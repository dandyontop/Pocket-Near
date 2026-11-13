# Pocket Near — thesis and evidence

## Product thesis

Pocket Near can make cross-chain NEAR Intents swaps easier to review without taking custody: users set a signed policy, inspect a live 1Click quote, and authorize any on-chain transaction with their own wallet. Its usefulness depends on safe completion, understandable controls, and repeat usage—not on unverified volume or token-price claims.

This is a product thesis, not investment advice or a claim that Pocket Near has already achieved adoption.

## Evidence in favor

- **The wallet remains the transaction authority.** The Mini App calls the connected wallet's `signAndSendTransaction` for Rhea swaps and NEAR-origin Intents deposits in [wallet.ts](./apps/mini-app/src/lib/wallet.ts). For other Intents origin chains, the app provides deposit instructions; the user performs the transfer with that chain's wallet.
- **The Intents path has a policy check and a live execution step.** The server prepares a fresh executable 1Click quote with `dry: false`, verifies the account and active policy, saves the quote for the user, and records the deposit hash and provider status in [app.ts](./apps/bot/src/app.ts). The server does not hold a wallet signer.
- **Claims can be checked against upstream records.** The public Explorer overview uses the authenticated Explorer API and reports its rolling window, source, update time, and partial-coverage flag. Flywheel attribution requires an exact match to a saved deposit address and memo, and counts only matching `SUCCESS` rows toward Pocket Near volume.
- **The product has a reproducible build.** After installing the locked dependencies with `npm ci`, `npm run build` builds the shared package, API, and Mini App.

These are implementation facts. They do not prove that the service is deployed correctly, users complete swaps, or the feature improves retention.

## Evidence against and material limitations

- **No production swap has been verified here.** No small mainnet swap, production 1Click response, submitted deposit, or final provider `SUCCESS` status was observed during this work. A user must perform the live proof; no funds were sent by the development process.
- **Policy is not an on-chain restriction.** The server checks signed policy data before preparing the app's quote flow. The UI explicitly says that this does not constrain a user who bypasses Pocket Near and calls a contract directly.
- **Explorer coverage can be incomplete.** Each Explorer refresh is capped at two pages of 1,000 transactions. A `partial` result is not full-window coverage. Pocket Near attribution also depends on saved swap records and exact address/memo matching; unmatched activity is not counted.
- **Hourly snapshots are rolling 24-hour aggregates, not raw history.** The worker stores aggregate volume, counts, statuses, pairs, and source-chain totals only. It does not preserve Explorer transaction rows, addresses, memos, or transaction hashes in those snapshots. Funnel statuses can change after the snapshot.
- **The repeated-size detector is weak by design.** It flags only repeated pair-and-amount bursts in the matched sample. It cannot identify a sender, funding source, ownership cluster, or net position; it does not prove bot or wash activity and excludes no volume. A zero flag count is not evidence that all activity is organic.
- **The 10× view is a hypothetical scenario.** Its output depends on a user-entered NEAR conversion share, multiplier, and live NEAR price. It is not observed NEAR buying demand.
- **DefiLlama comparisons are not directly comparable.** Its NEAR Intents data spans the network and all integrators, not Pocket Near. Protocol fee and volume adapter scopes differ; references are omitted when either live value is missing.
- **AI is not an attestation or transaction feature.** The thesis report is validated JSON or a labeled rules-only fallback. The application does not verify model attestation and does not use AI to sign, authorize, or submit transactions. The configured NEAR AI key and its credit have not been tested here.
- **No static CSV example is committed.** A truthful Pocket Near-attributed sample requires the deployed Explorer credential, saved deposit records, and a successful hourly worker run. No sample values have been fabricated.
- **Solver Relay was not integrated or tested.** The planned read-only test needs a Relay API key. No such credential was used or sent to a third party in this development environment; the Relay remains out of the product.

## What would strengthen or weaken the thesis

1. The owner configures server-only `ONE_CLICK_JWT`, `EXPLORER_JWT`, and `NEARAI_API_KEY` values in the deployment environment; secrets are never committed or placed in the Mini App.
2. The production database migration completes and the existing hourly worker writes a fresh rolling-24-hour snapshot. The owner checks that its `partial` flag and timestamp are shown honestly.
3. The owner makes one small mainnet swap, verifies the wallet transaction, and confirms that 1Click reports the expected final status. This is the first evidence of an end-to-end live flow, not evidence of general adoption.
4. With consent and privacy-preserving measurement, observe whether users can understand policy limits, complete a swap, and return. Do not equate network-wide Intents volume with Pocket Near usage.
5. If the measured flow repeatedly fails, users do not return, or exact deposit matches cannot be reliably reconciled, revise or reject the product thesis.

## Rebuild and source references

- Rebuild: `npm ci` followed by `npm run build` from the repository root.
- Explorer contract and documented pagination: [NEAR Intents Explorer OpenAPI](https://explorer.near-intents.org/api/v0/openapi.yaml).
- DefiLlama data used for peer context: [NEAR Intents fees](https://api.llama.fi/summary/fees/near-intents?dataType=dailyFees) and [NEAR Intents volume](https://api.llama.fi/summary/dexs/near-intents?dataType=dailyVolume).
- Hackathon rules: [HACKATHON.md](https://nearhackathon.com/HACKATHON.md).
- Build, configuration, methodology, and deployment notes: [README.md](./README.md).
