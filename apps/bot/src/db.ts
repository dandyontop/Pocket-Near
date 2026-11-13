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
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE,
      account_id TEXT, password_salt TEXT, password_hash TEXT,
      agent_enabled BOOLEAN NOT NULL DEFAULT false, auto_enabled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;
    CREATE TABLE IF NOT EXISTS wallet_login_challenges (
      nonce TEXT PRIMARY KEY, account_id TEXT NOT NULL, message TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS wallet_login_challenges_expiry_idx ON wallet_login_challenges(expires_at);
    CREATE TABLE IF NOT EXISTS policy_signing_challenges (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      nonce TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL
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
    CREATE TABLE IF NOT EXISTS intent_swaps (
      id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quote_id TEXT NOT NULL, preview_quote_id TEXT, quote JSONB NOT NULL, origin_chain TEXT NOT NULL, origin_token_contract TEXT,
      deposit_address TEXT NOT NULL, deposit_memo TEXT,
      status TEXT NOT NULL CHECK(status IN ('PENDING_DEPOSIT','KNOWN_DEPOSIT_TX','PROCESSING','SUCCESS','INCOMPLETE_DEPOSIT','REFUNDED','FAILED')),
      deposit_tx_hash TEXT, status_details JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_id,quote_id)
    );
    ALTER TABLE intent_swaps ADD COLUMN IF NOT EXISTS preview_quote_id TEXT;
    ALTER TABLE intent_swaps ADD COLUMN IF NOT EXISTS origin_token_contract TEXT;
    UPDATE intent_swaps SET preview_quote_id=quote_id WHERE preview_quote_id IS NULL;
    ALTER TABLE intent_swaps ALTER COLUMN preview_quote_id SET NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS intent_swaps_user_preview_quote_idx ON intent_swaps(user_id,preview_quote_id);
    CREATE INDEX IF NOT EXISTS intent_swaps_user_created_idx ON intent_swaps(user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS execution_events (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('blocked','preview','submitted','success','failed')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS price_watchlist (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,symbol)
    );
    CREATE TABLE IF NOT EXISTS price_alerts (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL, op TEXT NOT NULL CHECK(op IN ('gte','lte')),
      threshold_usd NUMERIC NOT NULL CHECK(threshold_usd > 0), active BOOLEAN NOT NULL DEFAULT true,
      last_fired_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS price_alerts_active_idx ON price_alerts(active,symbol);
    CREATE TABLE IF NOT EXISTS price_alert_firings (
      alert_id BIGINT NOT NULL REFERENCES price_alerts(id) ON DELETE CASCADE,
      bucket TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(alert_id,bucket)
    );
    CREATE TABLE IF NOT EXISTS discover_events (
      id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK(item_type IN ('app','game','earn')),
      item_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('open')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS meme_votes (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      vote TEXT NOT NULL CHECK(vote IN ('bull','bear')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,asset_id)
    );
    CREATE TABLE IF NOT EXISTS investment_preferences (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      alerts_enabled BOOLEAN NOT NULL DEFAULT false,
      symbols TEXT[] NOT NULL DEFAULT ARRAY['NEAR','USDC','USDT']::TEXT[],
      position_monitoring BOOLEAN NOT NULL DEFAULT false,
      report_frequency SMALLINT NOT NULL DEFAULT 1 CHECK(report_frequency BETWEEN 1 AND 4),
      last_suggestion_at TIMESTAMPTZ,
      last_report_at TIMESTAMPTZ,
      next_position_report_at TIMESTAMPTZ,
      last_position_check_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS investment_preferences_worker_idx ON investment_preferences(position_monitoring,last_position_check_at) WHERE position_monitoring=true;
    CREATE TABLE IF NOT EXISTS position_snapshots (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position_id TEXT NOT NULL,
      token_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      amount_raw TEXT NOT NULL,
      reported_amount_raw TEXT NOT NULL,
      decimals SMALLINT NOT NULL CHECK(decimals BETWEEN 0 AND 30),
      value_usd NUMERIC,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,position_id)
    );
    CREATE TABLE IF NOT EXISTS rhea_position_alert_state (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position_id TEXT NOT NULL,
      can_withdraw BOOLEAN NOT NULL,
      notified BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,position_id)
    );
    CREATE INDEX IF NOT EXISTS position_snapshots_user_idx ON position_snapshots(user_id,observed_at DESC);
    CREATE INDEX IF NOT EXISTS execution_events_user_created_idx ON execution_events(user_id, created_at DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_mode TEXT NOT NULL DEFAULT 'off' CHECK(agent_mode IN ('off','notify_only','auto_inside_policy'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS master_lock BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_exec_lock BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_error TEXT;
    UPDATE users SET agent_mode=CASE WHEN auto_enabled AND agent_enabled THEN 'auto_inside_policy' WHEN agent_enabled THEN 'notify_only' ELSE 'off' END WHERE agent_mode='off' AND (agent_enabled OR auto_enabled);
    UPDATE users SET agent_mode='notify_only',auto_enabled=false WHERE agent_mode='auto_inside_policy';
    ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE wallet_login_challenges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE policy_signing_challenges ENABLE ROW LEVEL SECURITY;
    ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE quote_cache ENABLE ROW LEVEL SECURITY;
    ALTER TABLE live_quotes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE intent_swaps ENABLE ROW LEVEL SECURITY;
    ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE price_watchlist ENABLE ROW LEVEL SECURITY;
    ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE price_alert_firings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE discover_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE meme_votes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE investment_preferences ENABLE ROW LEVEL SECURITY;
    ALTER TABLE position_snapshots ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rhea_position_alert_state ENABLE ROW LEVEL SECURITY;
  `);
      await client.query("COMMIT");
    }catch(error){
      await client.query("ROLLBACK");
      throw error;
    }finally{client.release();}
  })().catch(error=>{migrationPromise=undefined;throw error;});
  return migrationPromise;
}
