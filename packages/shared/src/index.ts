import { z } from "zod";

export const assetSchema = z.object({
  assetId: z.string().min(1).max(160), symbol: z.string().min(1).max(24),
  name: z.string().max(80).default(""), decimals: z.number().int().min(0).max(30),
  blockchain: z.string().max(40).default(""),
});
export type Asset = z.infer<typeof assetSchema>;

export const policySchema = z.object({
  version: z.literal(1),
  accountId: z.string().min(2).max(128),
  allowedPairs: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).min(1).max(30),
  maxTradeAmount: z.string().regex(/^\d+$/),
  dailyLimit: z.string().regex(/^\d+$/),
  weeklyLimit: z.string().regex(/^\d+$/),
  allowedDestinations: z.array(z.string().min(1).max(128)).min(1).max(20),
  timeWindows: z.array(z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.string().min(1).max(64) })).min(1).max(14),
  maxSlippageBps: z.number().int().min(1).max(500),
  freeze: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type AgentPolicy = z.infer<typeof policySchema>;

export const quoteInputSchema = z.object({
  originAsset: z.string().min(1).max(160), destinationAsset: z.string().min(1).max(160),
  amount: z.string().regex(/^[1-9]\d{0,77}$/),
  sender: z.string().min(2).max(128), refundTo:z.string().min(2).max(160), recipient: z.string().min(2).max(160),
  slippageToleranceBps: z.number().int().min(1).max(500).default(100),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export interface QuoteView {
  id: string; provider: "one-click" | "solver-relay" | "cache";
  originAsset: string; destinationAsset: string; amountIn: string; amountOut: string;
  amountOutFormatted?: string; route: string[]; fees: Array<{ asset: string; amount: string; kind: string }>;
  expiresAt: string; slippageBps: number; stale: boolean; depositAddress?: string;
  raw: Record<string, unknown>;
}

export interface PolicyUsage { dayAmount: string; weekAmount: string; dayKey: string; weekKey: string }
export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

const asBigInt = (value: string): bigint => {
  if (!/^\d+$/.test(value)) throw new Error("Amount must be an unsigned integer in base units.");
  return BigInt(value);
};

export function checkPolicy(policy: AgentPolicy, usage: PolicyUsage, quote: QuoteView, now = new Date()): PolicyDecision {
  if (policy.freeze) return { allowed: false, reason: "Agent is frozen. Unfreeze it in the policy settings." };
  if (quote.stale || Date.parse(quote.expiresAt) <= now.getTime()) return { allowed: false, reason: "Quote is stale or expired; fetch a fresh live quote." };
  if (!policy.allowedPairs.some(p => p.from === quote.originAsset && p.to === quote.destinationAsset)) return { allowed: false, reason: "This asset pair is outside the signed policy." };
  if (!policy.allowedDestinations.includes(quote.raw.recipient as string)) return { allowed: false, reason: "The recipient is not an allowed destination." };
  if (quote.slippageBps > policy.maxSlippageBps) return { allowed: false, reason: "Quote slippage exceeds the signed limit." };
  try {
    const amount = asBigInt(quote.amountIn);
    if (amount > asBigInt(policy.maxTradeAmount)) return { allowed: false, reason: "Amount exceeds the per-trade limit." };
    if (asBigInt(usage.dayAmount) + amount > asBigInt(policy.dailyLimit)) return { allowed: false, reason: "Amount exceeds the remaining daily limit." };
    if (asBigInt(usage.weekAmount) + amount > asBigInt(policy.weeklyLimit)) return { allowed: false, reason: "Amount exceeds the remaining weekly limit." };
  } catch { return { allowed: false, reason: "Policy or usage amounts are invalid." }; }
  const inWindow = policy.timeWindows.some(w => {
    let local: Intl.DateTimeFormatPart[];
    try { local = new Intl.DateTimeFormat("en-US", { timeZone:w.timezone, weekday:"short", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(now); }
    catch { return false; }
    const weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(local.find(p=>p.type==="weekday")?.value??"");
    const minute=Number(local.find(p=>p.type==="hour")?.value??"0")*60+Number(local.find(p=>p.type==="minute")?.value??"0");
    if (!w.days.includes(weekday)) return false;
    const [sh, sm] = w.start.split(":").map(Number), [eh, em] = w.end.split(":").map(Number);
    const start = sh! * 60 + sm!, end = eh! * 60 + em!;
    return start <= end ? minute >= start && minute <= end : minute >= start || minute <= end;
  });
  return inWindow ? { allowed: true } : { allowed: false, reason: "Current time is outside the signed policy window." };
}

export function canonicalPolicy(policy: AgentPolicy): string {
  return JSON.stringify({ ...policy, allowedPairs: [...policy.allowedPairs].sort((a,b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)), allowedDestinations: [...policy.allowedDestinations].sort(), timeWindows: [...policy.timeWindows].sort((a,b) => `${a.days.join(",")}:${a.start}`.localeCompare(`${b.days.join(",")}:${b.start}`)) });
}
