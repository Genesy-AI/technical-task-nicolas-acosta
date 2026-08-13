# TinyEnginy — Codebase Improvements & Technical Roadmap

Findings from working on the CSV import and email verification bugs. Each item states the problem observed in the current code, the proposal, and why it's worth doing. Ordered into Now / Next / Later at the end.

---

## Frontend

### 1. Warnings, not just errors, on CSV import

**Problem.** The import preview only knows two states: a row is `isValid` or it isn't ([csvParser.ts](frontend/src/utils/csvParser.ts) — `errors: string[]` and nothing else). Anything that is neither fatal nor perfect is silently swallowed:

- An invalid country code is dropped and the lead imports without a country — the user is never told.
- The sample files ship `yearsInRole` and `phoneNumber` columns that the parser's `switch` has no case for. They are discarded without a word.
- The preview table has no Country column at all, so even a correct value can't be eyeballed before import.

**Proposal.** Add a `warnings: string[]` tier to `CsvLead`, separate from `errors`, that does *not* block the row. Surface it in `CsvImportModal` as a fifth summary tile ("Imported with warnings") and as amber text in the per-row Issues column. Add an explicit "unmapped columns: X, Y" warning at file level.

**Why.** The reported country-code bug was really an *observability* bug: bad data went in silently and only surfaced days later in the leads table. A warning tier turns the same class of problem into something the user catches at import time.

### 2. Real progress feedback for long-running enrichment

**Problem.** `POST /leads/verify-emails` holds the HTTP request open until every workflow finishes, and the UI shows nothing until it resolves — no spinner on the affected rows, no partial results, no cancel. With the sequential loop this was indistinguishable from a hang; with `Promise.all` it's faster but still a single opaque wait. The import flow has the same shape: one "Importing..." button state for the whole batch.

**Proposal.** Stop coupling request duration to workflow duration. Return the started workflow IDs immediately, persist a per-lead enrichment status (`pending | running | done | failed`), and let the frontend poll (`refetchInterval` while anything is pending) or subscribe. Render status per row rather than as a single toast.

**Why.** This is the pattern every future enrichment needs — phone enrichment (3 sequential providers with retries) will be slower than email verification, so the current model doesn't survive the next feature.

### 3. Break up `LeadsList` and make the columns data-driven

**Problem.** [LeadsList.tsx](frontend/src/components/LeadsList.tsx) is 334 lines holding data fetching, selection state, three mutations, dropdown UI, the full table markup, date formatting and two modals. Columns are hardcoded JSX, and the message-template fields are a hardcoded array in a second file ([MessageTemplateModal.tsx:109](frontend/src/components/MessageTemplateModal.tsx:109)).

**Proposal.** Extract `useLeadSelection` (selection state), `LeadsTable` / `LeadRow` (presentation), `EnrichMenu` (actions), and — most importantly — define the lead fields **once as a data structure** (key, label, formatter) that drives the table columns, the CSV parser mapping, and the template field chips.

**Why.** The README says the field list will keep growing. Today adding one field means editing six-plus places: Prisma schema, migration, backend create, API type, CSV parser `switch`, table JSX, template field array. A single field registry makes it one place plus a migration. This is the concrete payoff of applying SRP here — not abstraction for its own sake.

---

## Backend

### 4. Thin the endpoints out: controller → service → repository

**Problem.** [index.ts](backend/src/index.ts) is 327 lines with every route, all business logic, and seven copy-pasted `try/catch` blocks that each re-derive the same `500` response shape. There is no error middleware, no router split, and CORS is hand-rolled with `Access-Control-Allow-Origin: *`.

**Proposal.** Routes declare HTTP concerns only (parse, validate, status codes). Services own business rules (dedupe policy, enrichment orchestration, message generation). Prisma *is* the repository — no hand-written repository wrapper on top of it, that would be a layer with no content. Add one error-handling middleware so handlers can throw and stop repeating themselves.

**Why.** Every new endpoint currently starts by copy-pasting ~15 lines of boilerplate, and none of the business logic is testable without an HTTP server — which is why the only backend tests today cover the one pure function that happens to live outside `index.ts`.

### 5. Separate validation, normalization and persistence

**Problem.** `POST /leads/bulk` does, in a single block: shape validation, a dedupe query, trimming/normalization, a `create` per lead inside a loop, and error accumulation. Validation is ad-hoc boolean chains (`lead.firstName && typeof lead.firstName === 'string' && lead.firstName.trim()`), and normalization is inline `.trim()` calls scattered through the `data` object.

**Proposal.** A zod schema at the boundary parses and rejects; normalizers are pure named functions (the country-code fix already introduced one — `normalizeCountryCode`); persistence is a batch insert in a transaction rather than N sequential `create` calls.

**Why.** Three different concerns currently fail as one. It also fixes a real performance issue: importing 500 leads is 500 round-trips.

### 6. Temporal usage: connection, worker lifecycle, and concurrency

**Problem.** Three separate issues in the same handler:

- A new `Connection.connect()` is opened and closed on **every request** ([index.ts:276](backend/src/index.ts:276)) instead of one long-lived client.
- The worker is booted inside the API process ([index.ts:320](backend/src/index.ts:320)), so an API restart kills in-flight workflow processing and the two can't scale independently.
- The verification loop awaited each workflow sequentially. **Fixed** — now `Promise.all`, so leads fan out and Temporal's worker concurrency (40 workflow tasks / 100 activity tasks by default) actually gets used. Measured: 3 slow leads went from ~18s to 6.06s, the same wall time as a single lead.

**Proposal.** Singleton Temporal client created at boot; worker as its own process (`pnpm worker`); keep the fan-out but add a concurrency limiter once batch sizes grow past a few hundred. For phone enrichment, use the built-in `maxActivitiesPerSecond` / `maxTaskQueueActivitiesPerSecond` worker options for provider rate limits instead of a bespoke queue.

**Why.** Per-request connections are pure latency and leak on error paths; the shared process makes deploys destructive.

---

## Cross-cutting

### 7. Monorepo

**Problem.** `frontend/` and `backend/` are two unrelated pnpm projects with duplicated tooling (two prettier configs, two vitest configs, two tsconfigs, ESLint in the frontend only). Nothing type-checks the seam between them.

**Proposal.** pnpm workspace + Turborepo, one lint/format/test/build pipeline, shared base tsconfig.

### 8. `packages/shared` as the single source of truth

**Problem.** The API contract is hand-mirrored: nine files under `frontend/src/api/types/leads/` restate the backend's responses with nothing enforcing they match. It has already drifted — `emailVerified` was added to `LeadsGetManyOutput` but not to the optimistic object in [useApiMutation.ts:64](frontend/src/api/mutations/useApiMutation.ts:64), and `pnpm exec tsc` fails on `main` today because of it. The country-code normalizer now exists twice, once per package, for the same reason.

**Proposal.** A shared package exporting: zod schemas (used for runtime validation in the backend, and as the source of inferred types in the frontend via `z.infer`), the Prisma-generated model types, and shared normalizers/validators. Delete the hand-written type mirrors.

**Why.** This is the highest-leverage item on the list: it removes a whole category of silent drift, and it is what makes item 3's field registry shareable between the CSV parser, the table and the API.

---

## Suggested sequencing

| When | Items | Rationale |
|---|---|---|
| **Now** | 7 + 8 (monorepo + shared package), 4 (backend layering) | Everything else is cheaper afterwards, and 8 fixes a type error that exists today. |
| **Next** | 5 (zod + batch insert), 3 (field registry + component split), 1 (warnings) | These are what make "the field list will keep growing" sustainable. |
| **Later** | 2 (async enrichment + polling), 6 (worker process split, rate limits) | Blocked on nothing, but only pays off once more enrichment providers exist. |
