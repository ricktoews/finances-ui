import type { Transaction } from '../types/finance';

type MonthlyIncomeProps = {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  selectedMonth: string;
  selectedYear: string;
  onMonthChange: (month: string) => void;
};

type MonthSummary = {
  key: string;
  label: string;
  total: number;
  count: number;
};

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
});

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const monthKeys = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, '0'),
);

function getMonthLabel(month: string, year: string): string {
  return monthFormatter.format(new Date(`${year}-${month}-01T00:00:00`));
}

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

function formatCurrency(value: number): string {
  return usdFormatter.format(value);
}

function formatText(value: string): string {
  return value.trim() ? value : '—';
}

function getIncomeTransactions(transactions: Transaction[], year: string) {
  return transactions
    .filter(
      (transaction) =>
        transaction.amount !== null &&
        transaction.amount > 0 &&
        transaction.transactionDate.startsWith(year),
    )
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
}

export function MonthlyIncome({
  transactions,
  isLoading,
  error,
  selectedMonth,
  selectedYear,
  onMonthChange,
}: MonthlyIncomeProps) {
  const incomeTransactions = getIncomeTransactions(transactions, selectedYear);
  const monthlySummaries: MonthSummary[] = monthKeys.map((month) => {
    const monthTransactions = incomeTransactions.filter(
      (transaction) => transaction.transactionDate.slice(5, 7) === month,
    );
    const total = monthTransactions.reduce(
      (sum, transaction) => sum + (transaction.amount ?? 0),
      0,
    );

    return {
      key: month,
      label: getMonthLabel(month, selectedYear),
      total,
      count: monthTransactions.length,
    };
  });
  const selectedTransactions =
    selectedMonth === 'all'
      ? incomeTransactions
      : incomeTransactions.filter(
          (transaction) => transaction.transactionDate.slice(5, 7) === selectedMonth,
        );
  const visibleSummaries =
    selectedMonth === 'all'
      ? monthlySummaries
      : monthlySummaries.filter((summary) => summary.key === selectedMonth);
  const annualIncome = incomeTransactions.reduce(
    (sum, transaction) => sum + (transaction.amount ?? 0),
    0,
  );
  const selectedIncome = selectedTransactions.reduce(
    (sum, transaction) => sum + (transaction.amount ?? 0),
    0,
  );
  const activeMonthCount = monthlySummaries.filter((summary) => summary.total > 0).length;
  const averageMonthlyIncome =
    activeMonthCount === 0 ? 0 : annualIncome / activeMonthCount;
  const maxMonthTotal = Math.max(...visibleSummaries.map((summary) => summary.total), 0);

  return (
    <section className="content-section income-section" aria-labelledby="income-heading">
      <div className="section-heading income-heading">
        <div>
          <h2 id="income-heading">Monthly Income</h2>
          <p>Positive checking and savings transactions for {selectedYear}.</p>
        </div>
        <label className="month-select">
          <span>Month</span>
          <select
            value={selectedMonth}
            onChange={(event) => onMonthChange(event.target.value)}
          >
            <option value="all">All months</option>
            {monthlySummaries.map((summary) => (
              <option key={summary.key} value={summary.key}>
                {summary.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p className="panel-state">Loading income...</p>}

      {error && !isLoading && (
        <div className="panel-state error-message" role="alert">
          {error}
        </div>
      )}

      {!isLoading && !error && incomeTransactions.length === 0 && (
        <p className="panel-state">No income transactions found for {selectedYear}.</p>
      )}

      {!isLoading && !error && incomeTransactions.length > 0 && (
        <div className="income-body">
          <div className="income-metrics">
            <article>
              <span className="toolbar-label">
                {selectedMonth === 'all' ? 'Total income' : 'Selected income'}
              </span>
              <strong>
                {formatCurrency(selectedMonth === 'all' ? annualIncome : selectedIncome)}
              </strong>
            </article>
            <article>
              <span className="toolbar-label">Monthly average</span>
              <strong>{formatCurrency(averageMonthlyIncome)}</strong>
            </article>
            <article>
              <span className="toolbar-label">Income entries</span>
              <strong>{selectedTransactions.length}</strong>
            </article>
          </div>

          <div className="income-chart" aria-label="Monthly income totals">
            {visibleSummaries.map((summary) => (
              <div className="income-bar-row" key={summary.key}>
                <span>{summary.label}</span>
                <div className="income-bar-track">
                  <div
                    className="income-bar-fill"
                    style={{
                      width:
                        maxMonthTotal === 0
                          ? '0%'
                          : `${Math.max((summary.total / maxMonthTotal) * 100, 2)}%`,
                    }}
                  />
                </div>
                <strong>{formatCurrency(summary.total)}</strong>
              </div>
            ))}
          </div>

          {selectedMonth !== 'all' && selectedTransactions.length === 0 && (
            <p className="panel-state compact-state">
              No income transactions found for this month.
            </p>
          )}

          {selectedMonth !== 'all' && selectedTransactions.length > 0 && (
            <div className="table-shell income-transactions">
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
                  {selectedTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td data-label="Date">{formatDate(transaction.transactionDate)}</td>
                      <td data-label="Account name">
                        {formatText(transaction.accountName)}
                      </td>
                      <td data-label="Description">
                        {formatText(transaction.description)}
                      </td>
                      <td data-label="Category">{formatText(transaction.category)}</td>
                      <td data-label="Amount" className="numeric amount positive-amount">
                        {formatCurrency(transaction.amount ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
