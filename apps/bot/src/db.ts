import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined, max: 12, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL,
      account_id TEXT, password_salt TEXT, password_hash TEXT,
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
  `);
}
