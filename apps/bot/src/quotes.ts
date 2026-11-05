import { createHash } from "node:crypto";
import { OneClickService, OpenAPI, QuoteRequest } from "@defuse-protocol/one-click-sdk-typescript";
import { quoteInputSchema, type QuoteInput, type QuoteView } from "@pocket-near/shared";
import { pool } from "./db.js";
import { env } from "./env.js";

OpenAPI.BASE = env.ONE_CLICK_BASE_URL;
OpenAPI.TOKEN = env.ONE_CLICK_JWT || undefined;
const asObj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";

function normalize(raw: unknown, input: QuoteInput, stale = false): QuoteView {
  const root = asObj(raw), quote = asObj(root.quote ?? raw);
  const out = str(quote.amountOut ?? quote.amount_out ?? quote.minAmountOut ?? quote.expectedAmountOut);
  if (!/^\d+$/.test(out)) throw new Error("The quote provider returned no valid output amount.");
  const expires = str(quote.expirationTime ?? quote.expiration_time ?? quote.deadline ?? quote.expiryTime ?? root.expirationTime);
  if (!expires || !Number.isFinite(Date.parse(expires))) throw new Error("The quote provider returned no valid expiry time.");
  const expiresAt = new Date(expires).toISOString();
  const feeEstimate=asObj(quote.feeEstimation);
  const feeData = Array.isArray(quote.fees) ? quote.fees : Array.isArray(feeEstimate.underlyingFees) ? feeEstimate.underlyingFees : [];
  const fees = feeData.map((item) => { const f = asObj(item); return { asset: str(f.asset ?? f.token ?? ""), amount: str(f.amount ?? "0"), kind: str(f.type ?? f.name ?? "fee") }; });
  const routeRaw = Array.isArray(quote.route) ? quote.route : Array.isArray(quote.steps) ? quote.steps : [];
  const route = routeRaw.map((v) => { const o = asObj(v); return str(o.name ?? o.provider ?? o.asset ?? v); }).filter(Boolean);
  const deposit = str(quote.depositAddress ?? quote.deposit_address);
  return {
    id: str(root.correlationId ?? quote.quoteId ?? quote.quote_hash ?? quote.id) || createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0,20),
    provider: stale ? "cache" : "one-click", originAsset: input.originAsset, destinationAsset: input.destinationAsset,
    amountIn: input.amount, amountOut: out, ...(typeof quote.amountOutFormatted === "string" ? { amountOutFormatted: quote.amountOutFormatted } : {}),
    route: route.length ? route : [input.originAsset, input.destinationAsset], fees, expiresAt,
    slippageBps: input.slippageToleranceBps, stale,
    ...(deposit ? { depositAddress: deposit } : {}), raw: { ...quote, recipient: input.recipient },
  };
}

export async function fetchLiveQuote(inputValue: unknown): Promise<{ quote: QuoteView; source: "live" | "cached" }> {
  const input = quoteInputSchema.parse(inputValue);
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const request = {
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
    deadline: new Date(Date.now() + 60_000).toISOString(),
  } as QuoteRequest;
  try {
    const raw = await OneClickService.getQuote(request);
    const quote = normalize(raw,input);
    await pool.query("INSERT INTO quote_cache(cache_key,quote,cached_at) VALUES($1,$2,now()) ON CONFLICT(cache_key) DO UPDATE SET quote=EXCLUDED.quote,cached_at=now()",[key,JSON.stringify(quote)]);
    return { quote, source: "live" };
  } catch (error) {
    if(env.ONE_CLICK_JWT){
      try{
        const response=await fetch(env.SOLVER_RELAY_URL,{method:"POST",headers:{"content-type":"application/json","x-api-key":env.ONE_CLICK_JWT},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"quote",params:[{defuse_asset_identifier_in:input.originAsset,defuse_asset_identifier_out:input.destinationAsset,exact_amount_in:input.amount,min_deadline_ms:Math.max(1000,Date.parse(new Date(Date.now()+60_000).toISOString())-Date.now())}]}),signal:AbortSignal.timeout(5_000)});
        if(!response.ok)throw new Error(`Solver relay returned ${response.status}.`);
        const envelope=asObj(await response.json()), result=envelope.result;
        const candidates=Array.isArray(result)?result:[];
        const best=candidates.map(v=>asObj(v)).filter(v=>/^\d+$/.test(str(v.amount_out))).sort((a,b)=>BigInt(str(a.amount_out))>BigInt(str(b.amount_out))?-1:1)[0];
        if(best){
          const normalized=normalize(best,input);
          const relayQuote={...normalized,provider:"solver-relay" as const};
          await pool.query("INSERT INTO quote_cache(cache_key,quote,cached_at) VALUES($1,$2,now()) ON CONFLICT(cache_key) DO UPDATE SET quote=EXCLUDED.quote,cached_at=now()",[key,JSON.stringify(relayQuote)]);
          return {quote:relayQuote,source:"live"};
        }
      }catch{/* use short-lived cache after both live sources fail */}
    }
    const cached = await pool.query<{ quote: QuoteView; cached_at: Date }>("SELECT quote,cached_at FROM quote_cache WHERE cache_key=$1 AND cached_at > now() - ($2 * interval '1 second')",[key,env.QUOTE_CACHE_TTL_SECONDS]);
    if (cached.rowCount) return { quote: { ...cached.rows[0]!.quote, provider: "cache", stale: true }, source: "cached" };
    throw error;
  }
}
