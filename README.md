# Pocket Near

Pocket Near is a non-custodial NEAR wallet companion. Its Mini App is organized around Home, Swap, Activity, Explore, and Profile. Users connect their own NEAR wallet, inspect supported NEAR token balances, review NEAR Intents and Rhea quotes, and sign each on-chain action themselves. The app also provides wallet-signed spending policies, RNEAR liquid staking, and evidence-based NEAR market research.

See [THESIS.md](./THESIS.md) for the product thesis, evidence on both sides, verification gaps, and rebuild command.

## NEAR HACKATHON entry

**Problem:** NEAR users need a clear way to review token balances, compare supported swap routes, understand minimum output and fees, and keep transaction approval in their own wallet. Policy checks and market data should inform a decision without giving an app server control of the funds.

**What Pocket Near does:** The Mini App presents available supported NEAR tokens first, checks the selected token balance before quoting, and separates quote review from wallet approval. Rhea swaps and RNEAR staking are signed in the user's NEAR wallet. NEAR Intents swaps use an executable 1-Click quote and saved deposit instructions; pending statuses are refreshed automatically. Signed policies constrain the quote review, while the notification agent remains notify-only. Explore includes NEAR market metrics and a research thesis built from cited source data.

**How NEAR fits:** NEP-413 wallet signatures establish account ownership and sign policies; NEAR RPC reads wallet balances and transaction outcomes; Rhea provides NEAR swaps and RNEAR liquid staking; and NEAR Intents provides supported swap quotes and settlement. Optional thesis generation uses NEAR AI Cloud. Pocket Near does not claim model attestation or give the model authority to sign transactions.

**Tracks this project fits:** `defi` (wallet-approved swaps and RNEAR staking), `thesis` (data-backed NEAR research and dashboards), and `security` (wallet-signed spending policies and a non-custodial, notify-only agent). The agent does not autonomously spend, negotiate, or hire other agents.

**Demo post:** [Pocket Near on X](https://x.com/BunnaOntop/status/2121751456474624069).

**Existing-project disclosure and judging scope:** The event was announced on October 19, 2026; its build and submission window runs from November 1 through November 14, 2026. Pocket Near existed before that window. Baseline commit [`9ee6565`](https://github.com/dandyontop/Pocket-Near/commit/9ee6565) (October 31, 2026) contains the Telegram Mini App, NEP-413 wallet sign-in, signed policy checks, and quote previews. The features added after that baseline include the Rhea and RNEAR flows, improved wallet-approved Intents execution and tracking, NEAR research and market dashboards, and the current product and safety experience. The project is not represented as newly created for this event. [Review the baseline-to-submission diff](https://github.com/dandyontop/Pocket-Near/compare/9ee6565...d88212b).

**Libraries and services:** React, TypeScript, Vite, Express, Telegraf, PostgreSQL, HOT Labs NEAR Connect, `near-api-js`, the official NEAR Intents TypeScript SDK, and Rhea's `rnear-sdk`. Data and optional AI features use NEAR Intents, Rhea, NEAR RPC, NEAR AI Cloud, CoinGecko, Alternative.me, GeckoTerminal, and DeFiLlama. This repository uses its existing Pocket Near implementation as the starting point; it is not a hackathon starter template.

### Judge walkthrough

1. Follow [Local setup](#local-setup), then run `npm run dev`. A local browser session is available in development; a Telegram bot token is needed only to use the Telegram bot itself.
2. Open the Mini App, connect a NEAR wallet, and sign the one-time login challenge. In **Swap**, available supported NEAR tokens appear first with their balances. Choose a pair and amount, request a quote, and review the expected output, minimum output, slippage, fees, balance, and gas reserve.
3. Review the policy result and request an executable quote. Approve a Rhea swap or NEAR deposit in the wallet. Rhea transaction status is checked from the wallet-returned transaction hash; Intents status is polled from the saved 1-Click deposit instructions. The app reports provider/chain status and does not treat a quote as a completed swap.
4. In **Explore → Earn**, review the RNEAR staking card, approve a small stake in the wallet, and refresh positions to see the on-chain result. Pool opportunity indexing may be unavailable independently of RNEAR contract balances.
5. In **Explore → Markets**, inspect the NEAR thesis and market metrics. The thesis identifies its source data and labels its rules-based fallback if NEAR AI Cloud is unavailable.

## Security boundary

Pocket Near never asks for, receives, or stores a wallet private key. Telegram launch data is HMAC-verified, and a normal browser can establish a session only after a NEP-413 wallet signature. Both methods issue a short-lived HttpOnly session cookie. Wallet identity and policy envelopes are verified with NEP-413 signatures. Policy checks are performed by the API and are not an on-chain restriction.

Every supported swap is initiated by the user and approved by the user's NEAR wallet. Rhea NEAR swaps use wallet-approved transactions; after approval, Pocket Near reads the transaction hash returned by the wallet and checks the NEAR execution result. For NEAR Intents 1Click, Pocket Near requests a fresh executable quote after the user reviews the live quote and continues to Activity. The user reviews the saved deposit instructions and signs any NEAR transfer in the wallet; the app sends the wallet-returned hash to 1-Click when available and polls saved swap status while pending. The current swap picker is limited to supported NEAR assets. Before a deposit quote is saved, it must pass at least one active wallet-signed policy. Users can keep up to three policies; a new one is added without replacing the others, and each can be edited, frozen/resumed, or deleted individually. The monitoring agent only sends notifications and never signs or submits a transaction. The database enum retains `auto_inside_policy` for compatibility, but the application disables that mode and normalizes existing users to notify-only without changing the enum.

The API does not store a wallet private key or use a TEE signer. Unlock passwords are 10–128 characters, stored only as per-user salted scrypt hashes, and used for policy changes and protected settings. Passwords are never retained in browser storage or sent in Telegram.
## Monorepo

```text
apps/
  bot/       Telegraf bot and Express API
  mini-app/  React + TypeScript Telegram Mini App
packages/
  shared/    Runtime schemas, policy evaluator, shared types
```

PostgreSQL stores optional Telegram account IDs, NEAR account IDs, short-lived single-use wallet and policy challenges, signed policy envelopes, short-lived quote cache entries, each user's own Intents quote/deposit/status record, hourly rolling-24h network aggregates, audit events, price watchlists and alerts, alert deduplication records, and optional discover-open events. Network snapshots contain aggregate counts and volumes only; they do not store Explorer transaction rows, deposit addresses, memos, or transaction hashes. Secrets are loaded only from environment variables.

The five main tabs share the existing Mini App session and follow common user tasks:

- **Home** shows wallet connection and unlocked native NEAR balance, a direct Swap action, recent saved Intents swap statuses, and a compact 24-hour NEAR Intents network summary. Network-wide volume includes all integrators and is never represented as Pocket Near volume. Additional network metrics and scenario modeling are secondary and expandable.
- **Swap** separates asset/amount entry from live quote review. Supported tokens with balances are listed first; selected token balance and the separate NEAR gas reserve are checked before quoting/starting. The review groups expected and minimum output, route, fees, expiry, policy status, and wallet action. For a 1Click swap, the app fetches a fresh executable quote before the user confirms.
- **Activity** shows saved NEAR Intents swaps, their deposit/processing/completion timeline, automatic pending-status polling, manual refresh, and expandable deposit details. Rhea pool swaps are submitted directly by the wallet; their transaction result is checked from the wallet-returned hash.
- **Explore** has Markets, Earn, Apps & games, and Agents categories. Market prices, Rhea market data, NEAR thesis, Rhea staking, and protocol listings are grouped by intent.
- **Profile** groups wallet identity, price and pool alerts, position monitoring, signed policy limits, agent controls, and emergency freeze under Safety.

Agent Market detail and hire links stay on the marketplace's buyer flow. Catalog results are cached for 60–120 seconds, default 90. Pocket Near does not reproduce Agent Market escrow, disputes, or payouts. Telegram workers only run in a persistent bot process; Vercel serverless functions do not keep intervals alive.

The normal browser landing page provides public read-only Intents overview, prices, Earn, and Explore data without a login. Personal wallet features require wallet sign-in; the wallet remains responsible for approving and submitting transactions. Background alerts and agent notifications require an account linked to Telegram.

## NEAR research thesis

The Explore → Markets **Get NEAR Thesis** card, authenticated **My Agent** card, and Telegram `/thesis` command can request `POST /api/thesis`. The server builds a facts-only snapshot from the configured CoinGecko price feed, the Explorer's rolling 24-hour Intents metrics, indexed NEAR/stablecoin pool data, and a curated NEAR game directory, then asks NEAR AI Cloud's OpenAI-compatible chat-completions API for a JSON thesis (`summary`, `bull`, `bear`, `risks`, and `whatToVerify`). The response is validated with shared Zod schemas. Network-wide Intents volume is explicitly not attributed to Pocket Near.

Set `NEARAI_API_KEY` only in the API server environment; it is never sent to or bundled with the Mini App. The feature uses `z-ai/glm-5.3-flash`, caches a successful result per user for 15 minutes, and allows at most three model requests per user per 15 minutes. If the key is missing or the model request/response fails, the API returns a clearly labeled `rules-fallback` based only on the available source data. The card ranks only the configured token feed and returned pool data; rankings are not return forecasts. It can show the connected account's unlocked native NEAR value as context, but does not read other token balances. A user-entered risk amount stays in the browser and is not sent to the model. The display explicitly notes that 24-hour moves cannot identify a price bottom, pool minimum deposits are not verified, and game entry costs or earnings are unknown. The fixed disclaimer says, “Use as research material, never as financial advice. AI can make mistakes. Always verify results and do your own research.”

## Market signals and Rhea market warnings

The Fear & Greed card reads Alternative.me's general crypto-market index (0–100), caches it in API memory for 15 minutes, and shows both the provider observation time and API check time. Refreshing the card requests a fresh reading and updates the check timestamp. It is not a NEAR-specific sentiment signal, and the UI omits the provider's textual sentiment label.

Rhea NEAR markets show only observable market fields. Before a Rhea swap, the UI asks the user to review and acknowledge warnings for a Rhea freeze-list flag, missing market data, liquidity below $10,000, 24-hour volume below $100, fewer than three reported trades, or absolute 24-hour price movement of at least 20%. These are transparent UI thresholds, not a wash-trading, bot, scam, or security detector; they do not prove an asset is unsafe and do not replace the wallet's transaction review.

NEAR AI Cloud documents its inference as TEE-based. Pocket Near does not verify or claim model attestation, and AI output has no authority over wallet signing, policy decisions, or transaction submission. No wallet data or private keys are sent to the model.

## Intents network overview

The public Flywheel reads `GET /api/flywheel/overview`, backed by an hourly scheduled worker. `GET /api/network/overview` uses the network aggregate saved by that worker when available, so opening Home or the public landing page does not trigger a new Explorer scrape. Before the first saved aggregate is available, it falls back to the Explorer API and may return an explicit 502/503 if the upstream is unavailable or rate-limits requests. Read `updatedAt` to see when the displayed aggregate was captured. Set `EXPLORER_JWT` only in the API server environment; it is never sent to or bundled with the Mini App. Explorer volume uses `amountInUsd`; success rate is `SUCCESS / txCount` as a 0–1 value. Both include exact ISO rolling-24-hour window bounds. The Explorer request has a 15-second timeout and reads at most two 1,000-row pages, paced at the documented five-second partner rate.

Each hourly Flywheel snapshot still covers a rolling 24 hours; it is not a last-hour total. Although the shared worker can be called more frequently for other jobs, Flywheel stores at most one new snapshot per 60 minutes. The worker matches Explorer rows against saved Pocket Near deposit-address-and-memo pairs and attributes only matching `SUCCESS` rows to Pocket Near. Network-wide Explorer totals are shown separately and are never attributed to Pocket Near. Database snapshots contain only aggregated volume, transaction/status counts, pairs, and source chains. They are retained for up to 365 days. Explorer permits one request per partner every five seconds; requests for additional pages are paced accordingly. A maximum of two 1,000-row pages are read per refresh. `partial: true` means pagination/safety limits or missing timestamps may prevent full 24-hour coverage.

The Flywheel funnel counts Pocket Near swap records created in the window, deposit hashes submitted, and saved provider statuses; a provider status can update after a snapshot.

The 10× model uses the Explorer's network-wide rolling-24h `volumeUsd24h`, including all integrators, not only volume routed through Pocket Near. It computes `network-wide 24h USD volume × editable multiplier × entered NEAR-conversion percentage ÷ live NEAR USD price`. The conversion assumption is blank until the user enters it. This is an editable market-size scenario, not Pocket Near-attributed volume or observed NEAR demand; a partial Explorer sample may understate the baseline. DefiLlama fees-per-$1M is `24h fees ÷ 24h volume × 1,000,000`; rows are shown only when both real values are returned. Each protocol's coverage and accounting methods differ, and NEAR Intents DefiLlama data covers the network/all integrators, not Pocket Near.

Vercel Schedules is the primary worker and GitHub Actions is a fallback. The fallback job uses the GitHub Actions `production` environment: set `POCKET_NEAR_API_URL` as an environment variable and `POCKET_NEAR_WORKER_SECRET` as an environment secret. The worker secret must match the API's `CRON_SECRET`; `EXPLORER_JWT` stays in the API environment. A snapshot appears only after a worker run succeeds; check the Vercel or GitHub Actions run logs if it remains unavailable. If Explorer is unavailable, the worker reports an error and does not replace the last successful aggregate. A maximum of two 1,000-row pages means snapshots may be partial; the API does not claim complete coverage in that case.

## Requirements

- Node.js 20.11 or later
- npm 10 or later
- Docker Compose (for local PostgreSQL)
- A NEAR Intents partner JWT for executable Intents quotes and status notifications
- A Telegram bot token from BotFather only if using Telegram bot commands or the Telegram launch flow
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

5. Connect a wallet, create the one-time unlock password in **Profile**, add one or more NEAR asset pairs and limits, then unlock and sign the policy with your wallet. Try notify-only and the master lock. Auto execution is not supported. Any on-chain transaction must still be approved in the wallet.

## Telegram mobile demo

1. Start PostgreSQL and run `npm run db:migrate`, then start the API and Mini App with `npm run dev`.
2. Open the Mini App from Telegram (or the development browser session). **Home** shows how to connect a NEAR wallet and get started; wallet sign-in is required for personal features.
3. In **Profile → Safety**, create an unlock password once, choose policy pairs and limits, and sign the policy in the wallet. Enable agent notifications there if desired; the agent only monitors signed pairs and never submits transactions.
4. Open **Explore → Markets** to inspect live price context. Select a market's **Trade** or **Check route** action, or open **Swap** directly. Enter the amount, request a quote, then review output, route, fees, minimum output, expiry, addresses, and policy check.
5. For Intents, continue from the review to create executable deposit instructions in **Activity**. Review the exact amount, address, and memo, then approve the NEAR transfer in your wallet. Pocket Near submits the returned transaction hash to 1-Click when available and polls provider status while the swap is pending; only provider-reported `SUCCESS` means the swap completed. Rhea swaps are approved in the wallet and Pocket Near checks the returned NEAR transaction hash for final execution status. Share quote previews through the link handler; previews are not submitted and do not claim a fill.
6. **Activity** shows saved 1-Click swaps. **Explore** separates Markets, Earn, Apps & games, and Agents. Alerts, Rhea position monitoring, wallet settings, signed policy and emergency freeze are in **Profile**. `/status`, `/lock`, and `/unlock` remain the Telegram control plane; chat never collects passwords.

When opened in Telegram Web, the app reads verified `initData` from the Telegram WebApp bridge or Telegram launch parameters. A plain browser URL starts in public read-only mode; connect a NEAR wallet and sign the one-time login challenge to open personal features. Background alerts still require a Telegram-linked account.

### Verifying Intents swap deposits

In the Mini App, connect a NEAR wallet and open **Swap**. The supported NEAR token list puts tokens with available wallet balances first. Select a pair, enter an amount, and tap **Get live quote**. For the USDC (NEAR) → wNEAR (NEAR) example, enter `10`; the API converts it to the 6-decimal base-unit amount `10000000`. Also check the reverse wNEAR → USDC route with `0.1`, and USDC → USDT with `10`. The API checks the selected NEAR token balance before quoting and refreshes balances before starting; the form shows the NEAR gas reserve separately. The review shows expected output, minimum output, slippage, fees and expiry when provided. A quote is an estimate, not a guaranteed fill, and 1-Click may have no route for a pair or amount.

The swap list is limited to supported NEAR assets; deprecated or unsupported entries and confusing pool labels are omitted. A quote provider may still return no route for a supported pair and amount. That is a live provider result, not a completed swap; adjust the pair or amount and request a fresh quote.

To prepare an Intents swap, configure `ONE_CLICK_JWT` in the API environment and sign an active policy that allows the pair, amount, and destination. After reviewing the preview and passing the policy check, select **Continue to Activity**. The API rechecks the policy and requests a fresh executable quote. Review its updated amount and output before confirming. In Activity, review the deposit amount, output estimate, address, and memo before sending. For a NEAR-origin NEP-141 asset, the connected wallet signs a standard `ft_transfer` to the provider address with one yocto attached and includes the provider memo if supplied. Pocket Near submits the transaction hash returned by the wallet when available; the user is never asked to paste a hash. It polls saved 1-Click swap status while pending and stops at terminal status. If the wallet returns before a hash is available, Activity shows that it is waiting for wallet confirmation and retries detection. Manual refresh remains available. External-origin deposits are not supported by the current swap picker; automatic tracking requires a supported handoff or transaction information the app actually receives.

Policy time windows are evaluated in the signed window's IANA time zone, including overnight windows that continue into the following weekday. When editing a policy, Pocket Near preserves the signed days, time zone, and any additional windows not exposed by the current editor. Saving a new policy adds a separate policy; editing updates only the selected policy. Frozen policies remain visible but do not authorize swaps, and every saved policy remains until the user deletes it.

The adapter reads output from `quote.amountOut` (and `quote.amountOutFormatted` for display), minimum output from `quote.minAmountOut`, fees from `quote.refundFee` and `quote.withdrawFee`, and provider expiry from `quote.deadline` or other recognized expiry fields. A `dry: true` response normally omits `quote.deadline`; when the output amount is valid, the adapter assigns a client-derived 55-second preview expiry. This is not a settlement deadline. A recent successful dry quote may be returned as visibly stale cache only after a retryable live-provider failure. Executable quotes are never cached and cannot use stale previews.

## Deploying to Vercel

The root `vercel.json` defines two services: the Vite Mini App and the Express API. `/api/*` is routed to the API; all other paths are routed to the Mini App. The API service bundles the TypeScript app (including `@pocket-near/shared`) with esbuild into a single ESM file, `dist/app.mjs`, and `apps/bot/server.mjs` is the explicit `entrypoint` Vercel loads. The `.mjs` extension keeps the function ESM regardless of which `package.json` ends up next to it. The API initializes its idempotent schema on the first request in each serverless instance under a PostgreSQL advisory lock; tables have RLS enabled and are accessed by the server through its private PostgreSQL connection. The frontend uses same-origin `/api` requests in production, so do not set `VITE_API_URL` for Vercel deployments. The API's `PUBLIC_APP_URL` origin and Vercel's deployment URL are allowed by CORS; add any other custom frontend origins to `ALLOWED_ORIGINS`.

Configure these project environment variables in Vercel:

- `PUBLIC_APP_URL`: the HTTPS URL of the Mini App, including its custom domain if applicable.
- Connect the Supabase project to Vercel. The API uses the integration's `POSTGRES_URL` when present, and falls back to `DATABASE_URL` for local or legacy deployments. `SESSION_SECRET` must be a random value of at least 32 characters.
- `COOKIE_SECURE=true` and `NODE_ENV=production`.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_URL` (`${PUBLIC_APP_URL}/api/telegram/webhook`), and `TELEGRAM_WEBHOOK_SECRET` when enabling Telegram webhooks. On Vercel, the API registers the command menu and webhook handler on its serverless Express app; without both the bot token and webhook URL, chat commands cannot be served.
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
| `NEARAI_API_KEY` | Optional server-only key for NEAR AI Cloud thesis generation; never expose to the Mini App |

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
- Native rNEAR staking is a wallet-approved NEAR deposit to Rhea's `lst.rhealab.near` contract using Rhea's official SDK. The SDK checks token registration and includes the one-time registration call when needed. This is liquid staking, not an rNEAR/USDC pool; the currently indexed rNEAR pool is rNEAR/wNEAR. Rhea may not return a current APY value.
- Telegram `/prices` and `/alerts` commands; the session cookie uses `SameSite=None; Secure` for secure deployments and `SameSite=Lax` locally. Browser API calls include credentials.

## Current scope limits

- Intents swaps use a fresh executable quote and wallet-approved NEAR deposit. The current picker supports NEAR-origin assets only. Pocket Near can track a transaction only when it receives the host wallet's transaction hash or a supported wallet handoff; it cannot identify an unseen external-chain transaction.
- The app does not claim that a cached quote is live or eligible for execution. Rhea's pool swap quote and rNEAR staking transactions are also reviewed and submitted by the connected wallet.
- The portfolio summary reads unlocked native NEAR through public NEAR RPC. Separately, the swap form checks balances for supported NEAR-origin tokens before quoting and refreshes them before starting; it displays the required gas reserve. External-chain token balances are not checked, and chain/provider rejection remains a final safeguard.
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
- [Rhea rNEAR liquid staking guide](https://guide.rhea.finance/near-chain-guides/near-liquid-staking-tokens-lst)
- [Rhea rnear-sdk](https://github.com/rhea-finance/rnear-sdk)
- [Rhea pooling documentation](https://guide.rhea.finance/near-chain-guides/how-rhea-finance-works/pooling)
- [Intear balance API documentation](https://docs.intear.tech/api/reference/balances/)
- [Vercel Schedules](https://vercel.com/changelog/vercel-schedules-is-now-in-public-beta)
- [GitHub Actions scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
