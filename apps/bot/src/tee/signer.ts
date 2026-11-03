import { z } from "zod";
import { checkPolicy, policySchema, type AgentPolicy, type PolicyUsage, type QuoteView } from "../../../../packages/shared/dist/index.js";
import { env } from "../env.js";

export interface SignIntentInput { policy: AgentPolicy; quote: QuoteView; usage: PolicyUsage; intentPayload: unknown }
export interface SignIntentResult { signature?: string; attestation?: unknown; error?: string }
export interface TeeSigner { signIntent(input: SignIntentInput): Promise<SignIntentResult> }

const resultSchema=z.object({signature:z.string().min(1).optional(),attestation:z.unknown().optional(),error:z.string().optional()});
function validate(input:SignIntentInput):string|undefined {
  const parsed=policySchema.safeParse(input.policy);
  if(!parsed.success)return "Enclave rejected invalid policy.";
  const decision=checkPolicy(parsed.data,input.usage,input.quote);
  return decision.allowed?undefined:decision.reason;
}

export const teeSigner:TeeSigner={async signIntent(input){
  if(!env.TEE_SIGNER_ENABLED)return {error:"TEE signer is disabled; execution is fail-closed."};
  const blocked=validate(input);if(blocked)return {error:blocked};
  if(env.TEE_SIGNER_URL){
    try{
      const response=await fetch(env.TEE_SIGNER_URL,{method:"POST",headers:{"content-type":"application/json",...(env.TEE_SIGNER_API_KEY?{authorization:`Bearer ${env.TEE_SIGNER_API_KEY}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(10_000)});
      if(!response.ok)return {error:`TEE signer returned HTTP ${response.status}.`};
      const parsed=resultSchema.safeParse(await response.json());
      if(!parsed.success)return {error:"TEE signer response was invalid."};
      return parsed.data;
    }catch{return {error:"TEE signer is unreachable; execution is fail-closed."};}
  }
  if(env.NODE_ENV!=="development"||!env.DEV_ENCLAVE_PRIVATE_KEY)return {error:"TEE_SIGNER_URL is required outside development; DEV key is unavailable."};
  // The development enclave signs only the deterministic intent envelope and never submits it.
  const {createHmac}=await import("node:crypto");
  return {signature:createHmac("sha256",env.DEV_ENCLAVE_PRIVATE_KEY).update(JSON.stringify({policy:input.policy,quote:input.quote,intentPayload:input.intentPayload})).digest("base64url"),attestation:{mode:"DEV-ONLY",warning:"Not a TEE signature and not valid for mainnet settlement."}};
}};
