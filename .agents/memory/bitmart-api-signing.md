---
name: BitMart API signing
description: Signing scheme, endpoints, and known quirks for BitMart authenticated REST API
---

## Signing format
`HMAC-SHA256(apiSecret, "${timestamp}#${memo}#${payload}")`
- `timestamp` = `Date.now()` (milliseconds)
- `memo` = empty string unless API key has a memo (env: `BITMART_MEMO`)
- GET payload = raw query string (e.g. `symbol=BTC_USDT&limit=10`), NOT URL-encoded
- POST payload = raw JSON body string
- Headers: `X-BM-KEY`, `X-BM-SIGN`, `X-BM-TIMESTAMP`, optionally `X-BM-MEMO`

## Key endpoints (current — as of June 2026)
- **Order book (public)**: `GET /spot/quotation/v3/books?symbol=BTC_USDT&limit=10`
  → `data.bids` = bids (desc), `data.asks` = asks (asc); each entry `[price, size]`
  ⚠️ Field names are `bids`/`asks` NOT `buys`/`sells` (docs were wrong)
- **Submit order**: `POST /spot/v2/submit_order` body `{symbol, side:"buy", type:"limit", price, size}`
  → `data.order_id`
- **Cancel order**: `POST /spot/v3/cancel_order` body `{symbol, order_id}` — **symbol required**
- **Order status**: `POST /spot/v4/query/order` body `{orderId}` (camelCase)
  → `data.state`: `"new"|"partially_filled"` = open; `"filled"` = filled; `"canceled"|"partially_canceled"` = canceled
  → `code 50005` = order not found (treat as unknown/closed)
  ⚠️ Old endpoint `GET /spot/v2/order_detail` is DEPRECATED (code=30031)
- **Open orders**: `POST /spot/v4/query/open-orders` body `{orderMode:"spot", bizType:"spot"}`
  → array of `{orderId, side, state, symbol, price, size, ...}` (all camelCase)
- **Balance**: `GET /account/v1/wallet` → `data.wallet` array of `{id, available, frozen}`
  → `id` field is the asset name (not `currency`)
- **Symbol info (public)**: `GET /spot/v1/symbols/details` → field `price_max_precision` for decimal places

## Error codes
- `30002` = missing API key header (no credentials)
- `30031` = endpoint deprecated — must migrate to newer version
- `50005` = orderId not found / no data (treat as order not found)
- `50008` = order not found / already canceled (safe to swallow)
- `50032` = order does not exist

**Why:** BitMart requires symbol in cancel (unlike Kraken/XT). Open orders v4 uses camelCase `orderId`. Balance uses asset `id` field not `currency`. Order detail migrated from v2 (status int) to v4 (state string).

**How to apply:** Always pass `this.config.pair` to `cancelOrder`. In `getOrder`, use `/spot/v4/query/order` POST with camelCase `orderId` and map string `state` field. In orderbook, read `data.bids`/`data.asks` (not `buys`/`sells`).
