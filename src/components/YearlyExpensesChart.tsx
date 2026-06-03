import type { Expense } from '../types/finance';

type MonthlyExpenseSummary = {
  month: string;
  total: number;
  count: number;
  transactions: Expense[];
};

type YearlyExpensesChartProps = {
  summaries: MonthlyExpenseSummary[];
  isLoading: boolean;
  error: string | null;
  selectedMonth: string;
  selectedYear: string;
  categoryOptions: string[];
  selectedCategory: string | null;
  onMonthChange: (month: string) => void;
  onCategoryChange: (category: string | null) => void;
};

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
});

const shortMonthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
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

function getShortMonthLabel(month: string, year: string): string {
  return shortMonthFormatter.format(new Date(`${year}-${month}-01T00:00:00`));
}

function formatCurrency(value: number): string {
  return usdFormatter.format(value);
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

function formatText(value: string): string {
  return value.trim() ? value : '—';
}

function formatCategory(value: string): string {
  return value.trim() || 'Uncategorized';
}

function getExpenseAmount(expense: Expense): number {
  if (expense.expenseAmount !== null) {
    return expense.expenseAmount;
  }

  return Math.abs(expense.amount ?? 0);
}

export function YearlyExpensesChart({
  summaries,
  isLoading,
  error,
  selectedMonth,
  selectedYear,
  categoryOptions,
  selectedCategory,
  onMonthChange,
  onCategoryChange,
}: YearlyExpensesChartProps) {
  const completeSummaries = monthKeys.map((month) => {
    const summary = summaries.find((item) => item.month === month);

    return {
      month,
      label: getMonthLabel(month, selectedYear),
      shortLabel: getShortMonthLabel(month, selectedYear),
      total: summary?.total ?? 0,
      count: summary?.count ?? 0,
      transactions: summary?.transactions ?? [],
    };
  });
  const yearlyTotal = completeSummaries.reduce((sum, summary) => sum + summary.total, 0);
  const activeMonthCount = completeSummaries.filter((summary) => summary.total > 0).length;
  const monthlyAverage = activeMonthCount === 0 ? 0 : yearlyTotal / activeMonthCount;
  const highestMonth = completeSummaries.reduce((highest, summary) =>
    summary.total > highest.total ? summary : highest,
  );
  const maxMonthTotal = Math.max(...completeSummaries.map((summary) => summary.total), 0);
  const chartScope = selectedCategory ?? 'all categories';
  const selectedSummary =
    completeSummaries.find((summary) => summary.month === selectedMonth) ??
    completeSummaries[0];

  return (
    <section
      className="content-section yearly-expenses-section"
      aria-labelledby="yearly-expenses-heading"
    >
      <div className="section-heading yearly-expenses-heading">
        <div>
          <h2 id="yearly-expenses-heading">Expenses by Month</h2>
          <p>
            Monthly spending for {chartScope} across {selectedYear}.
          </p>
        </div>
        <div className="yearly-chart-controls">
          <label className="category-select">
            <span>Category</span>
            <select
              value={selectedCategory ?? 'all'}
              onChange={(event) =>
                onCategoryChange(
                  event.target.value === 'all' ? null : event.target.value,
                )
              }
            >
              <option value="all">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="month-select">
            <span>Month</span>
            <select
              value={selectedMonth}
              onChange={(event) => onMonthChange(event.target.value)}
            >
              {completeSummaries.map((summary) => (
                <option key={summary.month} value={summary.month}>
                  {summary.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {isLoading && <p className="panel-state">Loading yearly expenses...</p>}

      {error && !isLoading && (
        <div className="panel-state error-message" role="alert">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="yearly-expenses-body">
          <div className="income-metrics">
            <article>
              <span className="toolbar-label">
                {selectedCategory === null ? 'Yearly expenses' : 'Category expenses'}
              </span>
              <strong>{formatCurrency(yearlyTotal)}</strong>
            </article>
            <article>
              <span className="toolbar-label">Monthly average</span>
              <strong>{formatCurrency(monthlyAverage)}</strong>
            </article>
            <article>
              <span className="toolbar-label">Highest month</span>
              <strong>{highestMonth.total > 0 ? highestMonth.shortLabel : '—'}</strong>
            </article>
          </div>

          <div className="yearly-expenses-chart" aria-label="Expenses by month">
            {completeSummaries.map((summary) => {
              const isSelected = selectedMonth === summary.month;

              return (
                <button
                  type="button"
                  className={`yearly-expense-bar ${
                    isSelected ? 'selected-expense-month' : ''
                  }`}
                  key={summary.month}
                  aria-pressed={isSelected}
                  onClick={() => onMonthChange(summary.month)}
                >
                  <span>{summary.shortLabel}</span>
                  <div className="yearly-expense-bar-column">
                    <div
                      className="yearly-expense-bar-fill"
                      style={{
                        height:
                          maxMonthTotal === 0
                            ? '0%'
                            : `${Math.max((summary.total / maxMonthTotal) * 100, 3)}%`,
                      }}
                    />
                  </div>
                  <strong>{formatCurrency(summary.total)}</strong>
                  <small>{summary.count} entries</small>
                </button>
              );
            })}
          </div>

          <div className="yearly-expenses-transactions">
            <div className="yearly-transactions-heading">
              <div>
                <h3>{selectedSummary.label} Expenses</h3>
                <p>
                  {selectedCategory === null
                    ? 'All categories'
                    : selectedCategory}{' '}
                  · {formatCurrency(selectedSummary.total)}
                </p>
              </div>
              <span>{selectedSummary.count} entries</span>
            </div>

            {selectedSummary.transactions.length === 0 && (
              <p className="panel-state compact-state">
                No expenses found for {selectedSummary.label}.
              </p>
            )}

            {selectedSummary.transactions.length > 0 && (
              <div className="table-shell yearly-transactions-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Account name</th>
                      <th scope="col">Description</th>
                      <th scope="col">Category</th>
                      <th scope="col" className="numeric">
                        Expense
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSummary.transactions.map((expense) => (
                      <tr key={expense.id}>
                        <td data-label="Date">{formatDate(expense.transactionDate)}</td>
                        <td data-label="Account name">
                          {formatText(expense.accountName)}
                        </td>
                        <td data-label="Description">
                          {formatText(expense.description)}
                        </td>
                        <td data-label="Category">{formatCategory(expense.category)}</td>
                        <td data-label="Expense" className="numeric amount negative-amount">
                          {formatCurrency(getExpenseAmount(expense))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
