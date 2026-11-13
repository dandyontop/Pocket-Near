import { networkOverviewSchema, type NetworkOverview } from "@pocket-near/shared";
import { env } from "./env.js";

const EXPLORER_URL="https://explorer.near-intents.org/api/v0/transactions";
const PAGE_SIZE=1000;
const MAX_PAGES=2;
const CACHE_TTL_MS=10*60*1000;
const REQUEST_INTERVAL_MS=5000;
const METHOD="Rolling 24h sum of amountInUsd from Explorer transactions; successRate = SUCCESS/txCount (0–1)";
export type ExplorerTransaction={
  originAsset?:unknown;
  destinationAsset?:unknown;
  status?:unknown;
  createdAt?:unknown;
  createdAtTimestamp?:unknown;
  amountInUsd?:unknown;
  depositAddress?:unknown;
  depositMemo?:unknown;
};
export type ExplorerWindow={
  transactions:ExplorerTransaction[];
  windowStart:number;
  windowEnd:number;
  updatedAt:string;
  partial:boolean;
};
type CachedOverview={value:NetworkOverview;expiresAt:number};

let cache:CachedOverview|undefined;
let refresh:Promise<NetworkOverview>|undefined;
let explorerRefresh:Promise<ExplorerWindow>|undefined;
let nextExplorerRequestAt=0;

export class NetworkOverviewError extends Error {
  constructor(message:string,readonly status:502|503){super(message);this.name="NetworkOverviewError";}
}

function sleep(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));}

export function transactionTimestamp(transaction:ExplorerTransaction):number|undefined{
  if(typeof transaction.createdAtTimestamp==="number"&&Number.isFinite(transaction.createdAtTimestamp)){
    const timestamp=transaction.createdAtTimestamp*1000;
    if(Number.isFinite(timestamp))return timestamp;
  }
  if(typeof transaction.createdAt==="string"){
    const timestamp=Date.parse(transaction.createdAt);
    if(Number.isFinite(timestamp))return timestamp;
  }
  return undefined;
}

export function parseExplorerUsd(value:unknown):number|undefined{
  if(typeof value!=="string"&&typeof value!=="number")return undefined;
  if(typeof value==="string"&&!value.trim())return undefined;
  if(typeof value==="string"&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return undefined;
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:undefined;
}

function assetLabel(asset:string):string{
  const readable=asset.includes(":")?asset.slice(asset.indexOf(":")+1):asset;
  return readable.length>32?`${readable.slice(0,14)}…${readable.slice(-12)}`:readable;
}

function addVolume(map:Map<string,{volumeUsd:number;txCount:number}>,key:string,volume:number|undefined):void{
  const current=map.get(key)??{volumeUsd:0,txCount:0};
  current.txCount++;
  if(volume!==undefined&&Number.isFinite(current.volumeUsd+volume))current.volumeUsd+=volume;
  map.set(key,current);
}

function buildOverview(transactions:ExplorerTransaction[],windowStart:number,windowEnd:number,updatedAt:string,partial:boolean):NetworkOverview{
  const statusCounts24h:Record<string,number>={SUCCESS:0,PROCESSING:0,REFUNDED:0,OTHER:0};
  const pairs=new Map<string,{originAsset:string;destinationAsset:string;volumeUsd:number;txCount:number}>();
  const origins=new Map<string,{volumeUsd:number;txCount:number}>();
  const destinations=new Map<string,{volumeUsd:number;txCount:number}>();
  let volumeUsd24h=0;
  let txCount24h=0;
  let incompleteTimestamp=false;

  for(const transaction of transactions){
    const timestamp=transactionTimestamp(transaction);
    if(timestamp===undefined){incompleteTimestamp=true;continue;}
    if(timestamp<windowStart||timestamp>windowEnd)continue;
    txCount24h++;
    const status=typeof transaction.status==="string"?transaction.status.toUpperCase():"";
    const bucket=status==="SUCCESS"||status==="PROCESSING"||status==="REFUNDED"?status:"OTHER";
    statusCounts24h[bucket]=(statusCounts24h[bucket]??0)+1;
    const amount=parseExplorerUsd(transaction.amountInUsd);
    if(amount!==undefined&&Number.isFinite(volumeUsd24h+amount))volumeUsd24h+=amount;

    if(typeof transaction.originAsset!=="string"||!transaction.originAsset||typeof transaction.destinationAsset!=="string"||!transaction.destinationAsset)continue;
    const originAsset=transaction.originAsset;
    const destinationAsset=transaction.destinationAsset;
    const pair=`${originAsset}→${destinationAsset}`;
    const current=pairs.get(pair)??{originAsset,destinationAsset,volumeUsd:0,txCount:0};
    current.txCount++;
    if(amount!==undefined&&Number.isFinite(current.volumeUsd+amount))current.volumeUsd+=amount;
    pairs.set(pair,current);
    addVolume(origins,originAsset,amount);
    addVolume(destinations,destinationAsset,amount);
  }

  const topPairs24h=[...pairs.entries()].map(([pair,value])=>({
    pair,...value,label:`${assetLabel(value.originAsset)} → ${assetLabel(value.destinationAsset)}`,
  })).sort((a,b)=>b.volumeUsd-a.volumeUsd).slice(0,8);
  const topAssets=(values:Map<string,{volumeUsd:number;txCount:number}>)=>[...values.entries()]
    .map(([asset,value])=>({asset,...value,label:assetLabel(asset)}))
    .sort((a,b)=>b.volumeUsd-a.volumeUsd).slice(0,5);

  return networkOverviewSchema.parse({
    windowStart:new Date(windowStart).toISOString(),
    windowEnd:new Date(windowEnd).toISOString(),
    volumeUsd24h,
    txCount24h,
    statusCounts24h,
    successRate24h:txCount24h===0?0:(statusCounts24h.SUCCESS??0)/txCount24h,
    topPairs24h,
    topOrigins24h:topAssets(origins),
    topDestinations24h:topAssets(destinations),
    source:"near-intents-explorer",
    updatedAt,
    partial:partial||incompleteTimestamp,
    methodology:METHOD,
  });
}

async function fetchPage(start:number,end:number,cursor?:{address:string;memo:string}):Promise<ExplorerTransaction[]>{
  const delay=Math.max(0,nextExplorerRequestAt-Date.now());
  if(delay)await sleep(delay);
  nextExplorerRequestAt=Date.now()+REQUEST_INTERVAL_MS;
  const url=new URL(EXPLORER_URL);
  url.searchParams.set("numberOfTransactions",String(PAGE_SIZE));
  url.searchParams.set("startTimestamp",new Date(start-1).toISOString());
  url.searchParams.set("endTimestamp",new Date(end+1).toISOString());
  url.searchParams.set("direction","next");
  if(cursor){
    url.searchParams.set("lastDepositAddress",cursor.address);
    url.searchParams.set("lastDepositMemo",cursor.memo);
  }
  let response:Response;
  try{
    response=await fetch(url,{headers:{accept:"application/json",authorization:`Bearer ${env.EXPLORER_JWT}`},signal:AbortSignal.timeout(12_000)});
  }catch{
    throw new NetworkOverviewError("NEAR Intents Explorer could not be reached. Try again later.",503);
  }
  if(!response.ok){
    throw new NetworkOverviewError(
      response.status===429?"NEAR Intents Explorer rate limit reached. Try again later.":`NEAR Intents Explorer returned HTTP ${response.status}. Try again later.`,
      response.status===429||response.status>=500?503:502,
    );
  }
  let payload:unknown;
  try{payload=await response.json();}catch{throw new NetworkOverviewError("NEAR Intents Explorer returned invalid JSON.",502);}
  if(!Array.isArray(payload)||payload.length>PAGE_SIZE){
    throw new NetworkOverviewError("NEAR Intents Explorer returned an invalid transaction page.",502);
  }
  if(payload.some(value=>!value||typeof value!=="object"||Array.isArray(value))){
    throw new NetworkOverviewError("NEAR Intents Explorer returned an invalid transaction row.",502);
  }
  return payload as ExplorerTransaction[];
}

async function fetchExplorerWindow():Promise<ExplorerWindow>{
  if(!env.EXPLORER_JWT.trim())throw new NetworkOverviewError("Intents network metrics are not configured. Set EXPLORER_JWT on the API server.",503);
  const windowEnd=Date.now();
  const windowStart=windowEnd-24*60*60*1000;
  const updatedAt=new Date(windowEnd).toISOString();
  const transactions:ExplorerTransaction[]=[];
  let cursor:{address:string;memo:string}|undefined;
  let partial=false;

  for(let pageNumber=0;pageNumber<MAX_PAGES;pageNumber++){
    const page=await fetchPage(windowStart,windowEnd,cursor);
    transactions.push(...page);
    const oldestTimestamp=page.length?transactionTimestamp(page[page.length-1]!):undefined;
    if(oldestTimestamp!==undefined&&oldestTimestamp<windowStart)break;
    if(page.length<PAGE_SIZE)break;
    if(pageNumber===MAX_PAGES-1){partial=true;break;}
    const last=page[page.length-1]!;
    if(typeof last.depositAddress!=="string"||last.depositAddress.length===0){
      partial=true;
      break;
    }
    const memo=typeof last.depositMemo==="string"?last.depositMemo:"";
    cursor={address:last.depositAddress,memo};
  }
  if(transactions.some(transaction=>transactionTimestamp(transaction)===undefined))partial=true;
  return {transactions,windowStart,windowEnd,updatedAt,partial};
}

export async function getExplorerWindow():Promise<ExplorerWindow>{
  if(explorerRefresh)return explorerRefresh;
  explorerRefresh=fetchExplorerWindow();
  try{return await explorerRefresh;}finally{explorerRefresh=undefined;}
}

function computeOverview(window:ExplorerWindow):NetworkOverview{
  return buildOverview(window.transactions,window.windowStart,window.windowEnd,window.updatedAt,window.partial);
}

export function aggregateExplorerWindow(window:ExplorerWindow):NetworkOverview{
  return computeOverview(window);
}

export async function getNetworkOverview():Promise<NetworkOverview>{
  if(cache&&cache.expiresAt>Date.now())return cache.value;
  if(refresh)return refresh;
  refresh=getExplorerWindow().then(window=>{
    const overview=computeOverview(window);
    cache={value:overview,expiresAt:Date.now()+CACHE_TTL_MS};
    return overview;
  });
  try{return await refresh;}finally{refresh=undefined;}
}
