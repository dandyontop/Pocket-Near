import { nearProvider } from "./near.js";

type Obj=Record<string,unknown>;
const obj=(value:unknown):Obj=>value&&typeof value==="object"&&!Array.isArray(value)?value as Obj:{};
const text=(value:unknown)=>typeof value==="string"||typeof value==="number"?String(value):"";
const num=(value:unknown):number|null=>{const result=Number(value);return Number.isFinite(result)?result:null;};

export type RheaMarket={assetId:string;symbol:string;name:string;decimals:number;blockchain:"near";poolAddress:string;poolName:string;poolType:string|null;poolFeePct:number|null;priceUsd:number|null;liquidityUsd:number|null;volume24hUsd:number|null;trades24h:number|null;priceChange24hPct:number|null;frozen:boolean|null;poolUrl:string};
export type RheaPoolSignal={poolAddress:string;poolName:string;poolType:string|null;contracts:string[];symbols:string[];poolFeePct:number|null;liquidityUsd:number|null;volume24hUsd:number|null;trades24h:number|null;priceChange24hPct:number|null;poolUrl:string};

let marketCache:{until:number;markets:RheaMarket[];pools:RheaPoolSignal[]}|undefined;
export async function getRheaMarkets():Promise<RheaMarket[]>{
  if(marketCache&&marketCache.until>Date.now())return marketCache.markets;
  const [pages,frozenTokens]=await Promise.all([Promise.all([1,2,3,4,5].map(async page=>{
    const url=`https://api.geckoterminal.com/api/v2/networks/near/dexes/rhea-finance/pools?sort=h24_volume_usd_desc&page=${page}&include=base_token,quote_token`;
    const response=await fetch(url,{headers:{accept:"application/json;version=20230302"},signal:AbortSignal.timeout(12_000)});
    if(!response.ok)throw Object.assign(new Error("Rhea pool market data is temporarily unavailable."),{status:502});
    return obj(await response.json());
  })),getRheaFrozenTokenSet()]);
  const pools=pages.flatMap(page=>Array.isArray(page.data)?page.data:[]),included=pages.flatMap(page=>Array.isArray(page.included)?page.included.map(obj):[]);
  const tokenById=new Map(included.filter(row=>obj(row.attributes).address).map(row=>[text(row.id),obj(row.attributes)]));
  const result:RheaMarket[]=[];
  const poolSignals:RheaPoolSignal[]=[];
  for(const entry of pools){
    const pool=obj(entry),attrs=obj(pool.attributes),rels=obj(pool.relationships),baseRel=obj(obj(rels.base_token).data),quoteRel=obj(obj(rels.quote_token).data);
    const base=tokenById.get(text(baseRel.id)),quote=tokenById.get(text(quoteRel.id));
    const liquidity=num(attrs.reserve_in_usd),volume=obj(attrs.volume_usd),transactions=obj(attrs.transactions),change=obj(attrs.price_change_percentage);
    const poolAddress=text(attrs.address);if(!poolAddress)continue;
    const poolName=text(attrs.name)||poolAddress;
    const feePct=num(attrs.pool_fee_percentage);
    const poolType=/\b(ALMM|CLMM|STABLE|AMM)\b/i.exec(poolName)?.[1]?.toUpperCase()??null;
    const baseAddress=text(base?.address),quoteAddress=text(quote?.address);
    const poolUrl=`https://www.geckoterminal.com/near/rhea-finance/pools/${encodeURIComponent(poolAddress)}`;
    if(baseAddress&&quoteAddress&&liquidity!==null&&liquidity>0)poolSignals.push({poolAddress,poolName,poolType,contracts:[baseAddress,quoteAddress],symbols:[text(base?.symbol)||baseAddress,text(quote?.symbol)||quoteAddress],poolFeePct:feePct,liquidityUsd:liquidity,volume24hUsd:num(volume.h24),trades24h:(num(obj(transactions.h24).buys)??0)+(num(obj(transactions.h24).sells)??0),priceChange24hPct:num(change.h24),poolUrl});
    for(const [token,other] of [[base,quote],[quote,base]] as const){
      if(!token)continue;
      const address=text(token.address);if(!address)continue;
      const symbol=text(token.symbol)||address.slice(0,12),name=text(token.name)||symbol,decimals=num(token.decimals);
      const frozen=frozenTokens===null?null:frozenTokens.has(address.toLowerCase());
      const record:RheaMarket={assetId:`near:${address}`,symbol,name,decimals:decimals!==null&&Number.isInteger(decimals)&&decimals>=0&&decimals<=30?decimals:24,blockchain:"near",poolAddress,poolName:text(attrs.name)||`${symbol}/${text(other?.symbol)||"token"}`,poolType,poolFeePct:feePct,priceUsd:num(token.price_usd),liquidityUsd:liquidity,volume24hUsd:num(volume.h24),trades24h:(num(obj(transactions.h24).buys)??0)+(num(obj(transactions.h24).sells)??0),priceChange24hPct:num(change.h24),frozen,poolUrl};
      if(liquidity!==null&&liquidity>0)result.push(record);
    }
  }
  const best=new Map<string,RheaMarket>();for(const market of result){const current=best.get(market.assetId);if(!current||(market.volume24hUsd??0)>(current.volume24hUsd??0))best.set(market.assetId,market);}
  marketCache={until:Date.now()+60_000,markets:[...best.values()].sort((a,b)=>(b.volume24hUsd??0)-(a.volume24hUsd??0)).slice(0,100),pools:poolSignals};
  return marketCache.markets;
}

export async function getRheaPoolSignals():Promise<RheaPoolSignal[]>{
  if(!marketCache||marketCache.until<=Date.now())await getRheaMarkets();
  return marketCache?.pools??[];
}

let frozenCache:{until:number;tokens:Set<string>|null}|undefined;
export async function getRheaFrozenTokenSet():Promise<Set<string>|null>{
  if(frozenCache&&frozenCache.until>Date.now())return frozenCache.tokens;
  try{
    const raw=await nearProvider.callFunction({contractId:"v2.ref-finance.near",method:"get_frozenlist_tokens",args:{}});
    const values=Array.isArray(raw)?raw:Array.isArray(obj(raw).tokens)?obj(raw).tokens as unknown[]:null;
    if(!values||values.some(value=>typeof value!=="string")){frozenCache={until:Date.now()+60_000,tokens:null};return null;}
    const tokens=new Set((values as string[]).map(value=>value.toLowerCase()));frozenCache={until:Date.now()+5*60_000,tokens};return tokens;
  }catch{frozenCache={until:Date.now()+60_000,tokens:null};return null;}
}

export type RheaSwapQuote={amount_in:string;amount_out:string;min_amount_out:string;msg:string;signature:string;tokens:string[]};
export async function getRheaSwapQuote(input:{amount:string;tokenIn:string;tokenOut:string;user:string;slippageBps:number}):Promise<RheaSwapQuote>{
  const url=new URL("https://smartx.rhea.finance/swapMultiDexPath");
  url.searchParams.set("amountIn",input.amount);url.searchParams.set("tokenIn",input.tokenIn);url.searchParams.set("tokenOut",input.tokenOut);url.searchParams.set("slippage",String(input.slippageBps/10_000));url.searchParams.set("user",input.user);
  const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw Object.assign(new Error("Rhea could not find a live route for this NEAR token pair."),{status:response.status===400?422:502});
  const data=obj(await response.json());
  if(!/^[1-9]\d*$/.test(text(data.amount_in))||! /^[1-9]\d*$/.test(text(data.amount_out))||! /^[1-9]\d*$/.test(text(data.min_amount_out))||typeof data.msg!=="string"||!data.msg||typeof data.signature!=="string"||!data.signature||!Array.isArray(data.tokens)||data.tokens.length===0||data.tokens.some(token=>typeof token!=="string"||!/^[a-z0-9._-]{2,64}$/.test(token)))throw Object.assign(new Error("Rhea returned an incomplete swap route; no transaction was prepared."),{status:502});
  return {amount_in:text(data.amount_in),amount_out:text(data.amount_out),min_amount_out:text(data.min_amount_out),msg:data.msg,signature:data.signature,tokens:data.tokens as string[]};
}

export async function checkRheaRouteRegistration(user:string,tokens:string[]):Promise<{checked:boolean;ready:boolean;missing:string[];missingStorage:Array<{token:string;accountId:string}>}>{
  const result=await nearProvider.callFunction({contractId:"aggregatedex.near",method:"query_user_tokens_registered",args:{user,tokens}});
  let states:Map<string,boolean>|undefined;
  if(Array.isArray(result)&&result.length===tokens.length&&result.every(value=>typeof value==="boolean"))states=new Map(tokens.map((token,index)=>[token,result[index] as boolean]));
  else if(Array.isArray(result)&&result.every(value=>typeof value==="string"))states=new Map(tokens.map(token=>[token,(result as string[]).includes(token)]));
  else if(result&&typeof result==="object"){
    const root=obj(result),candidate=obj(root.registered??root.tokens??root.registered_tokens??root);
    const entries=tokens.map(token=>[token,candidate[token]] as const);
    if(entries.every(([,value])=>typeof value==="boolean"||value===0||value===1))states=new Map(entries.map(([token,value])=>[token,value===true||value===1]));
    else if(entries.every(([,value])=>value&&typeof value==="object"&&(typeof obj(value).registered==="boolean"||typeof obj(value).is_registered==="boolean")))states=new Map(entries.map(([token,value])=>[token,(obj(value).registered??obj(value).is_registered) as boolean]));
  }
  if(!states)throw new Error("Rhea returned an unrecognized token-registration status. Swap execution is paused to protect your funds.");
  const missing=tokens.filter(token=>!states!.get(token));
  const accounts=[user,"aggregatedexstg.near/user"];
  const storage=await Promise.all(tokens.flatMap(token=>accounts.map(async accountId=>{
    const balance=await nearProvider.callFunction({contractId:token,method:"storage_balance_of",args:{account_id:accountId}});
    return {token,accountId,registered:balance!==null&&balance!==undefined};
  })));
  const missingStorage=storage.filter(item=>!item.registered).map(({token,accountId})=>({token,accountId}));
  return {checked:true,ready:missing.length===0&&missingStorage.length===0,missing,missingStorage};
}
