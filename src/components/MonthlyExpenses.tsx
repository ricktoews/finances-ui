import type { Expense, ExpensesReport } from '../types/finance';

type MonthlyExpensesProps = {
  report: ExpensesReport | null;
  isLoading: boolean;
  error: string | null;
  selectedMonth: string;
  selectedYear: string;
  onMonthChange: (month: string) => void;
  selectedCategory: string | null;
  categoryReport: ExpensesReport | null;
  isCategoryLoading: boolean;
  categoryError: string | null;
  onCategoryChange: (category: string | null) => void;
};

type CategorySummary = {
  category: string;
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

function formatCategory(value: string): string {
  return value.trim() || 'Uncategorized';
}

function getExpenseAmount(expense: Expense): number {
  if (expense.expenseAmount !== null) {
    return expense.expenseAmount;
  }

  return Math.abs(expense.amount ?? 0);
}

export function MonthlyExpenses({
  report,
  isLoading,
  error,
  selectedMonth,
  selectedYear,
  onMonthChange,
  selectedCategory,
  categoryReport,
  isCategoryLoading,
  categoryError,
  onCategoryChange,
}: MonthlyExpensesProps) {
  const expenses = report?.transactions ?? [];
  const totalExpenses = report?.summary.selectedTotal ?? expenses.reduce(
    (sum, expense) => sum + getExpenseAmount(expense),
    0,
  );
  const categorySummaries = [...expenses.reduce((summaries, expense) => {
    const category = formatCategory(expense.category);
    const current = summaries.get(category) ?? { category, total: 0, count: 0 };

    summaries.set(category, {
      category,
      total: current.total + getExpenseAmount(expense),
      count: current.count + 1,
    });

    return summaries;
  }, new Map<string, CategorySummary>()).values()].sort((a, b) => b.total - a.total);
  const maxCategoryTotal = Math.max(
    ...categorySummaries.map((summary) => summary.total),
    0,
  );
  const largestCategory = categorySummaries[0];

  function handleMonthChange(month: string) {
    onMonthChange(month);
  }

  function handleCategorySelect(category: string) {
    onCategoryChange(selectedCategory === category ? null : category);
  }

  return (
    <section className="content-section expenses-section" aria-labelledby="expenses-heading">
      <div className="section-heading expenses-heading">
        <div>
          <h2 id="expenses-heading">Monthly Expenses</h2>
          <p>
            Categorized spending for {getMonthLabel(selectedMonth, selectedYear)}{' '}
            {selectedYear}.
          </p>
        </div>
        <label className="month-select">
          <span>Month</span>
          <select
            value={selectedMonth}
            onChange={(event) => handleMonthChange(event.target.value)}
          >
            {monthKeys.map((month) => (
              <option key={month} value={month}>
                {getMonthLabel(month, selectedYear)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p className="panel-state">Loading expenses...</p>}

      {error && !isLoading && (
        <div className="panel-state error-message" role="alert">
          {error}
        </div>
      )}

      {!isLoading && !error && expenses.length === 0 && (
        <p className="panel-state">
          No expenses found for {getMonthLabel(selectedMonth, selectedYear)} {selectedYear}.
        </p>
      )}

      {!isLoading && !error && expenses.length > 0 && (
        <div className="expenses-body">
          <div className="income-metrics">
            <article>
              <span className="toolbar-label">Total expenses</span>
              <strong>{formatCurrency(totalExpenses)}</strong>
            </article>
            <article>
              <span className="toolbar-label">Expense entries</span>
              <strong>{expenses.length}</strong>
            </article>
            <article>
              <span className="toolbar-label">Top category</span>
              <strong>{largestCategory?.category ?? '—'}</strong>
            </article>
          </div>

          <div className="expense-category-list" aria-label="Expenses by category">
            {categorySummaries.map((summary) => {
              const isSelected = selectedCategory === summary.category;
              let runningTotal = 0;

              return (
                <div className="category-group" key={summary.category}>
                  <button
                    type="button"
                    className={`income-bar-row category-bar-row ${
                      isSelected ? 'selected-category' : ''
                    }`}
                    aria-expanded={isSelected}
                    onClick={() => handleCategorySelect(summary.category)}
                  >
                    <span>{summary.category}</span>
                    <div className="income-bar-track">
                      <div
                        className="expense-bar-fill"
                        style={{
                          width:
                            maxCategoryTotal === 0
                              ? '0%'
                              : `${Math.max((summary.total / maxCategoryTotal) * 100, 2)}%`,
                        }}
                      />
                    </div>
                    <strong>{formatCurrency(summary.total)}</strong>
                  </button>

                  {isSelected && (
                    <div className="category-inline-transactions">
                      {isCategoryLoading && (
                        <p className="panel-state compact-state">
                          Loading {summary.category} expenses...
                        </p>
                      )}

                      {categoryError && !isCategoryLoading && (
                        <div className="panel-state error-message" role="alert">
                          {categoryError}
                        </div>
                      )}

                      {!isCategoryLoading &&
                        !categoryError &&
                        categoryReport !== null &&
                        categoryReport.transactions.length === 0 && (
                          <p className="panel-state compact-state">
                            No transactions found for this category.
                          </p>
                        )}

                      {!isCategoryLoading &&
                        !categoryError &&
                        categoryReport !== null &&
                        categoryReport.transactions.length > 0 && (
                          <div className="table-shell category-expenses-transactions">
                            <table>
                              <thead>
                                <tr>
                                  <th scope="col">Date</th>
                                  <th scope="col">Description</th>
                                  <th scope="col" className="numeric">
                                    Expense
                                  </th>
                                  <th scope="col" className="numeric">
                                    Running total
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {categoryReport.transactions.map((expense) => {
                                  runningTotal += getExpenseAmount(expense);

                                  return (
                                    <tr key={expense.id}>
                                      <td data-label="Date">
                                        {formatDate(expense.transactionDate)}
                                      </td>
                                      <td data-label="Description">
                                        {formatText(expense.description)}
                                      </td>
                                      <td
                                        data-label="Expense"
                                        className="numeric amount negative-amount"
                                      >
                                        {formatCurrency(getExpenseAmount(expense))}
                                      </td>
                                      <td
                                        data-label="Running total"
                                        className="numeric amount"
                                      >
                                        {formatCurrency(runningTotal)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedCategory === null && (
            <p className="panel-state compact-state">
              Select a category to view its transactions.
            </p>
          )}

          <div className="table-shell expenses-transactions">
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
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td data-label="Date">{formatDate(expense.transactionDate)}</td>
                    <td data-label="Account name">{formatText(expense.accountName)}</td>
                    <td data-label="Description">{formatText(expense.description)}</td>
                    <td data-label="Category">{formatCategory(expense.category)}</td>
                    <td data-label="Expense" className="numeric amount negative-amount">
                      {formatCurrency(getExpenseAmount(expense))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
