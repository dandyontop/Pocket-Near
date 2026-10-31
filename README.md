# Pocket Near

Pocket Near is a Telegram Mini App companion for NEAR Intents. It connects to a user's own NEAR wallet, verifies wallet ownership with NEP-413 signatures, keeps a signed policy in PostgreSQL, and displays solver quotes from 1Click and the Solver Relay.

## Security boundary

The app never asks for, receives, or stores a wallet private key. Telegram launch data is HMAC-verified by the API before a short-lived, HttpOnly session cookie is issued. Policy data is canonicalized, signed by the connected wallet, and verified server-side with `near-api-js`. A separate unlock password is stored as a scrypt hash with a random salt.

**Unattended settlement is intentionally disabled.** The Verifier's registered Intents keys are authorized to sign intents for the account and can add or remove other keys. The published 1Click quote flow returns a deposit address; it does not confer a spend authorization on Pocket Near. The app therefore evaluates policies and selects quotes but requires a wallet authorization for every on-chain action. It does not store an agent key, and its API responds with a clear rejection if an unattended execution is requested. Do not deploy this MVP as an autonomous asset manager.

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
   - For webhook mode, set `TELEGRAM_WEBHOOK_URL` to a public HTTPS URL pointing at the API path (for example `https://api.example.com/telegram/webhook`) and set a random `TELEGRAM_WEBHOOK_SECRET`.
   - For local bot testing, leave `TELEGRAM_WEBHOOK_URL` unset; the bot uses long polling when `NODE_ENV=development`.
   - Open the bot and press **Open Pocket Near**. The backend validates Telegram's `initData`; browser preview uses the development-only session route.

5. Connect a wallet, set an unlock password, choose assets and limits in **Policy**, and sign the policy with the wallet. Request quotes from **Overview**. The agent can poll live quotes while the Mini App is open and report whether each is inside the signed policy. Any on-chain transaction must still be approved in the wallet.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | Express API port (default `8787`) |
| `PUBLIC_APP_URL` | HTTPS Mini App URL used by the bot's web app button |
| `DATABASE_URL` | PostgreSQL connection URL |
| `DATABASE_SSL` | Enable TLS with certificate verification for PostgreSQL (`true`/`false`) |
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

## Implemented

- Telegraf `/start`, `/help`, `/status`, and `/freeze` commands with a Mini App button.
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
