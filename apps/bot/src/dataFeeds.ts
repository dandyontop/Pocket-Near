import { curatedEarnFallback, curatedExploreApps, curatedExploreGames, priceRowSchema, type EarnProtocol, type PriceRow } from "@pocket-near/shared";
import { env } from "./env.js";

type Cache<T>={until:number;value:T};
let pricesCache:Cache<PriceRow[]>|undefined;
let earnCache:Cache<EarnProtocol[]>|undefined;
const nowIso=()=>new Date().toISOString();

export async function getPrices():Promise<{rows:PriceRow[];source:string;updatedAt:string}>{
  if(pricesCache&&pricesCache.until>Date.now())return {rows:pricesCache.value,source:"cache",updatedAt:pricesCache.value[0]?.updatedAt??nowIso()};
  const ids=env.PRICE_ASSET_IDS;
  try{
    const url=new URL("https://api.coingecko.com/api/v3/coins/markets");
    url.searchParams.set("vs_currency","usd");url.searchParams.set("ids",ids);url.searchParams.set("order","market_cap_desc");url.searchParams.set("per_page","50");url.searchParams.set("page","1");url.searchParams.set("price_change_percentage","24h");
    const headers:Record<string,string>={accept:"application/json"};if(env.COINGECKO_API_KEY)headers["x-cg-demo-api-key"]=env.COINGECKO_API_KEY;
    const response=await fetch(url,{headers,signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`Market provider returned ${response.status}.`);
    const payload:unknown=await response.json();if(!Array.isArray(payload))throw new Error("Market provider returned invalid data.");
    const rows=payload.map((v:Record<string,unknown>)=>priceRowSchema.parse({id:String(v.id),symbol:String(v.symbol).toUpperCase(),name:String(v.name),priceUsd:Number(v.current_price),change24hPct:v.price_change_percentage_24h===null||v.price_change_percentage_24h===undefined?null:Number(v.price_change_percentage_24h),marketCap:v.market_cap===null||v.market_cap===undefined?null:Number(v.market_cap),source:"CoinGecko",updatedAt:nowIso()}));
    pricesCache={until:Date.now()+env.PRICES_CACHE_TTL_SECONDS*1000,value:rows};return {rows,source:"CoinGecko",updatedAt:nowIso()};
  }catch(error){if(pricesCache)return {rows:pricesCache.value,source:"stale-cache",updatedAt:pricesCache.value[0]?.updatedAt??nowIso()};throw error;}
}

export async function getEarn():Promise<{protocols:EarnProtocol[];source:string;updatedAt:string}>{
  if(earnCache&&earnCache.until>Date.now())return {protocols:earnCache.value,source:"cache",updatedAt:nowIso()};
  try{
    const response=await fetch("https://api.llama.fi/protocols",{signal:AbortSignal.timeout(10_000)});if(!response.ok)throw new Error(`DefiLlama returned ${response.status}.`);
    const payload:unknown=await response.json();if(!Array.isArray(payload))throw new Error("DefiLlama returned invalid data.");
    const protocols:EarnProtocol[]=payload.filter((v:Record<string,unknown>)=>Array.isArray(v.chains)&&(v.chains as unknown[]).some(c=>String(c).toLowerCase()==="near")&&Number(v.tvl)>0).map((v:Record<string,unknown>)=>({id:String(v.slug??v.name).toLowerCase().replace(/[^a-z0-9-]/g,"-"),name:String(v.name),category:String(v.category??"Other"),tvl:Number(v.tvl),change1d:v.change_1d===null||v.change_1d===undefined?null:Number(v.change_1d),change7d:v.change_7d===null||v.change_7d===undefined?null:Number(v.change_7d),url:typeof v.url==="string"&&v.url.startsWith("https://")?v.url:"https://defillama.com" ,...(typeof v.logo==="string"&&v.logo.startsWith("https://")?{logo:v.logo}:{})})).sort((a,b)=>b.tvl-a.tvl);
    if(!protocols.length)throw new Error("No NEAR protocol rows were returned.");
    earnCache={until:Date.now()+env.EARN_CACHE_TTL_SECONDS*1000,value:protocols};return {protocols,source:"DefiLlama",updatedAt:nowIso()};
  }catch(error){if(earnCache)return {protocols:earnCache.value,source:"stale-cache",updatedAt:nowIso()};return {protocols:curatedEarnFallback,source:"curated-fallback",updatedAt:nowIso()};}
}

export function getCuratedApps(){return curatedExploreApps;}
export function getCuratedGames(){return curatedExploreGames;}
