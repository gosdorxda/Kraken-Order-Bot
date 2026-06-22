---
name: Startup order deduplication
description: How to prevent duplicate Kraken orders during rolling restarts / redeploys
---

## Rule
`cancelAllOpenBuyOrders(pairs)` in krakenBot.ts must be called ONCE centrally in
`BotManager.initialize()` BEFORE any bot is started. Do NOT rely on per-bot
`cancelStaleOpenOrders()` inside `KrakenBot.start()`.

**Why:** During rolling restarts or Replit deployments, two server instances overlap
briefly. If each bot independently calls OpenOrders → cancel → place, both instances
read an empty order book simultaneously and each places its own order, producing 2×
(or 3×) duplicate open orders on Kraken.

**How to apply:** Any time KrakenBot.start() is auto-called at startup (i.e. from
BotManager), ensure cancelAllOpenBuyOrders has already run for all pairs. For manually
user-triggered starts (POST /bots/:id/start), no centralized cancel needed — the user
is intentionally starting, and there shouldn't be a parallel instance race.
