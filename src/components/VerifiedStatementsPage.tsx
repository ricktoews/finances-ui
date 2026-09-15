import { CategoryYearAverages } from './CategoryYearAverages';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { getCategories, getStatementPdfByFilename, getVerifiedStatementData, getVerifiedStatementFiles } from '../api/financesApi';
import type { Category } from '../types/finance';
import { ExtractedDepositStatement, ExtractedStatementSummary, ExtractedTransactions } from './JsonStatements';
import { categoryCounts, record, statementBillCents, statementDate, statementLabel, updateCategory } from './verifiedStatementData';
import type { LoadedStatement } from './verifiedStatementData';
import { HighlightedCategoryContext } from './HighlightedCategoryContext';

const months = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, '0'),
  name: new Date(2026, index, 1).toLocaleString('en-US', { month: 'long' }),
}));
const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6'];
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const percentage = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

export function VerifiedStatementsPage() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const yearControl = <label className="year-select"><span>Year</span>
      <input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} />
    </label>;
  return /^(20\d{2}|2100)$/.test(year)
    ? <StatementYear key={year} year={year} yearControl={yearControl} />
    : <><div className="dashboard-toolbar verified-month-toolbar">{yearControl}</div><p className="status-message">Enter a year from 2000 to 2100.</p></>;
}

function StatementYear({ year, yearControl }: { year: string; yearControl: ReactNode }) {
  const [files, setFiles] = useState<LoadedStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [month, setMonth] = useState('');
  const [selected, setSelected] = useState('');
  const [categoryHighlight, setCategoryHighlight] = useState<{ fileName: string; category: string } | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [categoryAttempt, setCategoryAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getCategories(controller.signal).then((result) => {
      if (!controller.signal.aborted) setCategories(result);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setCategoryError(caught instanceof Error ? caught.message : 'Unable to load categories.');
    });
    return () => controller.abort();
  }, [categoryAttempt]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const listing = await getVerifiedStatementFiles(year);
        if (controller.signal.aborted) return;
        const results: LoadedStatement[] = [];
        let index = 0;
        // Limit requests while resolving dates missing from the listing.
        await Promise.all(Array.from({ length: 4 }, async () => {
          while (index < listing.length && !controller.signal.aborted) {
            const file = listing[index++];
            try {
              const data = record(await getVerifiedStatementData(year, file.fileName, controller.signal));
              if (!Object.keys(data).length) throw new Error('Statement data is empty or invalid.');
              results.push({ ...file, data });
            } catch (caught) {
              results.push({ ...file, error: caught instanceof Error ? caught.message : 'Unable to load statement.' });
            }
          }
        }));
        if (!controller.signal.aborted) setFiles(results.sort((a, b) => statementDate(b).localeCompare(statementDate(a)) || a.fileName.localeCompare(b.fileName)));
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to load statements.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [year, attempt]);

  const visible = files.filter((file) => statementDate(file).slice(0, 7) === `${year}-${month}`);
  const undated = files.filter((file) => !statementDate(file));
  const file = files.find((candidate) => candidate.fileName === selected);
  const chartFiles = file ? [file] : visible;
  const counts = categoryCounts(chartFiles);
  const chartCategories = counts.map((entry, colorIndex) => ({ ...entry, colorIndex, chartAmount: Math.abs(entry.amountCents) }))
    .filter((entry) => !/^credit[\s_-]+card[\s_-]+payments?$/i.test(entry.name.trim()));
  const chartHasAmounts = chartCategories.some((entry) => entry.chartAmount > 0);
  const highlightedCategory = file && categoryHighlight?.fileName === file.fileName && counts.some((entry) => entry.name === categoryHighlight.category)
    ? categoryHighlight.category : null;
  const monthlyCategoryTotals = highlightedCategory ? months.map((item) => {
    const monthFiles = files.filter((entry) => statementDate(entry).slice(0, 7) === `${year}-${item.value}`);
    const category = categoryCounts(monthFiles).find((entry) => entry.name === highlightedCategory);
    return {
      ...item,
      amountCents: category?.amountCents ?? 0,
      hasData: monthFiles.some((entry) => entry.data),
      incomplete: monthFiles.some((entry) => entry.error || !entry.data) || Boolean(category?.missingAmounts),
    };
  }) : [];
  const completeMonthlyAmounts = monthlyCategoryTotals
    .filter((item) => item.hasData && !item.incomplete)
    .map((item) => item.amountCents);
  const monthCount = completeMonthlyAmounts.length;
  const meanCents = monthCount ? completeMonthlyAmounts.reduce((sum, amount) => sum + amount, 0) / monthCount : null;
  const billCents = statementBillCents(chartFiles);
  const total = counts.reduce((sum, category) => sum + category.value, 0);
  function retry() { setError(null); setLoading(true); setSelected(''); setAttempt((value) => value + 1); }
  function saved(transactionId: string, category: Category) {
    setFiles((current) => current.map((item) => item.data ? { ...item, data: updateCategory(item.data, transactionId, category) } : item));
  }
  return <>
    <div className="dashboard-toolbar verified-month-toolbar">
      {yearControl}
      <label className="month-select"><span>Month</span><select value={month} disabled={loading || Boolean(error)} onChange={(event) => { setMonth(event.target.value); setSelected(''); }}>
        <option value="">Choose a month…</option>
        {months.map((item) => <option key={item.value} value={item.value}>{item.name} ({files.filter((entry) => statementDate(entry).slice(0, 7) === `${year}-${item.value}`).length})</option>)}
      </select></label>
      <p>Files are grouped by statement closing month.</p>
      <button type="button" className="statement-pdf-button" aria-expanded={showPdf} onClick={() => setShowPdf((current) => !current)}>
        {showPdf ? 'Hide PDF' : 'Show PDF'}
      </button>
    </div>
    {loading && <p className="status-message" role="status">Loading verified statements for {year}…</p>}
    {error && <div className="status-message error-message" role="alert">{error} <button onClick={retry}>Retry</button></div>}
    {!loading && !error && files.length === 0 && <p className="status-message">No verified statements found for {year}.</p>}
    {!loading && !error && files.some((entry) => entry.error) && <div className="status-message error-message" role="alert">Some statement files could not be loaded. Category counts may be incomplete. <button onClick={retry}>Retry files</button></div>}
    {!loading && !error && month && <div className="verified-month-overview">
      <section aria-label="JSON files">
        {visible.length === 0 ? <p className="panel-state">No statements close in this month.</p> : <ul className="verified-file-list">{visible.map((entry) => <li key={entry.fileName}>
          <button aria-pressed={selected === entry.fileName} onClick={() => setSelected(entry.fileName)}>
            <strong>{statementDate(entry)} · {String(entry.data?.financial_institution ?? entry.statementType).replaceAll('_', ' ')}</strong><span>{entry.fileName}</span>
            {entry.error && <span>{entry.error}</span>}
          </button>
        </li>)}</ul>}
      </section>
    </div>}
    {file && categoryError && <p className="status-message error-message" role="alert">{categoryError} <button onClick={() => { setCategoryError(null); setCategoryAttempt((value) => value + 1); }}>Retry categories</button></p>}
    {!loading && !error && (month || file) && <div className={`json-statement-details verified-comparison${showPdf ? '' : ' verified-comparison-without-pdf'}`}>
      {file ? <HighlightedCategoryContext.Provider value={highlightedCategory}><StatementComparison key={file.fileName} file={file} categories={categories} onSaved={saved} showPdf={showPdf} /></HighlightedCategoryContext.Provider> : <>
        {showPdf && <section className="content-section"><div className="section-heading"><h2>Source PDF</h2></div><p className="panel-state">Select a JSON file above to view its source PDF.</p></section>}
        <section className="content-section"><div className="section-heading"><h2>Statement</h2></div><p className="panel-state">Select a JSON file above to view its formatted statement.</p></section>
      </>}
      <section className="content-section"><div className="section-heading"><h2>Transactions by category</h2><span>{total} total</span></div>
        <p className="verified-chart-note">{file ? 'Transactions for the selected statement’s full billing cycle.' : 'Transactions across this month’s statements, including their full billing periods.'} Wedges show the absolute size of each category’s net dollar total, excluding credit card payments. Credit card payments remain in the list. Tooltips and list amounts retain their signs.</p>
        <p className="verified-chart-note">{billCents === null ? 'Bill percentages are unavailable without a positive credit card statement balance for every statement shown.' : `Bill percentages use ${file ? 'the statement’s new balance' : 'the combined new balances'} of ${currency.format(billCents / 100)}.`}</p>
        {total === 0 ? <p className="panel-state">No transactions available to chart.</p> : <div className="verified-category-chart">
          {chartHasAmounts ? <div aria-label="Net dollar amounts by category, shown as absolute sizes"><ResponsiveContainer width="100%" height={250}><PieChart><Pie data={chartCategories} dataKey="chartAmount" nameKey="name" innerRadius={55} outerRadius={100} isAnimationActive={false}>{chartCategories.map((entry) => <Cell key={entry.name} fill={colors[entry.colorIndex % colors.length]} />)}</Pie><Tooltip formatter={(_value, name) => {
            const category = counts.find((entry) => entry.name === name);
            return [category ? `${currency.format(category.amountCents / 100)}${category.missingAmounts ? ' (incomplete)' : ''}` : 'Amount unavailable', name];
          }} /></PieChart></ResponsiveContainer></div> : <p className="panel-state">No nonzero category totals to chart.</p>}
          <p className="verified-chart-note">{file ? 'Select a category to highlight its transactions. Select it again to clear the highlights.' : 'Select a statement to highlight transactions by category.'}</p>
          <ul>{counts.map((entry, index) => <li key={entry.name}>
            <span className="category-dot" style={{ background: colors[index % colors.length] }} />
            <button type="button" className="verified-category-highlight-button" disabled={!file} aria-pressed={highlightedCategory === entry.name}
              onClick={() => { if (file) setCategoryHighlight(highlightedCategory === entry.name ? null : { fileName: file.fileName, category: entry.name }); }}>
              {entry.name}
            </button>
            <span className="verified-category-totals">
              <strong>{currency.format(entry.amountCents / 100)}{entry.missingAmounts > 0 ? ' (incomplete)' : billCents !== null ? ` (${percentage.format(entry.amountCents / billCents)})` : ' (bill share unavailable)'}</strong>
              <span>{entry.value} ({percentage.format(entry.value / total)} of transactions)</span>
            </span>
            {highlightedCategory === entry.name && <div className="verified-category-months">
              <h3>{entry.name} breakdown</h3>
              <dl>{entry.children.map((child) => <div key={child.name}>
                <dt>{child.ungrouped ? 'Other / ungrouped' : child.name}</dt>
                <dd>{currency.format(child.amountCents / 100)}{child.missingAmounts ? ' (incomplete)' : ''} · {child.value} {child.value === 1 ? 'transaction' : 'transactions'}</dd>
              </div>)}</dl>
              <CategoryYearAverages year={year} category={entry.name} currentFiles={files} />
              <div className="verified-category-months-heading">
                <h3>{entry.name} · {year}</h3>
                <span>Average: {meanCents === null ? 'N/A' : currency.format(meanCents / 100)}</span>
              </div>
              <p>Average uses {monthCount} {monthCount === 1 ? 'month' : 'months'} with complete data, including zero totals.</p>
              <p>Across all statements, grouped by closing month.</p>
              <dl>{monthlyCategoryTotals.map((item) => <div key={item.value}>
                <dt>{item.name}</dt>
                <dd>{item.hasData ? `${currency.format(item.amountCents / 100)}${item.incomplete ? ' (incomplete)' : ''}` : 'No data'}</dd>
              </div>)}</dl>
              {undated.length > 0 && <p>Statements without a closing date are excluded.</p>}
            </div>}
          </li>)}</ul>
        </div>}
      </section>
    </div>}
    {!loading && undated.length > 0 && <details className="status-message"><summary>Files without a closing date ({undated.length})</summary><ul>{undated.map((entry) => <li key={entry.fileName}><button onClick={() => setSelected(entry.fileName)}>{entry.fileName}</button> {entry.error}</li>)}</ul></details>}

  </>;
}

function StatementComparison({ file, categories, onSaved, showPdf }: { file: LoadedStatement; categories: Category[]; onSaved: (transactionId: string, category: Category) => void; showPdf: boolean }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    const source = file.data?.source_file;
    const name = typeof source === 'string' && /\.pdf$/i.test(source) ? source.split(/[\\/]/).pop()! : file.fileName.replace(/\.json$/i, '.pdf');
    getStatementPdfByFilename(name, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setPdfUrl(url);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setPdfError(caught instanceof Error ? caught.message : 'Unable to load PDF.');
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [file.fileName, file.data?.source_file, attempt]);
  return <>
    {showPdf && <section className="content-section pdf-data-section"><div className="section-heading"><h2>Source PDF</h2></div>
      {pdfError ? <p className="panel-state error-message" role="alert">{pdfError} <button onClick={() => { setPdfError(null); setAttempt((value) => value + 1); }}>Retry PDF</button></p> : !pdfUrl ? <p className="panel-state" role="status">Loading PDF…</p> : <iframe className="statement-pdf" src={pdfUrl} title={`PDF for ${file.fileName}`} />}
    </section>}
    <section className="content-section json-data-section" aria-label={statementLabel(file)}>
      <div className="json-derived-scroll verified-statement-scroll" tabIndex={0} role="region" aria-label={`${statementLabel(file)} statement content`}>
        {file.error && <p className="panel-state error-message" role="alert">{file.error}</p>}
        {file.data && <><ExtractedStatementSummary data={file.data} /><ExtractedTransactions data={file.data} onCategorySaved={onSaved} /><ExtractedDepositStatement data={file.data} categories={categories} onCategorySaved={onSaved} /><details><summary className="raw-json-heading">View JSON</summary><pre className="statement-json">{JSON.stringify(file.data, null, 2)}</pre></details></>}
      </div>
    </section>
  </>;
}
