import { useEffect, useMemo, useState } from 'react';
import { getExpensesReport } from '../api/financesApi';
import type { Expense, ExpensesReport } from '../types/finance';

type Range = {
  start: string;
  end: string;
};

type MonthReport = {
  month: string;
  report: ExpensesReport;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
});

function getMonthsInRange(range: Range): string[] {
  if (!/^\d{4}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}$/.test(range.end)) {
    return [];
  }

  const [startYear, startMonth] = range.start.split('-').map(Number);
  const [endYear, endMonth] = range.end.split('-').map(Number);
  const startIndex = startYear * 12 + startMonth - 1;
  const endIndex = endYear * 12 + endMonth - 1;

  if (startIndex > endIndex) {
    return [];
  }

  return Array.from({ length: endIndex - startIndex + 1 }, (_, index) => {
    const monthIndex = startIndex + index;
    const year = Math.floor(monthIndex / 12);
    const month = String((monthIndex % 12) + 1).padStart(2, '0');
    return `${year}-${month}`;
  });
}

function formatMonth(value: string): string {
  return monthFormatter.format(new Date(`${value}-01T00:00:00`));
}

function formatCategory(value: string): string {
  return value.trim() || 'Uncategorized';
}

function getExpenseAmount(expense: Expense): number {
  return expense.expenseAmount ?? Math.abs(expense.amount ?? 0);
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createCsv(transactions: Expense[]): string {
  const header = ['date', 'month', 'description', 'account', 'category', 'parent_category', 'amount'];
  const rows = transactions.map((expense) => [
    expense.transactionDate,
    expense.month,
    expense.description,
    expense.accountName,
    formatCategory(expense.category),
    expense.parentCategory,
    getExpenseAmount(expense).toFixed(2),
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function createAiText(
  title: string,
  category: string,
  transactions: Expense[],
): string {
  const monthlyTotals = new Map<string, number>();
  for (const expense of transactions) {
    const month = expense.month || expense.transactionDate.slice(0, 7);
    monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + getExpenseAmount(expense));
  }

  const total = transactions.reduce((sum, expense) => sum + getExpenseAmount(expense), 0);
  const monthlyLines = [...monthlyTotals.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([month, amount]) => `- ${month}: ${amount.toFixed(2)}`)
    .join('\n');
  const transactionLines = transactions
    .map((expense) =>
      [
        expense.transactionDate,
        getExpenseAmount(expense).toFixed(2),
        expense.description.trim() || 'Unknown description',
        expense.accountName.trim() || 'Unknown account',
      ].join(' | '),
    )
    .join('\n');

  return `Expense data for AI analysis
Category: ${category}
Range: ${title}
Currency: USD
Transaction count: ${transactions.length}
Total: ${total.toFixed(2)}

Monthly totals:
${monthlyLines || '(none)'}

Transactions (date | amount | description | account):
${transactionLines || '(none)'}

Suggested analysis: Identify unusually high or low months, potential duplicate or miscategorized transactions, changes in average monthly spending, and trends that may reflect inflation. Distinguish changes in price levels from changes in purchase frequency where the data permits.`;
}

function getCategoryTotal(report: ExpensesReport, category: string): number {
  return report.transactions
    .filter((expense) => formatCategory(expense.category) === category)
    .reduce((total, expense) => total + getExpenseAmount(expense), 0);
}

async function loadRange(range: Range, signal: AbortSignal): Promise<MonthReport[]> {
  const months = getMonthsInRange(range);
  const reports: MonthReport[] = new Array(months.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < months.length) {
      const index = nextIndex;
      nextIndex += 1;
      const month = months[index];
      reports[index] = {
        month,
        report: await getExpensesReport(
          month.slice(0, 4),
          month.slice(5, 7),
          undefined,
          signal,
        ),
      };
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(4, months.length) }, () => worker()),
  );
  return reports;
}

export function ComparisonPage() {
  const [firstRange, setFirstRange] = useState<Range>({
    start: '2025-01',
    end: '2025-12',
  });
  const [secondRange, setSecondRange] = useState<Range>({
    start: '2020-01',
    end: '2020-12',
  });
  const [firstReports, setFirstReports] = useState<MonthReport[]>([]);
  const [secondReports, setSecondReports] = useState<MonthReport[]>([]);
  const [category, setCategory] = useState('Groceries');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rangesAreValid =
    getMonthsInRange(firstRange).length > 0 && getMonthsInRange(secondRange).length > 0;

  useEffect(() => {
    if (!rangesAreValid) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadComparison() {
      setIsLoading(true);
      setError(null);

      try {
        const nextFirstReports = await loadRange(firstRange, controller.signal);
        const nextSecondReports = await loadRange(secondRange, controller.signal);

        if (isMounted) {
          setFirstReports(nextFirstReports);
          setSecondReports(nextSecondReports);
        }
      } catch (caughtError) {
        if (caughtError instanceof DOMException && caughtError.name === 'AbortError') {
          return;
        }

        if (isMounted) {
          setFirstReports([]);
          setSecondReports([]);
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load comparison data.',
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadComparison();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [firstRange, secondRange, rangesAreValid]);

  const categories = useMemo(
    () =>
      [
        ...new Set(
          [...firstReports, ...secondReports].flatMap(({ report }) =>
            report.transactions.map((expense) => formatCategory(expense.category)),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [firstReports, secondReports],
  );

  const selectedCategory = categories.includes(category)
    ? category
    : categories.find((item) => item.toLowerCase().includes('grocer')) ??
      categories[0] ??
      category;

  const firstTotals = firstReports.map(({ month, report }) => ({
    month,
    total: getCategoryTotal(report, selectedCategory),
  }));
  const secondTotals = secondReports.map(({ month, report }) => ({
    month,
    total: getCategoryTotal(report, selectedCategory),
  }));
  const getTransactions = (reports: MonthReport[]) =>
    reports
      .flatMap(({ report }) => report.transactions)
      .filter((expense) => formatCategory(expense.category) === selectedCategory)
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  const firstTransactions = getTransactions(firstReports);
  const secondTransactions = getTransactions(secondReports);
  const firstTotal = firstTotals.reduce((sum, item) => sum + item.total, 0);
  const secondTotal = secondTotals.reduce((sum, item) => sum + item.total, 0);
  const difference = firstTotal - secondTotal;
  const maxMonthlyTotal = Math.max(
    ...firstTotals.map((item) => item.total),
    ...secondTotals.map((item) => item.total),
    0,
  );
  const comparisonRows = Array.from(
    { length: Math.max(firstTotals.length, secondTotals.length) },
    (_, index) => ({ first: firstTotals[index], second: secondTotals[index] }),
  );

  return (
    <main className="app-shell">
      <header className="dashboard-header page-header">
        <div>
          <h1>Comparison</h1>
          <p>Compare spending for one category across two month ranges.</p>
        </div>
        <nav aria-label="Primary navigation">
          <a href="/">Dashboard</a>
          <a href="/compare" aria-current="page">Comparison</a>
        </nav>
      </header>

      <section className="content-section comparison-controls" aria-labelledby="comparison-filters">
        <div className="section-heading">
          <div>
            <h2 id="comparison-filters">Comparison filters</h2>
            <p>Select two ranges and a spending category.</p>
          </div>
        </div>
        <div className="comparison-filter-grid">
          <fieldset>
            <legend>First range</legend>
            <label><span>Start month</span><input type="month" value={firstRange.start} onChange={(event) => setFirstRange((range) => ({ ...range, start: event.target.value }))} /></label>
            <label><span>End month</span><input type="month" value={firstRange.end} onChange={(event) => setFirstRange((range) => ({ ...range, end: event.target.value }))} /></label>
          </fieldset>
          <fieldset>
            <legend>Second range</legend>
            <label><span>Start month</span><input type="month" value={secondRange.start} onChange={(event) => setSecondRange((range) => ({ ...range, start: event.target.value }))} /></label>
            <label><span>End month</span><input type="month" value={secondRange.end} onChange={(event) => setSecondRange((range) => ({ ...range, end: event.target.value }))} /></label>
          </fieldset>
          <label className="comparison-category">
            <span>Category</span>
            <select value={selectedCategory} onChange={(event) => setCategory(event.target.value)} disabled={categories.length === 0}>
              {categories.length === 0 && <option value={category}>{category}</option>}
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </section>

      {rangesAreValid && isLoading && <p className="status-message">Loading comparison...</p>}
      {!rangesAreValid && <div className="status-message error-message" role="alert">Each start month must be before or equal to its end month.</div>}
      {rangesAreValid && error && !isLoading && <div className="status-message error-message" role="alert">{error}</div>}

      {rangesAreValid && !isLoading && !error && (
        <section className="content-section" aria-labelledby="comparison-results">
          <div className="section-heading">
            <div>
              <h2 id="comparison-results">{selectedCategory}</h2>
              <p>Monthly totals are aligned by their position within each range.</p>
            </div>
          </div>
          <div className="comparison-body">
            <div className="comparison-metrics">
              <article><span>{firstRange.start} to {firstRange.end}</span><strong>{currencyFormatter.format(firstTotal)}</strong></article>
              <article><span>{secondRange.start} to {secondRange.end}</span><strong>{currencyFormatter.format(secondTotal)}</strong></article>
              <article><span>Difference</span><strong className={difference > 0 ? 'negative-amount' : 'positive-amount'}>{difference > 0 ? '+' : ''}{currencyFormatter.format(difference)}</strong></article>
            </div>
            <div className="comparison-export-toolbar" aria-label="Export comparison data">
              <div>
                <strong>Export data for AI analysis</strong>
                <p>Copy structured text or download the individual transactions as CSV.</p>
              </div>
              <div className="comparison-export-ranges">
                <ExportActions
                  label={firstRange.start === firstRange.end ? firstRange.start : `${firstRange.start}–${firstRange.end}`}
                  title={`${firstRange.start} to ${firstRange.end}`}
                  category={selectedCategory}
                  transactions={firstTransactions}
                />
                <ExportActions
                  label={secondRange.start === secondRange.end ? secondRange.start : `${secondRange.start}–${secondRange.end}`}
                  title={`${secondRange.start} to ${secondRange.end}`}
                  category={selectedCategory}
                  transactions={secondTransactions}
                />
              </div>
            </div>
            <div className="table-shell comparison-table">
              <table>
                <thead><tr><th>First range</th><th className="numeric">Amount</th><th>Second range</th><th className="numeric">Amount</th></tr></thead>
                <tbody>
                  {comparisonRows.map(({ first, second }, index) => (
                    <tr key={index}>
                      <td data-label="First range">{first ? formatMonth(first.month) : '—'}{first && <span className="comparison-bar"><i style={{ width: maxMonthlyTotal === 0 ? '0%' : `${(first.total / maxMonthlyTotal) * 100}%` }} /></span>}</td>
                      <td data-label="First amount" className="numeric">{first ? currencyFormatter.format(first.total) : '—'}</td>
                      <td data-label="Second range">{second ? formatMonth(second.month) : '—'}{second && <span className="comparison-bar secondary"><i style={{ width: maxMonthlyTotal === 0 ? '0%' : `${(second.total / maxMonthlyTotal) * 100}%` }} /></span>}</td>
                      <td data-label="Second amount" className="numeric">{second ? currencyFormatter.format(second.total) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="comparison-transactions-grid">
              <TransactionList
                title={`${firstRange.start} to ${firstRange.end}`}
                transactions={firstTransactions}
                total={firstTotal}
              />
              <TransactionList
                title={`${secondRange.start} to ${secondRange.end}`}
                transactions={secondTransactions}
                total={secondTotal}
              />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function TransactionList({
  title,
  transactions,
  total,
}: {
  title: string;
  transactions: Expense[];
  total: number;
}) {
  return (
    <section className="comparison-transactions" aria-label={`${title} transactions`}>
      <div className="comparison-transactions-heading">
        <div>
          <h3>{title}</h3>
          <p>{transactions.length} transactions</p>
        </div>
        <strong>{currencyFormatter.format(total)}</strong>
      </div>
      {transactions.length === 0 ? (
        <p className="panel-state">No matching transactions.</p>
      ) : (
        <div className="table-shell">
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th>Account</th><th className="numeric">Amount</th></tr>
            </thead>
            <tbody>
              {transactions.map((expense) => (
                <tr key={expense.id}>
                  <td data-label="Date">{expense.transactionDate || '—'}</td>
                  <td data-label="Description">{expense.description.trim() || '—'}</td>
                  <td data-label="Account">{expense.accountName.trim() || '—'}</td>
                  <td data-label="Amount" className="numeric">{currencyFormatter.format(getExpenseAmount(expense))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ExportActions({
  label,
  title,
  category,
  transactions,
}: {
  label: string;
  title: string;
  category: string;
  transactions: Expense[];
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  async function copyForAi() {
    try {
      await navigator.clipboard.writeText(createAiText(title, category, transactions));
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
    }
  }

  function downloadCsv() {
    const blob = new Blob([createCsv(transactions)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${title.replace(/\s+to\s+/g, '_')}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="comparison-export-range">
      <span>{label}</span>
      <button type="button" onClick={copyForAi} disabled={transactions.length === 0}>
        {copyStatus === 'copied' ? 'Copied!' : copyStatus === 'error' ? 'Copy failed' : 'Copy for AI'}
      </button>
      <button type="button" onClick={downloadCsv} disabled={transactions.length === 0}>
        Download CSV
      </button>
    </div>
  );
}
