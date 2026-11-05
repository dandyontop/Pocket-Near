import type { AgentPolicy, Asset, QuoteInput, QuoteView } from "@pocket-near/shared";

const API = import.meta.env.DEV ? import.meta.env.VITE_API_URL ?? "" : "";
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await fetch(`${API}${path}`,{...init,credentials:"include",headers:{"content-type":"application/json",...init.headers}});
  if(response.status===204)return undefined as T;
  const data=await response.json() as T & {error?:string};
  if(!response.ok)throw new Error(data.error??`Request failed (${response.status})`);
  return data;
}
export const api={
  me:()=>request<{accountId:string|null,passwordSet:boolean;agentEnabled:boolean;autoEnabled:boolean}>("/api/auth/me"),
  agentSettings:(data:{agentEnabled?:boolean;autoEnabled?:boolean;password?:string})=>request<{agent_enabled:boolean;auto_enabled:boolean}>("/api/agent/settings",{method:"PUT",body:JSON.stringify(data)}),
  login:(initData:string)=>request<{authenticated:boolean}>("/api/auth/telegram",{method:"POST",body:JSON.stringify({initData})}),
  walletChallenge:(accountId:string)=>request<{message:string;recipient:string;nonce:string}>("/api/wallet/challenge",{method:"POST",body:JSON.stringify({accountId})}),
  walletVerify:(envelope:unknown)=>request<{accountId:string}>("/api/wallet/verify",{method:"POST",body:JSON.stringify(envelope)}),
  assets:()=>request<{assets:Asset[]}>("/api/assets"),
  policy:()=>request<{policy:{body:AgentPolicy;active:boolean}|null}>("/api/policy"),
  challenge:(accountId:string)=>request<{message:string;recipient:string;nonce:string}>("/api/policy/challenge",{method:"POST",body:JSON.stringify({accountId})}),
  savePolicy:(policy:AgentPolicy,envelope:unknown,password:string)=>request<{saved:boolean}>("/api/policy",{method:"PUT",headers:{"x-pocket-password":password},body:JSON.stringify({policy,envelope})}),
  savePassword:(password:string,currentPassword?:string)=>request<{saved:boolean}>("/api/security/password",{method:"POST",body:JSON.stringify({password,currentPassword})}),
  quote:(input:QuoteInput)=>request<{quote:QuoteView;source:string;autoEligible:boolean}>("/api/quotes",{method:"POST",body:JSON.stringify(input)}),
  evaluate:(quoteId:string,recordPreview=false)=>request<{decision:{allowed:boolean;reason?:string};executionMode:string;message:string}>("/api/agent/evaluate",{method:"POST",body:JSON.stringify({quoteId,recordPreview})}),
  execute:(quoteId:string,password:string)=>request<{error:string;requiresWalletSignature?:boolean}>("/api/agent/execute",{method:"POST",body:JSON.stringify({quoteId,password})}),
  events:()=>request<{events:Array<{event_type:string;details:Record<string,unknown>;created_at:string}>}>("/api/events"),
  logout:()=>request<void>("/api/auth/logout",{method:"POST"}),
};
