import { intentSwapStatusSchema } from "@pocket-near/shared";
import { pool } from "./db.js";
import { getExecutionStatus } from "./quotes.js";

export async function runIntentSwapWorker():Promise<{checked:number;updated:number;errors:string[]}>{
  await pool.query(`UPDATE intent_swaps SET status='EXPIRED',status_details=COALESCE(status_details,'{}'::jsonb)||jsonb_build_object('expiredAt',now(),'expiryReason','quote expired before a deposit transaction was recorded'),updated_at=now()
    WHERE status='PENDING_DEPOSIT' AND deposit_tx_hash IS NULL AND CASE WHEN quote->>'expiresAt' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (quote->>'expiresAt')::timestamptz<=now() ELSE false END`);
  const {rows}=await pool.query<{id:string;deposit_address:string;deposit_memo:string|null;status:string}>(
    "SELECT id,deposit_address,deposit_memo,status FROM intent_swaps WHERE status IN ('PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING') ORDER BY updated_at ASC LIMIT 5",
  );
  let updated=0;const errors:string[]=[];
  await Promise.all(rows.map(async swap=>{
    try{
      const response=await getExecutionStatus(swap.deposit_address,swap.deposit_memo??undefined);
      const status=intentSwapStatusSchema.safeParse(response.status);
      if(!status.success)throw new Error("1-Click returned an unsupported swap status.");
      const hashes=response.swapDetails?.originChainTxHashes;
      const depositHash=Array.isArray(hashes)?hashes.find(item=>typeof item?.hash==="string")?.hash??null:null;
      const details={updatedAt:response.updatedAt,swapDetails:response.swapDetails};
      const result=await pool.query(
        "UPDATE intent_swaps SET status=$2,deposit_tx_hash=COALESCE(deposit_tx_hash,$3),status_details=$4,updated_at=now() WHERE id=$1 AND status IN ('PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING')",
        [swap.id,status.data,depositHash,JSON.stringify(details)],
      );
      if(result.rowCount)updated++;
    }catch(error){errors.push(`${swap.id}: ${error instanceof Error?error.message:"status check failed"}`);}
  }));
  return {checked:rows.length,updated,errors};
}
