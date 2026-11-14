import { marketSentimentSchema, type MarketSentiment } from "@pocket-near/shared";

type Cache={value:MarketSentiment;until:number};
let cache:Cache|undefined;

export class MarketSentimentError extends Error {
  constructor(){super("The market sentiment index is temporarily unavailable.");this.name="MarketSentimentError";}
}

export async function getMarketSentiment(options:{refresh?:boolean}={}):Promise<MarketSentiment>{
  if(!options.refresh&&cache&&cache.until>Date.now())return cache.value;
  try{
    const response=await fetch("https://api.alternative.me/fng/?limit=1&format=json",{signal:AbortSignal.timeout(8_000)});
    if(!response.ok)throw new Error(`Fear & Greed provider returned HTTP ${response.status}.`);
    const payload:unknown=await response.json();
    if(!payload||typeof payload!=="object"||!Array.isArray((payload as {data?:unknown}).data))throw new Error("Fear & Greed provider returned invalid data.");
    const row=(payload as {data:unknown[]}).data[0];
    if(!row||typeof row!=="object")throw new Error("Fear & Greed provider returned no current observation.");
    const value=Number((row as {value?:unknown}).value);
    const timestamp=Number((row as {timestamp?:unknown}).timestamp);
    if(!Number.isInteger(value)||value<0||value>100||!Number.isSafeInteger(timestamp)||timestamp<=0)throw new Error("Fear & Greed provider returned an invalid observation.");
    const parsed=marketSentimentSchema.parse({
      value,
      observedAt:new Date(timestamp*1000).toISOString(),
      updatedAt:new Date().toISOString(),
      source:"alternative.me",
    });
    cache={value:parsed,until:Date.now()+15*60_000};
    return parsed;
  }catch(error){
    if(error instanceof MarketSentimentError)throw error;
    throw new MarketSentimentError();
  }
}
