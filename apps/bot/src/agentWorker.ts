import { checkPolicy, policySchema, type QuoteInput } from "@pocket-near/shared";
import { pool } from "./db.js";
import { fetchLiveQuote } from "./quotes.js";

export type AgentNotify=(telegramId:number,text:string,quoteId:string)=>Promise<void>;
export function startAgentWorker(notify:AgentNotify,intervalMs:number):()=>void {
  let running=false;
  const tick=async()=>{
    if(running)return;running=true;
    try{
      const {rows}=await pool.query<{id:string;telegram_id:string;account_id:string;body:unknown}>("SELECT u.id,u.telegram_id,u.account_id,p.body FROM users u JOIN policies p ON p.user_id=u.id WHERE u.telegram_id IS NOT NULL AND u.agent_enabled=true AND u.agent_mode='notify_only' AND u.master_lock=false AND p.active=true AND u.account_id IS NOT NULL");
      for(const row of rows){
        try{
          const policy=policySchema.parse(row.body);if(policy.freeze){await pool.query("UPDATE users SET last_run_at=now(),last_error='Emergency freeze active' WHERE id=$1",[row.id]);continue;}
          for(const pair of policy.allowedPairs){
            const destination=policy.allowedDestinations[0];if(!destination)continue;
            const input:QuoteInput={originAsset:pair.from,destinationAsset:pair.to,amount:policy.maxTradeAmount,sender:row.account_id,recipient:destination,refundTo:row.account_id,slippageToleranceBps:policy.maxSlippageBps};
            const {quote}=await fetchLiveQuote(input);
            await pool.query("INSERT INTO live_quotes(user_id,quote_id,quote) VALUES($1,$2,$3) ON CONFLICT(user_id,quote_id) DO UPDATE SET quote=EXCLUDED.quote,created_at=now()",[row.id,quote.id,JSON.stringify(quote)]);
            const usage=await pool.query<{day_amount:string;week_amount:string}>(`SELECT COALESCE(sum((details->>'amountIn')::numeric) FILTER(WHERE created_at::date=now()::date),0)::text day_amount,COALESCE(sum((details->>'amountIn')::numeric) FILTER(WHERE created_at>=date_trunc('week',now())),0)::text week_amount FROM execution_events WHERE user_id=$1 AND event_type IN ('submitted','success')`,[row.id]);
            const now=new Date(),dayKey=now.toISOString().slice(0,10),weekKey=`${now.getUTCFullYear()}-${Math.ceil((Number(dayKey.slice(5,7))*31+Number(dayKey.slice(8,10)))/7)}`;
            const decision=checkPolicy(policy,{dayAmount:usage.rows[0]?.day_amount??"0",weekAmount:usage.rows[0]?.week_amount??"0",dayKey,weekKey},quote,now);
            if(!decision.allowed){await pool.query("INSERT INTO execution_events(user_id,event_type,details) SELECT $1,'blocked',$2 WHERE NOT EXISTS(SELECT 1 FROM execution_events WHERE user_id=$1 AND event_type='blocked' AND details->>'quoteId'=$3 AND created_at>now()-interval '15 minutes')",[row.id,JSON.stringify({quoteId:quote.id,reason:decision.reason,source:"agent-worker"}),quote.id]);continue;}
            const inserted=await pool.query("INSERT INTO execution_events(user_id,event_type,details) SELECT $1,'preview',$2 WHERE NOT EXISTS(SELECT 1 FROM execution_events WHERE user_id=$1 AND event_type='preview' AND details->>'source'='agent-worker' AND created_at>now()-interval '2 minutes') RETURNING id",[row.id,JSON.stringify({quoteId:quote.id,amountIn:quote.amountIn,amountOut:quote.amountOut,source:"agent-worker",mode:"notify_only",submitted:false})]);
            await pool.query("UPDATE users SET last_run_at=now(),last_error=NULL WHERE id=$1",[row.id]);
            if(inserted.rowCount)await notify(Number(row.telegram_id),`Policy match found.\n${quote.amountIn} ${quote.originAsset} → ${quote.amountOut} ${quote.destinationAsset}\nNo transaction was submitted. Open Pocket Near to review; every swap requires your wallet approval.`,quote.id);
          }
        }catch(error){await pool.query("UPDATE users SET last_error=$1 WHERE id=$2",[error instanceof Error?error.message:"Agent scan failed",row.id]).catch(()=>{});console.warn("Agent worker user scan failed",row.id,error);}
      }
    }catch(error){console.error("Agent worker scan failed",error);}finally{running=false;}
  };
  const timer=setInterval(()=>void tick(),intervalMs);timer.unref();void tick();return()=>clearInterval(timer);
}
