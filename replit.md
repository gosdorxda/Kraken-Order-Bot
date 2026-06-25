# KRKN.BOT

Kraken top-of-book buy bot with real-time web dashboard. Automatically stays at the top of the buy order book on Kraken, cancels and re-places orders when outbid, with configurable max bid price and order size.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/kraken-bot run dev` — run the frontend dashboard (port 19887)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `KRAKEN_API_KEY`, `KRAKEN_API_SECRET` — Kraken API credentials
- Required env (BitMart): `BITMART_API_KEY`, `BITMART_API_SECRET` — wajib untuk menjalankan BitMart bot; `BITMART_MEMO` opsional (kosong jika API key tidak punya memo)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Frontend: React + Vite + Tailwind CSS + shadcn/ui
- Kraken: `kraken-api` npm package (REST API)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `artifacts/api-server/src/lib/krakenBot.ts` — Bot engine singleton (Kraken API + bot logic)
- `artifacts/api-server/src/routes/bot.ts` — Bot control routes
- `artifacts/api-server/src/routes/account.ts` — Account balance routes
- `artifacts/kraken-bot/src/` — React frontend dashboard

## Architecture decisions

- Bot state is held in-memory as a singleton (`krakenBot`). Config and logs reset on server restart. No DB needed for the bot itself.
- Bot polls the order book every `checkIntervalMs` (default 3000ms). On each cycle: checks if our order is still open and still at top bid. If outbid and target price ≤ maxBidPrice, cancel + re-place 1 tick higher.
- Kraken pair format uses Kraken's internal naming: `XXBTZUSD` (BTC/USD), `XETHZUSD` (ETH/USD), `SOLUSD` (SOL/USD).
- `kraken-api` package has no TypeScript types — manual `.d.ts` added at `artifacts/api-server/src/types/kraken-api.d.ts`.
- Frontend polls bot status every 2s and order book every 2s via React Query `refetchInterval`.

## Product

- **Dashboard** (`/`): Real-time bot status, current active order position (AT TOP / OUTBID / NO ORDER), live order book (top 10 bids + asks), account balances, and color-coded activity log.
- **Settings** (`/settings`): Configure trading pair, order size, max bid price, tick size, check interval. Start/stop bot.

## User preferences

- UI in Indonesian language (labels, toasts, dialogs)
- Bot list layout preferred over grid cards
- Top navbar preferred over sidebar

## Roadmap

- **Multi-exchange support** (planned): same top-of-book buy bot strategy, but extended to other exchanges beyond Kraken (e.g. Indodax, Binance, OKX, etc.). Each exchange will have its own adapter/client, but share the same `BotManager` + polling + rate-limiter architecture. When adding a new exchange: create an exchange adapter interface so `KrakenBot` logic can be reused with a different API client underneath.

## Gotchas

- Kraken pair names use their internal format (e.g., `XXBTZUSD` not `XBT/USD`). Common pairs: `XXBTZUSD`, `XETHZUSD`, `SOLUSD`, `ADAUSD`.
- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `openapi.yaml`.
- The `kraken-api` package resolves Promises (not callbacks) when called as `client.api(method, params)`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
