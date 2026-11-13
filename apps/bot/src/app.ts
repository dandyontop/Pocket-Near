import { randomUUID } from "node:crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { canonicalPolicy, checkPolicy, policySchema, quoteInputSchema, type QuoteView } from "@pocket-near/shared";
import { migrate, pool } from "./db.js";
import { env } from "./env.js";
import { makePasswordHash, makeSession, newNonce, readSession, verifyPassword, verifyTelegramInitData } from "./security.js";
import { readNativeNearBalance, verifyPolicySignature, type SignedPolicyEnvelope } from "./near.js";
import { fetchLiveQuote, QuoteProviderError, QuoteRequestError } from "./quotes.js";
import { getCuratedApps, getCuratedGames, getEarn, getPrices } from "./dataFeeds.js";
import { getMarketAgent, listMarketAgents } from "./marketplace.js";
import { getNetworkOverview, NetworkOverviewError } from "./networkOverview.js";
import { timingSafeEqual } from "node:crypto";
import { getRheaPositions, getRNearYield } from "./rheaPositions.js";
import { runScheduledWorker } from "./scheduledWorker.js";
import { checkRheaRouteRegistration, getRheaFrozenTokenSet, getRheaMarkets, getRheaSwapQuote } from "./rheaMarkets.js";
import { getNearStablePools } from "./investmentPools.js";

declare global { namespace Express { interface Request { telegramId?: number; userId?: number } } }
const app: Express = express();
if(process.env.VERCEL)app.set("trust proxy",1);
const origins = new Set([
  ...env.ALLOWED_ORIGINS.split(",").map(v => v.trim()).filter(Boolean),
  new URL(env.PUBLIC_APP_URL).origin,
  ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
  ...(process.env.VERCEL_BRANCH_URL ? [`https://${process.env.VERCEL_BRANCH_URL}`] : []),
]);
const loginRate = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false });
const apiRate = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false });
const challenges = new Map<number,string>();
const walletChallenges = new Map<number,{nonce:string;message:string}>();

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"],scriptSrc:["'self'","https://telegram.org"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["'self'","data:","https://fonts.gstatic.com"],imgSrc:["'self'","data:","https:"],connectSrc:["'self'",...origins,"https://1click.chaindefuser.com","https://rpc.mainnet.near.org"] } } }));
app.use(cors({ origin(origin, cb) { if (!origin || origins.has(origin)) return cb(null,true); cb(new Error("Origin is not allowed.")); }, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "64kb", type: "application/json" }));
app.use("/api",apiRate);
app.use((_req,_res,next)=>{void migrate().then(()=>next(),next);});

function fail(res: Response, status: number, message: string): void { res.status(status).json({ error: message }); }
function asyncRoute(fn: (req: Request,res: Response,next: NextFunction) => Promise<unknown>) { return (req: Request,res: Response,next: NextFunction) => { void fn(req,res,next).catch(next); }; }
const cookieName = "pocket_near_session";
function cookie(res: Response, token: string) { res.cookie(cookieName,token,{ httpOnly:true, secure:env.COOKIE_SECURE, sameSite:env.COOKIE_SECURE?"none":"lax", path:"/api", maxAge:12*60*60*1000 }); }

const requireSession = asyncRoute(async (req,res,next) => {
  try {
    const token = req.cookies?.[cookieName] as string | undefined;
    const telegramId = token ? await readSession(token) : undefined;
    if (!telegramId) return fail(res,401,"Open Pocket Near from its Telegram Mini App button.");
    req.telegramId = telegramId;
    const user = await pool.query<{id:string}>("INSERT INTO users(telegram_id) VALUES($1) ON CONFLICT(telegram_id) DO UPDATE SET updated_at=now() RETURNING id",[telegramId]);
    req.userId = Number(user.rows[0]!.id);
    next();
  } catch { fail(res,401,"Session expired. Reopen the Mini App from Telegram."); }
});

app.get("/api/worker/tick",asyncRoute(async(req,res)=>{
  const authorization=req.get("authorization")??"";
  const expected=`Bearer ${env.CRON_SECRET}`;
  const suppliedBytes=Buffer.from(authorization),expectedBytes=Buffer.from(expected);
  if(!env.CRON_SECRET||suppliedBytes.length!==expectedBytes.length||!timingSafeEqual(suppliedBytes,expectedBytes))return fail(res,401,"Worker authorization failed.");
  const result=await runScheduledWorker();
  res.status(result.errors.length?502:200).json({ok:result.errors.length===0,...result});
}));

app.get("/api/investments/preferences",requireSession,asyncRoute(async(req,res)=>{
  const {rows}=await pool.query(`SELECT alerts_enabled AS "alertsEnabled",symbols,position_monitoring AS "positionMonitoring",report_frequency AS "reportFrequency",last_suggestion_at AS "lastSuggestionAt",next_position_report_at AS "nextPositionReportAt" FROM investment_preferences WHERE user_id=$1`,[req.userId]);
  res.json({preferences:rows[0]??{alertsEnabled:false,symbols:["NEAR","USDC","USDT"],positionMonitoring:false,reportFrequency:1,lastSuggestionAt:null,nextPositionReportAt:null}});
}));
app.put("/api/investments/preferences",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({alertsEnabled:z.boolean(),symbols:z.array(z.enum(["NEAR","USDC","USDT"])).max(3),positionMonitoring:z.boolean(),reportFrequency:z.number().int().min(1).max(4)}).parse(req.body);
  const symbols=[...new Set(body.symbols)];
  if(body.alertsEnabled&&!symbols.length)return fail(res,400,"Choose at least one token for investment alerts.");
  const current=(await pool.query<{report_frequency:number;position_monitoring:boolean}>("SELECT report_frequency,position_monitoring FROM investment_preferences WHERE user_id=$1",[req.userId])).rows[0];
  const reportChanged=Boolean(current&&(current.report_frequency!==body.reportFrequency||current.position_monitoring!==body.positionMonitoring));
  const {rows}=await pool.query(`INSERT INTO investment_preferences(user_id,alerts_enabled,symbols,position_monitoring,report_frequency,next_position_report_at,updated_at)
    VALUES($1,$2,$3,$4,$5,CASE WHEN $4 THEN now()+($6::text||' hours')::interval ELSE NULL END,now())
    ON CONFLICT(user_id) DO UPDATE SET alerts_enabled=EXCLUDED.alerts_enabled,symbols=EXCLUDED.symbols,position_monitoring=EXCLUDED.position_monitoring,report_frequency=EXCLUDED.report_frequency,
      next_position_report_at=CASE WHEN NOT EXCLUDED.position_monitoring THEN NULL WHEN $7 THEN now()+($6::text||' hours')::interval ELSE investment_preferences.next_position_report_at END,updated_at=now()
    RETURNING alerts_enabled AS "alertsEnabled",symbols,position_monitoring AS "positionMonitoring",report_frequency AS "reportFrequency",last_suggestion_at AS "lastSuggestionAt",next_position_report_at AS "nextPositionReportAt"`,
  [req.userId,body.alertsEnabled,symbols,body.positionMonitoring,body.reportFrequency,24/body.reportFrequency,reportChanged||!current]);
  res.json({preferences:rows[0]});
}));
app.get("/api/investments/opportunities",requireSession,asyncRoute(async(_req,res)=>{
  const [data,rnear]=await Promise.all([getNearStablePools(),getRNearYield()]);
  res.setHeader("Cache-Control","private, max-age=60");
  res.json({...data,yields:{poolFeeApr:data.pools.map(item=>({poolId:item.poolId,symbols:item.symbols,valuePct:item.feeApr24hRunRatePct,source:"GeckoTerminal 24h volume × pool fee × assumed 80% LP share ÷ indexed TVL × 365",observedAt:item.updatedAt,basis:"Backward-looking annualized run-rate; unavailable for CLMM or unclassified pools"})),rnearStakingApy:{valuePct:rnear.apyPct,source:rnear.source,observedAt:rnear.observedAt,basis:"Rhea-reported staking APY; reward accrues through rNEAR share price"},farmRewardsApr:{valuePct:null,source:null,observedAt:null,basis:"No verified live farm rewards APR source is integrated."},lendingSupplyApy:{valuePct:null,source:null,observedAt:null,basis:"No verified live Rhea lending supply APY source is integrated."}},source:"Rhea public pool index + GeckoTerminal 24h market data + Rhea rNEAR indexer and contract",disclaimer:"Pool fee run-rate is a backward-looking estimate, not Rhea's official APR or a forecast. It uses an assumed 80% LP share and excludes impermanent loss and token price changes. rNEAR staking APY is separately reported by Rhea. Farm rewards APR and lending supply APY are shown unavailable until a verified source is integrated."});
}));
app.get("/api/positions",requireSession,asyncRoute(async(req,res)=>{
  const user=(await pool.query<{account_id:string|null}>("SELECT account_id FROM users WHERE id=$1",[req.userId])).rows[0];
  if(!user?.account_id)return res.json({positions:[],source:"Intear indexed Rhea deposits",height:null,coverage:"Connect a NEAR wallet to detect Rhea deposits."});
  const result=await getRheaPositions(user.account_id);
  res.setHeader("Cache-Control","private, max-age=60");
  res.json({...result,coverage:"Rhea internal token deposits and rNEAR liquid staking are tracked. Rhea farm-staked positions and concentrated-liquidity NFT positions are not currently included. rNEAR unlock time is unavailable when the contract view does not expose an estimate."});
}));

app.get("/api/prices",requireSession,asyncRoute(async(_req,res)=>{
  const data=await getPrices();res.setHeader("Cache-Control","private, max-age=30");res.json(data);
}));
app.get("/api/network/overview",requireSession,asyncRoute(async(_req,res)=>{
  try{
    const data=await getNetworkOverview();
    res.setHeader("Cache-Control","private, max-age=300");
    res.json(data);
  }catch(error){
    if(error instanceof NetworkOverviewError)return fail(res,error.status,error.message);
    throw error;
  }
}));
app.get("/api/prices/watchlist",requireSession,asyncRoute(async(req,res)=>{
  const {rows}=await pool.query<{symbol:string}>("SELECT symbol FROM price_watchlist WHERE user_id=$1 ORDER BY created_at",[req.userId]);res.json({symbols:rows.map(r=>r.symbol)});
}));
app.put("/api/prices/watchlist",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({symbols:z.array(z.string().min(1).max(24)).max(50)}).parse(req.body);
  const symbols=[...new Set(body.symbols.map(s=>s.toUpperCase()))];
  const client=await pool.connect();
  try{await client.query("BEGIN");await client.query("DELETE FROM price_watchlist WHERE user_id=$1",[req.userId]);for(const symbol of symbols)await client.query("INSERT INTO price_watchlist(user_id,symbol) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.userId,symbol]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  res.json({symbols});
}));
app.get("/api/prices/alerts",requireSession,asyncRoute(async(req,res)=>{
  const {rows}=await pool.query("SELECT id,symbol,op,threshold_usd::float8 AS \"thresholdUsd\",active,created_at AS \"createdAt\" FROM price_alerts WHERE user_id=$1 ORDER BY created_at DESC",[req.userId]);res.json({alerts:rows});
}));
app.post("/api/prices/alerts",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({symbol:z.string().min(1).max(24),op:z.enum(["gte","lte"]),thresholdUsd:z.number().positive().finite()}).parse(req.body);
  const symbol=body.symbol.toUpperCase();const market=await getPrices();if(!market.rows.some(p=>p.symbol===symbol))return fail(res,400,"Choose a symbol from the current price list.");
  const {rows}=await pool.query("INSERT INTO price_alerts(user_id,symbol,op,threshold_usd) VALUES($1,$2,$3,$4) RETURNING id,symbol,op,threshold_usd::float8 AS \"thresholdUsd\",active,created_at AS \"createdAt\"",[req.userId,symbol,body.op,body.thresholdUsd]);res.status(201).json({alert:rows[0]});
}));
app.patch("/api/prices/alerts/:id",requireSession,asyncRoute(async(req,res)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);const {active}=z.object({active:z.boolean()}).parse(req.body);
  const {rows}=await pool.query("UPDATE price_alerts SET active=$1,last_fired_at=CASE WHEN $1 THEN last_fired_at ELSE NULL END WHERE id=$2 AND user_id=$3 RETURNING id,symbol,op,threshold_usd::float8 AS \"thresholdUsd\",active,created_at AS \"createdAt\"",[active,id,req.userId]);if(!rows.length)return fail(res,404,"Price alert was not found.");res.json({alert:rows[0]});
}));
app.delete("/api/prices/alerts/:id",requireSession,asyncRoute(async(req,res)=>{
  const id=z.coerce.number().int().positive().parse(req.params.id);const result=await pool.query("DELETE FROM price_alerts WHERE id=$1 AND user_id=$2",[id,req.userId]);if(!result.rowCount)return fail(res,404,"Price alert was not found.");res.status(204).end();
}));
app.get("/api/earn",requireSession,asyncRoute(async(req,res)=>{
  const data=await getEarn();const category=typeof req.query.category==="string"?req.query.category:undefined;const minTvl=Number(req.query.minTvl??0);const sort=req.query.sort==="change1d"?"change1d":req.query.sort==="change7d"?"change7d":"tvl";
  const protocols=data.protocols.filter(p=>(!category||p.category.toLowerCase()===category.toLowerCase())&&p.tvl>=Math.max(0,minTvl)).sort((a,b)=>sort==="tvl"?b.tvl-a.tvl:(b[sort]??-Infinity)-(a[sort]??-Infinity));res.json({...data,protocols});
}));
app.get("/api/explore/apps",requireSession,asyncRoute(async(req,res)=>{
  const category=typeof req.query.category==="string"?req.query.category:undefined;const search=typeof req.query.search==="string"?req.query.search.toLowerCase().slice(0,80):"";const sort=req.query.sort==="name"?"name":req.query.sort==="featured"?"featured":"tvl";
  const {protocols}=await getEarn();const mapped=getCuratedApps().map(app=>{const protocol=protocols.find(p=>p.name.toLowerCase()===app.name.toLowerCase()||p.id===app.slug);return {...app,...(protocol?{tvl:protocol.tvl}:{})};});
  const apps=mapped.filter(a=>(!category||a.category===category)&&(!search||`${a.name} ${a.blurb} ${a.category}`.toLowerCase().includes(search))).sort((a,b)=>sort==="name"?a.name.localeCompare(b.name):sort==="featured"?Number(b.featured)-Number(a.featured)||((b.tvl??0)-(a.tvl??0)):((b.tvl??0)-(a.tvl??0))||Number(b.featured)-Number(a.featured));res.json({apps,source:"curated+DefiLlama"});
}));
app.get("/api/explore/games",requireSession,(_req,res)=>res.json({games:getCuratedGames(),source:"curated"}));
app.post("/api/discover/events",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({itemType:z.enum(["app","game","earn"]),itemId:z.string().min(1).max(120)}).parse(req.body);await pool.query("INSERT INTO discover_events(user_id,item_type,item_id,action) VALUES($1,$2,$3,'open')",[req.userId,body.itemType,body.itemId]);res.status(201).json({recorded:true});
}));

app.get("/api/meme/board",requireSession,asyncRoute(async(req,res)=>{
  const assets=await getRheaMarkets();
  if(!assets.length)return res.json({status:"coming_soon",assets:[]});
  const {rows}=await pool.query<{asset_id:string;bull_votes:string;bear_votes:string;user_vote:"bull"|"bear"|null}>(
    `SELECT asset_id,
      count(*) FILTER(WHERE vote='bull')::text AS bull_votes,
      count(*) FILTER(WHERE vote='bear')::text AS bear_votes,
      max(vote) FILTER(WHERE user_id=$2) AS user_vote
     FROM meme_votes WHERE asset_id=ANY($1::text[]) GROUP BY asset_id`,
    [assets.map(asset=>asset.assetId),req.userId],
  );
  const byAsset=new Map(rows.map(row=>[row.asset_id,row]));
  res.setHeader("Cache-Control","private, no-store");
  res.json({status:"live",assets:assets.map(asset=>{
    const votes=byAsset.get(asset.assetId);
    return {...asset,bullVotes:Number(votes?.bull_votes??0),bearVotes:Number(votes?.bear_votes??0),userVote:votes?.user_vote??null};
  })});
}));
app.put("/api/meme/vote",requireSession,asyncRoute(async(req,res)=>{
  const {assetId,vote}=z.object({assetId:z.string().min(1).max(160),vote:z.enum(["bull","bear"])}).parse(req.body);
  const asset=(await getRheaMarkets()).find(candidate=>candidate.assetId===assetId);
  if(!asset)return fail(res,404,"This token is not in the current NEAR Rhea market list.");
  await pool.query("INSERT INTO meme_votes(user_id,asset_id,vote) VALUES($1,$2,$3) ON CONFLICT(user_id,asset_id) DO UPDATE SET vote=EXCLUDED.vote,updated_at=now()",[req.userId,assetId,vote]);
  res.json({saved:true});
}));

app.get("/api/market/agents",requireSession,asyncRoute(async(req,res)=>{
  const query=typeof req.query.query==="string"?req.query.query.slice(0,100):"";const category=typeof req.query.category==="string"?req.query.category.slice(0,80):"";
  let offset=0;if(typeof req.query.cursor==="string"){try{offset=Number(Buffer.from(req.query.cursor,"base64url").toString("utf8"));}catch{return fail(res,400,"Invalid marketplace cursor.");}}
  if(!Number.isSafeInteger(offset)||offset<0||offset>100_000)return fail(res,400,"Invalid marketplace cursor.");
  try{res.setHeader("Cache-Control","private, max-age=60");res.json(await listMarketAgents({query,category,offset,limit:12}));}catch(error){const status=(error as {status?:number}).status??502;fail(res,status,status===404?"Market listing was not found.":"NEAR Agent Market is temporarily unavailable.");}
}));
app.get("/api/market/agents/:id",requireSession,asyncRoute(async(req,res)=>{
  const id=Array.isArray(req.params.id)?req.params.id[0]!:req.params.id!;try{res.setHeader("Cache-Control","private, max-age=60");res.json({agent:await getMarketAgent(id)});}catch(error){const status=(error as {status?:number}).status??502;fail(res,status,status===404?"Market listing was not found.":"NEAR Agent Market is temporarily unavailable.");}
}));

async function requirePassword(req: Request, supplied?: string): Promise<boolean> {
  // Unlock passwords are 10–128 characters; verify against the per-user salted scrypt hash and never persist the plaintext.
  const row = await pool.query<{password_salt:string|null,password_hash:string|null}>("SELECT password_salt,password_hash FROM users WHERE id=$1",[req.userId]);
  const password = z.string().min(10).max(128).safeParse(supplied ?? req.get("x-pocket-password") ?? "");
  if (!row.rows[0]?.password_hash || !row.rows[0].password_salt || !password.success) return false;
  return verifyPassword(password.data,row.rows[0].password_salt,row.rows[0].password_hash);
}

app.get("/api/health",asyncRoute(async(_req,res)=>{await pool.query("SELECT 1");res.json({ok:true,database:"connected"});}));
app.post("/api/auth/telegram",loginRate,asyncRoute(async (req,res) => {
  const data = z.object({ initData:z.string().min(1).max(8192) }).parse(req.body);
  try {
    const telegram = verifyTelegramInitData(data.initData);
    await pool.query("INSERT INTO users(telegram_id) VALUES($1) ON CONFLICT(telegram_id) DO UPDATE SET updated_at=now()",[telegram.userId]);
    cookie(res,await makeSession(telegram.userId));
    res.json({ authenticated:true });
  } catch (error) { fail(res,401,error instanceof Error ? error.message : "Telegram authentication failed."); }
}));
app.post("/api/auth/dev",loginRate,asyncRoute(async(_req,res)=>{
  if(env.NODE_ENV!=="development")return fail(res,404,"Not found.");
  const telegramId=900_000_001;
  await pool.query("INSERT INTO users(telegram_id) VALUES($1) ON CONFLICT(telegram_id) DO UPDATE SET updated_at=now()",[telegramId]);
  cookie(res,await makeSession(telegramId));
  res.json({authenticated:true,developmentOnly:true});
}));
app.post("/api/auth/logout",(_req,res) => { res.clearCookie(cookieName,{ path:"/api", sameSite:env.COOKIE_SECURE?"none":"lax", secure:env.COOKIE_SECURE }); res.status(204).end(); });
app.get("/api/auth/me",requireSession,asyncRoute(async (req,res) => {
  const { rows } = await pool.query("SELECT account_id,(password_hash IS NOT NULL) AS password_set,agent_enabled,auto_enabled FROM users WHERE id=$1",[req.userId]);
  res.json({ accountId:rows[0]?.account_id ?? null,passwordSet:rows[0]?.password_set ?? false,agentEnabled:rows[0]?.agent_enabled??false,autoEnabled:rows[0]?.auto_enabled??false });
}));
app.get("/api/agent/status",requireSession,asyncRoute(async(req,res)=>{
  const {rows}=await pool.query<any>(`SELECT u.agent_enabled,u.agent_mode,u.master_lock,u.auto_exec_lock,u.last_run_at,u.last_error,(u.password_hash IS NOT NULL) password_set,p.active policy_active,p.body FROM users u LEFT JOIN policies p ON p.user_id=u.id WHERE u.id=$1`,[req.userId]);const r=rows[0];
  const events=await pool.query("SELECT event_type,details,created_at FROM execution_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10",[req.userId]);
  res.json({agentEnabled:r.agent_enabled,mode:r.agent_mode,masterLock:r.master_lock,autoExecLock:r.auto_exec_lock,freeze:Boolean(r.body?.freeze),passwordSet:r.password_set,policyActive:Boolean(r.policy_active),lastRunAt:r.last_run_at,lastError:r.last_error,policy:r.body??null,lastEvents:events.rows});
}));
app.put("/api/agent/settings",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({agentEnabled:z.boolean().optional(),mode:z.enum(["off","notify_only"]).optional(),masterLock:z.boolean().optional(),password:z.string().min(10).max(128).optional()}).refine(v=>v.agentEnabled!==undefined||v.mode!==undefined||v.masterLock!==undefined).parse(req.body);
  const current=(await pool.query<{master_lock:boolean;agent_mode:string;agent_enabled:boolean}>("SELECT master_lock,agent_mode,agent_enabled FROM users WHERE id=$1",[req.userId])).rows[0]!;
  const mode=body.mode??(body.agentEnabled===false?"off":body.agentEnabled===true&&current.agent_mode==="off"?"notify_only":current.agent_mode);
  if(body.masterLock===false&&current.master_lock&&!await requirePassword(req,body.password))return fail(res,403,"A valid unlock password is required to clear the master lock.");
  const enabled=body.agentEnabled??(mode!=="off"&&current.agent_enabled);
  await pool.query("UPDATE users SET agent_enabled=$1,agent_mode=$2,auto_enabled=false,master_lock=COALESCE($3,master_lock),updated_at=now() WHERE id=$4",[enabled,mode,body.masterLock??null,req.userId]);
  await pool.query("INSERT INTO execution_events(user_id,event_type,details) VALUES($1,'preview',$2)",[req.userId,JSON.stringify({source:"agent-settings",mode,agentEnabled:enabled,masterLock:body.masterLock??current.master_lock})]);
  const r=(await pool.query("SELECT agent_enabled,agent_mode,master_lock FROM users WHERE id=$1",[req.userId])).rows[0];res.json({agentEnabled:r.agent_enabled,mode:r.agent_mode,masterLock:r.master_lock,autoExecLock:false});
}));
app.post("/api/wallet/challenge",requireSession,asyncRoute(async(req,res)=>{
  const {accountId}=z.object({accountId:z.string().min(2).max(128)}).parse(req.body);
  const nonce=Buffer.from(newNonce()).toString("base64");
  const message=`Pocket Near wallet connection\nTelegram user: ${req.telegramId}\nAccount: ${accountId}\nNonce: ${nonce}`;
  walletChallenges.set(req.telegramId!,{nonce,message});
  setTimeout(()=>walletChallenges.delete(req.telegramId!),5*60_000).unref();
  res.json({nonce,message,recipient:"Pocket Near"});
}));
app.post("/api/wallet/verify",requireSession,asyncRoute(async(req,res)=>{
  const envelope=z.object({accountId:z.string(),publicKey:z.string(),signature:z.string(),payload:z.object({message:z.string(),recipient:z.string(),nonce:z.string()})}).parse(req.body);
  const challenge=walletChallenges.get(req.telegramId!);
  if(!challenge||challenge.nonce!==envelope.payload.nonce||challenge.message!==envelope.payload.message||envelope.payload.recipient!=="Pocket Near")return fail(res,403,"Wallet proof is invalid or expired.");
  try{await verifyPolicySignature(envelope);}catch{return fail(res,403,"Wallet signature could not be verified.");}
  walletChallenges.delete(req.telegramId!);
  await pool.query("UPDATE users SET account_id=$1,updated_at=now() WHERE id=$2",[envelope.accountId,req.userId]);
  res.json({accountId:envelope.accountId});
}));

app.post("/api/security/password",requireSession,asyncRoute(async (req,res) => {
  const body = z.object({ password:z.string().min(10).max(128), currentPassword:z.string().optional() }).parse(req.body);
  const row = await pool.query<{password_salt:string|null,password_hash:string|null}>("SELECT password_salt,password_hash FROM users WHERE id=$1",[req.userId]);
  if (row.rows[0]?.password_hash) {
    if (!body.currentPassword || !row.rows[0].password_salt || !await verifyPassword(body.currentPassword,row.rows[0].password_salt,row.rows[0].password_hash)) return fail(res,403,"Current password is incorrect.");
  }
  const {salt,hash} = await makePasswordHash(body.password);
  await pool.query("UPDATE users SET password_salt=$1,password_hash=$2,updated_at=now() WHERE id=$3",[salt,hash,req.userId]);
  res.json({ saved:true });
}));
app.post("/api/security/verify",requireSession,asyncRoute(async(req,res)=>{
  const {password}=z.object({password:z.string().min(10).max(128)}).parse(req.body);if(!await requirePassword(req,password))return fail(res,403,"Unlock password is incorrect.");res.json({unlocked:true});
}));

app.get("/api/policy",requireSession,asyncRoute(async (req,res) => {
  const {rows} = await pool.query("SELECT body,signature,active,updated_at FROM policies WHERE user_id=$1",[req.userId]);
  res.json({ policy:rows[0] ?? null });
}));
app.post("/api/policy/challenge",requireSession,asyncRoute(async (req,res) => {
  const { accountId } = z.object({accountId:z.string().min(2).max(128)}).parse(req.body);
  const nonce = newNonce();
  const nonceBase64 = Buffer.from(nonce).toString("base64");
  const message = `Pocket Near policy authorization\nAccount: ${accountId}\nNonce: ${nonceBase64}`;
  challenges.set(req.telegramId!,nonceBase64);
  setTimeout(() => { if(challenges.get(req.telegramId!)===nonceBase64) challenges.delete(req.telegramId!); },5*60_000).unref();
  res.json({message,recipient:"Pocket Near",nonce:nonceBase64});
}));
app.put("/api/policy",requireSession,asyncRoute(async (req,res) => {
  const parsed = z.object({policy:policySchema,envelope:z.object({accountId:z.string(),publicKey:z.string(),signature:z.string(),payload:z.object({message:z.string(),recipient:z.string(),nonce:z.string()})})}).safeParse(req.body);
  if (!parsed.success) return fail(res,400,"Policy payload is invalid.");
  if (!await requirePassword(req)) return fail(res,403,"Unlock with your password before changing the policy.");
  const {policy,envelope} = parsed.data;
  if (policy.accountId !== envelope.accountId || policy.accountId !== (await pool.query("SELECT account_id FROM users WHERE id=$1",[req.userId])).rows[0]?.account_id) return fail(res,403,"Policy account does not match the connected wallet.");
  if (challenges.get(req.telegramId!) !== envelope.payload.nonce) return fail(res,403,"Policy signing challenge is missing, expired, or already used.");
  const canonical = canonicalPolicy(policy);
  const expected = `Pocket Near policy authorization\nAccount: ${policy.accountId}\nNonce: ${envelope.payload.nonce}\nPolicy: ${canonical}`;
  if (envelope.payload.message !== expected) return fail(res,403,"Signed message does not match the submitted policy.");
  try { await verifyPolicySignature(envelope); } catch { return fail(res,403,"Wallet signature could not be verified."); }
  challenges.delete(req.telegramId!);
  await pool.query("INSERT INTO policies(user_id,body,signature,signer_public_key,signed_message,signed_nonce,active) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id) DO UPDATE SET body=EXCLUDED.body,signature=EXCLUDED.signature,signer_public_key=EXCLUDED.signer_public_key,signed_message=EXCLUDED.signed_message,signed_nonce=EXCLUDED.signed_nonce,active=true,updated_at=now()",[req.userId,JSON.stringify(policy),JSON.stringify(envelope),envelope.publicKey,expected,Buffer.from(envelope.payload.nonce,"base64"),!policy.freeze]);
  res.json({saved:true,policy});
}));

app.get("/api/assets",asyncRoute(async (_req,res) => {
  const response = await fetch(`${env.ONE_CLICK_BASE_URL}/v0/tokens`,{signal:AbortSignal.timeout(10_000)});
  if (!response.ok) return fail(res,502,"Supported asset directory is temporarily unavailable.");
  const data: unknown = await response.json();
  if (!Array.isArray(data)) return fail(res,502,"Supported asset directory returned an invalid response.");
  const assets = data.map((item) => {
    const v = item as Record<string,unknown>;
    return {assetId:String(v.assetId ?? ""),symbol:String(v.symbol ?? ""),name:String(v.name ?? ""),decimals:Number(v.decimals),blockchain:String(v.blockchain ?? "")};
  }).filter(a => a.assetId && a.symbol && Number.isInteger(a.decimals) && a.decimals >= 0 && a.decimals <= 30).slice(0,1000);
  try{for(const market of await getRheaMarkets())if(!assets.some(asset=>asset.assetId===market.assetId))assets.push({assetId:market.assetId,symbol:market.symbol,name:market.name,decimals:market.decimals,blockchain:"near"});}catch{/* The main Intents asset list remains usable when the market index is down. */}
  res.setHeader("Cache-Control","public, max-age=60, stale-while-revalidate=240");
  res.json({assets});
}));

app.get("/api/rhea/pools",requireSession,asyncRoute(async(_req,res)=>{
  try{const markets=await getRheaMarkets();res.setHeader("Cache-Control","private, max-age=45");res.json({markets,source:"GeckoTerminal Rhea pools + Rhea on-chain frozen-token list",updatedAt:new Date().toISOString(),coverage:"Tokens in the first five Rhea pool pages sorted by 24-hour volume"});}
  catch(error){fail(res,(error as {status?:number}).status??502,"Rhea pool market data is temporarily unavailable.");}
}));

app.post("/api/rhea/quote",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({originAsset:z.string().min(1).max(160),destinationAsset:z.string().min(1).max(160),amount:z.string().regex(/^[1-9]\d{0,77}$/),sender:z.string().min(2).max(128),slippageToleranceBps:z.number().int().min(1).max(500)}).parse(req.body);
  const account=await pool.query<{account_id:string|null}>("SELECT account_id FROM users WHERE id=$1",[req.userId]);
  if(account.rows[0]?.account_id!==body.sender)return fail(res,403,"Quote sender must be the connected wallet.");
  const contract=(asset:string)=>asset.startsWith("near:")?asset.slice(5):null;
  const tokenIn=contract(body.originAsset),tokenOut=contract(body.destinationAsset);
  if(!tokenIn||!tokenOut||tokenIn===tokenOut)return fail(res,400,"Rhea quotes require two different NEAR token contracts.");
  const markets=await getRheaMarkets();
  if(!markets.some(m=>m.assetId===body.originAsset)||!markets.some(m=>m.assetId===body.destinationAsset))return fail(res,422,"Both tokens must currently have an indexed NEAR or stablecoin Rhea pool.");
  const frozen=await getRheaFrozenTokenSet();
  if(frozen?.has(tokenIn.toLowerCase())||frozen?.has(tokenOut.toLowerCase()))return fail(res,409,"Rhea has frozen one of these tokens. Swap execution is blocked.");
  try{
    const route=await getRheaSwapQuote({amount:body.amount,tokenIn,tokenOut,user:body.sender,slippageBps:body.slippageToleranceBps});
    const registration=await checkRheaRouteRegistration(body.sender,route.tokens);
    const quote:QuoteView={id:`rhea-${randomUUID()}`,provider:"rhea",originAsset:body.originAsset,destinationAsset:body.destinationAsset,amountIn:route.amount_in,amountOut:route.amount_out,minAmountOut:route.min_amount_out,route:route.tokens,fees:[],expiresAt:new Date(Date.now()+30_000).toISOString(),slippageBps:body.slippageToleranceBps,stale:false,raw:{...route,receiverId:"aggregatedex.near",inputToken:tokenIn,accountId:body.sender,registration}};
    res.setHeader("Cache-Control","no-store");res.json({quote,source:"Rhea SmartRouter",autoEligible:false});
  }catch(error){fail(res,(error as {status?:number}).status??502,error instanceof Error?error.message:"Rhea route lookup failed.");}
}));

app.post("/api/quotes",requireSession,asyncRoute(async (req,res) => {
  const parsed = quoteInputSchema.safeParse(req.body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "amount") return fail(res,400,"Amount must be a positive integer in base units.");
    if (field === "slippageToleranceBps") return fail(res,400,"Slippage tolerance must be between 1 and 500 basis points.");
    if (field === "originAsset" || field === "destinationAsset") return fail(res,400,"Choose both assets from the 1-Click asset list.");
    if (field === "sender") return fail(res,400,"Sender must be the connected NEAR account ID.");
    if (field === "recipient") return fail(res,400,"Enter a valid recipient address.");
    if (field === "refundTo") return fail(res,400,"Enter a valid refund address.");
    return fail(res,400,"The quote request is invalid.");
  }
  const input = parsed.data;
  const account = await pool.query<{account_id:string|null}>("SELECT account_id FROM users WHERE id=$1",[req.userId]);
  if (account.rows[0]?.account_id !== input.sender) return fail(res,403,"Quote sender must be the connected wallet.");
  let result: Awaited<ReturnType<typeof fetchLiveQuote>>;
  try {
    result = await fetchLiveQuote(input);
  } catch (error) {
    if (error instanceof QuoteRequestError || error instanceof QuoteProviderError) return fail(res,error.status ?? 400,error.message);
    throw error;
  }
  const {quote,source} = result;
  await pool.query("INSERT INTO live_quotes(user_id,quote_id,quote) VALUES($1,$2,$3) ON CONFLICT(user_id,quote_id) DO UPDATE SET quote=EXCLUDED.quote,created_at=now()",[req.userId,quote.id,JSON.stringify(quote)]);
  res.setHeader("Cache-Control","no-store");
  res.json({quote,source,autoEligible:!quote.stale && Date.parse(quote.expiresAt)>Date.now()});
}));

app.post("/api/agent/evaluate",requireSession,asyncRoute(async (req,res) => {
  const body = z.object({quoteId:z.string().min(1).max(180),recordPreview:z.boolean().default(false),userInitiated:z.boolean().default(false)}).parse(req.body);
  const runtime=(await pool.query<{master_lock:boolean;agent_enabled:boolean;agent_mode:string}>("SELECT master_lock,agent_enabled,agent_mode FROM users WHERE id=$1",[req.userId])).rows[0]!;
  if(runtime.master_lock)return fail(res,423,"Agent is locked.");
  if(!body.userInitiated&&(!runtime.agent_enabled||runtime.agent_mode==="off"))return fail(res,409,"Agent monitoring is off.");
  const stored=await pool.query<{quote:QuoteView}>("SELECT quote FROM live_quotes WHERE user_id=$1 AND quote_id=$2",[req.userId,body.quoteId]);
  if(!stored.rowCount)return fail(res,404,"Quote is unknown or belongs to another session. Request a new live quote.");
  const parsedQuote = stored.rows[0]!.quote;
  const {rows} = await pool.query<{body:unknown,active:boolean}>("SELECT body,active FROM policies WHERE user_id=$1",[req.userId]);
  if (!rows[0]?.active) return fail(res,409,"No active signed policy is available.");
  const policy = policySchema.parse(rows[0].body);
  if(policy.freeze)return fail(res,423,"Emergency freeze active.");
  const now = new Date();
  const dayKey = now.toISOString().slice(0,10);
  const weekKey = `${now.getUTCFullYear()}-${Math.ceil((Number(dayKey.slice(5,7))*31+Number(dayKey.slice(8,10)))/7)}`;
  const usage = await pool.query<{day_amount:string,week_amount:string}>(`SELECT
    COALESCE(sum((details->>'amountIn')::numeric) FILTER (WHERE created_at::date=now()::date),0)::text AS day_amount,
    COALESCE(sum((details->>'amountIn')::numeric) FILTER (WHERE created_at >= date_trunc('week',now())),0)::text AS week_amount
    FROM execution_events WHERE user_id=$1 AND event_type IN ('submitted','success')`,[req.userId]);
  const decision = checkPolicy(policy,{dayAmount:usage.rows[0]?.day_amount ?? "0",weekAmount:usage.rows[0]?.week_amount ?? "0",dayKey,weekKey},parsedQuote,now);
  const details=JSON.stringify({quoteId:parsedQuote.id,amountIn:parsedQuote.amountIn,reason:decision.allowed?null:decision.reason});
  if(decision.allowed&&body.recordPreview)await pool.query("INSERT INTO execution_events(user_id,event_type,details) VALUES($1,'preview',$2)",[req.userId,details]);
  if(!decision.allowed)await pool.query("INSERT INTO execution_events(user_id,event_type,details) SELECT $1,'blocked',$2 WHERE NOT EXISTS(SELECT 1 FROM execution_events WHERE user_id=$1 AND event_type='blocked' AND details->>'quoteId'=$3 AND created_at>now()-interval '5 minutes')",[req.userId,details,parsedQuote.id]);
  res.json({decision,executionMode:"wallet-confirmation-required",message:decision.allowed ? "Policy matched. A live quote can be prepared; your wallet must authorize every on-chain action." : decision.reason});
}));

app.get("/api/portfolio",requireSession,asyncRoute(async (req,res) => {
  const account = await pool.query<{account_id:string|null}>("SELECT account_id FROM users WHERE id=$1",[req.userId]);
  if (!account.rows[0]?.account_id) return fail(res,409,"Connect and authenticate a NEAR wallet to view your portfolio.");
  try{const balance=await readNativeNearBalance(account.rows[0].account_id);res.json({accountId:account.rows[0].account_id,balances:[{assetId:"near:native",symbol:"NEAR",amount:balance.available,decimals:24,locked:balance.locked,source:"NEAR RPC",blockHeight:balance.blockHeight}],failures:[]});}
  catch{res.json({accountId:account.rows[0].account_id,balances:[],failures:["NEAR account balance could not be loaded from the RPC."]});}
}));

app.get("/api/events",requireSession,asyncRoute(async (req,res) => {
  const {rows}=await pool.query("SELECT event_type,details,created_at FROM execution_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",[req.userId]);
  res.json({events:rows});
}));

app.use((error: unknown,_req:Request,res:Response,_next:NextFunction) => {
  const zod = error instanceof z.ZodError;
  if (res.headersSent) return;
  if (zod) return fail(res,400,"Request fields failed validation.");
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  const status = (error as {status?:number}).status;
  res.status(status && status>=400 && status<600 ? status : 500).json({error:env.NODE_ENV==="production" ? "Request could not be completed." : message,requestId:randomUUID()});
});

export { app };
export default app;
