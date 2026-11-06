import { JsonRpcProvider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { env } from "./env.js";

export const nearProvider = new JsonRpcProvider({ url: env.NEAR_RPC_URL });
export interface SignedPolicyEnvelope {
  accountId: string; publicKey: string; signature: string;
  payload: { message: string; recipient: string; nonce: string };
}
export async function verifyPolicySignature(envelope: SignedPolicyEnvelope): Promise<void> {
  const nonce = Buffer.from(envelope.payload.nonce,"base64");
  if (nonce.length !== 32) throw new Error("Policy signature nonce is invalid.");
  if (envelope.payload.recipient !== "Pocket Near") throw new Error("Policy signature recipient is invalid.");
  await verifyMessage({
    signerAccountId: envelope.accountId,
    signerPublicKey: envelope.publicKey,
    signature: new Uint8Array(Buffer.from(envelope.signature,"base64")),
    payload: { message: envelope.payload.message, recipient: envelope.payload.recipient, nonce },
    provider: nearProvider,
  });
}

export async function readNativeNearBalance(accountId:string):Promise<{amount:string;locked:string;available:string;blockHeight:number}>{
  const account=await nearProvider.viewAccount({accountId});
  const available=account.amount-account.locked;
  return {amount:account.amount.toString(),locked:account.locked.toString(),available:(available>0n?available:0n).toString(),blockHeight:account.block_height};
}
