export type RheaPosition={
  id:string;
  tokenId:string;
  symbol:string;
  amount:string;
  decimals:number;
  valueUsd:number|null;
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

export async function getRheaPositions(accountId:string):Promise<{positions:RheaPosition[];height:number|null;source:string}>{
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
    return [{id:`rhea:${tokenId}`,tokenId,symbol:meta?.symbol??tokenId,amount:raw,decimals,valueUsd:value}];
  });
  return {positions,height:typeof data.height==="number"?data.height:null,source:"Intear indexed Rhea deposits"};
}
