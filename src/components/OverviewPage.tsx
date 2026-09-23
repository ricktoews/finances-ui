import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ReactNode } from 'react';
import type { Statement } from '../types/finance';
import { loadOverviewMonth, overviewMonths } from './overviewData';
import { canonicalTransactionId, getStatements } from '../api/financesApi';
import { categoryCounts, statementDate, statementLabel, statementTransactions } from './verifiedStatementData';
import type { LoadedStatement } from './verifiedStatementData';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const colors = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee', '#f472b6'];
function isCardPayment(name: string) { return /^credit[\s_-]+card[\s_-]+payments?$/i.test(name.trim()); }
function monthLabel(month: string) {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function formatAmount(amount: unknown) {
  const value = typeof amount === 'number' ? amount : typeof amount === 'string' && amount.trim() ? Number(amount.replace(/[$,]/g, '').replace(/^\((.*)\)$/, '-$1')) : NaN;
  return Number.isFinite(value) ? money.format(value) : 'Amount unavailable';
}

function sourceLabel(file: LoadedStatement) {
  const label = statementLabel(file);
  const institution = String(file.data?.financial_institution ?? '').trim();
  const bank = /bank of america/i.test(institution) ? 'BofA' : institution;
  return bank && !label.toLowerCase().includes(institution.toLowerCase()) ? `${bank} · ${label}` : label;
}

export function OverviewPage({ navigationActions }: { navigationActions: HTMLElement | null }) {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    getStatements(controller.signal).then((result) => {
      if (!controller.signal.aborted) setStatements(result);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load statements.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const months = overviewMonths(statements);
  const month = months.includes(selectedMonth) ? selectedMonth : months[0] ?? '';
  if (loading) return <p className="status-message" role="status">Loading statements…</p>;
  if (error) return <p className="status-message error-message" role="alert">{error} <button onClick={() => { setError(null); setLoading(true); setAttempt((value) => value + 1); }}>Retry</button></p>;
  if (!month) return <p className="status-message">No dated statements are available.</p>;
  const heading = <header className="overview-month-heading">
    <div><p>Latest activity{month !== months[0] ? ' · Earlier month' : ''}</p><h1>{monthLabel(month)}</h1></div>
    <label><span>Statement month</span><select value={month} onChange={(event) => setSelectedMonth(event.target.value)}>{months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label>
  </header>;
  return <OverviewMonth key={month} statements={statements} month={month} heading={heading} navigationActions={navigationActions} />;
}

function OverviewMonth({ statements, month, heading, navigationActions }: { statements: Statement[]; month: string; heading: ReactNode; navigationActions: HTMLElement | null }) {
  const hatchId = useId().replace(/[^a-zA-Z0-9_-]/g, '') + '-uncategorized';
  const [files, setFiles] = useState<LoadedStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const loaded = await loadOverviewMonth(statements, month, controller.signal);
        if (!controller.signal.aborted) setFiles(loaded);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load transactions.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt, statements, month]);

  const monthFiles = files;
  const counts = categoryCounts(monthFiles);

  counts.sort((a, b) =>
    Number(a.name === 'Uncategorized') - Number(b.name === 'Uncategorized')
    || Number(isCardPayment(a.name)) - Number(isCardPayment(b.name))
    || Math.abs(b.amountCents) - Math.abs(a.amountCents)
    || a.name.localeCompare(b.name),
  );
  const total = counts.reduce((sum, category) => sum + category.value, 0);
  const chartCategories = counts.map((category, colorIndex) => ({ ...category, colorIndex, chartAmount: Math.abs(category.amountCents) }))
    .filter((category) => !isCardPayment(category.name));
  const chartHasAmounts = chartCategories.some((category) => category.chartAmount > 0);
  const totalAmountCents = chartCategories.reduce((sum, category) => sum + category.chartAmount, 0);
  const amountsComplete = chartCategories.every((category) => category.missingAmounts === 0);
  const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
  const seen = new Set<string>();
  const transactions = monthFiles.flatMap((file) => statementTransactions(file.data ?? {}).flatMap((row, index) => {
    const transactionId = row.transaction_id ?? row.transactionId;
    if (typeof transactionId === 'string' && transactionId) {
      if (seen.has(transactionId)) return [];
      seen.add(transactionId);
    }
    const id = canonicalTransactionId(transactionId) || `${file.fileName}:${index}`;
    const category = typeof row.category === 'string' && row.category.trim() ? row.category.trim() : 'Uncategorized';
    const parentCategory = typeof row.parent_category === 'string' && row.parent_category.trim() ? row.parent_category.trim() : category;
    return [{ id, date: String(row.transaction_date ?? row.transactionDate ?? row.date ?? ''), description: String(row.description ?? 'Transaction'), category, parentCategory, merchant: typeof row.merchant === 'string' ? row.merchant : null, amount: row.amount, source: sourceLabel(file) }];
  })).sort((a, b) => b.date.localeCompare(a.date));
  function downloadStatements() {
    const statements = monthFiles.filter((file) => file.data && !file.error)
      .map((file) => ({ fileName: file.fileName, data: file.data }));
    if (!statements.length) return;
    const blob = new Blob([JSON.stringify({ month, statements }, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `statements-${month}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function retry() { setError(null); setLoading(true); setAttempt((value) => value + 1); }

  if (loading) return <>{heading}<p className="status-message" role="status">Loading transactions for {monthLabel(month)}…</p></>;
  if (error) return <div className="status-message error-message" role="alert">{error} <button onClick={retry}>Retry</button></div>;


  return <div className="overview-month">
    {navigationActions && createPortal(<button type="button" className="overview-download-button"
      disabled={!monthFiles.some((file) => file.data && !file.error)}
      onClick={downloadStatements} title={`Download statement JSON for ${monthLabel(month)}`}>
      Download
    </button>, navigationActions)}
    {heading}
    {files.some((file) => file.error || !statementDate(file)) && <div className="status-message error-message" role="alert">Some statements could not be loaded or dated. This month’s totals may be incomplete. {[...new Set(files.flatMap((file) => file.error ? [file.error] : []))].join(' ')} <button onClick={retry}>Retry</button></div>}
    <section className="overview-category-panel" aria-labelledby="overview-category-heading">
      <div className="overview-category-intro"><div><h2 id="overview-category-heading">Transactions by category</h2><p>{total} transactions · {monthFiles.length} statements</p></div></div>
      <div className="overview-statement-sources"><span>Statements included</span><ul>{monthFiles.filter((entry) => entry.data && !entry.error).map((entry) => <li key={entry.fileName}>{sourceLabel(entry)} <small>· {statementDate(entry)}</small></li>)}</ul></div>
      <div className="overview-category-layout">
        <div className="overview-chart-area">
          {chartHasAmounts && <div className="overview-donut"><ResponsiveContainer width="100%" height={190}><PieChart><defs><pattern id={hatchId} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><rect width="7" height="7" fill="#6b7280" /><line x1="0" y1="0" x2="0" y2="7" stroke="#d1d5db" strokeWidth="2" /></pattern></defs><Pie data={chartCategories} dataKey="chartAmount" nameKey="name" innerRadius={55} outerRadius={82} isAnimationActive={false}>{chartCategories.map((category) => <Cell key={category.name} fill={category.name === 'Uncategorized' ? `url(#${hatchId})` : colors[category.colorIndex % colors.length]} />)}</Pie><Tooltip formatter={(_value, name) => {
            const category = counts.find((entry) => entry.name === name);
            return [category ? `${money.format(category.amountCents / 100)}${category.missingAmounts ? ' (incomplete)' : ''}` : 'Amount unavailable', name];
          }} /></PieChart></ResponsiveContainer></div>}
          {!chartHasAmounts && total > 0 && <p className="panel-state">No nonzero category totals to chart.</p>}
          <p className="overview-chart-note">Wedges show the absolute size of each category’s net dollar total, excluding credit card payments. Credit card payments remain in the list. Tooltips and list amounts retain their signs; list percentages show each category’s share of the chart total. Based on statements closing in {monthLabel(month)}, including their full billing periods.</p>
        </div>
        {total === 0 ? <p className="panel-state">No imported transactions were returned for this month’s statements.</p> : <ul className="overview-category-list">{counts.map((category, index) => <li key={category.name}>
          <button className="overview-category-toggle" aria-expanded={expanded === category.name} aria-controls={`overview-category-${index}`} onClick={() => setExpanded((value) => value === category.name ? null : category.name)}>
            <span className="category-dot" style={{ background: category.name === 'Uncategorized' ? 'repeating-linear-gradient(135deg, #6b7280 0 3px, #d1d5db 3px 5px, #6b7280 5px 7px)' : colors[index % colors.length] }} />
            <span className="overview-category-name"><strong>{category.name}</strong><small>{category.value} transactions</small></span>
            <span className="overview-category-amount"><strong>{money.format(category.amountCents / 100)}</strong><small>{isCardPayment(category.name) ? 'Excluded from chart' : amountsComplete && totalAmountCents > 0 ? `${percent.format(Math.abs(category.amountCents) / totalAmountCents)} of total` : 'Share unavailable'}</small>{category.missingAmounts > 0 && <small>Incomplete</small>}</span>
            <span aria-hidden="true">{expanded === category.name ? '−' : '+'}</span>
          </button>
          <div id={`overview-category-${index}`} hidden={expanded !== category.name}>
            {expanded === category.name && (category.children.some((child) => !child.ungrouped)
              ? <div className="overview-subcategory-list">{category.children.map((child) => <details key={`${month}:${child.name}`} className="overview-subcategory">
                <summary>
                  <span className="overview-category-name"><strong>{child.ungrouped ? 'Other / ungrouped' : child.name}</strong><small>{child.value} {child.value === 1 ? 'transaction' : 'transactions'}</small></span>
                  <span className="overview-category-amount"><strong>{money.format(child.amountCents / 100)}</strong>{child.missingAmounts > 0 && <small>Incomplete</small>}</span>
                </summary>
                <OverviewTransactions transactions={transactions.filter((transaction) => transaction.parentCategory === category.name && transaction.category === child.name)} />
              </details>)}</div>
              : <OverviewTransactions transactions={transactions.filter((transaction) => transaction.parentCategory === category.name)} />)}
          </div>
        </li>)}</ul>}
      </div>
    </section>
  </div>;
}


type OverviewTransaction = { id: string; date: string; source: string; description: string; amount: unknown; merchant?: string | null };

function OverviewTransactions({ transactions }: { transactions: OverviewTransaction[] }) {
  return <ul className="overview-transaction-list">{transactions.map((transaction) => <li key={transaction.id}>
    <div><span className="overview-transaction-date">{transaction.date || 'Date unavailable'} · {transaction.source}</span><p>{transaction.description}</p>{transaction.merchant && <small>Merchant: {transaction.merchant}</small>}</div><strong>{formatAmount(transaction.amount)}</strong>
  </li>)}</ul>;
}
