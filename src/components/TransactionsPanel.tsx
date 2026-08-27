import { useState } from 'react';
import { getStatementPdfUrl } from '../api/financesApi';
import type { Statement, Transaction } from '../types/finance';

type TransactionsPanelProps = {
  selectedStatement: Statement;
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
};

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatDate(value: string): string {
  if (!value) {
    return '—';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatCurrency(value: number | null): string {
  return value === null ? '—' : usdFormatter.format(value);
}

function formatPeriodRange(statement: Statement): string {
  if (!statement.periodStart && !statement.periodEnd) {
    return 'Period not available';
  }

  if (!statement.periodStart || !statement.periodEnd) {
    return formatDate(statement.periodStart || statement.periodEnd);
  }

  return `${formatDate(statement.periodStart)} - ${formatDate(statement.periodEnd)}`;
}

function formatText(value: string): string {
  return value.trim() ? value : '—';
}

export function TransactionsPanel({
  selectedStatement,
  transactions,
  isLoading,
  error,
}: TransactionsPanelProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const isCreditCardStatement =
    selectedStatement.statementType === 'credit_card_statement';

  async function handleCopyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(transactions, null, 2));
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
    }
  }

  return (
    <div className="transactions-panel">
      <div className="section-heading transactions-heading">
        <div>
          <h3>Transactions</h3>
          <p>{formatPeriodRange(selectedStatement)}</p>
          {selectedStatement.sourceFile.trim() && (
            <p className="source-meta">{selectedStatement.sourceFile}</p>
          )}
        </div>
        <div className="transactions-heading-actions">
          <span>{transactions.length} total</span>
          {isCreditCardStatement && (
            <a
              className="statement-pdf-button"
              href={getStatementPdfUrl(selectedStatement.id)}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              aria-label="Open original statement PDF"
              title="Open original statement PDF"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6" />
                <path d="M8 15h8M8 18h5" />
              </svg>
            </a>
          )}
          {isCreditCardStatement && (
            <button
              type="button"
              className="copy-json-button"
              onClick={handleCopyJson}
              disabled={isLoading || transactions.length === 0}
              aria-label="Copy transactions as JSON"
              title="Copy transactions as JSON"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
              </svg>
            </button>
          )}
          {isCreditCardStatement && copyStatus !== 'idle' && (
            <span className={`copy-status ${copyStatus === 'error' ? 'copy-error' : ''}`} role="status">
              {copyStatus === 'copied' ? 'Copied' : 'Copy failed'}
            </span>
          )}
        </div>
      </div>

      {isLoading && <p className="panel-state">Loading transactions...</p>}

      {error && !isLoading && (
        <div className="panel-state error-message" role="alert">
          {error}
        </div>
      )}

      {!isLoading && !error && transactions.length === 0 && (
        <p className="panel-state">
          No transactions were returned for this statement yet.
        </p>
      )}

      {!isLoading && !error && transactions.length > 0 && (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Description</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td data-label="Date">{formatDate(transaction.transactionDate)}</td>
                  <td data-label="Description">{formatText(transaction.description)}</td>
                  <td
                    data-label="Amount"
                    className={`numeric amount ${
                      transaction.amount !== null && transaction.amount < 0
                        ? 'negative-amount'
                        : 'positive-amount'
                    }`}
                  >
                    {formatCurrency(transaction.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
