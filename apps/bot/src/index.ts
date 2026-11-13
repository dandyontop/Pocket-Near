import { Markup, type Telegraf } from "telegraf";
import { app } from "./app.js";
import { migrate, pool } from "./db.js";
import { env } from "./env.js";
import { startAgentWorker } from "./agentWorker.js";
import { startPriceAlertWorker } from "./priceAlertWorker.js";
import { createTelegramBot, telegramCommands } from "./telegramBot.js";

async function start(): Promise<void> {
await migrate();
const server=app.listen(env.PORT,()=>console.info(`Pocket Near API listening on ${env.PORT}`));
let bot:Telegraf|undefined;
let stopWorker:(()=>void)|undefined;
let stopPriceAlerts:(()=>void)|undefined;
if(env.TELEGRAM_BOT_TOKEN){
  const configuredBot=createTelegramBot();
  if(!configuredBot)throw new Error("Telegram bot token is not configured.");
  bot=configuredBot;
  await configuredBot.telegram.setMyCommands(telegramCommands);
  if(env.AGENT_WORKER_ENABLED){stopWorker=startAgentWorker(async(telegramId,text)=>{await bot!.telegram.sendMessage(telegramId,text,{reply_markup:{inline_keyboard:[[Markup.button.webApp("Review in Pocket Near",env.PUBLIC_APP_URL)]]}});},env.AGENT_WORKER_INTERVAL_MS);stopPriceAlerts=startPriceAlertWorker(async(telegramId,text)=>{await bot!.telegram.sendMessage(telegramId,text);},env.AGENT_WORKER_INTERVAL_MS);}
  const menuButton={type:"web_app" as const,text:"Open Pocket Near",web_app:{url:env.PUBLIC_APP_URL}};
  await configuredBot.telegram.setChatMenuButton({menuButton});
  if(env.TELEGRAM_WEBHOOK_URL){
    const url=new URL(env.TELEGRAM_WEBHOOK_URL);
    const telegramWebhookOptions=env.TELEGRAM_WEBHOOK_SECRET?{secret_token:env.TELEGRAM_WEBHOOK_SECRET}:{};
    const expressWebhookOptions=env.TELEGRAM_WEBHOOK_SECRET?{secretToken:env.TELEGRAM_WEBHOOK_SECRET}:{};
    await configuredBot.telegram.setWebhook(env.TELEGRAM_WEBHOOK_URL,telegramWebhookOptions);
    app.use(configuredBot.webhookCallback(url.pathname,expressWebhookOptions));
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
