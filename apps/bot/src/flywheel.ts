import { flywheelOverviewSchema, type FlywheelOverview } from "@pocket-near/shared";
import { pool } from "./db.js";
import { aggregateExplorerWindow, getExplorerWindow, parseExplorerUsd, transactionTimestamp, type ExplorerTransaction } from "./networkOverview.js";
import { getSupportedToken } from "./quotes.js";

const PEER_CACHE_MS=30*60*1000;
const PEER_TIMEOUT_MS=10_000;
const REPEATED_SIZE_WINDOW_MS=5*60*1000;
const REPEATED_SIZE_MIN_COUNT=3;
const PEERS=[
  {id:"near-intents",fees:"fees/near-intents",volume:"dexs/near-intents"},
  {id:"1inch",fees:"fees/1inch",volume:"aggregators/1inch"},
  {id:"cowswap",fees:"fees/cowswap",volume:"aggregators/cowswap"},
] as const;
const PEERS_METHOD="DefiLlama rolling 24h fee and volume dimensions; protocol coverage and accounting methods differ.";

type DepositKey={deposit_address:string;deposit_memo:string|null};
type Aggregate={volumeUsd:number;txCount:number;successTxCount:number};
type DefiLlamaSummary={name?:unknown;total24h?:unknown};
type CachedPeers={value:FlywheelOverview["defiLlamaPeers"];expiresAt:number};

let peerCache:CachedPeers|undefined;
let peerRefresh:Promise<FlywheelOverview["defiLlamaPeers"]>|undefined;

export class FlywheelOverviewError extends Error {
  constructor(message:string,readonly status:503){super(message);this.name="FlywheelOverviewError";}
}

function isRecord(value:unknown):value is Record<string,unknown>{
  return Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
}

function statusBucket(value:unknown):string{
  if(typeof value!=="string")return "OTHER";
  const status=value.toUpperCase();
  return ["SUCCESS","PROCESSING","REFUNDED","PENDING_DEPOSIT","INCOMPLETE_DEPOSIT","FAILED"].includes(status)?status:"OTHER";
}

function addAggregate(map:Map<string,Aggregate>,key:string,amount:number|undefined,success:boolean):void{
  const value=map.get(key)??{volumeUsd:0,txCount:0,successTxCount:0};
  value.txCount++;
  if(success){
    value.successTxCount++;
    if(amount!==undefined&&Number.isFinite(value.volumeUsd+amount))value.volumeUsd+=amount;
  }
  map.set(key,value);
}

function repeatedSizeSignals(rows:Array<{pair:string;amount:number;timestamp:number}>):{
  transactionCount:number;
  volumeUsd:number;
}{
  const groups=new Map<string,Array<{amount:number;timestamp:number;index:number}>>();
  rows.forEach((row,index)=>{
    const key=`${row.pair}\u0000${Math.round(row.amount*100)}`;
    const group=groups.get(key)??[];
    group.push({...row,index});
    groups.set(key,group);
  });
  const flagged=new Set<number>();
  for(const group of groups.values()){
    group.sort((a,b)=>a.timestamp-b.timestamp);
    let first=0;
    for(let last=0;last<group.length;last++){
      while(group[last]!.timestamp-group[first]!.timestamp>REPEATED_SIZE_WINDOW_MS)first++;
      if(last-first+1>=REPEATED_SIZE_MIN_COUNT){
        for(let index=first;index<=last;index++)flagged.add(group[index]!.index);
      }
    }
  }
  return {
    transactionCount:flagged.size,
    volumeUsd:rows.reduce((sum,row,index)=>flagged.has(index)?sum+row.amount:sum,0),
  };
}

async function getFunnel(windowStart:number,windowEnd:number):Promise<FlywheelOverview["pocketNear"]["funnel"]>{
  const [totals,statuses]=await Promise.all([
    pool.query<{started:number;deposits:number;successful:number}>(`SELECT
      count(*)::int AS started,
      count(*) FILTER(WHERE deposit_tx_hash IS NOT NULL)::int AS deposits,
      count(*) FILTER(WHERE status='SUCCESS')::int AS successful
      FROM intent_swaps WHERE created_at >= $1 AND created_at <= $2`,[new Date(windowStart),new Date(windowEnd)]),
    pool.query<{status:string;count:number}>(`SELECT status,count(*)::int AS count
      FROM intent_swaps WHERE created_at >= $1 AND created_at <= $2 GROUP BY status`,[new Date(windowStart),new Date(windowEnd)]),
  ]);
  const statusCounts24h=Object.fromEntries(statuses.rows.map(row=>[row.status,row.count]));
  return {
    started24h:totals.rows[0]?.started??0,
    depositHashSubmitted24h:totals.rows[0]?.deposits??0,
    successful24h:totals.rows[0]?.successful??0,
    statusCounts24h,
  };
}

function depositKey(address:string,memo:string|null|undefined):string{
  return `${address}\u0000${memo??""}`;
}

async function buildSnapshot():Promise<FlywheelOverview>{
  const explorer=await getExplorerWindow();
  const [savedDeposits,funnel]=await Promise.all([
    pool.query<DepositKey>("SELECT DISTINCT deposit_address,deposit_memo FROM intent_swaps"),
    getFunnel(explorer.windowStart,explorer.windowEnd),
  ]);
  const knownDeposits=new Set(savedDeposits.rows.map(row=>depositKey(row.deposit_address,row.deposit_memo)));
  const matched:ExplorerTransaction[]=[];
  for(const transaction of explorer.transactions){
    const timestamp=transactionTimestamp(transaction);
    if(timestamp===undefined||timestamp<explorer.windowStart||timestamp>explorer.windowEnd)continue;
    if(typeof transaction.depositAddress!=="string"||!knownDeposits.has(depositKey(
      transaction.depositAddress,
      typeof transaction.depositMemo==="string"?transaction.depositMemo:null,
    )))continue;
    matched.push(transaction);
  }

  const matchedStatusCounts:Record<string,number>={SUCCESS:0,PROCESSING:0,REFUNDED:0,PENDING_DEPOSIT:0,INCOMPLETE_DEPOSIT:0,FAILED:0,OTHER:0};
  const pairs=new Map<string,Aggregate>();
  const chains=new Map<string,Aggregate>();
  const successfulForSignals:Array<{pair:string;amount:number;timestamp:number}>=[];
  let routedVolumeUsd24h=0;
  let successfulTxCount24h=0;
  const originAssets=new Set<string>();
  for(const transaction of matched){
    const status=statusBucket(transaction.status);
    matchedStatusCounts[status]=(matchedStatusCounts[status]??0)+1;
    const amount=parseExplorerUsd(transaction.amountInUsd);
    const success=status==="SUCCESS";
    if(success){
      successfulTxCount24h++;
      if(amount!==undefined&&Number.isFinite(routedVolumeUsd24h+amount))routedVolumeUsd24h+=amount;
    }
    const origin=typeof transaction.originAsset==="string"?transaction.originAsset:"";
    const destination=typeof transaction.destinationAsset==="string"?transaction.destinationAsset:"";
    if(origin)originAssets.add(origin);
    const pair=origin&&destination?`${origin}→${destination}`:"";
    if(pair)addAggregate(pairs,pair,amount,success);
    if(success&&pair){
      const timestamp=transactionTimestamp(transaction);
      if(amount!==undefined&&timestamp!==undefined)successfulForSignals.push({pair,amount,timestamp});
    }
    if(origin)addAggregate(chains,origin,amount,success);
    else addAggregate(chains,"Unknown origin asset",amount,success);
  }

  const tokenResults=await Promise.all([...originAssets].map(async asset=>{
    try{return [asset,await getSupportedToken(asset)] as const;}
    catch(error){
      console.warn("Could not map an Intents asset to its source chain.",asset,error instanceof Error?error.message:"unknown error");
      return [asset,undefined] as const;
    }
  }));
  const chainByAsset=new Map(tokenResults.map(([asset,token])=>[asset,token?.blockchain||"Unknown source chain"]));
  const sourceChains=new Map<string,Aggregate>();
  for(const [asset,value] of chains){
    const chain=asset==="Unknown origin asset"?"Unknown source chain":chainByAsset.get(asset)??"Unknown source chain";
    const current=sourceChains.get(chain)??{volumeUsd:0,txCount:0,successTxCount:0};
    current.txCount+=value.txCount;
    current.successTxCount+=value.successTxCount;
    if(Number.isFinite(current.volumeUsd+value.volumeUsd))current.volumeUsd+=value.volumeUsd;
    sourceChains.set(chain,current);
  }
  const signals=repeatedSizeSignals(successfulForSignals);
  const overview=aggregateExplorerWindow(explorer);
  const capturedAt=explorer.updatedAt;
  return flywheelOverviewSchema.parse({
    windowStart:new Date(explorer.windowStart).toISOString(),
    windowEnd:new Date(explorer.windowEnd).toISOString(),
    updatedAt:capturedAt,
    source:"near-intents-explorer",
    partial:explorer.partial||overview.partial,
    network:{
      volumeUsd24h:overview.volumeUsd24h,
      txCount24h:overview.txCount24h,
      successRate24h:overview.successRate24h,
    },
    pocketNear:{
      volumeUsd24h:routedVolumeUsd24h,
      successfulTxCount24h,
      matchedTxCount24h:matched.length,
      successRate24h:matched.length===0?0:successfulTxCount24h/matched.length,
      statusCounts24h:matchedStatusCounts,
      byPair:[...pairs.entries()].map(([pair,value])=>{
        const [originAsset,destinationAsset]=pair.split("→");
        return {pair,originAsset:originAsset??"",destinationAsset:destinationAsset??"",...value};
      }).sort((a,b)=>b.volumeUsd-a.volumeUsd).slice(0,8),
      bySourceChain:[...sourceChains.entries()].map(([sourceChain,value])=>({sourceChain,...value}))
        .sort((a,b)=>b.volumeUsd-a.volumeUsd).slice(0,8),
      funnel,
      signals:{
        repeatedSizeBurstTxCount24h:signals.transactionCount,
        repeatedSizeBurstVolumeUsd24h:signals.volumeUsd,
        methodology:"Soft signal only: 3+ successful matched swaps with the same asset pair and USD amount rounded to cents within 5 minutes. No activity is excluded; this does not establish common ownership or wash trading.",
      },
    },
    defiLlamaPeers:[],
    peersMethodology:PEERS_METHOD,
    methodology:"Rolling 24h Explorer window refreshed hourly. Pocket Near volume includes only SUCCESS rows whose deposit address and memo exactly match saved Pocket Near swaps; it sums Explorer amountInUsd. Stored records contain aggregates only, not Explorer rows, deposit addresses, memos, or transaction hashes. Funnel counts are saved Pocket Near swaps created in this window; provider statuses may update later.",
  });
}

async function fetchDefiLlamaSummary(path:string,dataType:"dailyFees"|"dailyVolume"):Promise<DefiLlamaSummary>{
  const url=new URL(`https://api.llama.fi/summary/${path}`);
  url.searchParams.set("dataType",dataType);
  let response:Response;
  try{response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(PEER_TIMEOUT_MS)});}
  catch(error){throw new Error(`DefiLlama ${path} request failed: ${error instanceof Error?error.message:"network error"}`);}
  if(!response.ok)throw new Error(`DefiLlama ${path} returned HTTP ${response.status}.`);
  const payload:unknown=await response.json();
  if(!isRecord(payload))throw new Error(`DefiLlama ${path} returned invalid JSON.`);
  return payload as DefiLlamaSummary;
}

function readUsd(value:unknown):number|undefined{
  if(typeof value!=="number"&&typeof value!=="string")return undefined;
  if(typeof value==="string"&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return undefined;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0?number:undefined;
}

async function fetchPeer(peer:typeof PEERS[number]):Promise<FlywheelOverview["defiLlamaPeers"][number]|undefined>{
  try{
    const [fees,volume]=await Promise.all([
      fetchDefiLlamaSummary(peer.fees,"dailyFees"),
      fetchDefiLlamaSummary(peer.volume,"dailyVolume"),
    ]);
    const feesUsd24h=readUsd(fees.total24h);
    const volumeUsd24h=readUsd(volume.total24h);
    if(typeof fees.name!=="string"||typeof volume.name!=="string"||feesUsd24h===undefined||volumeUsd24h===undefined||volumeUsd24h===0)return undefined;
    return {
      id:peer.id,
      name:fees.name,
      feesUsd24h,
      volumeUsd24h,
      feesPerMillionUsd:feesUsd24h/volumeUsd24h*1_000_000,
      source:"defillama",
      note:"Fee/volume adapter scope differs by protocol; this is a reference, not a direct apples-to-apples ranking.",
    };
  }catch(error){
    console.warn("DefiLlama peer data unavailable; omitting the protocol.",peer.id,error instanceof Error?error.message:"unknown error");
    return undefined;
  }
}

export async function getDefiLlamaPeers():Promise<FlywheelOverview["defiLlamaPeers"]>{
  if(peerCache&&peerCache.expiresAt>Date.now())return peerCache.value;
  if(peerRefresh)return peerRefresh;
  peerRefresh=Promise.all(PEERS.map(fetchPeer)).then(values=>values.filter((value):value is NonNullable<typeof value>=>Boolean(value)));
  try{
    const value=await peerRefresh;
    peerCache={value,expiresAt:Date.now()+PEER_CACHE_MS};
    return value;
  }finally{peerRefresh=undefined;}
}

export async function runFlywheelSnapshot():Promise<{updatedAt:string;partial:boolean;matchedTxCount24h:number;refreshed:boolean}>{
  const recent=await pool.query<{updated_at:Date|string;aggregate:unknown}>(
    "SELECT updated_at,aggregate FROM flywheel_hourly_snapshots WHERE updated_at > now()-interval '60 minutes' ORDER BY updated_at DESC LIMIT 1",
  );
  if(recent.rowCount){
    const previous=flywheelOverviewSchema.parse(recent.rows[0]!.aggregate);
    return {
      updatedAt:new Date(recent.rows[0]!.updated_at).toISOString(),
      partial:previous.partial,
      matchedTxCount24h:previous.pocketNear.matchedTxCount24h,
      refreshed:false,
    };
  }
  const snapshot=await buildSnapshot();
  const snapshotHour=new Date(snapshot.windowEnd);
  const aggregate={...snapshot,defiLlamaPeers:[]};
  await pool.query(`INSERT INTO flywheel_hourly_snapshots(snapshot_hour,window_start,window_end,updated_at,partial,aggregate)
    VALUES(date_trunc('hour',$1::timestamptz),$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT(snapshot_hour) DO UPDATE SET window_start=EXCLUDED.window_start,window_end=EXCLUDED.window_end,
      updated_at=EXCLUDED.updated_at,partial=EXCLUDED.partial,aggregate=EXCLUDED.aggregate`,
  [snapshotHour,new Date(snapshot.windowStart),new Date(snapshot.windowEnd),new Date(snapshot.updatedAt),snapshot.partial,JSON.stringify(aggregate)]);
  await pool.query("DELETE FROM flywheel_hourly_snapshots WHERE snapshot_hour < now()-interval '365 days'");
  return {updatedAt:snapshot.updatedAt,partial:snapshot.partial,matchedTxCount24h:snapshot.pocketNear.matchedTxCount24h,refreshed:true};
}

export async function getFlywheelOverview():Promise<FlywheelOverview>{
  const result=await pool.query<{aggregate:unknown}>("SELECT aggregate FROM flywheel_hourly_snapshots ORDER BY snapshot_hour DESC LIMIT 1");
  if(!result.rowCount)throw new FlywheelOverviewError("No hourly Intents snapshot has completed yet. The scheduled worker must run successfully first; check its deployment schedule, database connection, and server-side Explorer credential.",503);
  const aggregate=flywheelOverviewSchema.parse(result.rows[0]!.aggregate);
  return flywheelOverviewSchema.parse({
    ...aggregate,
    defiLlamaPeers:await getDefiLlamaPeers(),
    peersMethodology:PEERS_METHOD,
  });
}
