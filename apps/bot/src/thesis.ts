import { thesisContentSchema, thesisReportSchema, type ThesisFacts, type ThesisReport } from "@pocket-near/shared";
import { pool } from "./db.js";
import { env } from "./env.js";
import { getPrices } from "./dataFeeds.js";
import { getNetworkOverview } from "./networkOverview.js";

const MODEL="z-ai/glm-5.3-flash";
const DISCLAIMER_NOTE="AI-generated analysis; not independently verified or attested.";

export class ThesisRateLimitError extends Error {
  constructor(){super("Thesis generation limit reached. Try again later.");this.name="ThesisRateLimitError";}
}

function asObject(value:unknown):Record<string,unknown>{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

async function collectFacts():Promise<ThesisFacts>{
  const [marketResult,overviewResult]=await Promise.allSettled([getPrices(),getNetworkOverview()]);
  const unavailable:string[]=[];
  const marketData=marketResult.status==="fulfilled"?marketResult.value:undefined;
  const near=marketData?.rows.find(row=>row.symbol.toUpperCase()==="NEAR");
  if(marketResult.status==="rejected")unavailable.push("NEAR market price is unavailable.");
  else if(!near)unavailable.push("The current market feed did not include NEAR.");
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
        {role:"system",content:"Write a cautious NEAR ecosystem research thesis using only the supplied JSON facts. Treat the facts as observations, not proof of causation or future performance. Do not invent numbers, sources, events, product usage, valuation, fees, or tokenomics. If evidence is insufficient, say so. Return exactly one JSON object with summary (string), bull (array of 1-5 strings), bear (array of 1-5 strings), risks (array of 1-5 strings), and whatToVerify (array of 1-5 strings). Do not provide buy/sell instructions or financial advice."},
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
