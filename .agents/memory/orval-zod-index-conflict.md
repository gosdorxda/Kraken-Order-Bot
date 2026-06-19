---
name: Orval Zod index.ts naming conflict
description: How to prevent duplicate export names when using orval with the zod client in mode:split
---

## The rule
Do NOT use `schemas: { path: "generated/types", type: "typescript" }` in the orval zod client config. It generates TypeScript types with the same names as the Zod schemas (e.g. `GetBotLogsParams`), causing `TS2308: already exported` errors.

**Why:** Orval's `mode: "split"` zod client generates both Zod validators in `generated/api.ts` AND TypeScript types in `generated/types/`. Their generated `index.ts` re-exports both, creating name collisions. The TypeScript types are redundant — use `z.infer<typeof Schema>` to derive types from the Zod schemas instead.

**How to apply:**
1. Keep `schemas` option removed from the `zod` output config in `lib/api-spec/orval.config.ts`
2. After any codegen run that regenerates `lib/api-zod/src/index.ts`, ensure it only contains `export * from "./generated/api";`
3. If `index.ts` gets stale types content, overwrite it manually and re-run codegen
