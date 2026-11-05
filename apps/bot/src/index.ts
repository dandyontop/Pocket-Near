import { Telegraf, Markup } from "telegraf";
import { app } from "./app.js";
import { migrate, pool } from "./db.js";
import { env } from "./env.js";
import { startAgentWorker } from "./agentWorker.js";
import { policySchema, checkPolicy, type QuoteView } from "@pocket-near/shared";
import { teeSigner } from "./tee/signer.js";

async function start(): Promise<void> {
await migrate();
const server=app.listen(env.PORT,()=>console.info(`Pocket Near API listening on ${env.PORT}`));
let bot:Telegraf|undefined;
let stopWorker:(()=>void)|undefined;
if(env.TELEGRAM_BOT_TOKEN){
  bot=new Telegraf(env.TELEGRAM_BOT_TOKEN);
  bot.start(async ctx=>{
    await ctx.reply("Welcome to Pocket Near. Connect your wallet, set a signed policy, and review live NEAR Intents quotes from your Mini App.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
  });
  bot.command("help",ctx=>ctx.reply("Pocket Near checks live quotes against your wallet-signed policy. Your wallet remains in control of every on-chain action."));
  bot.command("agent",async ctx=>{
    const action=ctx.message.text.split(/\s+/)[1]?.toLowerCase();if(action!=="on"&&action!=="off")return ctx.reply("Use /agent on or /agent off.");
    if(action==="on"){
      const row=await pool.query("SELECT u.id,p.active,p.body FROM users u LEFT JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
      if(!row.rowCount||!row.rows[0]!.active||policySchema.parse(row.rows[0]!.body).freeze)return ctx.reply("Create or unfreeze a signed policy in the Mini App first.");
    }
    await pool.query("UPDATE users SET agent_enabled=$1,updated_at=now() WHERE telegram_id=$2",[action==="on",ctx.from.id]);return ctx.reply(action==="on"?"Agent monitoring is on. Policy matches will be sent here for approval.":"Agent monitoring is off.");
  });
  bot.command("auto",async ctx=>ctx.reply("Auto mode changes require your unlock password in the Mini App settings. Auto execution is not enabled by this bot command."));
  bot.command("freeze",async ctx=>{
    const user=await pool.query("SELECT u.id FROM users u JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
    if(!user.rowCount)return ctx.reply("No saved policy was found. Open the Mini App to create one.");
    await pool.query("UPDATE policies SET active=false,updated_at=now() WHERE user_id=$1",[user.rows[0]!.id]);
    await ctx.reply("Agent activity is paused. Open Pocket Near and sign a frozen policy to record an on-chain-verifiable policy change.");
  });
  bot.command("status",async ctx=>{
    const {rows}=await pool.query("SELECT p.active,p.body,u.account_id,u.agent_enabled,u.auto_enabled FROM users u LEFT JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
    const row=rows[0];
    if(!row)return ctx.reply("Open Pocket Near to connect your wallet.");
    const body=row.body as {freeze?:boolean}|null;
    return ctx.reply(`Wallet: ${row.account_id??"not connected"}\nPolicy: ${row.active&&!body?.freeze?"active":"paused"}\nAgent: ${row.agent_enabled?"on":"off"}\nAuto: ${row.auto_enabled?"on":"off"}`);
  });
  bot.action(/^approve:(.+)$/,async ctx=>{
    const quoteId=ctx.match[1]!;const u=await pool.query<{id:string}>("SELECT id FROM users WHERE telegram_id=$1",[ctx.from.id]);if(!u.rowCount)return ctx.answerCbQuery("Open the Mini App first.");
    const userId=u.rows[0]!.id,stored=await pool.query<{quote:QuoteView}>("SELECT quote FROM live_quotes WHERE user_id=$1 AND quote_id=$2",[userId,quoteId]);if(!stored.rowCount)return ctx.answerCbQuery("Quote expired; request another.");
    const pr=await pool.query<{body:unknown;active:boolean}>("SELECT body,active FROM policies WHERE user_id=$1",[userId]);if(!pr.rows[0]?.active)return ctx.answerCbQuery("No active signed policy.");
    const policy=policySchema.parse(pr.rows[0].body),quote=stored.rows[0]!.quote;
    const usage=await pool.query<{day_amount:string;week_amount:string}>(`SELECT COALESCE(sum((details->>'amountIn')::numeric) FILTER(WHERE created_at::date=now()::date),0)::text day_amount,COALESCE(sum((details->>'amountIn')::numeric) FILTER(WHERE created_at>=date_trunc('week',now())),0)::text week_amount FROM execution_events WHERE user_id=$1 AND event_type IN ('submitted','success')`,[userId]);
    const now=new Date(),dayKey=now.toISOString().slice(0,10),weekKey=`${now.getUTCFullYear()}-${Math.ceil((Number(dayKey.slice(5,7))*31+Number(dayKey.slice(8,10)))/7)}`,usageValue={dayAmount:usage.rows[0]?.day_amount??"0",weekAmount:usage.rows[0]?.week_amount??"0",dayKey,weekKey};
    const decision=checkPolicy(policy,usageValue,quote,now);if(!decision.allowed){await ctx.answerCbQuery("Policy no longer allows this quote.");return ctx.editMessageText(`Approval blocked: ${decision.reason}`);}
    const signed=await teeSigner.signIntent({policy,quote,usage:usageValue,intentPayload:quote.raw});if(signed.error||!signed.signature){await ctx.answerCbQuery("TEE signing unavailable.");return ctx.editMessageText(`Approval could not proceed: ${signed.error??"No signature"}`);}
    await pool.query("INSERT INTO execution_events(user_id,event_type,details) VALUES($1,'preview',$2)",[userId,JSON.stringify({quoteId,signed:true,approvedByTelegram:true,submitted:false,attestation:signed.attestation??null})]);
    await ctx.answerCbQuery("Policy rechecked; TEE signed.");return ctx.editMessageText("TEE approved this intent payload. This deployment cannot submit the NEAR Intents transaction; no funds moved.");
  });
  bot.action(/^reject:(.+)$/,async ctx=>{await ctx.answerCbQuery("Quote rejected.");await ctx.editMessageText("Quote rejected. No funds moved.");});
  bot.catch(error=>console.error("Telegram bot update failed",error));
  if(env.AGENT_WORKER_ENABLED)stopWorker=startAgentWorker(async(telegramId,text,quoteId)=>{await bot!.telegram.sendMessage(telegramId,text,{reply_markup:{inline_keyboard:[[{text:"Approve",callback_data:`approve:${quoteId}`},{text:"Reject",callback_data:`reject:${quoteId}`}]]}});},env.AGENT_WORKER_INTERVAL_MS);
  const menuButton={type:"web_app" as const,text:"Open Pocket Near",web_app:{url:env.PUBLIC_APP_URL}};
  await bot.telegram.setChatMenuButton({menuButton});
  if(env.TELEGRAM_WEBHOOK_URL){
    const url=new URL(env.TELEGRAM_WEBHOOK_URL);
    const telegramWebhookOptions=env.TELEGRAM_WEBHOOK_SECRET?{secret_token:env.TELEGRAM_WEBHOOK_SECRET}:{};
    const expressWebhookOptions=env.TELEGRAM_WEBHOOK_SECRET?{secretToken:env.TELEGRAM_WEBHOOK_SECRET}:{};
    await bot.telegram.setWebhook(env.TELEGRAM_WEBHOOK_URL,telegramWebhookOptions);
    app.use(bot.webhookCallback(url.pathname,expressWebhookOptions));
  }else if(env.NODE_ENV!=="production"){
    await bot.launch();
  }else{
    console.warn("Telegram bot token is set but TELEGRAM_WEBHOOK_URL is absent; bot polling is disabled in production.");
  }
}

const shutdown=async()=>{
  stopWorker?.();
  if(bot){bot.stop("SIGTERM");}
  server.close();
  await pool.end();
  process.exit(0);
};
process.once("SIGINT",()=>void shutdown());
process.once("SIGTERM",()=>void shutdown());
}

if (!process.env.VERCEL) {
  void start().catch(error => {
    console.error("API startup failed", error);
    process.exitCode = 1;
  });
}
