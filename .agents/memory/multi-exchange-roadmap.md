---
name: Multi-exchange roadmap
description: Future plan to support exchanges beyond Kraken with the same bot strategy
---

## The plan

User wants to expand the bot to **other exchanges** (beyond Kraken) using the **identical top-of-book buy strategy**:
- Stay at top of buy order book
- Cancel + re-place when outbid
- Configurable max bid price, tick size, order size, check interval

## Architecture recommendation when the time comes

Current `KrakenBot` class bundles both the **exchange client** (Kraken-specific API calls) and the **bot logic** (polling loop, state machine). To support multiple exchanges cleanly:

1. Extract an `ExchangeAdapter` interface covering the methods `KrakenBot` uses:
   - `fetchOrderBook(pair)` → `{ bids, asks }`
   - `fetchBalance()` → `Record<string, string>`
   - `placeOrder(pair, price, volume)` → `orderId`
   - `cancelOrder(orderId)` → `void`
   - `checkOrderOpen(orderId)` → `{ isOpen }`

2. `KrakenAdapter` implements `ExchangeAdapter` (wraps `kraken-api` + rate limiter)

3. `BotCore` contains the polling loop / state machine, takes any `ExchangeAdapter`

4. `BotManager` maps `exchangeId:pairId` → `BotCore` instance

5. Dashboard needs an `exchange` field on each bot config + a selector in the Add Bot dialog

**Why:** Avoids duplicating the polling/state logic per exchange; only the adapter layer changes per exchange.

## Notes

- Each exchange will need its own rate limiter instance (different limits)
- Pair naming conventions differ per exchange (Kraken uses `XXBTZUSD`, Binance uses `BTCUSDT`, etc.) — the adapter layer handles normalization
- Auth credentials per exchange should each be stored as separate Replit secrets
