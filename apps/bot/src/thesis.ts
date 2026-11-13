import { thesisContentSchema, thesisReportSchema, type ThesisFacts, type ThesisReport } from "@pocket-near/shared";
import { pool } from "./db.js";
import { env } from "./env.js";
import { getCuratedGames, getPrices } from "./dataFeeds.js";
import { getNetworkOverview } from "./networkOverview.js";
import { getNearStablePools } from "./investmentPools.js";

const MODEL="z-ai/glm-5.3-flash";
const DISCLAIMER_NOTE="AI-generated analysis; not independently verified or attested.";

export class ThesisRateLimitError extends Error {
  constructor(){super("Thesis generation limit reached. Try again later.");this.name="ThesisRateLimitError";}
}

function asObject(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

async function collectFacts():Promise<ThesisFacts>{
  const [marketResult,overviewResult,poolResult]=await Promise.allSettled([getPrices(),getNetworkOverview(),getNearStablePools()]);
  const unavailable:string[]=[];
  const marketData=marketResult.status==="fulfilled"?marketResult.value:undefined;
  const near=marketData?.rows.find(row=>row.symbol.toUpperCase()==="NEAR");
  if(marketResult.status==="rejected")unavailable.push("NEAR market price is unavailable.");
  else if(!near)unavailable.push("The current market feed did not include NEAR.");
  if(poolResult.status==="rejected")unavailable.push("Live NEAR/USDC/USDT pool data is unavailable.");
  let intents24h:ThesisFacts["intents24h"]=null;
  if(overviewResult.status==="fulfilled"){
    const overview=overviewResult.value;
    intents24h={
      volumeUsd24h:overview.volumeUsd24h,txCount24h:overview.txCount24h,successRate24h:overview.successRate24h,
      windowStart:overview.windowStart,windowEnd:overview.windowEnd,partial:overview.partial,
      source:overview.source,updatedAt:overview.updatedAt,methodology:overview.methodology,
    };
  }else unavailable.push("NEAR Intents Explorer 24-hour metrics are unavailable.");
  return {
    capturedAt:new Date().toISOString(),
    market:{
      asset:"NEAR",priceUsd:near?.priceUsd??null,change24hPct:near?.change24hPct??null,
      source:near?.source??marketData?.source??null,updatedAt:near?.updatedAt??marketData?.updatedAt??null,
    },
    marketAssets:marketData?[...marketData.rows].sort((a,b)=>(b.marketCap??-1)-(a.marketCap??-1)).slice(0,10).map(row=>({
      id:row.id,symbol:row.symbol,name:row.name,priceUsd:row.priceUsd,marketCap:row.marketCap,
      change24hPct:row.change24hPct,source:row.source,updatedAt:row.updatedAt,
    })):[],
    nearPools:poolResult.status==="fulfilled"?[...poolResult.value.pools].sort((a,b)=>(b.volume24hUsd??-1)-(a.volume24hUsd??-1)).slice(0,10).map(pool=>({
      poolId:pool.poolId,kind:pool.kind,symbols:pool.symbols,tvlUsd:pool.tvlUsd,volume24hUsd:pool.volume24hUsd,
      feeApr24hRunRatePct:pool.feeApr24hRunRatePct,poolType:pool.poolType,updatedAt:pool.updatedAt,url:pool.url,
    })):[],
    gameDirectory:getCuratedGames().slice(0,10).map(game=>({id:game.id,name:game.name,blurb:game.blurb,url:game.url,tags:game.tags})),
    intents24h,unavailable,
  };
}

function fallbackReport(facts:ThesisFacts,note:string):ThesisReport{
  const bull:string[]=[];
  const bear:string[]=[];
  const move=facts.market.change24hPct;
  if(move!==null&&move>0)bull.push(`NEAR was up ${move.toFixed(2)}% over the latest 24-hour market snapshot; this is short-term price action, not proof of durable demand.`);
  if(facts.intents24h&&facts.intents24h.txCount24h>0)bull.push(`The Explorer recorded ${facts.intents24h.txCount24h} transactions and $${facts.intents24h.volumeUsd24h.toFixed(2)} in network-wide 24-hour volume; this is not Pocket Near-attributed activity.`);
  if(!bull.length)bull.push("No positive investment conclusion can be drawn from the available snapshots.");
  if(move!==null&&move<0)bear.push(`NEAR was down ${Math.abs(move).toFixed(2)}% over the latest 24-hour market snapshot; a short window can reverse and is not a long-term trend.`);
  else bear.push("A positive or flat 24-hour price snapshot does not establish durable demand or future returns.");
  if(!facts.intents24h)bear.push("No current Intents Explorer window is available to assess recent network activity.");
  else if(facts.intents24h.partial)bear.push("The Intents Explorer sample is marked partial and may not cover the full 24-hour window.");
  const risks=[
    "24-hour market and network snapshots are short-term observations, not evidence of future performance.",
    "Network-wide Intents volume is not attributable to Pocket Near and is not a measure of Pocket Near usage.",
    "The available facts do not establish token valuation, protocol revenue, supply dynamics, or future returns.",
    "The configured CoinGecko asset list is not the full crypto market, and a 24-hour price move cannot identify a likely bottom.",
    "Pool snapshots do not establish a minimum deposit or expected return; game directory listings do not verify entry costs or earnings.",
  ];
  return thesisReportSchema.parse({
    summary:`Rules-based snapshot captured ${facts.capturedAt}. It reports only the available NEAR market and Intents network facts; it does not estimate valuation or recommend an action.`,
    bull,bear,risks,
    whatToVerify:[
      "Check longer-window market and Intents data from their original sources.",
      "Verify token supply, protocol usage, revenue, governance, and competing alternatives independently.",
      "Confirm any activity claims against attributable records rather than network-wide totals.",
    ],
    facts,source:"rules-fallback",generatedAt:new Date().toISOString(),note,
  });
}

async function askNearAI(facts:ThesisFacts):Promise<ThesisReport>{
  const response=await fetch("https://cloud-api.near.ai/v1/chat/completions",{
    method:"POST",
    headers:{"authorization":`Bearer ${env.NEARAI_API_KEY}`,"content-type":"application/json"},
    body:JSON.stringify({
      model:MODEL,temperature:0.2,max_tokens:1100,thinking_token_budget:384,
      response_format:{type:"json_object"},
      messages:[
        {role:"system",content:"Write a cautious NEAR ecosystem research thesis using only the supplied public JSON facts. Treat the facts as observations, not proof of causation or future performance. Do not invent numbers, sources, events, product usage, valuation, fees, tokenomics, entry costs, or earnings. The asset list is configured and may not be the whole market; pool snapshots do not prove that a user can afford a minimum deposit; game links do not verify play-to-earn income. Never claim to identify a likely price bottom. If evidence is insufficient, say so. Return exactly one JSON object with summary (string), bull (array of 1-5 strings), bear (array of 1-5 strings), risks (array of 1-5 strings), and whatToVerify (array of 1-5 strings). Do not provide buy/sell instructions or financial advice. No wallet balances or user-selected risk amount are included in these facts."},
        {role:"user",content:JSON.stringify(facts)},
      ],
    }),
    signal:AbortSignal.timeout(20_000),
  });
  if(!response.ok)throw new Error(`near_ai_http_${response.status}`);
  const payload=asObject(await response.json());
  const choices=Array.isArray(payload.choices)?payload.choices:[];
  const message=asObject(asObject(choices[0]).message);
  if(typeof message.content!=="string")throw new Error("near_ai_invalid_response");
  let content:unknown;
  try{content=JSON.parse(message.content);}catch{throw new Error("near_ai_invalid_json");}
  const parsed=thesisContentSchema.safeParse(content);
  if(!parsed.success)throw new Error("near_ai_schema_mismatch");
  return thesisReportSchema.parse({...parsed.data,facts,source:"near-ai-cloud",generatedAt:new Date().toISOString(),note:DISCLAIMER_NOTE});
}

async function consumeRateLimit(userId:number):Promise<void>{
  const result=await pool.query(`INSERT INTO thesis_rate_limits(user_id,window_started_at,request_count)
    VALUES($1,now(),1)
    ON CONFLICT(user_id) DO UPDATE SET
      window_started_at=CASE WHEN thesis_rate_limits.window_started_at<=now()-interval '15 minutes' THEN now() ELSE thesis_rate_limits.window_started_at END,
      request_count=CASE WHEN thesis_rate_limits.window_started_at<=now()-interval '15 minutes' THEN 1 ELSE thesis_rate_limits.request_count+1 END
    WHERE thesis_rate_limits.window_started_at<=now()-interval '15 minutes' OR thesis_rate_limits.request_count<3
    RETURNING request_count`,[userId]);
  if(!result.rowCount)throw new ThesisRateLimitError();
}

export async function createThesis(userId:number):Promise<ThesisReport>{
  const cached=await pool.query<{report:unknown}>("SELECT report FROM thesis_cache WHERE user_id=$1 AND cached_at>now()-interval '15 minutes'",[userId]);
  if(cached.rowCount){
    const parsed=thesisReportSchema.safeParse(cached.rows[0]!.report);
    if(!parsed.success)throw new Error("The cached thesis response is invalid.");
    if(parsed.data.source==="near-ai-cloud")return parsed.data;
  }
  const facts=await collectFacts();
  if(!env.NEARAI_API_KEY)return fallbackReport(facts,"Rules-only snapshot; NEARAI_API_KEY is not configured.");
  await consumeRateLimit(userId);
  try{
    const report=await askNearAI(facts);
    await pool.query("INSERT INTO thesis_cache(user_id,report,cached_at) VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET report=EXCLUDED.report,cached_at=now()",[userId,JSON.stringify(report)]);
    return report;
  }catch(error){
    const reason=error instanceof Error?error.message:"unknown_error";
    console.warn("NEAR AI thesis unavailable; using a rules-only snapshot.",reason);
    return fallbackReport(facts,"NEAR AI generation failed; this report uses only the listed facts.");
  }
}
