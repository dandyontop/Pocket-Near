import { createHash } from "node:crypto";
import { ApiError, OneClickService, OpenAPI, QuoteRequest, type QuoteResponse, type TokenResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { quoteInputSchema, type QuoteInput, type QuoteView } from "@pocket-near/shared";
import { pool } from "./db.js";
import { env } from "./env.js";

OpenAPI.BASE = env.ONE_CLICK_BASE_URL;
OpenAPI.TOKEN = env.ONE_CLICK_JWT || undefined;

const asObj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";

export class QuoteRequestError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "QuoteRequestError";
  }
}

export class QuoteProviderError extends Error {
  constructor(message: string, readonly status: number = 502, readonly retryable = true) {
    super(message);
    this.name = "QuoteProviderError";
  }
}

let tokenCache: { tokens: TokenResponse[]; expiresAt: number } | undefined;
let tokenRequest: Promise<TokenResponse[]> | undefined;

async function getTokens(): Promise<TokenResponse[]> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.tokens;
  if (!tokenRequest) {
    tokenRequest = OneClickService.getTokens()
      .then(tokens => {
        tokenCache = { tokens, expiresAt: Date.now() + 60_000 };
        return tokens;
      })
      .catch(error => {
        throw providerError(error, "The 1-Click asset catalog is unavailable.");
      })
      .finally(() => {
        tokenRequest = undefined;
      });
  }
  return tokenRequest;
}

const isNearAccount = (value: string): boolean =>
  value.length <= 64 && (/^[0-9a-f]{64}$/.test(value) || /^[a-z0-9_-]+(?:[.-][a-z0-9_-]+)*$/.test(value));

export async function validateQuoteInput(inputValue: unknown): Promise<QuoteInput> {
  const parsed = quoteInputSchema.safeParse(inputValue);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "request";
    if (field === "amount") throw new QuoteRequestError("Amount must be a positive integer in base units.");
    if (field === "slippageToleranceBps") throw new QuoteRequestError("Slippage tolerance must be between 1 and 500 basis points.");
    if (field === "originAsset" || field === "destinationAsset") throw new QuoteRequestError("Choose both assets from the 1-Click asset list.");
    if (field === "sender") throw new QuoteRequestError("Sender must be the connected NEAR account ID.");
    if (field === "recipient") throw new QuoteRequestError("Enter a valid recipient address.");
    if (field === "refundTo") throw new QuoteRequestError("Enter a valid refund address.");
    throw new QuoteRequestError("The quote request is invalid.");
  }

  const input = parsed.data;
  if (input.originAsset === input.destinationAsset) throw new QuoteRequestError("Choose two different assets.");
  if (!isNearAccount(input.sender)) throw new QuoteRequestError("Sender must be a valid NEAR account ID.");

  const tokens = await getTokens();
  const origin = tokens.find(token => token.assetId === input.originAsset);
  const destination = tokens.find(token => token.assetId === input.destinationAsset);
  if (!origin || !destination) throw new QuoteRequestError("Choose origin and destination asset IDs returned by /api/assets.");
  if (origin.blockchain === "near" && !isNearAccount(input.refundTo)) {
    throw new QuoteRequestError("The refund address for a NEAR asset must be a valid NEAR account ID.");
  }
  if (destination.blockchain === "near" && !isNearAccount(input.recipient)) {
    throw new QuoteRequestError("The recipient for a NEAR asset must be a valid NEAR account ID.");
  }
  if (/\s|[\u0000-\u001f]/.test(input.refundTo) || /\s|[\u0000-\u001f]/.test(input.recipient)) {
    throw new QuoteRequestError("Recipient and refund addresses cannot contain whitespace.");
  }
  return input;
}

function providerMessage(body: unknown): string | undefined {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 300);
  const data = asObj(body);
  const candidates = [data.message, data.error, data.detail, data.description];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 300);
    if (Array.isArray(candidate)) {
      const message = candidate.filter(item => typeof item === "string").join("; ");
      if (message) return message.slice(0, 300);
    }
  }
  return undefined;
}

function providerError(error: unknown, fallback: string): QuoteProviderError {
  if (error instanceof QuoteProviderError) return error;
  if (error instanceof ApiError) {
    const message = providerMessage(error.body) ?? fallback;
    if (error.status === 400 || error.status === 404 || error.status === 422) return new QuoteProviderError(message, 422, false);
    return new QuoteProviderError(message, 502, error.status === 429 || error.status >= 500);
  }
  return new QuoteProviderError(error instanceof Error && error.message ? error.message : fallback);
}

function expiryDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const numeric = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined;
  const millis = numeric === undefined ? Date.parse(raw) : numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  if (!Number.isFinite(millis)) return undefined;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalize(raw: unknown, input: QuoteInput, stale = false, dry = true): QuoteView {
  const root = asObj(raw);
  const providerErrorMessage = providerMessage(root);
  if (root.error || (typeof root.statusCode === "number" && root.statusCode >= 400)) {
    throw new QuoteProviderError(providerErrorMessage ?? "The 1-Click provider rejected the quote request.", 422, false);
  }
  const quote = asObj(root.quote ?? raw);
  const output = quote.amountOut ?? quote.amount_out ?? quote.expectedAmountOut ?? quote.expected_amount_out
    ?? root.amountOut ?? root.amount_out;
  const amountOut = str(output);
  if (!/^[1-9]\d*$/.test(amountOut)) {
    throw new QuoteProviderError(providerErrorMessage ?? "The 1-Click provider returned no valid output amount.");
  }

  const expiryCandidates = [
    quote.deadline, quote.expiresAt, quote.expires_at, quote.expirationTime, quote.expiration_time,
    quote.expiryTime, quote.expiry_time, quote.validUntil, quote.valid_until,
    root.deadline, root.expiresAt, root.expires_at, root.expirationTime, root.expiration_time,
    root.expiryTime, root.expiry_time, root.validUntil, root.valid_until,
  ];
  const providerExpiry = expiryCandidates.map(expiryDate).find((value): value is Date => Boolean(value && value.getTime() > Date.now()));
  const expiryWasProvided = expiryCandidates.some(value => value !== undefined && value !== null && String(value).trim() !== "");
  // Dry 1-Click responses omit quote.deadline; this short expiry is client-derived for previews only.
  const expiresAt = providerExpiry ?? (dry && !expiryWasProvided ? new Date(Date.now() + 55_000) : undefined);
  if (!expiresAt) throw new QuoteProviderError("The quote provider returned no valid expiry time.");

  const feeEstimate = asObj(quote.feeEstimation);
  const feeData = Array.isArray(quote.fees) ? quote.fees : Array.isArray(feeEstimate.underlyingFees) ? feeEstimate.underlyingFees : [];
  const fees = feeData.map(item => {
    const fee = asObj(item);
    return { asset: str(fee.asset ?? fee.assetId ?? fee.token ?? ""), amount: str(fee.amount ?? fee.value ?? ""), kind: str(fee.type ?? fee.name ?? "fee") };
  }).filter(fee => fee.amount !== "");
  for (const [field, asset, kind] of [
    ["refundFee", input.originAsset, "refund"],
    ["withdrawFee", input.destinationAsset, "withdraw"],
  ] as const) {
    const value = quote[field];
    if (value !== undefined && value !== null && /^\d+$/.test(str(value)) && !fees.some(fee => fee.kind === kind)) {
      fees.push({ asset, amount: str(value), kind });
    }
  }

  const routeRaw = Array.isArray(quote.route) ? quote.route : Array.isArray(quote.steps) ? quote.steps : [];
  const route = routeRaw.map(value => {
    const item = asObj(value);
    return str(item.name ?? item.provider ?? item.asset ?? value);
  }).filter(Boolean);
  const deposit = str(quote.depositAddress ?? quote.deposit_address);
  return {
    id: str(root.correlationId ?? quote.quoteId ?? quote.quote_hash ?? quote.id) || createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 20),
    provider: stale ? "cache" : "one-click",
    originAsset: input.originAsset,
    destinationAsset: input.destinationAsset,
    amountIn: str(quote.amountIn ?? quote.amount_in ?? input.amount),
    amountOut,
    ...(typeof quote.amountOutFormatted === "string" ? { amountOutFormatted: quote.amountOutFormatted } : {}),
    ...(/^[1-9]\d*$/.test(str(quote.minAmountOut ?? quote.min_amount_out)) ? { minAmountOut: str(quote.minAmountOut ?? quote.min_amount_out) } : {}),
    route,
    fees,
    expiresAt: expiresAt.toISOString(),
    slippageBps: input.slippageToleranceBps,
    stale,
    ...(deposit ? { depositAddress: deposit } : {}),
    raw: { ...quote, recipient: input.recipient },
  };
}

function quoteDeadline(origin: TokenResponse, destination: TokenResponse): string {
  const slowChains = new Set(["btc", "bch", "doge", "ltc"]);
  const timeoutMs = slowChains.has(origin.blockchain) || slowChains.has(destination.blockchain) ? 60 * 60_000 : 10 * 60_000;
  return new Date(Date.now() + timeoutMs).toISOString();
}

function quoteRequest(input: QuoteInput, origin: TokenResponse, destination: TokenResponse): QuoteRequest {
  return {
    dry: true,
    swapType: QuoteRequest.swapType.EXACT_INPUT,
    slippageTolerance: input.slippageToleranceBps,
    originAsset: input.originAsset,
    destinationAsset: input.destinationAsset,
    amount: input.amount,
    depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
    refundTo: input.refundTo,
    refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
    recipient: input.recipient,
    recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
    deadline: quoteDeadline(origin, destination),
  };
}

export async function fetchLiveQuote(inputValue: unknown): Promise<{ quote: QuoteView; source: "live" | "cached" }> {
  const input = await validateQuoteInput(inputValue);
  const tokens = await getTokens();
  const origin = tokens.find(token => token.assetId === input.originAsset)!;
  const destination = tokens.find(token => token.assetId === input.destinationAsset)!;
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  let quote: QuoteView;
  try {
    const response: QuoteResponse = await OneClickService.getQuote(quoteRequest(input, origin, destination));
    if (env.NODE_ENV === "development") {
      const responseObject = asObj(response);
      console.info("1-Click dry quote response shape", {
        rootKeys: Object.keys(responseObject),
        quoteKeys: Object.keys(asObj(responseObject.quote)),
      });
    }
    quote = normalize(response, input);
  } catch (error) {
    const failure = providerError(error, "The 1-Click quote provider is temporarily unavailable.");
    if (!failure.retryable) throw failure;
    const cached = await pool.query<{ quote: QuoteView }>(
      "SELECT quote FROM quote_cache WHERE cache_key=$1 AND cached_at > now() - ($2 * interval '1 second')",
      [key, env.QUOTE_CACHE_TTL_SECONDS],
    );
    if (cached.rowCount) return { quote: { ...cached.rows[0]!.quote, provider: "cache", stale: true }, source: "cached" };
    throw failure;
  }

  await pool.query(
    "INSERT INTO quote_cache(cache_key,quote,cached_at) VALUES($1,$2,now()) ON CONFLICT(cache_key) DO UPDATE SET quote=EXCLUDED.quote,cached_at=now()",
    [key, JSON.stringify(quote)],
  );
  return { quote, source: "live" };
}
