# MySQL read migration inspection

Inspected September 22, 2026. The initial inspection changed no application code,
database records, archive evidence, or running services. Stage 1 implementation
status is recorded below; production readers remain unchanged.

## Confirmed live schema and baseline

Inspected `SHOW CREATE TABLE` for institutions, accounts, statements,
statement_accounts, transactions, merchants, categories, merchant_aliases,
and transaction_categories, using the existing configuration without displaying credentials.

| Measurement | Live value |
|---|---:|
| Statements | 259 |
| Statement accounts | 346 |
| Transactions | 6,751 |
| Non-NULL canonical transaction IDs | 6,751 |
| Distinct canonical transaction IDs | 6,751 |
| Transactions with merchant_id | 3,878 |
| Transactions with materialized category_id | 3,493 |
| Explicit transaction_categories overrides | 0 |

The existing `populate_transaction_ids.py` read-only dry run also passed:
259 archive statements, 6,751 archive transactions, 6,751 uniquely matched
database transactions, zero source-field/mapping errors, and zero NULL stored
canonical IDs. It made no database changes.

The relational schema supports ordinary transaction reads. `transaction_id` has
a unique index but remains nullable. `source_index` is also nullable, with a
unique index on `(statement_account_id, source_index)`. Dates and amounts are
indexed. Statements and transactions each have a nullable `raw_json` column;
its presence does not establish provenance completeness or byte-for-byte archive identity.

Use this shared join for effective enrichment everywhere:

```sql
FROM transactions t
LEFT JOIN merchants m ON m.id = t.merchant_id
LEFT JOIN transaction_categories tc ON tc.transaction_id = t.transaction_id
LEFT JOIN categories c ON c.id = COALESCE(tc.category_id, m.category_id)
LEFT JOIN categories parent ON parent.id = c.parent_category_id
```

Expose the effective ID using `COALESCE(tc.category_id, m.category_id)`, category
name using `c.name`, and parent fields using `c.parent_category_id` and
`parent.name`. Preserve NULLs and transactions without merchants. Never consult
`t.category_id` for effective classification. Read-time alias matching must not
replace the persisted `t.merchant_id`.

## Read functions and dependencies

| Function/path | Current source and callers | Migration treatment |
|---|---|---|
| `Archive.__init__` | Recursively reads, validates, hashes and excludes invalid/duplicate statement JSON; constructs transactions, statements, fee adjustments and canonical evidence. Used by all four statement MCP readers, report storage, migration utilities and tests. | Keep as an evidence implementation; do not globally redefine it as a database reader. Split reusable statement/provenance processing from transaction selection. |
| `Archive.coverage`, `range_coverage`, `get_data_coverage` | Statement inventory, account periods, balances, transaction counts and summary-only fees; used by MCP coverage, search, spending, details and report-selection audit. | Hybrid. Database supplies operational counts; archive supplies inventory validation, exclusions and missing provenance/summary details. Clearly distinguish archive coverage from imported availability. |
| `select(archive, filters, records=None)` | Does not itself read files; filters the supplied transaction view. Called by search, spending and `report_selection.resolve_search_selections`. Optional records support fee adjustments. | Preserve shared filtering and ordering semantics; supply a MySQL-backed transaction view. Keep explicit-record filtering available. |
| `search_transactions` | Constructs Archive, calls select, creates snapshot-bound cursors, adds fee adjustments and coverage; registered directly by MCP. | Priority migration: database transaction fields/enrichment, archive provenance and coverage as needed. |
| `summarize_spending` | Constructs Archive; shared select/classifier, Decimal aggregation, fee adjustments; registered by MCP. | Database transactions plus archival summary fees; preserve sign/classification/currency semantics. Enable declared category/merchant groupings using effective enrichment. |
| `get_statement_details` | Constructs Archive and returns complete canonical statement, metadata, summaries and reconciliation; registered by MCP. | Keep JSON-backed full evidence retrieval. |
| `save_report_from_transactions` | Archive indexes resolve explicit IDs and search selections; builds source evidence and validates it. Called by MCP compact report submission, including dry runs. | Use database selection for operational searches/ID availability, then resolve selected canonical IDs against archive evidence and reject mismatches. Keep immutable evidence validation separate. |
| `resolve_search_selections` | Shared select and range_coverage; filters, exclusions, overlap detection and selection audit. | Use the same operational snapshot as MCP search. Preserve scope, exclusions, labels and audit behavior. |
| `save_verified_report`, `_validate_verified_report` | Archive evidence identity, raw values, PDF references and reconciliation; called by report submissions. | Keep archive-backed evidence validation. Do not substitute current enrichment for submitted/saved evidence. |
| API `get_verified_statement_files` | Lists JSON filenames. | Keep archive inventory behavior. |
| API `get_verified_statement_file` | Reads full JSON, generates canonical IDs, re-runs merchant aliases and joins explicit overrides. | Retain JSON statement envelope/evidence; obtain merchant and effective category fields from MySQL by canonical ID. Define missing-import behavior explicitly. |
| API `get_statements`, PDF routes | Statement list and ID lookup use MySQL; filename lookup derives dates; PDF bytes come from filesystem. | Preserve routes and existing PDF/provenance handling. |
| API `get_transactions`, `get_statement_transactions` | Already relational, but categories join `t.category_id` and outputs expose numeric `id`. | Use shared effective-category joins; add canonical `transaction_id`, retain numeric `id` only as a legacy field. |
| API `get_monthly_spending`, `get_income`, `get_expenses` | Relational reports with old category joins and amount assumptions. | Update effective-category filtering; verify imported signs against each report's intended semantics. Fix expense account join. |
| `report_reads.list_reports`, `search_reports`, `get_report` and API saved-report routes | Read immutable reports from `verified-json/reports`. | Keep unchanged; retrieval must not query current classification or recompute evidence. |
| Statement submission/import | Writes verified JSON. | Keep unchanged; new files require the separate database import before operational transaction search can see them. |

`add_transaction_ids`, `transaction_identity` helpers, matching predicates and
the economic-spending classifier do not need a database dependency.
`populate_transaction_ids.py` and live verification scripts depend on Archive
remaining usable as the canonical evidence reader.

## Compatibility gaps and decisions

1. **Historical account identity:** the migration utility explicitly maps two
   historical Alaska Visa numbers to one logical MySQL account. Reconstructing
   canonical account IDs from the current accounts row alone would collapse
   archive identities and break last-four/card/account filters. Preserve canonical
   IDs from stored transaction IDs and resolve historical display/legacy aliases
   from source statement metadata. Do not regenerate IDs using logical account IDs.
2. **Provenance and statement metadata:** normalized columns do not store archive
   relative paths, byte hashes, PDF paths/hashes, complete card summaries,
   transaction PDF references, currency or historical card product as dedicated
   fields. Source aliases and original institution labels also matter. Resolve
   these from archive metadata; inspect imported raw_json completeness before
   using it as a convenience source. MySQL JSON serialization cannot replace the
   hash of original archive bytes. No schema change is required for a hybrid read.
3. **Snapshot consistency:** existing cursors use an archive-content snapshot.
   The schema has no common revision covering transaction changes, merchant
   defaults, category names/parents and overrides. Initially fingerprint a
   deterministically serialized operational snapshot plus relevant archive
   evidence. Use a consistent database read transaction. Invalidate cursors when
   selection, enrichment or evidence changes; timestamps/counts alone are insufficient.
4. **Filtering:** current text matching uses Python casefold substring matching;
   categories/types use exact comparisons. Default MySQL collation is
   utf8mb4_0900_ai_ci, which is not equivalent. Keep shared Python predicates
   initially, then push filters into SQL only with parity tests. Preserve raw signed
   amount bounds, canonical/legacy aliases, source aliases, ordering and page limits.
5. **Intended category behavior change:** remove the old error that categories
   are unavailable without archive metadata. Searches should use effective MySQL
   categories; unmatched categories return no rows. Merchant/category grouping
   is declared in the MCP signature but currently rejected; implement it with
   explicit uncategorized/unmatched groups. Update stale descriptions and warnings.
6. **Legacy category edit route:** POST `/transaction-categories` already has the
   correct upsert behavior. PATCH `/transactions/{transaction_id}/category`
   currently accepts a numeric database ID and updates `transactions.category_id`.
   Recommended compatibility adapter: retain its numeric route parameter, resolve
   the canonical ID, and upsert the authoritative override. A NULL request removes
   the override and restores merchant fallback. Document this reset behavior.
7. **Broken expense join:** `/reports/expenses` references
   `t.normalized_account_id`, absent from the live schema. Replace with
   `t.statement_account_id -> statement_accounts.account_id -> accounts.id`.
8. **Legacy financial report signs:** monthly spending/expenses assume negative
   purchases, while the archive classifier handles positive card purchases and
   negative bank expenses. Imported source-sign preservation requires parity
   fixtures and an explicit documented correction where legacy totals are wrong;
   do not fold sign changes invisibly into category join changes.
9. **Import/evidence divergence:** JSON-only submissions must not silently join
   operational search results. Retain archive listing/details, disclose unimported
   availability, and avoid claiming complete operational coverage from archive
   coverage alone. If database evidence differs from archive source fields, report
   creation must fail clearly. No fallback to a second transaction truth on DB errors.

## Staged implementation and validation

### 1. Shared database view and parity checks

Extract a small connection/read layer independent of `app.py`; use parameterized
queries and explicit resource cleanup. Build an operational transaction view from
relational source fields with effective enrichment and archival identity/provenance
resolution. Initially retain shared select predicates over database-loaded records;
this changes the source without simultaneously changing every search semantic.

Validate all canonical IDs and imported raw source fields against the archive.
Test NULL merchants/defaults, explicit override with and without merchant, parent
replacement/clearing, default changes, misleading materialized t.category_id,
historical account aliases, source_index ordering, dates and Decimal serialization.
Use isolated test data for writes, never production fixtures.

### 2. MCP transaction reads

Switch search and spending to the operational view. Preserve method signatures,
response envelopes, ordering, raw amount filters, classification, currency
separation, fee adjustments and provenance. Keep evidence-oriented full statement
retrieval JSON-backed. Share metadata/coverage construction without reparsing and
rebuilding every archive transaction for ordinary requests; any metadata cache
must detect file changes and preserve inventory validation behavior.

Test pagination ties, changed filters, stale cursors after transaction/enrichment
or archive changes, card and deposit filters, refunds/payments/transfers/interest,
summary-only fees, missing archive/DB records and database unavailability.
Reconcile operational and archival coverage separately.

### 3. New report selection

Route report searches through the same operational select engine and snapshot.
Resolve selected IDs to immutable archive evidence before existing validation and
publication. Preserve explicit-ID selection, duplicate detection, exclusions,
scope enforcement, dry-run no-write behavior, grouping, Decimal reconciliation
and idempotence. Verify search and report-selection results agree for equivalent
filters. Saved-report reads must remain byte/content-equivalent and independent
of later merchant/category changes.

### 4. HTTP API integration

Use the shared enrichment joins for relational transaction routes, category-based
reports and the archive statement response. Preserve response envelopes, numeric
legacy identifiers where required, and expose canonical transaction_id explicitly.
Keep POST override writes; adapt legacy PATCH as described above. Fix the missing
expense account column and validate sign-sensitive reports using imported fixtures.
Test endpoint contracts, parent categories, override round trips and PDF paths.

### 5. Documentation and release checks

Update MCP server instructions/tool descriptions, `MCP_READ_TOOLS.md`, coverage
source/index metadata, category warnings and the temporary import-lag explanation.
Run the existing statement, merchant, transaction-category, report-selection,
economic-spending, saved-report, PDF and MCP contract suites plus new integration
tests. Compare representative read-only production queries against reconciled
baseline results, allowing only intended enrichment/category behavior changes.
Deployment/restarts and import redesign are not part of this inspection.

## Stage 1 implementation — September 22, 2026

Added `mysql_reads.py`, an opt-in connection/read layer and `OperationalView`.
No API/MCP caller imports it. It executes one relational query in a read-only,
repeatable-read snapshot, closes resources on success/failure, and resolves exact
canonical IDs against an injected or newly loaded Archive. Source dates, posting
dates, descriptions, signed amounts, types, statement periods, source identity,
and source indexes must agree; unknown/duplicate/NULL IDs and mismatches fail.
Missing imports are disclosed and never populated from archive transactions.
Historical account fields and PDF provenance come from canonical evidence.

Enrichment uses persisted merchant IDs, override/default COALESCE, and effective
parent categories. It never selects materialized `transactions.category_id` or
re-runs alias matching. `view.select(filters)` reuses the existing search predicates
and sorting while applying effective categories, including an empty result for
an unmatched category. Production `statement_reads.select` is unchanged.

The snapshot fingerprints ordered operational records and archive evidence.
The CLI `venv/bin/python mysql_reads.py` is read-only and prints parity counts;
it exits unsuccessfully on mismatches or missing imports. Live validation passed:
6,751 archive records, 6,751 database records, 6,751 matches, zero missing imports.

### Findings and deliberate Stage 1 limits

- All 6,751 live rows join statements whose `source_file` is a relative archive
  JSON path, not a PDF basename. The adapter validates that exact path (or an
  exact canonical PDF basename for legacy imports), retaining the archive's PDF
  identity separately. Stage 2/4 must account for this, particularly the existing
  PDF-by-statement-ID endpoint; do not treat source_file as a PDF path blindly.
- Stage 1 reuses the full Archive for evidence/parity rather than introducing a
  metadata cache or changing Archive. Stage 2 needs the planned metadata-only
  loading/caching design before claiming it avoids rebuilding archive transactions.
- Operational raw amounts are decimal strings, preserving exact cents and allowing
  ordinary JSON serialization. Before exposing this view, choose compatibility
  serialization for existing numeric response fields; saved evidence retains its
  original archived representation.
- No coverage adapter, fee-adjustment selection, or production cursor integration
  is enabled yet. Stage 2 must combine operational availability with archive
  inventory/summary evidence and use the new snapshot for cursor invalidation.
- Tests execute the actual join SQL against an isolated SQLite fixture, with a
  mocked MySQL connection lifecycle and native MySQL date/Decimal row fixtures.
  This avoids production writes. The read-only live check separately validates
  actual MySQL SQL execution and source parity.

Before Stage 2, settle the missing-evidence/import-lag response contract,
numeric serialization compatibility, and metadata/coverage loading strategy.
The current adapter conservatively fails on divergent or absent canonical evidence.

### Stage 1 validation results

- `venv/bin/python -m unittest discover -s tests -p test_mysql_reads.py`:
  all 8 new regression tests passed.
- `venv/bin/python mysql_reads.py` against live MySQL, read-only:
  all 6,751 canonical IDs/source rows matched, zero missing imports.
- `venv/bin/python -m unittest discover -s tests` outside the sandbox:
  90 tests ran, 89 passed. The sole failure is the existing live-archive summary
  test's stale expectation of 194 statements; actual count is 259. Its other
  old fixed totals also need updating separately. No historical baseline tests
  were rewritten as part of Stage 1.
- The sandboxed full-suite attempt stalled in an existing async MCP test; the
  unrestricted run completed in about 10 seconds, including those MCP tests.
  Interrupted sandbox attempts are not counted as successful runs.

## Stage 2 implementation — opt-in, production not wired

`mysql_statement_reads.search_transactions` and `summarize_spending` now provide
the same signatures and response envelopes as the Archive-backed functions.
`mcp_server.py`, API callers, report selection and saved-report readers still use
their existing sources. Restarting alone does not enable these new readers.

### Resolved decisions

- **Serialization:** database amounts remain decimal strings inside the view.
  Search converts raw_amount to a JSON number only at the response boundary,
  retaining the existing numeric contract. Spending contributions and totals
  remain Decimal-derived strings. Their trailing zeros may differ from archive
  results because MySQL preserves decimal scale; numeric values match. Saved
  report evidence and serialization are unchanged.
- **Evidence:** required archive evidence must be available and match each
  imported transaction's canonical identity/source fields. Unknown IDs, drift,
  or unreadable required evidence fail the request. Database outages return a
  clear unavailable error; there is no JSON transaction fallback.
- **Cache:** `archive_cache.py` keeps one validated Archive in process memory.
  Warm requests hash statement bytes without reparsing, revalidating, or rebuilding
  its transaction index. Content changes, additions, deletions and symlinks
  invalidate the cache; saved reports do not. A change during cold loading fails
  with a retry message. This is a full evidence cache, not a metadata-only index:
  it intentionally trades memory and continued hashing I/O for preservation of
  existing validation/duplicate/provenance behavior. Archive itself stays intact.
- **Coverage:** the existing top-level coverage describes operational availability;
  `archive_coverage` separately describes validated archival availability (without
  repeating its full inventory). `import_status` reports counts, missing canonical
  IDs and incomplete account periods. Incomplete account periods are excluded
  from operational covered periods, and any import lag conservatively prevents a
  completeness claim, even for a narrower query. Matching imported transactions
  remain queryable. Missing activity never means zero spending.
- **Empty periods:** statement-account imports are read in the same read-only
  database snapshot as transactions. Empty periods count as covered when their
  source identity and unique account type confirm the import. Ambiguous empty
  account mappings are treated as incomplete rather than guessed. This restores
  four live statements omitted when availability was inferred only from rows.
- **Summary fees:** include archive summary-only fees only for completely imported
  account periods, including confirmed empty periods. Keep them separate from
  transactions and attribute them to the closing date. Incomplete imports omit
  these adjustments and disclose the gap. Fee adjustments have no inferred
  merchant/category and therefore do not match a category filter.
- **Cursors:** fingerprint operational records, persisted enrichment, imported
  statement-account inventory and archive content. Changes invalidate subsequent
  pages, as do changed filters. Sorting and limits remain unchanged; cursors from
  the old Archive-backed path must be restarted when wiring the new reader.

### Intended behavior differences to review before wiring

1. Category filters use explicit overrides then merchant defaults, rather than
   archived metadata. Unknown categories produce empty results, not an unavailable
   category error. Parent category fields follow the effective category.
2. Transactions expose persisted merchant/category IDs, names, default/override
   IDs, and parent fields. normalized_merchant is now populated where known.
3. Spending supports the already-declared merchant and category groupings. A
   JSON null group identifies unmatched/uncategorized activity without colliding
   with a real category or merchant name. Currencies remain separate.
4. Coverage source/index labels now identify MySQL with cached archival evidence;
   additional archive_coverage/import_status fields disclose the two stores.
5. JSON-only submissions await import before appearing in operational searches.
6. Amount string formatting can retain additional trailing zeros, but raw JSON
   amounts remain numbers and economic values/signs do not change.
7. Operational reads require both database access and matching canonical evidence.
   Invalid/unreadable evidence and outages are not hidden behind fallback reads.

### Implementation and validation

- Added `archive_cache.py`, `mysql_statement_reads.py`,
  `tests/test_mysql_statement_reads.py`, and read-only `verify_mysql_reads.py`.
- Extended `mysql_reads.py` to optionally read statement-account inventory in the
  same snapshot; its Stage 1 default and CLI remain available.
- Extracted the existing aggregation body to `spending_summary.py`; the old
  `statement_reads.summarize_spending` still builds Archive and uses its existing
  filters and grouping restrictions. This shares financial arithmetic without
  switching any production caller. Updated isolated database fixtures accordingly.
- All 16 MySQL view/reader tests passed, including signature/response parity,
  amounts, filtering, pagination, overrides, stale cursors, grouping/currencies,
  import gaps, empty periods, summary adjustments, evidence caching and outages.
- Read-only live comparison passed for all 6,751 canonical rows, seven search
  cases, 21 spending cases and pagination across every row. Operational/archive
  coverage both count 259 statements and seven canonical accounts. No missing
  imports were found. The checker compares monetary values rather than trailing
  zero formatting. No database or archive writes were performed.
- Full regression suite: 98 tests ran, 97 passed. The only failure remains the
  pre-existing archive summary assertion expecting 194 statements instead of 259.
  It was not changed to hide the historical baseline mismatch.

No further product decision is required to exercise the opt-in readers. Production
wiring remains a separate step; Stage 3 report selections must also adopt the
effective-category search semantics before those report workflows are consistent
with the new MCP searches.

## Stage 3 implementation — opt-in new report selection

Added `mysql_report_storage.save_report_from_transactions` and its opt-in
`OperationalReportFromTransactions` request model. It creates one Stage 2
OperationalContext, selects imported rows through the operational predicates,
then resolves every selected canonical ID against that context's Archive.
Only archive amounts, source fields, metadata and PDF references enter report
evidence and reconciliation. Persisted merchant/category values determine search
membership, not saved source evidence or caller-provided report labels.

The original report builder was extracted to `report_storage._save_selected_report`
so both paths use the same duplicate/scope checks, grouping, Decimal arithmetic,
evidence validator and immutable publisher. `report_selection` accepts an optional
selector; its default remains Archive-backed. Neither production MCP/API callers
nor existing request schemas were switched. Saved-report readers and the saved
financial format remain unchanged. No statements, imports or services were changed.

### Intentional differences before Stage 4

1. New opt-in searches use MySQL row membership and effective categories. Matching
   labels/categories in report results still come from the request, exactly as
   before; they are not silently replaced with merchant names or defaults.
2. Stage 2 exposed merchant grouping, not a merchant filter. Stage 3 adds an
   optional `query.merchant` only to the opt-in report model. It matches the exact,
   case-sensitive persisted canonical merchant name and combines with other
   predicates using AND. Description `text` filtering retains its old behavior.
   Unknown merchant/category searches fail as empty report selections; they do not
   infer matches from aliases or archive metadata. Existing production models
   continue rejecting the new merchant field until explicitly wired.
3. Explicit-ID mode retains its request structure, labels, order-independent
   retry behavior and archive validation, but IDs must also be operationally
   imported. Archive-only IDs fail with an unknown/unimported error. Database
   outages or evidence drift fail without publication; no fallback is used.
4. Search audits retain the existing metadata.selection_audit location and shape,
   with additive coverage.source/import_status fields and an updated explanatory
   note. Excluded transaction amounts retain their archived JSON numeric format.
   Audit snapshots reflect operational data/enrichment and evidence. Import gaps
   conservatively make coverage incomplete, including gaps outside narrower scope.
5. Identical retries against unchanged data remain idempotent. Changes to search
   results, request labels/rules or snapshot/audit require a new report ID; this
   includes unrelated operational changes that invalidate the whole snapshot.
   Re-submitting a historical Archive-generated search report through the new
   path can conflict because its audit differs. Existing saved bytes are preserved.
   Explicit-ID reports with otherwise identical evidence/metadata remain compatible
   with prior saved output because they have no search-selection audit.
6. Reports still contain selected actual transactions only; statement-summary fee
   adjustments are not invented as report transactions. Existing classification,
   refund/payment/transfer treatment, source signs and reconciliation are unchanged.

### Validation

- All 26 MySQL regression tests passed, including 10 new/inherited operational
  report tests: representative filter parity, all exclusion forms, overlap errors,
  more-than-one-page selection, date/account/currency enforcement, explicit-ID
  duplicates, import gaps, source drift, grouping, dry runs, saved evidence/PDF
  references, retry/conflict behavior, and saved-reader independence.
- `venv/bin/python verify_mysql_reports.py` passed against live MySQL: five
  Archive-vs-operational filter comparisons plus three merchant/category/combined
  cases checked against archive evidence and totals. All cases used dry runs;
  publication was explicitly blocked and zero publication calls occurred.
- Existing `VerifiedReport` financial validation runs before the publisher appends
  search-audit metadata, preserving the existing saved-report convention.
- Full suite: 108 tests ran, 107 passed. The sole failure remains the existing
  live archive-summary expectation of 194 statements; the current count is 259.

New files: `mysql_report_storage.py`, `tests/test_mysql_report_selection.py`,
`verify_mysql_reports.py`. Shared refactors: `report_storage.py` and
`report_selection.py`. Stage 4 and production wiring remain unimplemented.

## Stage 4 implementation — September 23, 2026, opt-in HTTP API

Resumed the existing candidate after a usage-limit interruption. The prior run
had completed the implementation, seven isolated API tests and the stale archive
baseline update; the live API check and documentation were outstanding. No work
was discarded. This workspace has no Git metadata, so files were inspected directly.

### Implementation

- `mysql_api.create_app()` builds a separate candidate FastAPI app. `app:app`
  and all production MCP registrations remain unchanged. The candidate preserves
  existing route paths, parameter types, response envelopes, numeric IDs and CORS.
- Shared `mysql_reads.EFFECTIVE_CATEGORY_JOINS` drives both the operational view
  and API SQL. A shared database cursor handles read-only snapshots, write commits,
  rollback and resource cleanup. Relational API reads do not need archive loading;
  the full statement-envelope endpoint uses the validated operational context.
- Transaction/income/expense rows expose canonical transaction_id alongside numeric
  id, persisted merchant and effective category/parent fields. Queries never use
  transactions.category_id for classification. Expense accounts join through
  statement_accounts. Both the expense rows and yearly comparison use effective
  categories.
- The numeric PATCH resolves the canonical ID, upserts/removes transaction_categories,
  preserves existing notes on upsert, and returns effective enrichment. POST
  /transaction-categories is the original endpoint, unchanged.
- Statement envelopes retain archival fields and transaction evidence, adding
  MySQL enrichment and import-status disclosure. PDF-by-numeric-ID resolves the
  imported JSON source path to its archival PDF identity, including a contained
  metadata PDF path where present.
- Updated the stale real-archive regression baseline to the independently checked
  259 statements, 6,751 transactions, 172 card statements and seven canonical
  accounts. Historical Stage 1–3 results above remain as originally recorded.

### Intentional HTTP behavior differences

1. Effective categories and filters now use explicit overrides then persisted
   merchant defaults. Legacy materialized category values and read-time alias
   matching no longer control candidate API responses.
2. Canonical transaction_id and merchant/category/parent fields are additive;
   numeric IDs remain usable. The expense route retains its existing parent-name
   fallback to the category itself; direct transaction routes return NULL when
   no actual parent exists.
3. Repeating an unchanged category PATCH succeeds. Sending category_id=null removes
   the explicit override and restores merchant fallback, rather than setting the
   materialized transaction category to NULL. Unknown categories/transactions retain
   legacy failure envelopes; a missing canonical ID returns HTTP 409 without writes.
4. Statement responses add import_status. Unimported transactions retain archive
   evidence but have NULL merchant/category enrichment; no alias fallback is used.
   Incomplete empty account periods also prevent fully_imported=true. Database or
   required evidence failures return an error instead of silently using JSON enrichment.
5. Database failures in candidate endpoints return HTTP 503. Archive filename/year
   validation and missing-file responses remain explicit. Numeric PDF lookup now
   supports the actual imported JSON-path identity; PDF path traversal is rejected.
6. Financial sign rules are deliberately preserved and separately tested: monthly
   spending negates all categorized negative amounts (including negative card
   credits/payments), excludes positive purchases and uncategorized rows; income
   uses effective category ID 1 without adding a positive-only condition; expenses
   retains its old negative-amount/description/type predicates and calendar-average
   formula. Consequently these legacy HTTP reports remain different from MCP
   economic spending. Correcting those business rules requires a separate explicit
   change, not a hidden migration adjustment.

### Validation and release preparation

- Full regression suite: `venv/bin/python -m unittest discover -s tests` completed
  with **115 tests passed, zero failures**, outside the sandbox for async tests.
- Seven isolated API tests cover SQL/response parity, numeric/canonical IDs,
  override/post/reset behavior, notes, parent replacement, separate sign-sensitive
  monthly/income/expense cases, actual ASGI routing/serialization/CORS, production
  endpoint isolation, archive-byte preservation, import gaps, rollback/errors,
  PDF resolution and traversal rejection.
- `verify_mysql_api.py` passed nine read-only live parity cases, checked all 6,751
  canonical transaction IDs and one enriched statement. Zero writes occurred.
  Its SELECT-only reference adapts the category source and removed account column
  before comparing legacy financial predicates and existing response fields.
- Added `MYSQL_CUTOVER_CHECKLIST.md` with exact API factory/service switch,
  remaining MCP call-site/schema/documentation wiring, release gates, three smoke
  tests and rollback steps. No service configuration was edited or restarted.

Files added: `mysql_api.py`, `verify_mysql_api.py`, `tests/test_mysql_api.py`,
`MYSQL_CUTOVER_CHECKLIST.md`. Shared code changed: `mysql_reads.py`. Baseline test
updated: `tests/test_mcp_archive_tools.py`. This plan records the completed work.

## MCP production source wiring — September 23, 2026

MCP 1.8.0 now registers MySQL search, spending and the signature-compatible
operational coverage wrapper. Compact submission calls the operational report
builder with OperationalReportFromTransactions, including its merchant query
schema. Full statement details, legacy evidence validation, saved-report readers
and statement submission remain archive-backed. Tool annotations, descriptions,
server instructions and MCP_READ_TOOLS.md describe the two sources and import lag.
This completes the formerly opt-in MCP wiring in source; the process has not been
restarted. API service configuration remains unchanged.

The full suite passed 116 tests. All four MySQL checks passed: 6,751 canonical
matches with no import gaps; seven search/21 spending cases and full pagination;
five archive-filter/three merchant-category report cases with zero publication;
nine API cases plus complete canonical-ID and statement-enrichment checks with
zero writes. Schema/dispatch tests prove the registered tools reach operational
readers, including category grouping and a merchant-filtered compact dry run.

MYSQL_CUTOVER_CHECKLIST.md Section 3 now contains completed wiring items only;
release results are recorded there. Remaining cutover review/backup/access/smoke
gates are operational actions. No systemd files, running services or saved reports
were changed by this wiring/validation work.
