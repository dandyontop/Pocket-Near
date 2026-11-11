import { nearProvider } from "./near.js";

export async function getRNearYield():Promise<{apyPct:number|null;ftPriceNear:number|null;source:string;observedAt:string}>{
  const [apyResponse,summary]=await Promise.all([
    fetch("https://api.rhea.finance/get-rnear-apy",{signal:AbortSignal.timeout(10_000)}).catch(()=>null),
    nearProvider.callFunction({contractId:"lst.rhealab.near",method:"get_summary",args:{}}),
  ]);
  const apyBody=apyResponse?.ok?await apyResponse.json() as {data?:unknown}:{};
  const raw=summary&&typeof summary==="object"?(summary as Record<string,unknown>).ft_price:null;
  const rawText=typeof raw==="string"&&/^\d+$/.test(raw)?raw:null;
  return {apyPct:typeof apyBody.data==="string"&&Number.isFinite(Number(apyBody.data))?Number(apyBody.data):null,ftPriceNear:rawText?Number(rawText)/1e24:null,source:"Rhea rnear-sdk getApy() indexer + getSummary() on lst.rhealab.near",observedAt:new Date().toISOString()};
}

export type RheaPosition={
  id:string;
  tokenId:string;
  symbol:string;
  amount:string;
  decimals:number;
  valueUsd:number|null;
  kind:"deposit"|"rnear_staked"|"rnear_balance"|"rnear_pending";
  nearEquivalent:string|null;
  canWithdraw:boolean|null;
  estimatedUnlockAtMs:number|null;
};

type Table={columns?:string[];rows?:unknown[][]};
type RheaBalancesResponse={
  height?:number;
  balances?:Table;
  tokens?:Table;
  errors?:Record<string,{code?:string;message?:string}>;
};

function tableRows<T extends Record<string,unknown>>(table:Table|undefined):T[]{
  if(!table||!Array.isArray(table.columns)||!Array.isArray(table.rows))return [];
  return table.rows.flatMap(row=>{
    if(!Array.isArray(row))return [];
    return [Object.fromEntries(table.columns!.map((column,index)=>[column,row[index]])) as T];
  });
}

export async function getRheaPositions(accountId:string):Promise<{positions:RheaPosition[];height:number|null;source:string;rnear:{apyPct:number|null;ftPrice:number|null;stakedNear:string;pendingNear:string;canWithdraw:boolean|null;estimatedUnlockAtMs:number|null;source:string;observedAt:string}}>{
  const response=await fetch("https://api.intea.rs/balances",{
    method:"POST",headers:{accept:"application/json","content-type":"application/json"},
    body:JSON.stringify({account:accountId,sources:["rhea"],token_fields:["symbol","decimals","price_usd"]}),
    signal:AbortSignal.timeout(10_000),
  });
  if(!response.ok)throw new Error(`Intear Rhea balance service returned ${response.status}.`);
  const data=await response.json() as RheaBalancesResponse;
  if(data.errors?.rhea)throw new Error(data.errors.rhea.message||"Rhea balances are temporarily unavailable.");
  const metadata=new Map<string,{symbol:string;decimals:number;price:number|null}>();
  for(const row of tableRows<Record<string,unknown>>(data.tokens)){
    const tokenId=String(row.account_id??row.token??"");
    const decimals=Number(row.decimals);
    if(tokenId)metadata.set(tokenId,{symbol:String(row.symbol??tokenId),decimals:Number.isInteger(decimals)&&decimals>=0&&decimals<=30?decimals:0,price:row.price_usd==null?null:Number(row.price_usd)});
  }
  const positions=tableRows<Record<string,unknown>>(data.balances).flatMap(row=>{
    if(String(row.source??"")!=="rhea")return [];
    const tokenId=String(row.token??"");const raw=String(row.balance??"0");
    if(!tokenId||!/^\d+$/.test(raw)||BigInt(raw)<=0n)return [];
    const meta=metadata.get(tokenId);const decimals=meta?.decimals??0;
    const amount=Number(raw)/10**decimals;
    const value=meta?.price!==null&&meta?.price!==undefined&&Number.isFinite(meta.price)?amount*meta.price:null;
    return [{id:`rhea:${tokenId}`,tokenId,symbol:meta?.symbol??tokenId,amount:raw,decimals,valueUsd:value,kind:"deposit" as const,nearEquivalent:null,canWithdraw:null,estimatedUnlockAtMs:null}];
  });
  // These rNEAR views are the same read methods exposed by Rhea's rnear-sdk.
  // Keep the JSON-RPC response validated because contract data is external.
  const rnearContract="lst.rhealab.near";
  const [balanceRaw,accountRaw,summaryRaw,apyRaw]=await Promise.all([
    nearProvider.callFunction({contractId:rnearContract,method:"ft_balance_of",args:{account_id:accountId}}),
    nearProvider.callFunction({contractId:rnearContract,method:"get_account_details",args:{account_id:accountId}}),
    nearProvider.callFunction({contractId:rnearContract,method:"get_summary",args:{}}),
    fetch("https://api.rhea.finance/get-rnear-apy",{signal:AbortSignal.timeout(10_000)}).then(async response=>response.ok?await response.json() as Promise<{data?:unknown}>:{data:null}).catch(()=>({data:null})),
  ]);
  const asObj=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  const units=(value:unknown):string|null=>{
    if(typeof value==="string"&&/^\d+$/.test(value))return value;
    if(value&&typeof value==="object"&&/^\d+$/.test(String(asObj(value).raw??"")))return String(asObj(value).raw);
    return null;
  };
  const account=asObj(accountRaw),summary=asObj(summaryRaw);
  const stakedRaw=units(account.staked_balance)??"0",pendingRaw=units(account.unstaked_balance)??"0";
  const stakedAmount=(Number(stakedRaw)/1e24).toString();
  const pendingAmount=(Number(pendingRaw)/1e24).toString();
  const ftPriceRaw=units(summary.ft_price);
  const ftPrice=ftPriceRaw?Number(ftPriceRaw)/1e24:null;
  const rnearBalance=typeof balanceRaw==="string"&&/^\d+$/.test(balanceRaw)?balanceRaw:null;
  const sdkPositions:RheaPosition[]=[];
  if(BigInt(stakedRaw)>0n)sdkPositions.push({id:`rnear:staked:${accountId}`,tokenId:rnearContract,symbol:"NEAR staked as rNEAR",amount:stakedRaw,decimals:24,valueUsd:null,kind:"rnear_staked",nearEquivalent:stakedAmount,canWithdraw:false,estimatedUnlockAtMs:null});
  if(rnearBalance&&BigInt(rnearBalance)>0n)sdkPositions.push({id:`rnear:balance:${accountId}`,tokenId:rnearContract,symbol:"rNEAR wallet balance",amount:rnearBalance,decimals:24,valueUsd:null,kind:"rnear_balance",nearEquivalent:ftPrice?((Number(rnearBalance)/1e24)*ftPrice).toString():null,canWithdraw:null,estimatedUnlockAtMs:null});
  if(BigInt(pendingRaw)>0n)sdkPositions.push({id:`rnear:pending:${accountId}`,tokenId:rnearContract,symbol:"NEAR (pending rNEAR unstake)",amount:pendingRaw,decimals:24,valueUsd:null,kind:"rnear_pending",nearEquivalent:pendingAmount,canWithdraw:typeof account.can_withdraw==="boolean"?account.can_withdraw:null,estimatedUnlockAtMs:null});
  const apy=typeof apyRaw.data==="string"&&Number.isFinite(Number(apyRaw.data))?Number(apyRaw.data):null;
  const canWithdraw=typeof account.can_withdraw==="boolean"?account.can_withdraw:null;
  return {positions:[...positions,...sdkPositions],height:typeof data.height==="number"?data.height:null,source:"Intear indexed Rhea deposits + Rhea rnear-sdk contract views",rnear:{apyPct:apy,ftPrice:ftPrice?Number(ftPrice):null,stakedNear:stakedAmount,pendingNear:pendingAmount,canWithdraw,estimatedUnlockAtMs:null,source:"Rhea rnear-sdk views on lst.rhealab.near",observedAt:new Date().toISOString()}};
}
