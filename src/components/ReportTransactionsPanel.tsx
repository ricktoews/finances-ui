import { useEffect, useState } from 'react';
import { getReportTransactions } from '../api/financesApi';
import type { ReportTransactions } from '../types/finance';
import { groupReportTransactions } from './reportTransactionGroups';

export function ReportTransactionsPanel({ reportId }: { reportId: string }) {
  const [data, setData] = useState<ReportTransactions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await getReportTransactions(reportId, controller.signal);
        if (!controller.signal.aborted) setData(result);
      } catch (caughtError) {
        if (!controller.signal.aborted) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unable to load report transactions.');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [reportId, attempt]);

  if (error) return (
    <div className="panel-state error-message" role="alert">
      <p>{error}</p>
      <button className="reports-retry" onClick={() => {
        setError(null);
        setAttempt((value) => value + 1);
      }}>Try again</button>
    </div>
  );
  if (!data) return <p className="panel-state" role="status">Loading transactions...</p>;
  if (data.transactions.length === 0) return <p className="panel-state">No transactions are available for this report.</p>;

  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: data.currency });
  const { grouping, groups } = groupReportTransactions(data.transactions);
  return (
    <>
      <div className="section-heading">
        <div>
          <h4>Transactions</h4>
          <p>
            {grouping === 'label' ? 'Grouped by store / report label · ' : grouping === 'category' ? 'Grouped by category · ' : ''}
            Most recent first
          </p>
        </div>
        <span>{data.transactions.length.toLocaleString()} total</span>
      </div>
      {groups.map((group, groupIndex) => (
        <section className="report-transaction-group" key={groupIndex} aria-labelledby={`${reportId}-group-${groupIndex}`}>
          <div className="report-group-heading">
            <h5 id={`${reportId}-group-${groupIndex}`}>{group.label}</h5>
            <span>{group.transactions.length.toLocaleString()} {group.transactions.length === 1 ? 'transaction' : 'transactions'}</span>
          </div>
          <div className="table-shell report-transactions-table">
        <table>
          <caption className="report-table-caption">{group.label} · Most recent first · {data.currency}</caption>
          <thead><tr>
            <th scope="col">Date</th>
            <th scope="col">Description</th>
            <th scope="col">Category</th>
            <th scope="col">Source</th>
            <th scope="col" className="numeric">Amount ({data.currency})</th>
          </tr></thead>
          <tbody>{group.transactions.map((transaction, index) => (
            <tr key={`${transaction.id}-${index}`}>
              <td data-label="Date">{transaction.transactionDate || '—'}</td>
              <td data-label="Description" className="report-transaction-description">{transaction.description || '—'}</td>
              <td data-label="Category">{transaction.category || '—'}</td>
              <td data-label="Source" className="source-file">{transaction.sourceFile || '—'}</td>
              <td data-label={`Amount (${data.currency})`} className="numeric amount">
                {transaction.amount === null ? '—' : currency.format(transaction.amount)}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
        </section>
      ))}
    </>
  );
}
