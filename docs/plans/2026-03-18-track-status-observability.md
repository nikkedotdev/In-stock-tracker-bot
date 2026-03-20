# Track Status Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add diagnostic fields to `tracks` so `UNKNOWN` and `ERROR` rows explain why they are in that state without changing the current bot structure.

**Architecture:** Keep the existing `status` enum and transition flow, then layer three nullable diagnostic fields onto `tracks`: `last_http_status`, `last_error_kind`, and `state_reason`. Update insert, preview, fetch, scheduler, and list formatting paths so successful but unclassified pages, pending variant rows, and fetch failures each map to clear reasons.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vitest

---

### Task 1: Add schema support for diagnostics

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrations.ts`
- Test: `tests/helpers/mockD1.ts`
- Test: `tests/repos.spec.ts`

**Step 1: Write the failing test**

Add repository/migration coverage proving `tracks` can store:

- `last_http_status`
- `last_error_kind`
- `state_reason`

Update the mock D1 row shape in `tests/helpers/mockD1.ts` and add or extend a repository test in `tests/repos.spec.ts` that writes and reads these fields through `updateAfterCheck`.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/repos.spec.ts
```

Expected: FAIL because the mock row shape and schema support do not include the new fields yet.

**Step 3: Write minimal implementation**

Update `src/db/schema.sql` and `src/db/migrations.ts` so the new nullable columns exist for fresh databases and are added to existing ones if missing.

Update `tests/helpers/mockD1.ts` so mocked track rows carry the new nullable fields.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/repos.spec.ts
```

Expected: PASS.

### Task 2: Extend types and fetch error reporting

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/errors.ts`
- Modify: `src/checker/fetcher.ts`
- Test: `tests/index.spec.ts`

**Step 1: Write the failing test**

Add a test covering fetch failure classification:

- HTTP failures expose status code
- timeouts/network failures map to error kinds without HTTP code

If there is no focused fetcher test file yet, create one under `tests/` for the fetcher behavior.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/index.spec.ts
```

or the new fetcher test file if created.

Expected: FAIL because the fetch path does not yet return enough detail.

**Step 3: Write minimal implementation**

Add diagnostic types to `src/core/types.ts`.

Update `src/checker/fetcher.ts` and `src/core/errors.ts` so failed fetches preserve:

- HTTP status when present
- a normalized error kind
- any challenge-related hint available from response headers/body

Do not change the outer bot structure.

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm PASS.

### Task 3: Map runtime states into diagnostic fields

**Files:**
- Modify: `src/bot/handlers.ts`
- Modify: `src/checker/scheduler.ts`
- Modify: `src/checker/transitions.ts`
- Modify: `src/profiles/index.ts`
- Test: `tests/bot-variant.spec.ts`
- Test: `tests/transitions.spec.ts`

**Step 1: Write the failing tests**

Add or extend tests for:

- tracks waiting on variant selection get `state_reason=PENDING_VARIANT`
- successful but unclassified parses get `UNSUPPORTED_SITE` or `UNCLASSIFIED_HTML`
- HTTP `429` maps to `RATE_LIMITED`
- HTTP `403` with challenge evidence maps to `CLOUDFLARE_CHALLENGE`

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/bot-variant.spec.ts tests/transitions.spec.ts
```

Expected: FAIL because these fields are not populated yet.

**Step 3: Write minimal implementation**

Update:

- `src/bot/handlers.ts` to set `PENDING_VARIANT` for parked multi-variant rows
- `src/profiles/index.ts` or related parsing path to identify unsupported hosts
- `src/checker/scheduler.ts` to clear diagnostics on classified success and set detailed reasons on failure
- `src/checker/transitions.ts` only as needed to accept the new patch fields without changing stock semantics

**Step 4: Run tests to verify they pass**

Run the same targeted test command and confirm PASS.

### Task 4: Surface diagnostics in list output

**Files:**
- Modify: `src/bot/formatter.ts`
- Modify: `src/bot/labels.ts` if needed
- Test: `tests/bot-list.spec.ts`
- Test: `tests/bot-labels.spec.ts`

**Step 1: Write the failing test**

Add list-formatting expectations for rows such as:

- `UNKNOWN (pending variant)`
- `UNKNOWN (unsupported site)`
- `ERROR (403 cloudflare challenge)`
- `ERROR (429 rate limited)`

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/bot-list.spec.ts tests/bot-labels.spec.ts
```

Expected: FAIL because formatter output does not include diagnostic detail yet.

**Step 3: Write minimal implementation**

Update list formatting to append short human-readable reason text only when helpful.

Keep the current layout compact.

**Step 4: Run test to verify it passes**

Run the same targeted test command and confirm PASS.

### Task 5: Verify end-to-end behavior

**Files:**
- Modify: none unless issues are found
- Test: `tests/parser.spec.ts`
- Test: `tests/normaliser.spec.ts`
- Test: `tests/repos.spec.ts`
- Test: `tests/bot-list.spec.ts`
- Test: `tests/bot-variant.spec.ts`
- Test: `tests/transitions.spec.ts`

**Step 1: Run focused regression tests**

Run:

```bash
npm test -- tests/parser.spec.ts tests/normaliser.spec.ts tests/repos.spec.ts tests/bot-list.spec.ts tests/bot-variant.spec.ts tests/transitions.spec.ts
```

Expected: PASS.

**Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

**Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

### Task 6: Commit

**Files:**
- Add/modify all files touched above

**Step 1: Review changes**

Run:

```bash
git diff -- src tests docs/plans
```

Expected: Only the diagnostic status work and associated docs are included.

**Step 2: Commit**

Run:

```bash
git add src tests docs/plans
git commit -m "feat: add track status diagnostics"
```

Expected: Commit created with the implementation and plan docs.
