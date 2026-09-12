import { useEffect, useState } from 'react';
import { getReports } from '../api/financesApi';
import type { AvailableReport } from '../types/finance';
import { ReportTransactionsPanel } from './ReportTransactionsPanel';

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function formatTotal(report: AvailableReport): string {
  const amount = Number(report.grand_total);
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: report.currency,
  }).format(amount);
}

export function ReportsPage() {
  const [reports, setReports] = useState<AvailableReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadReports() {
      try {
        const result = await getReports(controller.signal);
        if (!controller.signal.aborted) setReports(result);
      } catch (caughtError) {
        if (!controller.signal.aborted) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unable to load reports.');
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    void loadReports();
    return () => controller.abort();
  }, [attempt]);

  return (
    <>
      <div className="page-heading">
        <h1>Reports</h1>
        <p>Select a report to view its transactions.</p>
      </div>
      {isLoading ? (
        <p className="status-message" role="status">Loading reports...</p>
      ) : error ? (
        <div className="status-message error-message" role="alert">
          <p>{error}</p>
          <button className="reports-retry" onClick={() => {
            setError(null);
            setIsLoading(true);
            setAttempt((value) => value + 1);
          }}>Try again</button>
        </div>
      ) : (
        <section aria-labelledby="available-reports-heading">
          <h2 id="available-reports-heading" className="reports-heading">
            {reports.length} available {reports.length === 1 ? 'report' : 'reports'}
          </h2>
          {reports.length === 0 ? (
            <p className="status-message">No reports are available yet.</p>
          ) : (
            <ul className="reports-list">
              {reports.map((report) => (
                <li key={report.report_id} className="content-section report-card">
                  <div className="report-heading">
                    <h3>
                      <button
                        className="report-toggle"
                        aria-expanded={selectedReportId === report.report_id}
                        aria-controls={`transactions-${report.report_id}`}
                        onClick={() => setSelectedReportId((selected) =>
                          selected === report.report_id ? null : report.report_id,
                        )}
                      >
                        {report.title}
                        <span className="report-toggle-hint">
                          {selectedReportId === report.report_id ? 'Hide transactions' : 'View transactions'}
                        </span>
                      </button>
                    </h3>
                    <span className="report-status">{report.status}</span>
                  </div>
                  <p className="report-description">{report.description}</p>
                  <p className="report-id">{report.report_id}</p>
                  <dl className="report-metrics">
                    <div><dt>Period</dt><dd>{formatDate(report.period_start)} – {formatDate(report.period_end)}</dd></div>
                    <div><dt>Total ({report.currency})</dt><dd>{formatTotal(report)}</dd></div>
                    <div><dt>Transactions</dt><dd>{report.transaction_count.toLocaleString()}</dd></div>
                    <div><dt>Source statements</dt><dd>{report.source_statement_count.toLocaleString()}</dd></div>
                  </dl>
                  <p className="report-updated">Updated {formatDate(report.updated_at)}</p>
                  <div id={`transactions-${report.report_id}`} hidden={selectedReportId !== report.report_id} className="report-transactions">
                    {selectedReportId === report.report_id && (
                      <ReportTransactionsPanel key={report.report_id} reportId={report.report_id} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
