import { env } from "./env.js";
import { getPrices } from "./dataFeeds.js";
import { getRheaPoolSignals } from "./rheaMarkets.js";

export type NearStablePool={
  id:string;
  poolId:string;
  kind:string;
  tokens:string[];
  symbols:string[];
  tvlUsd:number;
  feeBps:number|null;
  feeApr24hRunRatePct:number|null;
  volume24hUsd:number|null;
  poolType:string|null;
  updatedAt:string;
  url:string;
};

type AssetMeta={assetId:string;symbol:string;decimals:number;blockchain:string};
type RawPool={id:number|string;tokenIds?:string[];supplies?:Record<string,string>;fee?:number;pool_kind?:string};
type PoolIndex={block_number?:number;block_time?:number;simplePools?:RawPool[];ratedPools?:RawPool[];unRatedPools?:RawPool[]};
type PoolCache={until:number;value:{pools:NearStablePool[];updatedAt:string;source:string}};
let poolCache:PoolCache|undefined;
let poolRequest:Promise<{pools:NearStablePool[];updatedAt:string;source:string}>|undefined;
const nowIso=()=>new Date().toISOString();
const stablePriceSymbols=new Set(["USDC","USDT"]);

function priceSymbol(symbol:string):string{
  const normalized=symbol.toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(normalized==="WNEAR"||normalized==="NEAR")return "NEAR";
  if(normalized==="USDCE"||normalized==="USDC")return "USDC";
  if(normalized==="USDT"||normalized==="USDT0")return "USDT";
  return normalized;
}

function tokenAmount(raw:string|undefined,decimals:number):number{
  if(!raw||!/^\d+$/.test(raw))return 0;
  const value=Number(raw)/10**decimals;
  return Number.isFinite(value)?value:0;
}
function contractId(assetId:string):string{return assetId.startsWith("nep141:")?assetId.slice(7):assetId;}

async function loadPools():Promise<{pools:NearStablePool[];updatedAt:string;source:string}>{
  if(poolCache&&poolCache.until>Date.now())return poolCache.value;
  if(poolRequest)return poolRequest;
  poolRequest=(async()=>{
    const [indexResponse,assetsResponse,priceData,marketPools]=await Promise.all([
      fetch("https://api.rhea.finance/fetchAllPools",{signal:AbortSignal.timeout(12_000)}),
      fetch(`${env.ONE_CLICK_BASE_URL}/v0/tokens`,{signal:AbortSignal.timeout(10_000)}),
      getPrices(),
      getRheaPoolSignals(),
    ]);
    if(!indexResponse.ok)throw new Error(`Rhea pool index returned ${indexResponse.status}.`);
    if(!assetsResponse.ok)throw new Error(`Supported asset directory returned ${assetsResponse.status}.`);
    const [index,assetPayload]=await Promise.all([indexResponse.json() as Promise<PoolIndex>,assetsResponse.json() as Promise<unknown>]);
    if(!Array.isArray(assetPayload))throw new Error("Supported asset directory returned invalid data.");
    const assets=assetPayload.map((raw)=>{const item=raw as Record<string,unknown>;return {assetId:String(item.assetId??""),symbol:String(item.symbol??"").toUpperCase(),decimals:Number(item.decimals),blockchain:String(item.blockchain??"").toLowerCase()};}).filter((asset):asset is AssetMeta=>Boolean(asset.assetId)&&Number.isInteger(asset.decimals)&&asset.decimals>=0&&asset.decimals<=30);
    const assetsById=new Map(assets.map(asset=>[asset.assetId,asset]));
    const prices=new Map(priceData.rows.map(price=>[price.symbol.toUpperCase(),price.priceUsd]));
    const rows=[...(index.simplePools??[]),...(index.ratedPools??[]),...(index.unRatedPools??[])];
    const pools:NearStablePool[]=[];
    for(const row of rows){
      const tokenIds=(row.tokenIds??[]).filter(tokenId=>assetsById.has(tokenId));
      if(tokenIds.length<2||!row.supplies)continue;
      const tokenAssets=tokenIds.map(tokenId=>assetsById.get(tokenId)!);
      const hasNear=tokenAssets.some(asset=>asset.blockchain==="near"&&(asset.symbol==="NEAR"||asset.symbol==="WNEAR"));
      const hasStable=tokenAssets.some(asset=>asset.blockchain==="near"&&stablePriceSymbols.has(priceSymbol(asset.symbol)));
      if(!hasNear||!hasStable)continue;
      let tvlUsd=0;
      let priced=true;
      for(const asset of tokenAssets){
        const symbol=priceSymbol(asset.symbol);const price=prices.get(symbol);
        const amount=tokenAmount(row.supplies[asset.assetId],asset.decimals);
        if(price===undefined||amount===0){priced=false;break;}
        tvlUsd+=amount*price;
      }
      if(!priced||!Number.isFinite(tvlUsd)||tvlUsd<=0)continue;
      const symbols=tokenAssets.map(asset=>asset.symbol==="WNEAR"?"NEAR":asset.symbol);
      const kind=row.pool_kind??"RHEA_POOL";
      const contracts=tokenIds.map(contractId).sort();
      const market=marketPools.find(candidate=>candidate.contracts.map(value=>value.toLowerCase()).sort().join("|")===contracts.map(value=>value.toLowerCase()).join("|"));
      const volume=market?.volume24hUsd??null;
      const feePct=market?.poolFeePct??(typeof row.fee==="number"?row.fee/100:null);
      const feeApr24hRunRatePct=market&&volume!==null&&feePct!==null&&market.liquidityUsd&&market.poolType&&market.poolType!=="CLMM"?volume*(feePct/100)*0.8*365/market.liquidityUsd*100:null;
      pools.push({id:`${kind.toLowerCase()}:${row.id}`,poolId:String(row.id),kind,tokens:tokenIds,symbols,tvlUsd,feeBps:typeof row.fee==="number"?row.fee:null,feeApr24hRunRatePct:feeApr24hRunRatePct!==null&&Number.isFinite(feeApr24hRunRatePct)?feeApr24hRunRatePct:null,volume24hUsd:volume,poolType:market?.poolType??null,updatedAt:typeof index.block_time==="number"?new Date(index.block_time).toISOString():nowIso(),url:market?.poolUrl??"https://app.rhea.finance/pools"});
    }
    pools.sort((a,b)=>b.tvlUsd-a.tvlUsd);
    const data={pools,updatedAt:typeof index.block_time==="number"?new Date(index.block_time).toISOString():nowIso(),source:"Rhea public pool index + current market prices"};
    poolCache={until:Date.now()+5*60_000,value:data};return data;
  })().finally(()=>{poolRequest=undefined;});
  return poolRequest;
}

export async function getNearStablePools():Promise<{pools:NearStablePool[];updatedAt:string;source:string}>{
  return loadPools();
}
