# Pocket Near

Pocket Near is a Telegram-native NEAR super-pocket. Its Mini App has Home, Watch, Swap, Discover, and You tabs. It connects to a user's own NEAR wallet, verifies wallet ownership with NEP-413 signatures, stores signed policies in PostgreSQL, and displays quotes from 1Click and the Solver Relay.

## Security boundary

The app never asks for, receives, or stores a wallet private key. Telegram launch data is HMAC-verified by the API before a short-lived, HttpOnly session cookie is issued. Policy data is canonicalized, signed by the connected wallet, and verified server-side with `near-api-js`. A separate unlock password is stored as a scrypt hash with a random salt.

**No free-form trading chat is used.** The deterministic `packages/shared` `checkPolicy()` evaluator is the policy source of truth. Runtime `agent_mode` is `off`, `notify_only`, or `auto_inside_policy`; independent `master_lock` and `auto_exec_lock` values can prevent work. Workers skip a master-locked account, check signed policy freeze and usage, and only send notifications in notify-only mode. In auto mode an enabled TEE may sign an eligible intent payload, but the current deployment has no supported settlement/submission flow: a wallet signature and transaction submission are still required and no funds move automatically.

The security boundary is: wallet signs policy → PostgreSQL stores its signed envelope → API/worker evaluates quotes with `checkPolicy()` → optional TEE signer validates again → user completes wallet authorization. Unlock passwords must be 10–128 characters and are stored only as per-user salted scrypt hashes. Passwords are entered only in an ephemeral dialog for policy signing, enabling auto mode, or clearing runtime locks; passwords are not retained in browser storage or sent in Telegram. Creating a password and every unlock action clear the UI input after completion or cancellation. The API host never stores a full wallet private key. The current 1Click quote flow yields a deposit address and this repository does not implement the Intents deposit/submission lifecycle. A TEE signature alone is not settlement, so the API records a signed preview and explicitly refuses to report a submitted/successful swap.

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

PostgreSQL stores Telegram account IDs, NEAR account IDs, signed policy envelopes, short-lived quote cache entries, audit events, price watchlists and alerts, alert deduplication records, and optional discover-open events. Secrets are loaded only from environment variables.

The five tabs share one authenticated Mini App session. Watch displays only the pairs in the active signed policy and refreshes price context while visible; it never requests trade quotes. Swap is the only screen that requests 1Click quotes. Discover includes CoinGecko prices, DefiLlama earn data (with curated NEAR protocol fallback), curated apps and outbound game links, and a meme board only when one of the explicitly recognized CoinGecko asset IDs is present in the Intents token catalog. Meme votes are social-only and do not affect policy or execution. You shows the full NEAR `accountId` as the Pocket identity and separates My Agent controls from a server-proxied catalog using NEAR Agent Market's public list, detail, and pricing-plan API; Hire leaves the Mini App for Market's own buyer flow. Quests are marked coming soon and have no rewards or completion logic. Catalog results are cached for 60–120 seconds, default 90. Pocket Near does not reproduce Agent Market escrow, disputes, or payouts. Telegram workers only run in a persistent bot process; Vercel serverless functions do not keep intervals alive.

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

   Set that value as `SESSION_SECRET`. Configure `TELEGRAM_BOT_TOKEN` and `PUBLIC_APP_URL`. `ONE_CLICK_JWT` is optional for public 1-Click dry quotes. For Telegram testing, set `PUBLIC_APP_URL` to your HTTPS tunnel or deployment URL, and set `ALLOWED_ORIGINS` to the Mini App origin.

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

5. Connect a wallet, create the one-time unlock password in **You → My Agent**, choose assets and limits, then unlock and sign the policy with your wallet. Try notify-only, master lock, and auto mode; enabling auto and clearing locks require the password dialog. No password input remains on the main screens. In **Watch**, inspect only the signed policy pairs; choose **Swap this pair** to prefill the user-driven Swap form, request a live quote, and review the policy decision. Any on-chain transaction must still be approved in the wallet.

## Telegram mobile demo

1. Start PostgreSQL and run `npm run db:migrate`, then start the API and Mini App with `npm run dev`.
2. Open the Mini App from Telegram (or the development browser session), then connect a NEAR wallet and verify the wallet challenge.
3. In **You → My Agent**, create an unlock password once, choose a pair and limits, and sign the policy in the wallet. Turn on monitoring to scan only those signed pairs; auto mode remains password-gated and never reports an unsigned fill.
4. Open **Watch** to see policy chips and available live price context. Tap a pair's **Swap this pair** action; in **Swap**, set amount and any required destination/refund address, request a quote, and inspect output, route, fees, expiry, and allow/block decision.
5. Use the ephemeral unlock prompt to prepare a policy-approved preview. The UI distinguishes TEE-off/error from a TEE-signed preview and states that no quote was submitted or settled. Share a quote preview through Telegram's in-app link handler; the tweet intent says it is not submitted and does not claim a fill.
6. In **You**, verify the full wallet `accountId` identity and inspect profile, security, locks, policy, and agent events. **Discover** shows meme assets/votes only when backed by the current Intents token catalog; otherwise it says Coming soon. Quests also say Coming soon. Check curated apps, prices, Earn, games, and NEAR Agent Market there. `/status`, `/lock`, and `/unlock` remain the Telegram control plane; chat never collects passwords.

### Verifying live dry quotes

In the Telegram Mini App, connect a wallet, open **Swap**, choose assets from the live Intents asset list, enter a positive amount, and tap **Get live quote**. For the USDC (NEAR) → wNEAR (NEAR) example, enter `10`; the API converts it to the 6-decimal base-unit amount `10000000`. Also check the reverse wNEAR → USDC route with `0.1`, and USDC → USDT with `10`. The request uses full Intents asset IDs, the connected account as `sender`, and the account as `recipient`/`refundTo` for NEAR-chain legs. The UI shows the provider's output, minimum output and fee fields when present, expiry, provider, and stale-cache status; it does not invent a route when 1-Click omits route data.

The adapter reads output from `quote.amountOut` (and `quote.amountOutFormatted` for display), minimum output from `quote.minAmountOut`, fees from `quote.refundFee` and `quote.withdrawFee`, and provider expiry from `quote.deadline` or other recognized expiry fields. A `dry: true` response normally omits `quote.deadline`; when the output amount is valid, the adapter assigns a client-derived 55-second preview expiry. This is not a settlement deadline. A recent successful quote may be returned as visibly stale cache only after a retryable live-provider failure.

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
| `ONE_CLICK_JWT` | Optional server-side NEAR Intents partner JWT; public dry quotes are attempted without it; never send it to the browser |
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
| `COINGECKO_API_KEY` | Optional CoinGecko demo API key to improve rate-limit headroom |
| `PRICE_ASSET_IDS` | Comma-separated CoinGecko asset IDs for the default market list |
| `PRICES_CACHE_TTL_SECONDS` | Price cache TTL, 30–60 seconds (default 45) |
| `EARN_CACHE_TTL_SECONDS` | DefiLlama cache TTL, 300–900 seconds (default 600) |
| `MARKET_CACHE_TTL_SECONDS` | NEAR Agent Market public catalog/detail cache, 60–120 seconds (default 90); no Market credential is required for these public endpoints |

## Implemented

- Telegraf `/start`, `/help`, `/prices`, `/alerts`, `/status`, `/lock`, `/unlock`, `/freeze`, and `/agent on|off` controls with Mini App links.
- Optional backend quote worker for enabled and unlocked users, with policy/usage checks, preview audit records, and Telegram review alerts. It does not settle a transaction.
- Provider-agnostic TEE signer interface with fail-closed HTTP integration and a development-only envelope signer.
- Telegram `initData` authentication, HttpOnly session cookie, rate limiting, and wallet ownership proof.
- HOT Labs NEAR Connect wallet integration; policy signing and API verification use NEP-413.
- Live supported-asset list and 1Click quote integration through the official TypeScript SDK.
- Solver Relay JSON-RPC fallback for live solver quotes, then a bounded PostgreSQL cache fallback.
- Quote display with provider, route, fees where provided, output, slippage request, and expiry.
- Signed policy for an allowlisted asset pair and destination, per-trade/daily/weekly base-unit caps, time window, max slippage, and emergency freeze.
- API-side policy checks on each agent evaluation, blocked-attempt audit records, password protection for policy changes, and quote polling while the Mini App remains open.
- PostgreSQL persistence and production environment configuration.
- Five-tab product surface: authenticated prices, watchlists, price alerts, DefiLlama NEAR protocols, curated app and game links, Agent Market CTAs, and activity history.
- Ephemeral create/unlock password dialogs; runtime agent modes and locks persisted on users; public NEAR Agent Market listing, detail, and price proxy.
- CoinGecko and DefiLlama server-side caches, curated fallback data for Earn and Explore, and a persistent-host Telegram price-alert worker with daily firing deduplication.
- Telegram `/prices` and `/alerts` commands; the session cookie uses `SameSite=None; Secure` for secure deployments and `SameSite=Lax` locally. Browser API calls include credentials.

## Current scope limits

- 1Click quotes are pricing/deposit instructions. The integration currently requests dry quotes and does not submit deposits.
- The app does not claim that a cached quote is live or eligible for execution.
- The portfolio currently reads the connected account's unlocked native NEAR balance through public NEAR RPC. NEAR Intents token balances need a user-scoped authorization flow; a shared partner JWT is not treated as user authorization.
- Price-target Telegram alerts require a Telegram bot and a persistent host with `AGENT_WORKER_ENABLED=true`; Vercel functions do not run durable workers. Fill alerts and balance-change alerts require a user-scoped balance and execution service.
- Portfolio balances are not inferred from the shared partner JWT. Intents balance access requires a user-scoped authorization flow.
- The account policy is signed off-chain and checked by this API; it is not enforced by the Intents Verifier contract.
- Auto mode can request a constrained TEE signature only when configured. Settlement and transfer submission are unsupported, so the feature stops before funds move. Clearing `master_lock` or `auto_exec_lock`, enabling `auto_inside_policy`, and signing a changed policy require a valid password. Turning a lock on and changing notify/off mode do not.
- Agent Market's buyer hire flow may leave Telegram for Market authentication. Public catalog requests require no Market credential; no private buyer endpoint or jobs feed is proxied.
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
