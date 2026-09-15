import { lazy, Suspense, useEffect, useState } from 'react';
import { getStatements, getStatementTransactions } from './api/financesApi';
import './App.css';
import { JsonStatements } from './components/JsonStatements';
import { ReportsPage } from './components/ReportsPage';
import { StatementsTable } from './components/StatementsTable';
import type { Statement, Transaction } from './types/finance';
const VerifiedStatementsPage = lazy(() => import('./components/VerifiedStatementsPage').then((module) => ({ default: module.VerifiedStatementsPage })));
const OverviewPage = lazy(() => import('./components/OverviewPage').then((module) => ({ default: module.OverviewPage })));
const currentYear = String(new Date().getFullYear());
const monthKeys = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
function getStatementYear(statement: Statement): string {
  return (statement.periodEnd || statement.periodStart).slice(0, 4);
}

function getStatementMonth(statement: Statement): string {
  return (statement.periodEnd || statement.periodStart).slice(5, 7);
}

type Route = '/' | '/backup-statements' | '/statements' | '/json-statements' | '/reports';

function getRoute(): Route {
  if (window.location.pathname === '/backup-statements') return '/backup-statements';
  if (window.location.pathname === '/reports') return '/reports';
  if (window.location.pathname === '/statements') return '/statements';
  if (window.location.pathname === '/json-statements') return '/json-statements';
  return '/';
}

function getStatementYears(statements: Statement[]): string[] {
  const years = new Set(
    statements
      .map(getStatementYear)
      .filter((year) => /^\d{4}$/.test(year)),
  );

  return [...years].sort((a, b) => b.localeCompare(a));
}

function App() {
  const [route, setRoute] = useState(getRoute);
  const [overviewActions, setOverviewActions] = useState<HTMLSpanElement | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedStatementMonth, setSelectedStatementMonth] = useState('all');
  const [selectedStatement, setSelectedStatement] = useState<Statement | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isTransactionsLoading, setIsTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const statementYears = getStatementYears(statements);
  const yearOptions = statementYears.length ? statementYears : [selectedYear];
  const displayedStatements = statements.filter((statement) => getStatementYear(statement) === selectedYear && (selectedStatementMonth === 'all' || getStatementMonth(statement) === selectedStatementMonth));
  const combinedStatements = displayedStatements.filter((statement) => statement.statementType !== 'credit_card_statement');
  const creditCardStatements = displayedStatements.filter((statement) => statement.statementType === 'credit_card_statement');
  useEffect(() => {
    function handlePopState() {
      setRoute(getRoute());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  function navigate(nextRoute: Route) {
    if (window.location.pathname !== nextRoute) {
      window.history.pushState({}, '', nextRoute);
    }
    setRoute(nextRoute);
  }

  useEffect(() => {
    if (route !== '/backup-statements') return;
    let isMounted = true;

    async function loadStatements() {
      try {
        const nextStatements = await getStatements();

        if (isMounted) {
          const nextYears = getStatementYears(nextStatements);

          setStatements(nextStatements);
          setSelectedYear(
            nextYears.includes(currentYear) ? currentYear : nextYears[0] ?? currentYear,
          );
          setError(null);
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load statements.',
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadStatements();

    return () => {
      isMounted = false;
    };
  }, [route]);

  useEffect(() => {
    if (!selectedStatement) {
      return;
    }

    let isMounted = true;
    const statementId = selectedStatement.id;

    async function loadTransactions() {
      setIsTransactionsLoading(true);
      setTransactionsError(null);

      try {
        const nextTransactions = await getStatementTransactions(statementId);

        if (isMounted) {
          setTransactions(nextTransactions);
        }
      } catch (caughtError) {
        if (isMounted) {
          setTransactions([]);
          setTransactionsError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load transactions.',
          );
        }
      } finally {
        if (isMounted) {
          setIsTransactionsLoading(false);
        }
      }
    }

    loadTransactions();

    return () => {
      isMounted = false;
    };
  }, [selectedStatement]);

  function handleSelectStatement(statement: Statement) {
    setSelectedStatement((selected) => selected?.id === statement.id ? null : statement);
    setTransactions([]);
    setTransactionsError(null);
  }
  function handleYearChange(year: string) {
    setSelectedYear(year); setSelectedStatementMonth('all'); setSelectedStatement(null); setTransactions([]); setTransactionsError(null);
  }
  return <main className={`app-shell${route === '/' ? ' overview-shell' : ''}${route === '/statements' || route === '/json-statements' ? ' json-statements-shell' : ''}`}>
      <header className="dashboard-header">
        <a className="site-title" href="/" onClick={(event) => {
          event.preventDefault();
          navigate('/');
        }}>
          Finance Dashboard
        </a>
        <nav aria-label="Primary navigation">
          <a
            href="/"
            aria-current={route === '/' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate('/');
            }}
          >
            Overview
          </a>
          <a
            href="/statements"
            aria-current={route === '/statements' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate('/statements');
            }}
          >
            Statements
          </a>
          <a
            href="/reports"
            aria-current={route === '/reports' ? 'page' : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigate('/reports');
            }}
          >
            Reports
          </a>

          {route === '/' && <span className="overview-nav-actions" ref={setOverviewActions} />}
        </nav>
      </header>

      {route === '/backup-statements' && isLoading && <p className="status-message">Loading statements…</p>}
      {route === '/backup-statements' && error && !isLoading && <p className="status-message error-message" role="alert">{error}</p>}
      {!isLoading && !error && route === '/backup-statements' && (
        <>
          <div className="page-heading">
            <h1>Backup Statements</h1>
            <p>Browse imported bank and credit card statements by period.</p>
          </div>

          <div className="dashboard-toolbar statement-filters" aria-label="Statement filters">
            <div className="toolbar-metric">
              <span className="toolbar-label">Matching statements</span>
              <strong>{displayedStatements.length}</strong>
            </div>
            <label className="year-select">
              <span>Year</span>
              <select value={selectedYear} onChange={(event) => handleYearChange(event.target.value)}>
                {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label className="month-select">
              <span>Month</span>
              <select
                value={selectedStatementMonth}
                onChange={(event) => {
                  setSelectedStatementMonth(event.target.value);
                  setSelectedStatement(null);
                  setTransactions([]);
                }}
              >
                <option value="all">All months</option>
                {monthKeys.map((month) => (
                  <option key={month} value={month}>
                    {new Intl.DateTimeFormat('en-US', { month: 'long' }).format(
                      new Date(`${selectedYear}-${month}-01T00:00:00`),
                    )}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="content-section" aria-labelledby="combined-statements-heading">
            <div className="section-heading">
              <div>
                <h2 id="combined-statements-heading">Checking & Savings Statements</h2>
                <p>Combined bank statements across checking and savings accounts.</p>
              </div>
              <span>{combinedStatements.length} total</span>
            </div>
            <StatementsTable
              statements={combinedStatements}
              selectedStatementId={selectedStatement?.id ?? null}
              onSelectStatement={handleSelectStatement}
              transactions={transactions}
              isTransactionsLoading={isTransactionsLoading}
              transactionsError={transactionsError}
              balanceHeading="Combined ending balance"
            />
          </section>

          <section className="content-section" aria-labelledby="credit-card-statements-heading">
            <div className="section-heading">
              <div>
                <h2 id="credit-card-statements-heading">Credit Card Statements</h2>
                <p>Credit card statement periods and imported source files.</p>
              </div>
              <span>{creditCardStatements.length} total</span>
            </div>
            <StatementsTable
              statements={creditCardStatements}
              selectedStatementId={selectedStatement?.id ?? null}
              onSelectStatement={handleSelectStatement}
              transactions={transactions}
              isTransactionsLoading={isTransactionsLoading}
              transactionsError={transactionsError}
              balanceHeading="Ending balance"
            />
          </section>
        </>
      )}

      {route === '/' && <Suspense fallback={<p className="status-message" role="status">Loading latest transactions…</p>}><OverviewPage navigationActions={overviewActions} /></Suspense>}
      {route === '/statements' && <Suspense fallback={<p className="status-message" role="status">Loading statements…</p>}><VerifiedStatementsPage /></Suspense>}
      {route === '/json-statements' && <JsonStatements />}
      {route === '/reports' && <ReportsPage />}
    </main>;
}
export default App;
