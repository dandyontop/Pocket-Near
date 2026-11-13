import type { AgentPolicy, AgentStatus, MarketAgentCard, MarketAgentDetail, Asset, IntentSwap, QuoteInput, QuoteView, PriceRow, MarketSentiment, EarnProtocol, ExploreApp, ExploreGame, MemeBoard, MemeVote, NetworkOverview, FlywheelOverview, ThesisReport } from "@pocket-near/shared";

const API = import.meta.env.DEV ? import.meta.env.VITE_API_URL ?? "" : "";
export class ApiRequestError extends Error {
  constructor(message:string,readonly status:number){super(message);this.name="ApiRequestError";}
}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(`${API}${path}`,{...init,credentials:"include",headers:{"content-type":"application/json",...init.headers}});
  if(response.status===204)return undefined as T;
  const text=await response.text();
  let data:(T & {error?:string})|undefined;
  try{data=JSON.parse(text) as T & {error?:string};}catch{
    if(!response.ok)throw new ApiRequestError(text.trim()||`Request failed (${response.status})`,response.status);
    throw new Error("The API returned an invalid response.");
  }
  if(!data)throw new Error("The API returned an empty response.");
  if(!response.ok)throw new ApiRequestError(data.error??`Request failed (${response.status})`,response.status);
  return data;
}
export const api={
  me:()=>request<{accountId:string|null,passwordSet:boolean;agentEnabled:boolean;autoEnabled:boolean}>("/api/auth/me"),
  agentSettings:(data:{agentEnabled?:boolean;mode?:"off"|"notify_only";masterLock?:boolean;password?:string})=>request<{agentEnabled:boolean;mode:"off"|"notify_only"|"auto_inside_policy";masterLock:boolean;autoExecLock:boolean}>("/api/agent/settings",{method:"PUT",body:JSON.stringify(data)}),
  agentStatus:()=>request<AgentStatus>("/api/agent/status"),
  login:(initData:string)=>request<{authenticated:boolean}>("/api/auth/telegram",{method:"POST",body:JSON.stringify({initData})}),
  walletChallenge:(accountId:string)=>request<{message:string;recipient:string;nonce:string}>("/api/wallet/challenge",{method:"POST",body:JSON.stringify({accountId})}),
  walletVerify:(envelope:unknown)=>request<{accountId:string}>("/api/wallet/verify",{method:"POST",body:JSON.stringify(envelope)}),
  assets:()=>request<{assets:Asset[]}>("/api/assets"),
  memeBoard:()=>request<MemeBoard>("/api/meme/board"),
  rheaQuote:(input:{originAsset:string;destinationAsset:string;amount:string;sender:string;slippageToleranceBps:number})=>request<{quote:QuoteView;source:string;autoEligible:boolean}>("/api/rhea/quote",{method:"POST",body:JSON.stringify(input)}),
  voteMeme:(assetId:string,vote:MemeVote)=>request<{saved:boolean}>("/api/meme/vote",{method:"PUT",body:JSON.stringify({assetId,vote})}),
  policy:()=>request<{policy:{body:AgentPolicy;active:boolean}|null}>("/api/policy"),
  challenge:(accountId:string)=>request<{message:string;recipient:string;nonce:string}>("/api/policy/challenge",{method:"POST",body:JSON.stringify({accountId})}),
  savePolicy:(policy:AgentPolicy,envelope:unknown,password:string)=>request<{saved:boolean}>("/api/policy",{method:"PUT",headers:{"x-pocket-password":password},body:JSON.stringify({policy,envelope})}),
  savePassword:(password:string,currentPassword?:string)=>request<{saved:boolean}>("/api/security/password",{method:"POST",body:JSON.stringify({password,currentPassword})}),
  verifyUnlock:(password:string)=>request<{unlocked:boolean}>("/api/security/verify",{method:"POST",body:JSON.stringify({password})}),
  quote:(input:QuoteInput)=>request<{quote:QuoteView;source:string;autoEligible:boolean}>("/api/quotes",{method:"POST",body:JSON.stringify(input)}),
  startIntentSwap:(quoteId:string)=>request<{swap:IntentSwap;reused:boolean}>("/api/swaps/start",{method:"POST",body:JSON.stringify({quoteId})}),
  intentSwaps:()=>request<{swaps:IntentSwap[]}>("/api/swaps"),
  submitIntentDeposit:(id:string,txHash:string)=>request<{swap:IntentSwap}>(`/api/swaps/${encodeURIComponent(id)}/deposit`,{method:"POST",body:JSON.stringify({txHash})}),
  refreshIntentSwap:(id:string)=>request<{swap:IntentSwap}>(`/api/swaps/${encodeURIComponent(id)}/status`),
  evaluate:(quoteId:string,recordPreview=false,userInitiated=true)=>request<{decision:{allowed:boolean;reason?:string};executionMode:string;message:string}>("/api/agent/evaluate",{method:"POST",body:JSON.stringify({quoteId,recordPreview,userInitiated})}),
  events:()=>request<{events:Array<{event_type:string;details:Record<string,unknown>;created_at:string}>}>("/api/events"),
  portfolio:()=>request<{accountId:string;balances:Array<{assetId:string;symbol:string;amount:string;decimals:number;locked:string;source:string;blockHeight:number}>;failures:string[]}>("/api/portfolio"),
  investmentPreferences:()=>request<{preferences:{alertsEnabled:boolean;symbols:string[];positionMonitoring:boolean;reportFrequency:number;lastSuggestionAt:string|null;nextPositionReportAt:string|null}}>("/api/investments/preferences"),
  investmentOpportunities:()=>request<{pools:Array<{id:string;poolId:string;kind:string;tokens:string[];symbols:string[];tvlUsd:number;feeBps:number|null;feeApr24hRunRatePct:number|null;volume24hUsd:number|null;poolType:string|null;updatedAt:string;url:string}>;updatedAt:string;source:string;disclaimer:string;yields:{poolFeeApr:Array<{poolId:string;symbols:string[];valuePct:number|null;source:string;observedAt:string;basis:string}>;rnearStakingApy:{valuePct:number|null;source:string;observedAt:string;basis:string};farmRewardsApr:{valuePct:null;source:null;observedAt:null;basis:string};lendingSupplyApy:{valuePct:null;source:null;observedAt:null;basis:string}}}>("/api/investments/opportunities"),
  saveInvestmentPreferences:(preferences:{alertsEnabled:boolean;symbols:string[];positionMonitoring:boolean;reportFrequency:number})=>request<{preferences:{alertsEnabled:boolean;symbols:string[];positionMonitoring:boolean;reportFrequency:number;lastSuggestionAt:string|null;nextPositionReportAt:string|null}}>("/api/investments/preferences",{method:"PUT",body:JSON.stringify(preferences)}),
  positions:()=>request<{positions:Array<{id:string;tokenId:string;symbol:string;amount:string;decimals:number;valueUsd:number|null;kind:"deposit"|"rnear_staked"|"rnear_balance"|"rnear_pending";nearEquivalent:string|null;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null}>;source:string;height:number|null;coverage:string;rnear?:{apyPct:number|null;ftPrice:number|null;stakedNear:string;pendingNear:string;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null;source:string;observedAt:string}}>("/api/positions"),
  prices:()=>request<{rows:PriceRow[];source:string;updatedAt:string}>("/api/prices"),
  marketSentiment:()=>request<MarketSentiment>("/api/market/sentiment"),
  networkOverview:()=>request<NetworkOverview>("/api/network/overview"),
  flywheelOverview:()=>request<FlywheelOverview>("/api/flywheel/overview"),
  thesis:()=>request<ThesisReport>("/api/thesis",{method:"POST",body:JSON.stringify({})}),
  watchlist:()=>request<{symbols:string[]}>("/api/prices/watchlist"),
  saveWatchlist:(symbols:string[])=>request<{symbols:string[]}>("/api/prices/watchlist",{method:"PUT",body:JSON.stringify({symbols})}),
  alerts:()=>request<{alerts:Array<{id:number;symbol:string;op:"gte"|"lte";thresholdUsd:number;active:boolean;createdAt:string}>}>("/api/prices/alerts"),
  createAlert:(data:{symbol:string;op:"gte"|"lte";thresholdUsd:number})=>request<{alert:{id:number;symbol:string;op:"gte"|"lte";thresholdUsd:number;active:boolean;createdAt:string}}>("/api/prices/alerts",{method:"POST",body:JSON.stringify(data)}),
  deleteAlert:(id:number)=>request<void>(`/api/prices/alerts/${id}`,{method:"DELETE"}),
  setAlertActive:(id:number,active:boolean)=>request<{alert:{id:number;symbol:string;op:"gte"|"lte";thresholdUsd:number;active:boolean;createdAt:string}}>(`/api/prices/alerts/${id}`,{method:"PATCH",body:JSON.stringify({active})}),
  earn:()=>request<{protocols:EarnProtocol[];source:string;updatedAt:string}>("/api/earn"),
  apps:()=>request<{apps:ExploreApp[];source:string}>("/api/explore/apps"),
  games:()=>request<{games:ExploreGame[];source:string}>("/api/explore/games"),
  marketAgents:(query:string,category:string,cursor:string|null)=>request<{agents:MarketAgentCard[];nextCursor:string|null}>(`/api/market/agents?${new URLSearchParams({query,category,...(cursor?{cursor}:{})})}`),
  marketAgent:(id:string)=>request<{agent:MarketAgentDetail}>(`/api/market/agents/${encodeURIComponent(id)}`),
  discover:(itemType:"app"|"game"|"earn",itemId:string)=>request<{recorded:boolean}>("/api/discover/events",{method:"POST",body:JSON.stringify({itemType,itemId})}),
  logout:()=>request<void>("/api/auth/logout",{method:"POST"}),
};
