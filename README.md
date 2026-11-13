# Pocket Near

Pocket Near is a non-custodial NEAR wallet companion. Its Mini App includes Home, Watch, Swap, Discover, and Me. Users connect their own NEAR wallet, sign policy and swap transactions themselves, and inspect NEAR and NEAR Intents market data.

## Security boundary

Pocket Near never asks for, receives, or stores a wallet private key. Telegram launch data is HMAC-verified, and a normal browser can establish a session only after a NEP-413 wallet signature. Both methods issue a short-lived HttpOnly session cookie. Wallet identity and policy envelopes are verified with NEP-413 signatures. Policy checks are performed by the API and are not an on-chain restriction.

Every supported swap is initiated by the user and approved by the user's wallet. Rhea NEAR swaps use wallet-approved transactions. For NEAR Intents 1Click, Pocket Near requests a fresh executable quote only after the user chooses **Prepare live deposit**; the user reviews the quote and then confirms any NEAR token transfer in their wallet. For other origin chains, Pocket Near shows the provider's deposit instructions and the user sends funds from their own wallet. The server only records the user's transaction hash and requests provider status; it cannot sign or send deposits. An active signed policy is checked before a deposit quote is saved. The monitoring agent only sends notifications and never signs or submits a transaction. The database enum retains `auto_inside_policy` for compatibility, but the application disables that mode and normalizes existing users to notify-only without changing the enum.

The API does not store a wallet private key or use a TEE signer. Unlock passwords are 10–128 characters, stored only as per-user salted scrypt hashes, and used for policy changes and protected settings. Passwords are never retained in browser storage or sent in Telegram.
## Monorepo

```text
apps/
  bot/       Telegraf bot and Express API
  mini-app/  React + TypeScript Telegram Mini App
packages/
  shared/    Runtime schemas, policy evaluator, shared types
```

PostgreSQL stores optional Telegram account IDs, NEAR account IDs, short-lived single-use wallet and policy challenges, signed policy envelopes, short-lived quote cache entries, each user's own Intents quote/deposit/status record, audit events, price watchlists and alerts, alert deduplication records, and optional discover-open events. Secrets are loaded only from environment variables.

The five personal tabs share one authenticated Mini App session. Watch shows all pairs in the active signed policy first, then separates live market prices from the Intents-backed memecoin board; it never requests trade quotes. Swap is the only screen that requests 1Click quotes. Discover separates curated apps, DeFi/earn and game links from NEAR Agent Market listings. Marketplace detail and hire links stay on Market's buyer flow. Me shows the full NEAR `accountId` as the Pocket identity, the multi-pair policy editor (up to 30 signed pairs), My Agent controls and account safety. Quests are marked coming soon and have no rewards or completion logic. Catalog results are cached for 60–120 seconds, default 90. Pocket Near does not reproduce Agent Market escrow, disputes, or payouts. Telegram workers only run in a persistent bot process; Vercel serverless functions do not keep intervals alive.

The normal browser landing page provides public read-only Intents overview, prices, Earn, and Explore data without a login. Personal wallet features require wallet sign-in; the wallet remains responsible for approving and submitting transactions. Background alerts and agent notifications require an account linked to Telegram.

## Intents network overview

The Home card reads `GET /api/network/overview`, a public aggregate from the authenticated NEAR Intents Explorer transactions endpoint. Set `EXPLORER_JWT` only in the API server environment; it is never sent to or bundled with the Mini App. The server applies Explorer's transaction timestamp filters and computes volume from `amountInUsd`, transaction/status counts, `SUCCESS / txCount` as a 0–1 success rate, and the highest-volume pairs and assets for a rolling 24-hour window. The response includes the exact ISO `windowStart` / `windowEnd`, aggregation time, and methodology string.

Successful aggregates are kept in process memory for 10 minutes and concurrent refreshes are shared. Explorer permits one request per partner every five seconds; requests for additional pages are paced accordingly. A maximum of two 1,000-row pages are read for a refresh. `partial: true` means that pagination hit a cap, a needed cursor/timestamp was unavailable, or a returned row could not be timestamped; it is not represented as full-window coverage. Expired cache is not served on upstream failure: the endpoint returns a clear 502/503 error instead. Metrics are omitted until `EXPLORER_JWT` is configured. The optional DefiLlama peer strip is not enabled.

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

   Set that value as `SESSION_SECRET`. Configure `TELEGRAM_BOT_TOKEN` and `PUBLIC_APP_URL`. Set `ONE_CLICK_JWT` in the API server environment to enable executable Intents quotes, deposit notifications, and status checks. It is never sent to or bundled with the Mini App; dry quote previews may work without it. For Telegram testing, set `PUBLIC_APP_URL` to your HTTPS tunnel or deployment URL, and set `ALLOWED_ORIGINS` to the Mini App origin.

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

5. Connect a wallet, create the one-time unlock password in **Me**, add one or more asset pairs and limits, then unlock and sign the policy with your wallet. Try notify-only and the master lock. Auto execution is not supported. No password input remains on the main screens. In **Watch**, inspect each signed policy pair; choose **Swap this pair** to prefill the user-driven Swap form, request a live quote, and review the policy decision. Any on-chain transaction must still be approved in the wallet.

## Telegram mobile demo

1. Start PostgreSQL and run `npm run db:migrate`, then start the API and Mini App with `npm run dev`.
2. Open the Mini App from Telegram (or the development browser session), then connect a NEAR wallet and verify the wallet challenge.
3. In **You → My Agent**, create an unlock password once, choose a pair and limits, and sign the policy in the wallet. Turn on notifications to scan only those signed pairs; every swap still requires wallet approval.
4. Open **Watch** to see policy chips and available live price context. Tap a pair's **Swap this pair** action; in **Swap**, set amount and any required destination/refund address, request a quote, and inspect output, route, fees, expiry, and allow/block decision.
5. Use Swap to request a quote. For Intents, review the dry quote and policy decision, choose **Prepare live deposit**, review the fresh amount and address, then either approve the NEAR token transfer in your wallet or send from your own origin-chain wallet and enter its transaction hash. The app submits the hash to 1-Click and refreshes the provider status; only a provider-reported `SUCCESS` means the swap completed. Share a quote preview through Telegram's in-app link handler; the tweet intent says it is not submitted and does not claim a fill.
6. In **Me**, verify the full wallet `accountId` identity and inspect profile, security, locks, policy, and agent events. Check the **Market prices** and **Memecoin board** segments in Watch. **Discover** separates Explore from Discover NEAR agents; memes and quests never use placeholder assets or rewards. `/status`, `/lock`, and `/unlock` remain the Telegram control plane; chat never collects passwords.

When opened in Telegram Web, the app reads verified `initData` from the Telegram WebApp bridge or Telegram launch parameters. A plain browser URL starts in public read-only mode; connect a NEAR wallet and sign the one-time login challenge to open personal features. Background alerts still require a Telegram-linked account.

### Verifying Intents swap deposits

In the Telegram Mini App, connect a wallet, open **Swap**, choose assets from the live Intents asset list, enter a positive amount, and tap **Get live quote**. For the USDC (NEAR) → wNEAR (NEAR) example, enter `10`; the API converts it to the 6-decimal base-unit amount `10000000`. Also check the reverse wNEAR → USDC route with `0.1`, and USDC → USDT with `10`. The request uses full Intents asset IDs, the connected account as `sender`, and the account as `recipient`/`refundTo` for NEAR-chain legs. The UI shows the provider's output, minimum output and fee fields when present, expiry, provider, and stale-cache status; it does not invent a route when 1-Click omits route data.

To prepare a deposit, configure `ONE_CLICK_JWT` in the API environment, sign an active policy that allows the pair/amount/destination, then select **Prepare live deposit**. The API rechecks that policy and requests a new `dry: false` quote; a cached, expired, or incomplete quote cannot be used. Review the deposit amount, output estimate, address, and memo before sending anything. For a NEAR-origin NEP-141 asset, the connected wallet signs a standard `ft_transfer` to the provider address with one yocto attached and includes the provider memo if supplied. For other origin chains, Pocket Near does not access the chain wallet; send exactly as instructed from your wallet and enter the resulting transaction hash. The API submits that hash to 1-Click and stores the provider status on the signed-in user's swap record. Pending swaps can be refreshed from Swap; the app polls the status after a transaction hash is registered.

The adapter reads output from `quote.amountOut` (and `quote.amountOutFormatted` for display), minimum output from `quote.minAmountOut`, fees from `quote.refundFee` and `quote.withdrawFee`, and provider expiry from `quote.deadline` or other recognized expiry fields. A `dry: true` response normally omits `quote.deadline`; when the output amount is valid, the adapter assigns a client-derived 55-second preview expiry. This is not a settlement deadline. A recent successful dry quote may be returned as visibly stale cache only after a retryable live-provider failure. Executable quotes are never cached and cannot use stale previews.

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
| `ONE_CLICK_JWT` | Server-side NEAR Intents partner JWT required for executable quotes, deposit notifications, and status refresh; dry previews may work without it; never send it to the browser |
| `ONE_CLICK_BASE_URL` | 1Click API base URL |
| `EXPLORER_JWT` | Required server-only bearer JWT for NEAR Intents Explorer network metrics; never expose to the Mini App |

| `NEAR_RPC_URL` | NEAR RPC endpoint used to validate wallet signatures |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed by CORS |
| `QUOTE_CACHE_TTL_SECONDS` | Maximum quote-cache age; cached quotes are marked stale and cannot pass policy checks |
| `MAX_INIT_DATA_AGE_SECONDS` | Maximum Telegram launch-data age |
| `AGENT_WORKER_ENABLED` | Enable the PostgreSQL-backed Telegram quote worker (`true`/`false`, default false) |
| `AGENT_WORKER_INTERVAL_MS` | Worker polling interval, 5,000–300,000 ms |



| `COINGECKO_API_KEY` | Optional CoinGecko demo API key to improve rate-limit headroom |
| `PRICE_ASSET_IDS` | Comma-separated CoinGecko asset IDs for the default market list |
| `PRICES_CACHE_TTL_SECONDS` | Price cache TTL, 30–60 seconds (default 45) |
| `EARN_CACHE_TTL_SECONDS` | DefiLlama cache TTL, 300–900 seconds (default 600) |
| `MARKET_CACHE_TTL_SECONDS` | NEAR Agent Market public catalog/detail cache, 60–120 seconds (default 90); no Market credential is required for these public endpoints |

## Implemented

- Telegraf `/start`, `/help`, `/prices`, `/alerts`, `/status`, `/lock`, `/unlock`, `/freeze`, and `/agent on|off` controls with Mini App links.
- Optional backend quote worker for enabled and unlocked users, with policy/usage checks, preview audit records, and Telegram review alerts. It does not settle a transaction.

- Telegram `initData` authentication, HttpOnly session cookie, rate limiting, and wallet ownership proof.
- HOT Labs NEAR Connect wallet integration; policy signing and API verification use NEP-413.
- Live supported-asset list and 1Click quote integration through the official TypeScript SDK.

- Quote display with provider, route, fees where provided, output, slippage request, and expiry.
- Signed policy for an allowlisted asset pair and destination, per-trade/daily/weekly base-unit caps, time window, max slippage, and emergency freeze.
- API-side policy checks on each agent evaluation, blocked-attempt audit records, password protection for policy changes, and quote polling while the Mini App remains open.
- PostgreSQL persistence and production environment configuration.
- Five-tab product surface: authenticated prices, watchlists, price alerts, DefiLlama NEAR protocols, curated app and game links, Agent Market CTAs, and activity history.
- Ephemeral create/unlock password dialogs; runtime agent modes and locks persisted on users; public NEAR Agent Market listing, detail, and price proxy.
- CoinGecko and DefiLlama server-side caches, curated fallback data for Earn and Explore, and a persistent-host Telegram price-alert worker with daily firing deduplication.
- Vercel Schedules primary worker tick (every 30 minutes) and an hourly GitHub Actions fallback/manual dispatch. Both call the same bearer-authenticated API endpoint; a PostgreSQL advisory lock prevents overlapping ticks.
- Opt-in NEAR/USDC/USDT pool discovery using Rhea pool reserves, token metadata, and current prices. Rhea's public pool feed has no APR field, so suggestions show reserve-derived TVL and omit APR and projected returns.
- Me-tab visibility for detected Rhea internal LP token deposits and optional periodic monitoring (1–4 reports per day). Balance changes are not labeled as yield. Rhea farms and concentrated-liquidity NFT positions are outside current indexer coverage.
- Telegram `/prices` and `/alerts` commands; the session cookie uses `SameSite=None; Secure` for secure deployments and `SameSite=Lax` locally. Browser API calls include credentials.

## Current scope limits

- 1Click quotes are pricing/deposit instructions. The integration currently requests dry quotes and does not submit deposits.
- The app does not claim that a cached quote is live or eligible for execution.
- The portfolio currently reads the connected account's unlocked native NEAR balance through public NEAR RPC. NEAR Intents token balances need a user-scoped authorization flow; a shared partner JWT is not treated as user authorization.
- Price-target Telegram alerts and investment reports require `TELEGRAM_BOT_TOKEN`, a configured `CRON_SECRET`, database connectivity, and the Vercel Schedules or GitHub Actions caller. For the fallback, add repository secrets `POCKET_NEAR_API_URL` (API deployment origin) and `POCKET_NEAR_WORKER_SECRET` (same value as `CRON_SECRET`). GitHub scheduled workflows can be delayed during load; Vercel is the primary schedule.
- Investment discovery uses Rhea's public pool index, 1Click token metadata, and CoinGecko prices. It limits suggestions to indexed NEAR and USDC/USDT pools. The public Rhea index does not supply pool APR, and no APR or future returns are inferred. Intear balance indexing identifies Rhea internal deposits, but this path does not expose Rhea farm stakes or concentrated-liquidity NFT positions. Reports describe observed balance deltas, not earnings.
- Pool-level APY is available for some NEAR pools from DeFiLlama Yields, including Rhea entries, but its free yield endpoints are scheduled to shut down on November 13, 2026 and the replacement requires a paid API plan. Those records are not yet reliably mapped to every Rhea pool-index ID, so the worker does not use protocol-level rates as if they were a particular pool's APR.
- Portfolio balances are not inferred from the shared partner JWT. Intents balance access requires a user-scoped authorization flow.
- The account policy is signed off-chain and checked by this API; it is not enforced by the Intents Verifier contract.
- Auto execution is disabled. The legacy `auto_inside_policy` enum value remains in the database for compatibility; existing rows are normalized to `notify_only`. The agent only notifies and cannot sign or submit swaps.
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
- [Verifier account keys and signature flow](https://docs.near-intents.org/integration/verifier-contract/account-abstraction)
- [Telegram Mini App launch-data validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
- [Rhea pooling documentation](https://guide.rhea.finance/near-chain-guides/how-rhea-finance-works/pooling)
- [Intear balance API documentation](https://docs.intear.tech/api/reference/balances/)
- [Vercel Schedules](https://vercel.com/changelog/vercel-schedules-is-now-in-public-beta)
- [GitHub Actions scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
