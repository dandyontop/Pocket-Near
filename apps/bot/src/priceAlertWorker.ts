import { getPrices } from "./dataFeeds.js";
import { pool } from "./db.js";

export function startPriceAlertWorker(notify:(telegramId:number,text:string)=>Promise<void>,intervalMs:number):()=>void{
  let running=false;
  const tick=async()=>{if(running)return;running=true;try{await runPriceAlertCheck(notify);}finally{running=false;}};
  const timer=setInterval(()=>void tick(),intervalMs);timer.unref();void tick();return()=>clearInterval(timer);
}

export async function runPriceAlertCheck(notify:(telegramId:number,text:string)=>Promise<void>):Promise<number>{
  let notified=0;
  try{
    const {rows}=await getPrices();const bySymbol=new Map(rows.map(r=>[r.symbol,r]));
    const {rows:alerts}=await pool.query<{id:string;user_id:string;telegram_id:string;symbol:string;op:"gte"|"lte";threshold_usd:string}>("SELECT a.id,a.user_id,u.telegram_id,a.symbol,a.op,a.threshold_usd::text FROM price_alerts a JOIN users u ON u.id=a.user_id WHERE a.active=true");
    for(const alert of alerts){const price=bySymbol.get(alert.symbol);if(!price)continue;const threshold=Number(alert.threshold_usd);const matched=alert.op==="gte"?price.priceUsd>=threshold:price.priceUsd<=threshold;if(!matched)continue;
      const client=await pool.connect();let inserted=false;let bucket="";try{await client.query("BEGIN");const stamp=await client.query<{bucket:string}>("SELECT date_trunc('day',now())::text AS bucket");bucket=stamp.rows[0]!.bucket;const result=await client.query("INSERT INTO price_alert_firings(alert_id,bucket) VALUES($1,$2::timestamptz) ON CONFLICT DO NOTHING RETURNING alert_id",[alert.id,bucket]);inserted=Boolean(result.rowCount);if(inserted)await client.query("UPDATE price_alerts SET last_fired_at=now() WHERE id=$1",[alert.id]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
      if(inserted){try{await notify(Number(alert.telegram_id),`Pocket Near price alert: ${price.symbol} is ${alert.op==="gte"?"at or above":"at or below"} ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(threshold)}. Current price: ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumSignificantDigits:6}).format(price.priceUsd)}.`);notified++;}catch(error){await pool.query("DELETE FROM price_alert_firings WHERE alert_id=$1 AND bucket=$2::timestamptz",[alert.id,bucket]);await pool.query("UPDATE price_alerts SET last_fired_at=NULL WHERE id=$1",[alert.id]);throw error;}}
    }
  }catch(error){console.error("Price alert worker failed",error);throw error;}
  return notified;
}
