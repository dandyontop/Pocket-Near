import pg from "pg";
import { env } from "./env.js";

const usingSupabaseUrl=Boolean(env.POSTGRES_URL);
const connectionUrl=new URL(env.DATABASE_URL);
const sslConfigured=usingSupabaseUrl||env.DATABASE_SSL||Boolean(env.DATABASE_SSL_CA);
if(sslConfigured)for(const key of ["sslmode","sslrootcert","sslcert","sslkey"])connectionUrl.searchParams.delete(key);
const ssl=env.DATABASE_SSL_CA
  ? {ca:env.DATABASE_SSL_CA,rejectUnauthorized:true}
  : usingSupabaseUrl
    ? {rejectUnauthorized:false}
    : env.DATABASE_SSL
      ? {rejectUnauthorized:true}
      : undefined;
export const pool = new pg.Pool({ connectionString:sslConfigured?connectionUrl.toString():env.DATABASE_URL, ...(ssl?{ssl}:{}), max: 12, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });

let migrationPromise: Promise<void> | undefined;
export function migrate(): Promise<void> {
  if(migrationPromise)return migrationPromise;
  migrationPromise=(async()=>{
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1952542063,1)");
      await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL,
      account_id TEXT, password_salt TEXT, password_hash TEXT,
      agent_enabled BOOLEAN NOT NULL DEFAULT false, auto_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS policies (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      body JSONB NOT NULL, signature JSONB NOT NULL, signer_public_key TEXT NOT NULL,
      signed_message TEXT NOT NULL, signed_nonce BYTEA NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS quote_cache (
      cache_key TEXT PRIMARY KEY, quote JSONB NOT NULL, cached_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS live_quotes (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quote_id TEXT NOT NULL, quote JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,quote_id)
    );
    CREATE TABLE IF NOT EXISTS execution_events (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('blocked','preview','submitted','success','failed')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS execution_events_user_created_idx ON execution_events(user_id, created_at DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE quote_cache ENABLE ROW LEVEL SECURITY;
    ALTER TABLE live_quotes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
  `);
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  })().catch(error=>{migrationPromise=undefined;throw error;});
  return migrationPromise;
}
