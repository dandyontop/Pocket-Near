import type { AgentPolicy, AgentStatus, MarketAgentCard, MarketAgentDetail, Asset, QuoteInput, QuoteView, PriceRow, EarnProtocol, ExploreApp, ExploreGame, MemeBoard, MemeVote } from "@pocket-near/shared";

const API = import.meta.env.DEV ? import.meta.env.VITE_API_URL ?? "" : "";
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(`${API}${path}`,{...init,credentials:"include",headers:{"content-type":"application/json",...init.headers}});
  if(response.status===204)return undefined as T;
  const data=await response.json() as T & {error?:string};
  if(!response.ok&&!(path==="/api/agent/execute"&&Boolean((data as {requiresWalletSignature?:boolean}).requiresWalletSignature)))throw new Error(data.error??`Request failed (${response.status})`);
  return data;
}
export const api={
  me:()=>request<{accountId:string|null,passwordSet:boolean;agentEnabled:boolean;autoEnabled:boolean}>("/api/auth/me"),
  agentSettings:(data:{agentEnabled?:boolean;mode?:"off"|"notify_only"|"auto_inside_policy";masterLock?:boolean;autoExecLock?:boolean;password?:string})=>request<{agentEnabled:boolean;mode:"off"|"notify_only"|"auto_inside_policy";masterLock:boolean;autoExecLock:boolean}>("/api/agent/settings",{method:"PUT",body:JSON.stringify(data)}),
  agentStatus:()=>request<AgentStatus>("/api/agent/status"),
  login:(initData:string)=>request<{authenticated:boolean}>("/api/auth/telegram",{method:"POST",body:JSON.stringify({initData})}),
  walletChallenge:(accountId:string)=>request<{message:string;recipient:string;nonce:string}>("/api/wallet/challenge",{method:"POST",body:JSON.stringify({accountId})}),
  walletVerify:(envelope:unknown)=>request<{accountId:string}>("/api/wallet/verify",{method:"POST",body:JSON.stringify(envelope)}),
  assets:()=>request<{assets:Asset[]}>("/api/assets"),
  memeBoard:()=>request<MemeBoard>("/api/meme/board"),
  voteMeme:(assetId:string,vote:MemeVote)=>request<{saved:boolean}>("/api/meme/vote",{method:"PUT",body:JSON.stringify({assetId,vote})}),
  policy:()=>request<{policy:{body:AgentPolicy;active:boolean}|null}>("/api/policy"),
  challenge:(accountId:string)=>request<{message:string;recipient:string;nonce:string}>("/api/policy/challenge",{method:"POST",body:JSON.stringify({accountId})}),
  savePolicy:(policy:AgentPolicy,envelope:unknown,password:string)=>request<{saved:boolean}>("/api/policy",{method:"PUT",headers:{"x-pocket-password":password},body:JSON.stringify({policy,envelope})}),
  savePassword:(password:string,currentPassword?:string)=>request<{saved:boolean}>("/api/security/password",{method:"POST",body:JSON.stringify({password,currentPassword})}),
  verifyUnlock:(password:string)=>request<{unlocked:boolean}>("/api/security/verify",{method:"POST",body:JSON.stringify({password})}),
  quote:(input:QuoteInput)=>request<{quote:QuoteView;source:string;autoEligible:boolean}>("/api/quotes",{method:"POST",body:JSON.stringify(input)}),
  evaluate:(quoteId:string,recordPreview=false,userInitiated=true)=>request<{decision:{allowed:boolean;reason?:string};executionMode:string;message:string}>("/api/agent/evaluate",{method:"POST",body:JSON.stringify({quoteId,recordPreview,userInitiated})}),
  execute:(quoteId:string,password:string)=>request<{error:string;requiresWalletSignature?:boolean;signed?:boolean;attestation?:unknown}>("/api/agent/execute",{method:"POST",body:JSON.stringify({quoteId,password,userInitiated:true})}),
  events:()=>request<{events:Array<{event_type:string;details:Record<string,unknown>;created_at:string}>}>("/api/events"),
  portfolio:()=>request<{accountId:string;balances:Array<{assetId:string;symbol:string;amount:string;decimals:number;locked:string;source:string;blockHeight:number}>;failures:string[]}>("/api/portfolio"),
  prices:()=>request<{rows:PriceRow[];source:string;updatedAt:string}>("/api/prices"),
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
