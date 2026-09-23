# MySQL cutover checklist

Prepared September 23, 2026. This is a review checklist, not an executed deployment.
MCP source wiring is complete at version 1.8.0; the running processes have not
been restarted. API service configuration still targets the legacy app.

## 1. Release gates

- [ ] Review the intentional differences in the Stage 2–4 sections of
  `MYSQL_READ_MIGRATION_PLAN.md`, especially override resets, import gaps,
  report audit/idempotence changes and preserved legacy financial sign rules.
- [x] Run `venv/bin/python -m unittest discover -s tests` successfully in an
  environment where ASGI/async worker tests can run.
- [x] Run the read-only checks `venv/bin/python verify_mysql_reads.py`,
  `venv/bin/python verify_mysql_reports.py`, and
  `venv/bin/python verify_mysql_api.py` against the intended database/archive.
  Report checks use dry runs and block publication. API checks compare legacy
  financial predicates after explicitly substituting effective categories and
  repairing the removed account column; they do not claim old categories match.
- [ ] Record a known numeric statement ID, its JSON source path, one canonical
  transaction ID, an existing report ID and their expected responses for smoke
  tests. Record existing report-file hashes without displaying private contents.
- [ ] Save the current service configuration and source release for rollback.
  No schema migration or data rewrite is required for this cutover.
- [ ] Confirm service user `rtoews` can read database configuration, archive and
  PDFs. Do not copy credentials into logs or this checklist.

## 2. Exact API switch

Inspected `/etc/systemd/system/finances.service`:

```text
WorkingDirectory=/var/www/finances.toews-api.com
ExecStart=/var/www/finances.toews-api.com/venv/bin/uvicorn app:app --host 127.0.0.1 --port 8015
```

The prepared candidate is an ASGI factory. The proposed replacement is:

```text
ExecStart=/var/www/finances.toews-api.com/venv/bin/uvicorn mysql_api:create_app --factory --host 127.0.0.1 --port 8015
```

Use a reviewed systemd override (clear the old ExecStart before setting another),
then daemon-reload and restart **finances.service only after cutover approval**.
Keep the existing user, working directory, environment and binding.
There is no environment feature flag to enable the candidate accidentally.

The factory replaces these call sites while preserving paths and parameters:

- GET `/transactions`
- GET `/statements/{statement_id}/transactions`
- GET `/verified-statements/{year}/files/{filename}`
- PATCH `/transactions/{transaction_id}/category` (numeric route ID)
- GET `/reports/monthly-spending`, `/reports/income`, `/reports/expenses`
- GET `/statements/{statement_id}/pdf`

POST `/transaction-categories`, statement imports, archive listing, categories,
filename-based PDF lookup and saved-report readers retain their existing endpoints.

## 3. MCP wiring complete — restart remains a deployment action

All implementation items are complete in `mcp_server.py` (version **1.8.0**):

- [x] `search_transactions` registers `mysql_statement_reads.search_transactions`.
- [x] `summarize_spending` registers `mysql_statement_reads.summarize_spending`.
- [x] Compact report submission calls
  `mysql_report_storage.save_report_from_transactions` and publishes the
  `OperationalReportFromTransactions` schema, including its merchant filter.
- [x] `get_data_coverage` registers the signature-compatible MySQL wrapper.
  Top-level coverage describes imported operational availability; archive_coverage
  and import_status distinguish source evidence, exclusions and import gaps.
- [x] `get_statement_details`, legacy evidence validation, saved-report readers
  and statement submission retain their archive-backed implementations.
- [x] Version, tool descriptions/instructions, schema/dispatch tests and
  `MCP_READ_TOOLS.md` are updated for this architecture.

There are no remaining MCP implementation prerequisites. The inspected service
command is unchanged:

```text
ExecStart=/var/www/finances.toews-api.com/venv/bin/python /var/www/finances.toews-api.com/mcp_server.py
```

A later approved restart of **finances-mcp.service** will load these registrations;
no MCP systemd change or daemon-reload is needed. That restart has **not** occurred.
The API switch in Section 2 remains a separate service-configuration action.
For a coordinated release, approve and schedule both service changes together.
No reverse-proxy restart is expected; existing ports and routes are retained.

## 4. Three immediate smoke tests

1. **API reads and provenance:** GET `/`, `/transactions?limit=2`, the recorded
   statement's transaction route and verified JSON route. Confirm HTTP 200,
   unchanged numeric `id`, canonical `transaction_id`, matching effective category
   and parent fields, and import status. Open the numeric statement PDF route;
   verify `application/pdf`, inline disposition and the correct source document.
2. **Reports and unchanged saved evidence:** GET `/reports/expenses?year=2025&month=1`
   and the recorded saved report's `/reports/{report_id}/transactions`. Compare
   the legacy-sign baseline and saved evidence recorded before cutover; confirm
   saved report hashes remain unchanged. Do not use a production category edit
   merely as a smoke test: write/reset round trips are covered by isolated tests.
3. **MCP after the approved restart:** search two pages with a known filter and inspect persisted
   merchant/category and operational coverage; run a category spending summary,
   then a compact report with `dry_run: true` selecting the same canonical IDs.
   Confirm IDs/counts/totals agree, no report is published, and a known saved report
   still returns its original evidence. Restart old cursors from page one.

Check each restarted service's active state and logs for database/evidence errors.
Any unexpected category source, altered financial predicate, changed saved evidence,
or failing smoke test stops rollout.

## 5. Rollback

Restore the old API ExecStart and/or the prior MCP registration source, reload
systemd if its configuration changed, and restart only the affected service.
Do not roll back or delete archive/report files or transaction-category rows.
Be aware that the legacy numeric PATCH writes the materialized category column;
if reverting the API, avoid that route and continue using the authoritative POST
override endpoint until the migration is restored.

## Recorded source-release validation — September 23, 2026

| Gate | Result |
|---|---|
| Complete regression suite | 116 tests passed, zero failures (outside sandbox for async tests) |
| `mysql_reads.py` | 6,751 archive/database canonical transactions matched; zero missing imports |
| `verify_mysql_reads.py` | Seven search cases, 21 spending cases and pagination through all 6,751 rows passed; both coverage views show 259 statements/seven canonical accounts |
| `verify_mysql_reports.py` | Five archive-filter parity cases and three merchant/category cases passed; zero publications |
| `verify_mysql_api.py` | Nine API parity cases, 6,751 canonical IDs and one statement enrichment check passed; zero writes |
| MCP schema/dispatch checks | Operational coverage/search/category spending and merchant-filtered compact dry run passed within full suite; original signatures preserved for coverage/search/spending |
| Deployment activity | None: systemd unchanged, no restart, no deployment |

Section 3 has no remaining implementation tasks. The unchecked Section 1 items
(review, recorded production smoke fixtures/report hashes, rollback backup and
service-user access confirmation) remain operational cutover gates, not claims
that deployment or post-restart smoke testing already happened. The running
service can continue advertising the old version until its approved restart.
