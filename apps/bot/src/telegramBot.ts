import { Telegraf, Markup } from "telegraf";
import { policySchema } from "@pocket-near/shared";
import { createThesis, ThesisRateLimitError } from "./thesis.js";
import { getPrices } from "./dataFeeds.js";
import { pool } from "./db.js";
import { env } from "./env.js";

export const telegramCommands=[
  {command:"start",description:"Open Pocket Near"},
  {command:"help",description:"Show how Pocket Near works"},
  {command:"prices",description:"Show live market prices"},
  {command:"thesis",description:"Show a NEAR research snapshot"},
  {command:"alerts",description:"List your price alerts"},
  {command:"agent",description:"Turn notify-only monitoring on or off"},
  {command:"auto",description:"Explain wallet-confirmation safety"},
  {command:"freeze",description:"Freeze agent monitoring"},
  {command:"lock",description:"Lock agent controls"},
  {command:"unlock",description:"Open Pocket Near to unlock"},
  {command:"status",description:"Show your Pocket Near status"},
];

export function createTelegramBot():Telegraf|undefined{
  if(!env.TELEGRAM_BOT_TOKEN)return undefined;
  const bot=new Telegraf(env.TELEGRAM_BOT_TOKEN);
  bot.start(async ctx=>{
    await ctx.reply("Welcome to Pocket Near. Connect your wallet, set a signed policy, and review live NEAR Intents quotes from your Mini App.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
  });
  bot.command("help",ctx=>ctx.reply("Pocket Near checks live quotes against your wallet-signed policy. Your wallet remains in control of every on-chain action."));
  bot.command("prices",async ctx=>{try{const {rows}=await getPrices();return ctx.reply(rows.slice(0,8).map(p=>`${p.symbol}: $${new Intl.NumberFormat("en-US",{maximumSignificantDigits:6}).format(p.priceUsd)} (${p.change24hPct===null?"n/a":`${p.change24hPct>=0?"+":""}${p.change24hPct.toFixed(2)}%`})`).join("\n")||"No price rows are available.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));}catch{return ctx.reply("Price data is temporarily unavailable. Open Pocket Near to retry.");}});
  bot.command("thesis",async ctx=>{
    const user=await pool.query<{id:string}>("SELECT id FROM users WHERE telegram_id=$1",[ctx.from.id]);
    if(!user.rowCount)return ctx.reply("Open Pocket Near from Telegram and connect your wallet before requesting a research thesis.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
    try{
      const report=await createThesis(Number(user.rows[0]!.id));
      const market=report.facts.market.priceUsd===null?"NEAR price unavailable":`NEAR $${new Intl.NumberFormat("en-US",{maximumSignificantDigits:6}).format(report.facts.market.priceUsd)}${report.facts.market.change24hPct===null?"":` (${report.facts.market.change24hPct.toFixed(2)}% / 24h)`}`;
      const intents=report.facts.intents24h?`Intents ${new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(report.facts.intents24h.volumeUsd24h)} / 24h, ${report.facts.intents24h.txCount24h} transactions${report.facts.intents24h.partial?" (partial sample)":""}`:"Intents 24h metrics unavailable";
      const sections=[
        `NEAR Research · ${report.source==="near-ai-cloud"?"NEAR AI Cloud (unverified)":"rules-only snapshot"}`,
        report.summary,
        `Positive evidence:\n${report.bull.slice(0,2).map(item=>`• ${item}`).join("\n")}`,
        `Counter-evidence:\n${report.bear.slice(0,2).map(item=>`• ${item}`).join("\n")}`,
        `Risks:\n${report.risks.slice(0,2).map(item=>`• ${item}`).join("\n")}`,
        `What to verify:\n${report.whatToVerify.slice(0,2).map(item=>`• ${item}`).join("\n")}`,
        `Facts: ${market}; ${intents}.`,
        report.note??"",
        "Not financial advice. Do your own research.",
      ].filter(Boolean);
      return ctx.reply(sections.join("\n\n"),Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
    }catch(error){
      if(error instanceof ThesisRateLimitError)return ctx.reply(error.message);
      console.error("Telegram thesis request failed",error);
      return ctx.reply("Research thesis is temporarily unavailable. Open Pocket Near to retry.");
    }
  });
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
  return bot;
}
