# Pocket Near

Pocket Near is a Telegram Mini App companion for NEAR Intents. It connects to a user's own NEAR wallet, verifies wallet ownership with NEP-413 signatures, keeps a signed policy in PostgreSQL, and displays solver quotes from 1Click and the Solver Relay.

## Security boundary

The app never asks for, receives, or stores a wallet private key. Telegram launch data is HMAC-verified by the API before a short-lived, HttpOnly session cookie is issued. Policy data is canonicalized, signed by the connected wallet, and verified server-side with `near-api-js`. A separate unlock password is stored as a scrypt hash with a random salt.

**No NEAR AI or free-form trading chat is used.** The deterministic `packages/shared` `checkPolicy()` evaluator is the hard policy source of truth. A worker fetches quotes for signed allowed pairs, rechecks policy and usage, then sends a Telegram approval prompt. A configured TEE signer must recheck policy before it signs. Auto mode is a stored user preference gated by the unlock password; it does not bypass the signing or settlement boundaries below.

The security boundary is: wallet signs policy → PostgreSQL stores its signed envelope → API/worker evaluates quotes with `checkPolicy()` → Telegram user approves → API re-fetches stored quote and rechecks → TEE endpoint validates policy again and signs. The API host never stores a full wallet private key. The current 1Click quote flow yields a deposit address and this repository does not implement the Intents deposit/submission lifecycle. A TEE signature alone is not settlement, so this deployment records a signed preview and explicitly refuses to report a submitted/successful swap. Do not enable unattended execution for production funds until a reviewed, protocol-compatible submission path and enclave deployment exist.

The optional HTTP signer contract is `POST TEE_SIGNER_URL` with `{policy, quote, usage, intentPayload}` and expects `{signature, attestation?}`. Configure the URL to a Phala Shade or OutLayer enclave HTTP endpoint that implements this contract, performs `checkPolicy()` (or a faithful independently audited equivalent) inside the enclave, verifies the caller and payload, and keeps the limited key within the enclave. `TEE_SIGNER_API_KEY` is sent as a Bearer credential. Pointing this variable at an ordinary API does not create a TEE. The development signer is explicitly DEV-ONLY, only signs an envelope using `DEV_ENCLAVE_PRIVATE_KEY` when `NODE_ENV=development`, and does not submit transactions.

Application policy checks are enforced in the API and are not a smart-contract restriction. A compromised application server could bypass those checks. For unattended execution, an independently audited, protocol-enforced scoped authorization or smart account is required; a function-call key to an unrestricted token or verifier method is not a safe substitute.

## Monorepo

```text
apps/
  bot/       Telegraf bot and Express API
  mini-app/  React + TypeScript Telegram Mini App
packages/
  shared/    Runtime schemas, policy evaluator, shared types
```

PostgreSQL stores Telegram account IDs, NEAR account IDs, signed policy envelopes, short-lived quote cache entries, and audit events. Secrets are loaded only from environment variables.

## Requirements

- Node.js 20.11 or later
- npm 10 or later
- Docker Compose (for local PostgreSQL)
- A Telegram bot token from BotFather
- A NEAR Intents partner JWT for live quote requests
- An HTTPS Mini App URL for Telegram deployment; localhost is suitable for API and browser development but Telegram requires a reachable Mini App URL

## Local setup

1. Start PostgreSQL:

   ```sh
   docker compose up -d postgres
   ```

2. Copy `.env.example` to `.env`. Generate a session secret with:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Set that value as `SESSION_SECRET`. Configure `TELEGRAM_BOT_TOKEN`, `ONE_CLICK_JWT`, and `PUBLIC_APP_URL`. For Telegram testing, set `PUBLIC_APP_URL` to your HTTPS tunnel or deployment URL, and set `ALLOWED_ORIGINS` to the Mini App origin.

3. Install packages and start the API and Mini App:

   ```sh
   npm install
   npm run dev
   ```

   The API listens on `http://localhost:8787` and Vite on `http://localhost:5173`. In local browser preview, the API provides a development-only session; this endpoint is disabled in production. Set `VITE_API_URL=http://localhost:8787` in the shell when the API is on a different origin. The API initializes the PostgreSQL schema on startup.

4. Configure Telegram:

   - In BotFather, set the bot's Mini App URL to your HTTPS `PUBLIC_APP_URL`.
   - For webhook mode, set `TELEGRAM_WEBHOOK_URL` to a public HTTPS URL pointing at the API path (for example `https://app.example.com/api/telegram/webhook`) and set a random `TELEGRAM_WEBHOOK_SECRET`.
   - For local bot testing, leave `TELEGRAM_WEBHOOK_URL` unset; the bot uses long polling when `NODE_ENV=development`.
   - Open the bot and press **Open Pocket Near**. The backend validates Telegram's `initData`; browser preview uses the development-only session route.

5. Connect a wallet, set an unlock password, choose assets and limits in **Policy**, and sign the policy with the wallet. Request quotes from **Overview**. The agent can poll live quotes while the Mini App is open and report whether each is inside the signed policy. Any on-chain transaction must still be approved in the wallet.

## Deploying to Vercel

The root `vercel.json` defines two services: the Vite Mini App and the Express API. `/api/*` is routed to the API; all other paths are routed to the Mini App. The API service bundles the TypeScript app (including `@pocket-near/shared`) with esbuild into a single ESM file, `dist/app.mjs`, and `apps/bot/server.mjs` is the explicit `entrypoint` Vercel loads. The `.mjs` extension keeps the function ESM regardless of which `package.json` ends up next to it. The API initializes its idempotent schema on the first request in each serverless instance under a PostgreSQL advisory lock; tables have RLS enabled and are accessed by the server through its private PostgreSQL connection. The frontend uses same-origin `/api` requests in production, so do not set `VITE_API_URL` for Vercel deployments. The API's `PUBLIC_APP_URL` origin and Vercel's deployment URL are allowed by CORS; add any other custom frontend origins to `ALLOWED_ORIGINS`.

Configure these project environment variables in Vercel:

- `PUBLIC_APP_URL`: the HTTPS URL of the Mini App, including its custom domain if applicable.
- Connect the Supabase project to Vercel. The API uses the integration's `POSTGRES_URL` when present, and falls back to `DATABASE_URL` for local or legacy deployments. `SESSION_SECRET` must be a random value of at least 32 characters.
- `COOKIE_SECURE=true` and `NODE_ENV=production`.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL` (`${PUBLIC_APP_URL}/api/telegram/webhook`), and `TELEGRAM_WEBHOOK_SECRET` when enabling Telegram webhooks.
- Supabase `POSTGRES_URL` connections always use TLS. Add the Supabase root CA certificate as `DATABASE_SSL_CA` to verify the server certificate; without it, the Supabase integration's `sslmode=require` behavior encrypts traffic but does not validate certificate identity. For other PostgreSQL URLs, `DATABASE_SSL=true` enables certificate verification.

Vercel functions are not persistent workers. Keep `AGENT_WORKER_ENABLED=false`; the API does not use Telegram long polling in production and should receive updates through the webhook URL instead. The API initializes its database schema on startup.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | Express API port (default `8787`) |
| `PUBLIC_APP_URL` | HTTPS Mini App URL used by the bot's web app button |
| `DATABASE_URL` | PostgreSQL connection URL fallback; `POSTGRES_URL` takes precedence when provided by the Supabase Vercel integration |
| `POSTGRES_URL` | PostgreSQL connection URL provided by the Supabase Vercel integration |
| `DATABASE_SSL` | Enable TLS with certificate verification for non-Supabase connection URLs (`true`/`false`) |
| `DATABASE_SSL_CA` | Optional Supabase root CA certificate in PEM format; verifies the PostgreSQL server certificate |
| `SESSION_SECRET` | At least 32 characters of random key material for session JWTs |
| `COOKIE_SECURE` | Set `true` for HTTPS deployments |
| `TELEGRAM_BOT_TOKEN` | BotFather token; absent disables bot startup |
| `TELEGRAM_WEBHOOK_URL` | Optional full webhook URL; absent uses development long polling |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook secret token |
| `ONE_CLICK_JWT` | Server-side NEAR Intents partner JWT; never send this to the browser |
| `ONE_CLICK_BASE_URL` | 1Click API base URL |
| `SOLVER_RELAY_URL` | Official Message Bus JSON-RPC endpoint |
| `NEAR_RPC_URL` | NEAR RPC endpoint used to validate wallet signatures |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed by CORS |
| `QUOTE_CACHE_TTL_SECONDS` | Maximum quote-cache age; cached quotes are marked stale and cannot pass policy checks |
| `MAX_INIT_DATA_AGE_SECONDS` | Maximum Telegram launch-data age |
| `AGENT_WORKER_ENABLED` | Enable the PostgreSQL-backed Telegram quote worker (`true`/`false`, default false) |
| `AGENT_WORKER_INTERVAL_MS` | Worker polling interval, 5,000–300,000 ms |
| `TEE_SIGNER_ENABLED` | Enable signer requests; disabled means execute fails closed |
| `TEE_SIGNER_URL` | HTTPS endpoint implementing the enclave signer contract |
| `TEE_SIGNER_API_KEY` | Optional Bearer credential for the signer endpoint |
| `DEV_ENCLAVE_PRIVATE_KEY` | Development-only signing secret; ignored outside `NODE_ENV=development` |

## Implemented

- Telegraf `/start`, `/help`, `/status`, `/freeze`, `/agent on|off`, approval, and rejection controls with a Mini App button.
- Optional backend quote worker for enabled users, with policy/usage checks, preview audit records, deduplicated Telegram alerts, and inline approval/rejection buttons.
- Provider-agnostic TEE signer interface with fail-closed HTTP integration and a development-only envelope signer.
- Telegram `initData` authentication, HttpOnly session cookie, rate limiting, and wallet ownership proof.
- HOT Labs NEAR Connect wallet integration; policy signing and API verification use NEP-413.
- Live supported-asset list and 1Click quote integration through the official TypeScript SDK.
- Solver Relay JSON-RPC fallback for live solver quotes, then a bounded PostgreSQL cache fallback.
- Quote display with provider, route, fees where provided, output, slippage request, and expiry.
- Signed policy for an allowlisted asset pair and destination, per-trade/daily/weekly base-unit caps, time window, max slippage, and emergency freeze.
- API-side policy checks on each agent evaluation, blocked-attempt audit records, password protection for policy changes, and quote polling while the Mini App remains open.
- PostgreSQL persistence and production environment configuration.

## Current scope limits

- 1Click quotes are pricing/deposit instructions. The integration currently requests dry quotes and does not submit deposits.
- The app does not claim that a cached quote is live or eligible for execution.
- The portfolio endpoint deliberately refuses until a per-user NEAR Intents access token flow is configured; a shared partner JWT is not treated as user authorization.
- Telegram notifications are limited to bot commands and entry points. Fill alerts, balance-change alerts, and price-target monitoring require an enabled execution and user-scoped balance service.
- The account policy is signed off-chain and checked by this API; it is not enforced by the Intents Verifier contract.
- Named-account creation is handled by the selected wallet onboarding experience and is not provisioned by Pocket Near.
- This application needs a security review, load testing, operational monitoring, and protocol-scoped authorization before it can be considered production-ready for autonomous asset movement.

## Build and type check

```sh
npm run typecheck
npm run build
```

No API secret, full private key, or signing key belongs in `.env` or PostgreSQL.

## Protocol references

- [1Click API lifecycle and quote endpoint](https://docs.near-intents.org/integration/distribution-channels/1click-api)
- [1Click TypeScript SDK](https://github.com/defuse-protocol/one-click-sdk-typescript)
- [Solver Relay JSON-RPC reference](https://docs.near-intents.org/integration/market-makers/message-bus/rpc)
- [Verifier account keys and signature flow](https://docs.near-intents.org/integration/verifier-contract/account-abstraction)
- [Telegram Mini App launch-data validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
