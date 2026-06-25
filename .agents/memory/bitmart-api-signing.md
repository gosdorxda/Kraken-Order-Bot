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

## Key endpoints
- **Order book (public)**: `GET /spot/quotation/v3/books?symbol=BTC_USDT&limit=10`
  → `data.buys` = bids (desc), `data.sells` = asks (asc); each entry `[price, size, timestamp]`
- **Submit order**: `POST /spot/v2/submit_order` body `{symbol, side:"buy", type:"limit", price, size}`
  → `data.order_id`
- **Cancel order**: `POST /spot/v3/cancel_order` body `{symbol, order_id}` — **symbol required**
- **Order status**: `GET /spot/v2/order_detail?order_id=XXX`
  → `data.status`: 1=new, 2=canceled, 3=partial, 4=filled, 5=partial-canceled
- **Open orders**: `GET /spot/v4/query/open-orders?symbol=BTC_USDT&orderMode=spot`
  → array of `{orderId, side, state, ...}` (camelCase `orderId` not `order_id`)
- **Balance**: `GET /account/v1/wallet` → `data.wallet` array of `{id, available, frozen}`
- **Symbol info (public)**: `GET /spot/v1/symbols/details` → field `price_max_precision` for decimal places

## Error codes
- `30002` = missing API key header (no credentials)
- `50008` = order not found / already canceled (safe to swallow)

**Why:** BitMart requires symbol in cancel (unlike Kraken/XT). Open orders v4 uses camelCase `orderId`. Balance uses asset `id` field not `currency`.

**How to apply:** Always pass `this.config.pair` to `cancelOrder`. In `cancelAllOpenBuyOrders`, check both `orderId` and `order_id` field names from v4 response.
