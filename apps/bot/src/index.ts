import { Telegraf, Markup } from "telegraf";
import { app } from "./app.js";
import { migrate, pool } from "./db.js";
import { env } from "./env.js";
import { startAgentWorker } from "./agentWorker.js";
import { policySchema } from "@pocket-near/shared";
import { startPriceAlertWorker } from "./priceAlertWorker.js";
import { getPrices } from "./dataFeeds.js";

async function start(): Promise<void> {
await migrate();
const server=app.listen(env.PORT,()=>console.info(`Pocket Near API listening on ${env.PORT}`));
let bot:Telegraf|undefined;
let stopWorker:(()=>void)|undefined;
let stopPriceAlerts:(()=>void)|undefined;
if(env.TELEGRAM_BOT_TOKEN){
  bot=new Telegraf(env.TELEGRAM_BOT_TOKEN);
  bot.start(async ctx=>{
    await ctx.reply("Welcome to Pocket Near. Connect your wallet, set a signed policy, and review live NEAR Intents quotes from your Mini App.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
  });
  bot.command("help",ctx=>ctx.reply("Pocket Near checks live quotes against your wallet-signed policy. Your wallet remains in control of every on-chain action."));
  bot.command("prices",async ctx=>{try{const {rows}=await getPrices();return ctx.reply(rows.slice(0,8).map(p=>`${p.symbol}: $${new Intl.NumberFormat("en-US",{maximumSignificantDigits:6}).format(p.priceUsd)} (${p.change24hPct===null?"n/a":`${p.change24hPct>=0?"+":""}${p.change24hPct.toFixed(2)}%`})`).join("\n")||"No price rows are available.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));}catch{return ctx.reply("Price data is temporarily unavailable. Open Pocket Near to retry.");}});
  bot.command("alerts",async ctx=>{const {rows}=await pool.query<{symbol:string;op:string;threshold_usd:string;active:boolean}>("SELECT symbol,op,threshold_usd::text,active FROM price_alerts a JOIN users u ON u.id=a.user_id WHERE u.telegram_id=$1 ORDER BY a.created_at DESC LIMIT 20",[ctx.from.id]);return ctx.reply(rows.length?rows.map(a=>`${a.active?"●":"○"} ${a.symbol} ${a.op==="gte"?"≥":"≤"} $${a.threshold_usd}`).join("\n"):"You have no price alerts. Create one in Pocket Near.",Markup.inlineKeyboard([[Markup.button.webApp("Open alerts",env.PUBLIC_APP_URL)]]));});
  bot.command("agent",async ctx=>{
    const action=ctx.message.text.split(/\s+/)[1]?.toLowerCase();if(action!=="on"&&action!=="off")return ctx.reply("Use /agent on or /agent off.");
    if(action==="on"){
      const row=await pool.query("SELECT u.id,u.master_lock,p.active,p.body FROM users u LEFT JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
      if(!row.rowCount||!row.rows[0]!.active||policySchema.parse(row.rows[0]!.body).freeze)return ctx.reply("Create or unfreeze a signed policy in the Mini App first.");
      if(row.rows[0]!.master_lock)return ctx.reply("Agent is locked. Open Pocket Near to unlock it.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
    }
    await pool.query("UPDATE users SET agent_enabled=$1,agent_mode=CASE WHEN $1 THEN 'notify_only' ELSE 'off' END,auto_enabled=false,updated_at=now() WHERE telegram_id=$2",[action==="on",ctx.from.id]);return ctx.reply(action==="on"?"Agent monitoring is on in notify-only mode.":"Agent monitoring is off.");
  });
  bot.command("auto",async ctx=>ctx.reply("Auto execution is not supported. Pocket Near never signs or submits a swap for you; review each transaction and approve it in your wallet."));
  bot.command("freeze",async ctx=>{
    const user=await pool.query("SELECT u.id FROM users u JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
    if(!user.rowCount)return ctx.reply("No saved policy was found. Open the Mini App to create one.");
    await pool.query("UPDATE users SET master_lock=true,updated_at=now() WHERE id=$1",[user.rows[0]!.id]);
    await ctx.reply("Agent master lock is on. Open Pocket Near to review the signed policy and unlock when ready.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
  });
  bot.command("lock",async ctx=>{await pool.query("UPDATE users SET master_lock=true,updated_at=now() WHERE telegram_id=$1",[ctx.from.id]);return ctx.reply("Agent master lock is on.");});
  bot.command("unlock",ctx=>ctx.reply("For your security, unlock in Pocket Near. Passwords are never collected in Telegram chat.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]])));
  bot.command("status",async ctx=>{
    const {rows}=await pool.query("SELECT p.active,p.body,u.account_id,u.agent_enabled,u.agent_mode,u.master_lock,u.auto_exec_lock FROM users u LEFT JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
    const row=rows[0];
    if(!row)return ctx.reply("Open Pocket Near to connect your wallet.");
    const body=row.body as {freeze?:boolean}|null;
    return ctx.reply(`Wallet: ${row.account_id??"not connected"}\nPolicy: ${row.active&&!body?.freeze?"active":"frozen or inactive"}\nMode: ${row.agent_mode}\nMonitoring: ${row.agent_enabled?"on":"off"}\nMaster lock: ${row.master_lock?"on":"off"}\nAuto execution lock: ${row.auto_exec_lock?"on":"off"}`,Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
  });
  bot.catch(error=>console.error("Telegram bot update failed",error));
  if(env.AGENT_WORKER_ENABLED){stopWorker=startAgentWorker(async(telegramId,text)=>{await bot!.telegram.sendMessage(telegramId,text,{reply_markup:{inline_keyboard:[[Markup.button.webApp("Review in Pocket Near",env.PUBLIC_APP_URL)]]}});},env.AGENT_WORKER_INTERVAL_MS);stopPriceAlerts=startPriceAlertWorker(async(telegramId,text)=>{await bot!.telegram.sendMessage(telegramId,text);},env.AGENT_WORKER_INTERVAL_MS);}
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
  stopPriceAlerts?.();
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
