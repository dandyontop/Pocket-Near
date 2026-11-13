import { z } from "zod";

export const assetSchema = z.object({
  assetId: z.string().min(1).max(160), symbol: z.string().min(1).max(24),
  name: z.string().max(80).default(""), decimals: z.number().int().min(0).max(30),
  blockchain: z.string().max(40).default(""),
});
export type Asset = z.infer<typeof assetSchema>;
export const memeVoteSchema = z.enum(["bull","bear"]);
export type MemeVote = z.infer<typeof memeVoteSchema>;
export interface MemeBoardAsset extends Asset {
  bullVotes: number;
  bearVotes: number;
  userVote: MemeVote | null;
  poolAddress?: string;
  poolName?: string;
  poolType?: string | null;
  poolFeePct?: number | null;
  priceUsd?: number | null;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  trades24h?: number | null;
  priceChange24hPct?: number | null;
  frozen?: boolean | null;
  poolUrl?: string;
}
export interface MemeBoard {
  status: "live" | "coming_soon";
  assets: MemeBoardAsset[];
}

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
  id: string; provider: "one-click" | "cache" | "rhea";
  originAsset: string; destinationAsset: string; amountIn: string; amountOut: string;
  amountOutFormatted?: string; minAmountOut?: string; route: string[]; fees: Array<{ asset: string; amount: string; kind: string }>;
  expiresAt: string; slippageBps: number; stale: boolean; depositAddress?: string;
  raw: Record<string, unknown>;
}

export interface PolicyUsage { dayAmount: string; weekAmount: string; dayKey: string; weekKey: string }
export type PolicyDecision = { allowed: true } | { allowed: false; reason: string };

export const priceRowSchema = z.object({ id:z.string(), symbol:z.string(), name:z.string(), priceUsd:z.number().nonnegative(), change24hPct:z.number().nullable(), marketCap:z.number().nonnegative().nullable(), source:z.string(), updatedAt:z.string().datetime() });
export type PriceRow = z.infer<typeof priceRowSchema>;
export const priceAlertSchema = z.object({ id:z.number().int().positive().optional(), symbol:z.string().min(1).max(24), op:z.enum(["gte","lte"]), thresholdUsd:z.number().positive(), active:z.boolean().default(true) });
export type PriceAlert = z.infer<typeof priceAlertSchema>;
export const earnProtocolSchema = z.object({ id:z.string(), name:z.string(), category:z.string(), tvl:z.number().nonnegative(), change1d:z.number().nullable(), change7d:z.number().nullable(), url:z.string().url(), logo:z.string().url().optional() });
export type EarnProtocol = z.infer<typeof earnProtocolSchema>;
export const exploreAppSchema = z.object({ id:z.string(), name:z.string(), slug:z.string(), category:z.enum(["DeFi","AI","Social","Tools","Bridges","Wallets","Other"]), blurb:z.string(), url:z.string().url(), tvl:z.number().nonnegative().optional(), featured:z.boolean().default(false) });
export type ExploreApp = z.infer<typeof exploreAppSchema>;
export const exploreGameSchema = z.object({ id:z.string(), name:z.string(), blurb:z.string(), url:z.string().url(), tags:z.array(z.string()) });
export type ExploreGame = z.infer<typeof exploreGameSchema>;
export const agentModeSchema=z.enum(["off","notify_only","auto_inside_policy"]);
export type AgentMode=z.infer<typeof agentModeSchema>;
export const agentStatusSchema = z.object({ agentEnabled:z.boolean(), mode:agentModeSchema, masterLock:z.boolean(), autoExecLock:z.boolean(), freeze:z.boolean(), passwordSet:z.boolean(), policyActive:z.boolean(), lastRunAt:z.string().nullable(), lastError:z.string().nullable(), policy:policySchema.nullable(), lastEvents:z.array(z.object({event_type:z.string(),details:z.record(z.unknown()),created_at:z.string()})) });
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export const marketAgentCardSchema=z.object({id:z.string(),name:z.string(),tagline:z.string(),description:z.string().optional(),priceLabel:z.string(),currency:z.string().optional(),category:z.string().optional(),tags:z.array(z.string()),builderName:z.string().optional(),hireUrl:z.string().url(),detailUrl:z.string().url(),rawUpdatedAt:z.string().optional()});
export type MarketAgentCard=z.infer<typeof marketAgentCardSchema>;
export const marketAgentDetailSchema=marketAgentCardSchema.extend({description:z.string(),bioMarkdown:z.string().optional(),deliveredJobs:z.number().nonnegative().optional(),successRate:z.number().min(0).max(1).optional(), responseTimeSeconds:z.number().nonnegative().optional()});
export type MarketAgentDetail=z.infer<typeof marketAgentDetailSchema>;

export const networkOverviewPairSchema=z.object({
  pair:z.string(),
  originAsset:z.string(),
  destinationAsset:z.string(),
  volumeUsd:z.number().nonnegative().finite(),
  txCount:z.number().int().nonnegative(),
  label:z.string().optional(),
});
export const networkOverviewAssetSchema=z.object({
  asset:z.string(),
  volumeUsd:z.number().nonnegative().finite(),
  txCount:z.number().int().nonnegative(),
  label:z.string().optional(),
});
export const networkOverviewSchema=z.object({
  windowStart:z.string().datetime(),
  windowEnd:z.string().datetime(),
  volumeUsd24h:z.number().nonnegative().finite(),
  txCount24h:z.number().int().nonnegative(),
  statusCounts24h:z.record(z.number().int().nonnegative()),
  successRate24h:z.number().min(0).max(1).finite(),
  topPairs24h:z.array(networkOverviewPairSchema),
  topOrigins24h:z.array(networkOverviewAssetSchema).optional(),
  topDestinations24h:z.array(networkOverviewAssetSchema).optional(),
  peers:z.array(z.object({
    id:z.string(),
    name:z.string(),
    metricKind:z.enum(["fees24h","volume24h"]),
    valueUsd:z.number().nonnegative().finite().nullable(),
    source:z.string(),
    note:z.string().optional(),
  })).optional(),
  source:z.literal("near-intents-explorer"),
  updatedAt:z.string().datetime(),
  partial:z.boolean(),
  methodology:z.string(),
});
export type NetworkOverview=z.infer<typeof networkOverviewSchema>;

export const curatedExploreApps: ExploreApp[] = [
  {id:"ref-finance",name:"Rhea Finance",slug:"rhea-finance",category:"DeFi",blurb:"NEAR decentralized exchange and liquidity markets.",url:"https://rhea.finance",featured:true},
  {id:"burrow",name:"Burrow",slug:"burrow",category:"DeFi",blurb:"Lending and borrowing markets on NEAR.",url:"https://app.burrow.finance",featured:true},
  {id:"near-intents",name:"NEAR Intents",slug:"near-intents",category:"Bridges",blurb:"Move assets across chains through solver-based intents.",url:"https://near-intents.org",featured:true},
  {id:"market-near",name:"NEAR AI Agent Market",slug:"agent-market",category:"AI",blurb:"Discover, hire, or list agents in the NEAR ecosystem.",url:"https://market.near.ai",featured:true},
  {id:"near-wallet",name:"MyNearWallet",slug:"mynearwallet",category:"Wallets",blurb:"A browser wallet for the NEAR ecosystem.",url:"https://mynearwallet.com",featured:false},
  {id:"near-docs",name:"NEAR Documentation",slug:"near-docs",category:"Tools",blurb:"Developer guides and ecosystem documentation.",url:"https://docs.near.org",featured:false},
  {id:"meteor-wallet",name:"Meteor Wallet",slug:"meteor-wallet",category:"Wallets",blurb:"A self-custody wallet for NEAR apps.",url:"https://meteorwallet.app",featured:false},
  {id:"learn-near",name:"Learn NEAR",slug:"learn-near",category:"Social",blurb:"Community learning resources for the NEAR ecosystem.",url:"https://learnnear.club",featured:false},
];
export const curatedExploreGames: ExploreGame[] = [
  {id:"near-games",name:"NEAR Games",blurb:"Explore community games and game projects in the NEAR ecosystem.",url:"https://near.org/ecosystem?category=Gaming",tags:["Community","Games"]},
  {id:"playember",name:"Play Ember",blurb:"Discover blockchain games and gaming communities.",url:"https://playember.com",tags:["Games","Community"]},
];
export const curatedEarnFallback: EarnProtocol[] = [
  {id:"rhea-finance",name:"Rhea Finance",category:"Dexes",tvl:0,change1d:null,change7d:null,url:"https://rhea.finance"},
  {id:"burrow",name:"Burrow",category:"Lending",tvl:0,change1d:null,change7d:null,url:"https://app.burrow.finance"},
];

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
