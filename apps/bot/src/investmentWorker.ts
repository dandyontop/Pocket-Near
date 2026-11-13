import { pool } from "./db.js";
import { getNearStablePools } from "./investmentPools.js";
import { getRheaPositions, type RheaPosition } from "./rheaPositions.js";

export type WorkerNotify=(telegramId:number,text:string)=>Promise<void>;
type Preference={user_id:string;telegram_id:string;account_id:string|null;alerts_enabled:boolean;symbols:string[];position_monitoring:boolean;report_frequency:number;last_position_check_at:string|null};
const usd=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value);

function selectedPool(symbols:string[],poolSymbols:string[]):boolean{
  const wanted=new Set(symbols.map(value=>value.toUpperCase()));
  return poolSymbols.some(value=>wanted.has(value.toUpperCase()));
}

function formatUnits(raw:string,decimals:number):string{
  try{
    const value=BigInt(raw),base=10n**BigInt(decimals);
    if(decimals===0)return value.toString();
    const whole=value/base;
    const fraction=(value%base).toString().padStart(decimals,"0").replace(/0+$/g,"");
    return fraction?`${whole}.${fraction}`:whole.toString();
  }catch{return raw;}
}

function signedDelta(current:string,previous:string,decimals:number):string{
  try{
    const delta=BigInt(current)-BigInt(previous);
    if(delta===0n)return "no balance change";
    return `${delta>0n?"+":"−"}${formatUnits((delta>0n?delta:-delta).toString(),decimals)}`;
  }catch{return "change unavailable";}
}

async function sendPoolSuggestion(user:Preference,notify:WorkerNotify):Promise<boolean>{
  if(!user.alerts_enabled)return false;
  const feed=await getNearStablePools();
  const opportunity=feed.pools.find(item=>selectedPool(user.symbols,item.symbols));
  if(!opportunity)return false;
  const claimed=await pool.query<{last_suggestion_at:string}>(`UPDATE investment_preferences SET last_suggestion_at=now(),updated_at=now()
    WHERE user_id=$1 AND alerts_enabled=true AND (last_suggestion_at IS NULL OR last_suggestion_at<=now()-interval '48 hours')
    RETURNING last_suggestion_at`,[user.user_id]);
  if(!claimed.rowCount)return false;
  const poolLabel=opportunity.symbols.join(" / ");
  const fee=opportunity.feeBps===null?"fee data unavailable":`${(opportunity.feeBps/100).toFixed(2)}% swap fee`;
  const feeRunRate=opportunity.feeApr24hRunRatePct===null?"Fee APR unavailable from the verified pool data.":`Indicative 24h fee run-rate: ${opportunity.feeApr24hRunRatePct.toFixed(2)}% annualized (recent volume × fee × 80% LP share ÷ TVL). This is not a forecast or realized account yield.`;
  const text=[
    `Pocket Near pool alert: ${poolLabel} on Rhea`,
    `Reported pool TVL: ${usd(opportunity.tvlUsd)} · ${fee}`,
    feeRunRate,
    `Pool type: ${opportunity.poolType??"not classified"} · 24h volume: ${opportunity.volume24hUsd===null?"unavailable":usd(opportunity.volume24hUsd)}. Data is from ${new Date(opportunity.updatedAt).toLocaleString("en-US",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})} UTC.`,
    opportunity.url,
    "Not financial advice. Fee run-rate changes as trading, fees and TVL change; it excludes impermanent loss, token-price movement, depegs, CLMM range risk and reward-token incentives. Your position may lose value and requires active management.",
  ].join("\n");
  try{await notify(Number(user.telegram_id),text);return true;}
  catch(error){await pool.query("UPDATE investment_preferences SET last_suggestion_at=NULL WHERE user_id=$1 AND last_suggestion_at=$2",[user.user_id,claimed.rows[0]!.last_suggestion_at]);throw error;}
}

async function savePositionCheck(user:Preference,positions:RheaPosition[]):Promise<Array<{symbol:string;amount:string;reportedAmount:string;decimals:number;valueUsd:number|null;firstSeenAt:string}>>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(const position of positions){
      await client.query(`INSERT INTO position_snapshots(user_id,position_id,token_id,symbol,amount_raw,reported_amount_raw,decimals,value_usd,first_seen_at,observed_at)
        VALUES($1,$2,$3,$4,$5,$5,$6,$7,now(),now())
        ON CONFLICT(user_id,position_id) DO UPDATE SET token_id=EXCLUDED.token_id,symbol=EXCLUDED.symbol,amount_raw=EXCLUDED.amount_raw,decimals=EXCLUDED.decimals,value_usd=EXCLUDED.value_usd,observed_at=now()`,
      [user.user_id,position.id,position.tokenId,position.symbol,position.amount,position.decimals,position.valueUsd]);
    }
    const active=positions.map(position=>position.id);
    if(active.length)await client.query("UPDATE position_snapshots SET amount_raw='0',value_usd=NULL,observed_at=now() WHERE user_id=$1 AND NOT(position_id=ANY($2::text[])) AND observed_at<now()",[user.user_id,active]);
    else await client.query("UPDATE position_snapshots SET amount_raw='0',value_usd=NULL,observed_at=now() WHERE user_id=$1",[user.user_id]);
    await client.query("UPDATE investment_preferences SET last_position_check_at=now(),updated_at=now() WHERE user_id=$1",[user.user_id]);
    const rows=await client.query<{symbol:string;amount_raw:string;reported_amount_raw:string;decimals:number;value_usd:string|null;first_seen_at:string}>("SELECT symbol,amount_raw,reported_amount_raw,decimals,value_usd::text,first_seen_at FROM position_snapshots WHERE user_id=$1 ORDER BY first_seen_at",[user.user_id]);
    await client.query("COMMIT");
    return rows.rows.map(row=>({symbol:row.symbol,amount:row.amount_raw,reportedAmount:row.reported_amount_raw,decimals:row.decimals,valueUsd:row.value_usd===null?null:Number(row.value_usd),firstSeenAt:row.first_seen_at}));
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function sendPositionReport(user:Preference,positions:Array<{symbol:string;amount:string;reportedAmount:string;decimals:number;valueUsd:number|null;firstSeenAt:string}>,notify:WorkerNotify):Promise<boolean>{
  const due=await pool.query<{report_frequency:number;next_position_report_at:string|null}>(`SELECT report_frequency,next_position_report_at FROM investment_preferences
    WHERE user_id=$1 AND position_monitoring=true AND (next_position_report_at IS NULL OR next_position_report_at<=now())`,[user.user_id]);
  if(!due.rowCount)return false;
  const hours=24/Math.max(1,Math.min(4,due.rows[0]!.report_frequency));
  const entries=positions.filter(position=>BigInt(position.amount)>0n||BigInt(position.amount)!==BigInt(position.reportedAmount));
  const lines=entries.length?entries.slice(0,12).map(position=>{
    const value=position.valueUsd===null?"value unavailable":usd(position.valueUsd);
    return `• ${formatUnits(position.amount,position.decimals)} ${position.symbol} · ${value} · balance change ${signedDelta(position.amount,position.reportedAmount,position.decimals)}`;
  }):["No Rhea internal deposits were detected at this check."];
  const text=[
    "Pocket Near position check-in",
    ...lines,
    `Checked ${new Date().toLocaleString("en-US",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})} UTC via Intear.`,
    "Balance changes are not earnings calculations. Rhea farms and concentrated-liquidity NFT positions are not currently covered.",
  ].join("\n");
  await notify(Number(user.telegram_id),text);
  const next=new Date(Date.now()+hours*60*60*1000);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("UPDATE position_snapshots SET reported_amount_raw=amount_raw WHERE user_id=$1",[user.user_id]);
    await client.query("UPDATE investment_preferences SET last_report_at=now(),next_position_report_at=$2,updated_at=now() WHERE user_id=$1",[user.user_id,next]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  return true;
}

async function notifyRNearUnlock(user:Preference,positions:RheaPosition[],notify:WorkerNotify):Promise<number>{
  let sent=0;
  for(const position of positions.filter(item=>item.kind==="rnear_pending"&&item.canWithdraw!==null)){
    const {rows}=await pool.query<{notify:boolean}>(`INSERT INTO rhea_position_alert_state(user_id,position_id,can_withdraw,notified,updated_at)
      VALUES($1,$2,$3,false,now())
      ON CONFLICT(user_id,position_id) DO UPDATE SET
        notified=CASE WHEN rhea_position_alert_state.can_withdraw IS DISTINCT FROM EXCLUDED.can_withdraw THEN false ELSE rhea_position_alert_state.notified END,
        can_withdraw=EXCLUDED.can_withdraw,updated_at=now()
      RETURNING can_withdraw AND NOT notified AS notify`,[user.user_id,position.id,position.canWithdraw]);
    if(!rows[0]?.notify)continue;
    await notify(Number(user.telegram_id),`Pocket Near rNEAR alert: ${formatUnits(position.amount,position.decimals)} NEAR from your delayed unstake is ready to withdraw. The alert is based on Rhea's can_withdraw view for lst.rhealab.near. Withdrawals require a wallet-signed transaction.`);
    await pool.query("UPDATE rhea_position_alert_state SET notified=true,updated_at=now() WHERE user_id=$1 AND position_id=$2 AND can_withdraw=true",[user.user_id,position.id]);
    sent++;
  }
  return sent;
}

export async function runInvestmentWorker(notify:WorkerNotify):Promise<{suggestions:number;positionReports:number;positionsChecked:number;unlockAlerts:number;errors:string[]}>{
  const {rows}=await pool.query<Preference>(`SELECT p.user_id::text,u.telegram_id::text,u.account_id,p.alerts_enabled,p.symbols,p.position_monitoring,p.report_frequency,p.last_position_check_at
    FROM investment_preferences p JOIN users u ON u.id=p.user_id
    WHERE u.telegram_id IS NOT NULL AND (p.alerts_enabled=true OR p.position_monitoring=true) ORDER BY p.last_position_check_at NULLS FIRST LIMIT 100`);
  const result={suggestions:0,positionReports:0,positionsChecked:0,unlockAlerts:0,errors:[] as string[]};
  for(const user of rows){
    try{if(await sendPoolSuggestion(user,notify))result.suggestions++;}
    catch(error){result.errors.push(`Opportunity alert user ${user.user_id}: ${error instanceof Error?error.message:"failed"}`);}
  }
  for(const user of rows.filter(item=>item.position_monitoring&&item.account_id).slice(0,20)){
    try{
      const current=await getRheaPositions(user.account_id!);
      const snapshots=await savePositionCheck(user,current.positions);result.positionsChecked++;
      result.unlockAlerts+=await notifyRNearUnlock(user,current.positions,notify);
      if(await sendPositionReport(user,snapshots,notify))result.positionReports++;
    }catch(error){result.errors.push(`Position check user ${user.user_id}: ${error instanceof Error?error.message:"failed"}`);}
  }
  return result;
}
