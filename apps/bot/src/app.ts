import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { canonicalPolicy, checkPolicy, policySchema, quoteInputSchema, type QuoteView } from "../../../packages/shared/dist/index.js";
import { pool } from "./db.js";
import { env } from "./env.js";
import { makePasswordHash, makeSession, newNonce, readSession, verifyPassword, verifyTelegramInitData } from "./security.js";
import { verifyPolicySignature, type SignedPolicyEnvelope } from "./near.js";
import { fetchLiveQuote } from "./quotes.js";
import { teeSigner } from "./tee/signer.js";

declare global { namespace Express { interface Request { telegramId?: number; userId?: number } } }
const app = express();
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
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc:["'self'"],scriptSrc:["'self'","https://telegram.org"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["'self'","data:","https://fonts.gstatic.com"],imgSrc:["'self'","data:","https:"],connectSrc:["'self'",...origins,"https://1click.chaindefuser.com","https://rpc.mainnet.near.org","https://solver-relay-v2.chaindefuser.com","wss://solver-relay-v2.chaindefuser.com"] } } }));
app.use(cors({ origin(origin, cb) { if (!origin || origins.has(origin)) return cb(null,true); cb(new Error("Origin is not allowed.")); }, credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: "64kb", type: "application/json" }));
app.use("/api",apiRate);

function fail(res: Response, status: number, message: string): void { res.status(status).json({ error: message }); }
function asyncRoute(fn: (req: Request,res: Response,next: NextFunction) => Promise<unknown>) { return (req: Request,res: Response,next: NextFunction) => { void fn(req,res,next).catch(next); }; }
const cookieName = "pocket_near_session";
function cookie(res: Response, token: string) { res.cookie(cookieName,token,{ httpOnly:true, secure:env.COOKIE_SECURE, sameSite:"strict", path:"/api", maxAge:12*60*60*1000 }); }

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

async function requirePassword(req: Request, supplied?: string): Promise<boolean> {
  const row = await pool.query<{password_salt:string|null,password_hash:string|null}>("SELECT password_salt,password_hash FROM users WHERE id=$1",[req.userId]);
  const password = z.string().min(10).max(128).safeParse(supplied ?? req.get("x-pocket-password") ?? "");
  if (!row.rows[0]?.password_hash || !row.rows[0].password_salt || !password.success) return false;
  return verifyPassword(password.data,row.rows[0].password_salt,row.rows[0].password_hash);
}

app.get("/api/health",(_req,res) => res.json({ ok:true }));
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
app.post("/api/auth/logout",(_req,res) => { res.clearCookie(cookieName,{ path:"/api", sameSite:"strict", secure:env.COOKIE_SECURE }); res.status(204).end(); });
app.get("/api/auth/me",requireSession,asyncRoute(async (req,res) => {
  const { rows } = await pool.query("SELECT account_id,(password_hash IS NOT NULL) AS password_set,agent_enabled,auto_enabled FROM users WHERE id=$1",[req.userId]);
  res.json({ accountId:rows[0]?.account_id ?? null,passwordSet:rows[0]?.password_set ?? false,agentEnabled:rows[0]?.agent_enabled??false,autoEnabled:rows[0]?.auto_enabled??false });
}));
app.put("/api/agent/settings",requireSession,asyncRoute(async(req,res)=>{
  const body=z.object({agentEnabled:z.boolean().optional(),autoEnabled:z.boolean().optional(),password:z.string().min(10).max(128).optional()}).refine(v=>v.agentEnabled!==undefined||v.autoEnabled!==undefined).parse(req.body);
  if(body.autoEnabled!==undefined&&!await requirePassword(req,body.password))return fail(res,403,"A valid password is required to change auto mode.");
  if(body.agentEnabled!==undefined)await pool.query("UPDATE users SET agent_enabled=$1,updated_at=now() WHERE id=$2",[body.agentEnabled,req.userId]);
  if(body.autoEnabled!==undefined)await pool.query("UPDATE users SET auto_enabled=$1,updated_at=now() WHERE id=$2",[body.autoEnabled,req.userId]);
  const row=await pool.query("SELECT agent_enabled,auto_enabled FROM users WHERE id=$1",[req.userId]);res.json(row.rows[0]);
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
  res.setHeader("Cache-Control","public, max-age=60, stale-while-revalidate=240");
  res.json({assets});
}));

app.post("/api/quotes",requireSession,asyncRoute(async (req,res) => {
  const input = quoteInputSchema.parse(req.body);
  const account = await pool.query<{account_id:string|null}>("SELECT account_id FROM users WHERE id=$1",[req.userId]);
  if (account.rows[0]?.account_id !== input.sender) return fail(res,403,"Quote sender must be the connected wallet.");
  const {quote,source} = await fetchLiveQuote(input);
  await pool.query("INSERT INTO live_quotes(user_id,quote_id,quote) VALUES($1,$2,$3) ON CONFLICT(user_id,quote_id) DO UPDATE SET quote=EXCLUDED.quote,created_at=now()",[req.userId,quote.id,JSON.stringify(quote)]);
  res.setHeader("Cache-Control","no-store");
  res.json({quote,source,autoEligible:!quote.stale && Date.parse(quote.expiresAt)>Date.now()});
}));

app.post("/api/agent/evaluate",requireSession,asyncRoute(async (req,res) => {
  const body = z.object({quoteId:z.string().min(1).max(180),recordPreview:z.boolean().default(false)}).parse(req.body);
  const stored=await pool.query<{quote:QuoteView}>("SELECT quote FROM live_quotes WHERE user_id=$1 AND quote_id=$2",[req.userId,body.quoteId]);
  if(!stored.rowCount)return fail(res,404,"Quote is unknown or belongs to another session. Request a new live quote.");
  const parsedQuote = stored.rows[0]!.quote;
  const {rows} = await pool.query<{body:unknown,active:boolean}>("SELECT body,active FROM policies WHERE user_id=$1",[req.userId]);
  if (!rows[0]?.active) return fail(res,409,"No active signed policy is available.");
  const policy = policySchema.parse(rows[0].body);
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
  return fail(res,501,"Portfolio balance access requires a user-scoped NEAR Intents access token; this deployment has not been authorized to read the account.");
}));

app.post("/api/agent/execute",requireSession,asyncRoute(async (req,res) => {
  const input = z.object({quoteId:z.string().min(1).max(180),password:z.string().min(10).max(128)}).parse(req.body);
  if (!await requirePassword(req,input.password)) return fail(res,403,"Unlock with your password before preparing an action.");
  const stored=await pool.query<{quote:QuoteView}>("SELECT quote FROM live_quotes WHERE user_id=$1 AND quote_id=$2",[req.userId,input.quoteId]);
  if(!stored.rowCount)return fail(res,404,"Quote is unknown or belongs to another session. Request a new live quote.");
  const quote=stored.rows[0]!.quote;
  const {rows}=await pool.query<{body:unknown;active:boolean}>("SELECT body,active FROM policies WHERE user_id=$1",[req.userId]);
  if(!rows[0]?.active)return fail(res,409,"No active signed policy is available.");
  const p=policySchema.parse(rows[0].body);
  const usage=await pool.query<{day_amount:string;week_amount:string}>(`SELECT COALESCE(sum((details->>'amountIn')::numeric) FILTER(WHERE created_at::date=now()::date),0)::text AS day_amount,COALESCE(sum((details->>'amountIn')::numeric) FILTER(WHERE created_at>=date_trunc('week',now())),0)::text AS week_amount FROM execution_events WHERE user_id=$1 AND event_type IN ('submitted','success')`,[req.userId]);
  const now=new Date(),dayKey=now.toISOString().slice(0,10),weekKey=`${now.getUTCFullYear()}-${Math.ceil((Number(dayKey.slice(5,7))*31+Number(dayKey.slice(8,10)))/7)}`;
  const usageValue={dayAmount:usage.rows[0]?.day_amount??"0",weekAmount:usage.rows[0]?.week_amount??"0",dayKey,weekKey};
  const d=checkPolicy(p,usageValue,quote,now);
  if(!d.allowed){await pool.query("INSERT INTO execution_events(user_id,event_type,details) VALUES($1,'blocked',$2)",[req.userId,JSON.stringify({quoteId:quote.id,reason:d.reason})]);return fail(res,403,d.reason);}
  const result=await teeSigner.signIntent({policy:p,quote,usage:usageValue,intentPayload:quote.raw});
  if(result.error||!result.signature){await pool.query("INSERT INTO execution_events(user_id,event_type,details) VALUES($1,'failed',$2)",[req.userId,JSON.stringify({quoteId:quote.id,reason:result.error??"TEE returned no signature"})]);return fail(res,503,result.error??"TEE signing failed.");}
  await pool.query("INSERT INTO execution_events(user_id,event_type,details) VALUES($1,'preview',$2)",[req.userId,JSON.stringify({quoteId:quote.id,signed:true,submitted:false,attestation:result.attestation??null})]);
  res.status(409).json({error:"TEE signed the intent payload, but this deployment has no supported NEAR Intents submission flow. No funds were moved; review and complete the quote in your wallet.",requiresWalletSignature:true,signed:true,attestation:result.attestation??null});
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
