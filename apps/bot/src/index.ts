import { Telegraf, Markup } from "telegraf";
import { app } from "./app.js";
import { migrate, pool } from "./db.js";
import { env } from "./env.js";

await migrate();
const server=app.listen(env.PORT,()=>console.info(`Pocket Near API listening on ${env.PORT}`));
let bot:Telegraf|undefined;
if(env.TELEGRAM_BOT_TOKEN){
  bot=new Telegraf(env.TELEGRAM_BOT_TOKEN);
  bot.start(async ctx=>{
    await ctx.reply("Welcome to Pocket Near. Connect your wallet, set a signed policy, and review live NEAR Intents quotes from your Mini App.",Markup.inlineKeyboard([[Markup.button.webApp("Open Pocket Near",env.PUBLIC_APP_URL)]]));
  });
  bot.command("help",ctx=>ctx.reply("Pocket Near checks live quotes against your wallet-signed policy. Your wallet remains in control of every on-chain action."));
  bot.command("freeze",async ctx=>{
    const user=await pool.query("SELECT u.id FROM users u JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
    if(!user.rowCount)return ctx.reply("No saved policy was found. Open the Mini App to create one.");
    await pool.query("UPDATE policies SET active=false,updated_at=now() WHERE user_id=$1",[user.rows[0]!.id]);
    await ctx.reply("Agent activity is paused. Open Pocket Near and sign a frozen policy to record an on-chain-verifiable policy change.");
  });
  bot.command("status",async ctx=>{
    const {rows}=await pool.query("SELECT p.active,p.body,u.account_id FROM users u LEFT JOIN policies p ON p.user_id=u.id WHERE u.telegram_id=$1",[ctx.from.id]);
    const row=rows[0];
    if(!row)return ctx.reply("Open Pocket Near to connect your wallet.");
    const body=row.body as {freeze?:boolean}|null;
    return ctx.reply(`Wallet: ${row.account_id??"not connected"}\nPolicy agent: ${row.active&&!body?.freeze?"active":"paused"}`);
  });
  bot.catch(error=>console.error("Telegram bot update failed",error));
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
  if(bot){bot.stop("SIGTERM");}
  server.close();
  await pool.end();
  process.exit(0);
};
process.once("SIGINT",()=>void shutdown());
process.once("SIGTERM",()=>void shutdown());
