---
name: MEXC API integration
description: Signing scheme, precision source, and endpoint quirks for MEXC spot REST API
---

## Signing

MEXC spot v3 uses a **single flat scheme** — easy compared to XT/BitMart:

```
signature = HMAC-SHA256(secret, querystringWithoutSignature).hex()
URL       = https://api.mexc.com{path}?{querystring}&signature={signature}
Header    = X-MEXC-APIKEY: <apiKey>
```

Key points:
- The signed string is the **query string**, for **every** verb (GET/POST/DELETE).
- Order params (symbol, side, type, timeInForce, price, quantity) go in the **query string**, NOT a JSON body. MEXC ignores JSON bodies on `/api/v3/order`.
- `timestamp` (ms) must be included in the signed string.

## Precision

`GET /api/v3/exchangeInfo?symbol=BTCUSDT` → `symbols[0]`.

**Caveat:** MEXC frequently does NOT return a `PRICE_FILTER` entry (BTCUSDT, SHIBUSDT, PEPEUSDT all returned only `PERCENT_PRICE_BY_SIDE`). So the tick-size path usually misses. Fall back to `quotePrecision`:

| Symbol | quotePrecision | price decimals |
|---|---|---|
| BTCUSDT | 2 | 2 |
| SHIBUSDT | 9 | 9 |
| PEPEUSDT | 9 | 9 |

## Endpoints used

- Order book: `GET /api/v3/depth?symbol=X&limit=N` → `{bids, asks}` as `[[price, qty], ...]`
- Place: `POST /api/v3/order` (query params) → `{orderId}`
- Cancel: `DELETE /api/v3/order?symbol=X&orderId=Y`
- Status: `GET /api/v3/order?symbol=X&orderId=Y` → `status`: NEW/PARTIALLY_FILLED=open, FILLED, CANCELED/EXPIRED/REJECTED
- Open orders: `GET /api/v3/openOrders?symbol=X`
- Balance: `GET /api/v3/account?omitZeroBalances=true` → `{balances:[{asset,free,locked}]}`
- Market: `GET /api/v3/ticker/24hr` (all symbols, no auth)

## Error codes

- `-2010` = insufficient balance → skip cycle, don't trip circuit breaker
- `-2013` = order does not exist → treat as unknown/canceled
- `-1013` = filter failure (too small / bad precision) → skip cycle
