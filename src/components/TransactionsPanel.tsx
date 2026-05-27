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
        <span>{transactions.length} total</span>
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
                <th scope="col">Account name</th>
                <th scope="col">Description</th>
                <th scope="col">Category</th>
                <th scope="col" className="numeric">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td data-label="Date">{formatDate(transaction.transactionDate)}</td>
                  <td data-label="Account name">{formatText(transaction.accountName)}</td>
                  <td data-label="Description">{formatText(transaction.description)}</td>
                  <td data-label="Category">{formatText(transaction.category)}</td>
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
