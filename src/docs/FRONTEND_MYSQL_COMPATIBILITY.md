# Frontend MySQL API compatibility

Implemented against the supplied API contracts. No deployment, service restart,
production category edit, or database write was performed. HTTP cutover is still
pending according to the supplied backend documents.

## Files changed

- `api/financesApi.ts`: canonical ID validation, separate numeric identity,
  nullable enrichment, numeric reset with response-body/409 checks, common 503
  handling, and preservation of saved report label whitespace.
- `types/finance.ts`: additive identity/enrichment fields and nullable categories.
- `components/TransactionCategorySelect.tsx`: backend-returned display names,
  merchant/parent display, numeric-ID reset option, awaited refresh after writes,
  and a distinct error if a save succeeds but refresh fails.
- `components/JsonStatements.tsx`: canonical keys, numeric IDs passed separately,
  NULL-aware enrichment lookup, selected-statement refresh, and import notice.
- `components/VerifiedStatementsPage.tsx`: refresh statements containing the edited
  transaction (including the selected statement), replace complete response data,
  update derived totals, disclose import gaps and temporary errors.
- `components/OverviewPage.tsx`: canonical keys, merchant display, import notice,
  and temporary error details. Download retains the complete response JSON.
- `components/TransactionsPanel.tsx`: display returned merchant/category/parent.
- `components/MonthlyIncome.tsx`: allow NULL category display without changing
  income calculations.
- `components/verifiedStatementData.ts`: remove optimistic category replacement;
  exclude import-gap months from complete-month category averages.
- `components/ImportStatusNotice.tsx`: shared optional import-status notice.
- `App.css`: transaction enrichment text styling.
- `tests/mysql-api.test.cjs`: isolated API/editor/rendering regression tests.
- `docs/MYSQL_READ_MIGRATION_PLAN.md`, `docs/MYSQL_CUTOVER_CHECKLIST.md`: supplied
  backend context, copied without modification. The supplied checklist copies
  were identical.
- `docs/FRONTEND_MYSQL_COMPATIBILITY.md`: this implementation report.

## Validation

From the repository root:

```sh
node --test src/tests/mysql-api.test.cjs
```

Nine tests passed. Coverage includes canonical POST identity, rejection of numeric
canonical IDs and NULL POST categories, numeric PATCH/reset and HTTP 200 failure
bodies, 409/503 errors, actual editor save/reset handlers awaiting refresh,
parent-field replacement and recalculated totals, refresh failure reporting,
canonical-only reset omission, NULL enrichment and pre-cutover responses,
import-gap notice rendering and retained nested archive evidence, unchanged
numeric/filename PDF routes, signed saved-report values/labels/source references,
and the expense report's parent-name fallback.

TypeScript (`tsc --noEmit -p tsconfig.app.json`), ESLint on all changed TypeScript
files, and `git diff --check` passed. Tests mock HTTP and editor hooks and use
server rendering for notices; they are not live cutover or browser smoke tests.
No dependencies were added.

## Missing backend capability and rollout

The reset contract requires a numeric database transaction ID. The editor offers
“Use merchant default” only when its transaction supplies a positive numeric
`id`; it never derives that ID from the canonical string. Screens whose statement
transactions have only canonical IDs cannot reset. Supporting reset there needs
an additive numeric ID in the statement response or an explicitly documented
canonical reset endpoint. POST with NULL is never used.

The numeric reset adapter is intended for the MySQL-backed API. The supplied
checklist says the legacy PATCH has different semantics; reset must be smoke
validated against the candidate API at cutover. No existing numeric-only route
was replaced with a canonical route. Additive fields and import_status remain
optional for compatibility with existing reads.

## User-visible behavior

- Backend-returned merchant and effective category/parent names are displayed;
  NULL is retained and no matching or classification runs in the frontend.
- Category saves wait for authoritative statement refresh; parent IDs/names are
  replaced together and totals recalculate from those responses.
- Eligible numeric-ID transactions offer the merchant-default reset action.
- Incomplete statements show “Some statement data is awaiting import.” Archive
  amounts remain visible; incomplete category months do not count as complete
  zero-spend months in averages.
- Temporary database/evidence failures suggest retrying.
- Saved reports retain saved classification and values. Existing PDF routes,
  financial amount signs, HTTP expense semantics and parent fallback remain.

## Overview follow-up: relational loading

Overview now uses GET /statements for month discovery and GET
/statements/{numeric_id}/transactions only for statements closing in the selected
month, with up to four concurrent requests. Changing months cancels pending reads.
It no longer requests archive listings or verified JSON on landing. The existing
statement detail screens still use their evidence endpoints.

The download now contains displayed relational statement metadata and transactions,
not complete archive envelopes. These relational routes provide no archive import
status, so Overview cannot report archive-only missing imports; the statement detail
screens retain import-gap notices. Source filenames may still end in .json, but
Overview uses them only as metadata, not fetch URLs.

Added tests for selected-month numeric routes, signed totals, canonical IDs,
503 without archive fallback, and cancellation. All 11 tests pass.
