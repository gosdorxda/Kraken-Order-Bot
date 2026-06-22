---
name: XT.com API signing and endpoint formats
description: sapi.xt.com validate-* signing for ALL endpoints; exact URL formats for order CRUD
---

## Rule
XT.com's `sapi.xt.com` — use **validate-* headers** (new scheme) for ALL endpoints including orders.
Old X-XT-* headers return AUTH_001 on order endpoints and are effectively deprecated.

**validate-* signing format:**
- Headers: `validate-appkey`, `validate-timestamp`, `validate-signature`, `validate-algorithms=HmacSHA256`, `validate-recvwindow=5000`
- Signature input: `validate-algorithms=HmacSHA256&validate-appkey={key}&validate-recvwindow=5000&validate-timestamp={ts}#METHOD#/path[#sortedQuery][#body]`
- HMAC-SHA256 over that string using the API secret

## Endpoint formats (confirmed from official docs)

| Operation | Method | URL | Notes |
|-----------|--------|-----|-------|
| Place order | POST | `/v4/order` | body JSON; `price` and `quantity` must be **numbers** (not strings) |
| Get order | GET | `/v4/order/{orderId}` | path param, NOT query param |
| Cancel order | DELETE | `/v4/order/{orderId}` | path param, NOT query param |
| List open orders | GET | `/v4/order?state=NEW&symbol=X` | query params; `/v4/order/open-orders` returns "Type mismatch" |
| Balances | GET | `/v4/balances` | plural, no params |

## placeOrder required body fields
`symbol`, `side`, `type`, `timeInForce`, `bizType: "SPOT"`, `price` (number), `quantity` (number)

## openapiEnabled flag
Some pairs have `openapiEnabled: false` (e.g. mindfak_usdt, bdtc_usdt) — XT blocks them from API trading entirely. Placing an order returns ORDER_008 or SYMBOL_005. Bot now catches these and stops immediately with a clear message.

## Why
- Old X-XT-* scheme → AUTH_001 on all order endpoints
- price/quantity as strings → ORDER_008 (type mismatch in Spring Boot)
- `/v4/order?orderId=X` → works for listing but `/v4/order/{orderId}` is the correct single-order endpoint per docs

## How to apply
- All XT API calls → use `requestAccount()` / `rawRequestAccount()` (validate-* scheme)
- Never use `request()` / `rawRequest()` (old X-XT-* scheme) for XT orders
