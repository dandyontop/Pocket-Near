import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({path:fileURLToPath(new URL("../../../.env",import.meta.url))});
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  PUBLIC_APP_URL: z.string().url(), DATABASE_URL: z.string().default(""), POSTGRES_URL: z.string().default(""), DATABASE_SSL: z.string().default("false").transform(v=>v.toLowerCase()==="true"), DATABASE_SSL_CA: z.string().default(""),
  SESSION_SECRET: z.string().min(32), COOKIE_SECURE: z.string().default("false").transform(v=>v.toLowerCase()==="true"),
  TELEGRAM_BOT_TOKEN: z.string().default(""), TELEGRAM_WEBHOOK_SECRET: z.string().default(""), TELEGRAM_WEBHOOK_URL:z.preprocess(v=>v===""?undefined:v,z.string().url().optional()),
  ONE_CLICK_JWT: z.string().default(""), ONE_CLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  NEAR_RPC_URL: z.string().url().default("https://rpc.mainnet.near.org"),
  SOLVER_RELAY_URL: z.string().url().default("https://solver-relay-v2.chaindefuser.com/rpc"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  QUOTE_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(300).default(20),
  MAX_INIT_DATA_AGE_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  AGENT_WORKER_ENABLED: z.string().default("false").transform(v=>v.toLowerCase()==="true"),
  AGENT_WORKER_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  TEE_SIGNER_ENABLED: z.string().default("false").transform(v=>v.toLowerCase()==="true"),
  TEE_SIGNER_URL: z.preprocess(v=>v===""?undefined:v,z.string().url().optional()),
  TEE_SIGNER_API_KEY: z.string().default(""),
  DEV_ENCLAVE_PRIVATE_KEY: z.string().default(""),
  COINGECKO_API_KEY: z.string().default(""),
  PRICE_ASSET_IDS: z.string().default("bitcoin,ethereum,solana,near,usd-coin,tether,chainlink,avalanche-2,wrapped-bitcoin"),
  PRICES_CACHE_TTL_SECONDS: z.coerce.number().int().min(30).max(60).default(45),
  EARN_CACHE_TTL_SECONDS: z.coerce.number().int().min(300).max(900).default(600),
  MARKET_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(120).default(90),
}).refine(v=>Boolean(v.DATABASE_URL||v.POSTGRES_URL),{path:["DATABASE_URL"],message:"Set DATABASE_URL or the Supabase integration's POSTGRES_URL."});
const parsed = schema.parse(process.env);
export const env = {...parsed,DATABASE_URL:parsed.POSTGRES_URL||parsed.DATABASE_URL};
