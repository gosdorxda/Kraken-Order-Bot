---
name: XT.com API signing — two different schemes
description: sapi.xt.com uses two different auth schemes depending on the endpoint; balance uses validate-* headers with a different signing format
---

## Rule
XT.com's `sapi.xt.com` has two distinct signing/header schemes:

**Old scheme (X-XT-* headers)** — used by spot trading order endpoints:
- Headers: `X-XT-APIKEY`, `X-XT-TIMESTAMP`, `X-XT-SIGN`
- Signature message: `request_time={ts}` or `request_time={ts}&{sorted_params}`

**New scheme (validate-* headers)** — used by balance + account endpoints:
- Headers: `validate-appkey`, `validate-timestamp`, `validate-signature`, `validate-algorithms`, `validate-recvwindow`
- Signature message: `validate-algorithms=HmacSHA256&validate-appkey={key}&validate-recvwindow=5000&validate-timestamp={ts}#METHOD#/path[#query][#body]`

## Balance endpoint
- URL: `https://sapi.xt.com/v4/balances` (plural, no params needed)
- Returns: `result.assets[]` with `currency`, `availableAmount`, `frozenAmount`
- Uses: new validate-* signing scheme

## Why
- `/v4/user/balance` → "API not found" on sapi.xt.com (wrong path)
- `api.xt.com/v4/user/balance` → Spring Boot 404 (wrong base URL)
- `/v4/balance` (singular) → requires `currency` param
- `/v4/balances` (plural) → returns all balances ✓

## How to apply
- All order CRUD (placeOrder, cancelOrder, getOrder, getOpenOrders) → use `rawRequest` (old X-XT-* scheme)
- Balance fetch → use `rawRequestAccount` (new validate-* scheme)
