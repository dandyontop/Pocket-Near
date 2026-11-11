import { pool } from "./db.js";
import { runPriceAlertCheck } from "./priceAlertWorker.js";
import { runInvestmentWorker } from "./investmentWorker.js";
import { env } from "./env.js";

async function notifyTelegram(telegramId:number,text:string):Promise<void>{
  if(!env.TELEGRAM_BOT_TOKEN)throw new Error("Telegram bot token is not configured on the API host.");
  const response=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:telegramId,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(10_000),
  });
  if(!response.ok)throw new Error(`Telegram notification returned ${response.status}.`);
  const result=await response.json() as {ok?:boolean;description?:string};
  if(!result.ok)throw new Error(result.description??"Telegram rejected the notification.");
}

export async function runScheduledWorker():Promise<{skipped:boolean;priceAlerts:number;investment:{suggestions:number;positionReports:number;positionsChecked:number;unlockAlerts:number;errors:string[]};errors:string[]}>{
  const client=await pool.connect();
  try{
    const lock=await client.query<{locked:boolean}>("SELECT pg_try_advisory_lock(1952542064) AS locked");
    if(!lock.rows[0]?.locked)return {skipped:true,priceAlerts:0,investment:{suggestions:0,positionReports:0,positionsChecked:0,unlockAlerts:0,errors:[]},errors:[]};
    const errors:string[]=[];let priceAlerts=0;
    try{priceAlerts=await runPriceAlertCheck(notifyTelegram);}catch(error){errors.push(`Price alerts: ${error instanceof Error?error.message:"failed"}`);}
    let investment={suggestions:0,positionReports:0,positionsChecked:0,unlockAlerts:0,errors:[] as string[]};
    try{investment=await runInvestmentWorker(notifyTelegram);errors.push(...investment.errors);}catch(error){errors.push(`Investment worker: ${error instanceof Error?error.message:"failed"}`);}
    return {skipped:false,priceAlerts,investment,errors};
  }finally{
    try{await client.query("SELECT pg_advisory_unlock(1952542064)");}catch{/* Connection cleanup releases a session lock. */}
    client.release();
  }
}
