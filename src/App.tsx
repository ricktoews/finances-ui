import { useEffect, useMemo, useState } from 'react';
import {
  getExpensesReport,
  getStatements,
  getStatementTransactions,
} from './api/financesApi';
import './App.css';
import { MonthlyExpenses } from './components/MonthlyExpenses';
import { MonthlyIncome } from './components/MonthlyIncome';
import { StatementsTable } from './components/StatementsTable';
import type { ExpensesReport, Statement, Transaction } from './types/finance';

const currentYear = String(new Date().getFullYear());
const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

function getStatementYear(statement: Statement): string {
  return (statement.periodEnd || statement.periodStart).slice(0, 4);
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
  const [statements, setStatements] = useState<Statement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedStatement, setSelectedStatement] = useState<Statement | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isTransactionsLoading, setIsTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [incomeTransactions, setIncomeTransactions] = useState<Transaction[]>([]);
  const [isIncomeLoading, setIsIncomeLoading] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [selectedIncomeMonth, setSelectedIncomeMonth] = useState('all');
  const [expensesReport, setExpensesReport] = useState<ExpensesReport | null>(null);
  const [isExpensesLoading, setIsExpensesLoading] = useState(false);
  const [expensesError, setExpensesError] = useState<string | null>(null);
  const [selectedExpenseMonth, setSelectedExpenseMonth] = useState(currentMonth);
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState<string | null>(
    null,
  );
  const [categoryExpensesReport, setCategoryExpensesReport] =
    useState<ExpensesReport | null>(null);
  const [isCategoryExpensesLoading, setIsCategoryExpensesLoading] = useState(false);
  const [categoryExpensesError, setCategoryExpensesError] = useState<string | null>(null);
  const statementYears = useMemo(() => getStatementYears(statements), [statements]);
  const displayedStatements = useMemo(
    () =>
      statements.filter((statement) => getStatementYear(statement) === selectedYear),
    [selectedYear, statements],
  );
  const combinedStatements = useMemo(
    () =>
      displayedStatements.filter(
        (statement) => statement.statementType !== 'credit_card_statement',
      ),
    [displayedStatements],
  );
  const creditCardStatements = useMemo(
    () =>
      displayedStatements.filter(
        (statement) => statement.statementType === 'credit_card_statement',
      ),
    [displayedStatements],
  );
  const yearOptions = statementYears.length > 0 ? statementYears : [selectedYear];

  useEffect(() => {
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
  }, []);

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

  useEffect(() => {
    if (combinedStatements.length === 0) {
      return;
    }

    let isMounted = true;
    const statementIds = combinedStatements.map((statement) => statement.id);

    async function loadIncomeTransactions() {
      setIsIncomeLoading(true);
      setIncomeError(null);

      try {
        const statementTransactions = await Promise.all(
          statementIds.map((statementId) => getStatementTransactions(statementId)),
        );

        if (isMounted) {
          setIncomeTransactions(statementTransactions.flat());
        }
      } catch (caughtError) {
        if (isMounted) {
          setIncomeTransactions([]);
          setIncomeError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load income.',
          );
        }
      } finally {
        if (isMounted) {
          setIsIncomeLoading(false);
        }
      }
    }

    loadIncomeTransactions();

    return () => {
      isMounted = false;
    };
  }, [combinedStatements]);

  useEffect(() => {
    let isMounted = true;

    async function loadExpenses() {
      setIsExpensesLoading(true);
      setExpensesError(null);

      try {
        const nextExpensesReport = await getExpensesReport(
          selectedYear,
          selectedExpenseMonth,
        );

        if (isMounted) {
          setExpensesReport(nextExpensesReport);
        }
      } catch (caughtError) {
        if (isMounted) {
          setExpensesReport(null);
          setExpensesError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load expenses.',
          );
        }
      } finally {
        if (isMounted) {
          setIsExpensesLoading(false);
        }
      }
    }

    loadExpenses();

    return () => {
      isMounted = false;
    };
  }, [selectedExpenseMonth, selectedYear]);

  useEffect(() => {
    if (!selectedExpenseCategory) {
      return;
    }

    let isMounted = true;
    const expenseCategory = selectedExpenseCategory;

    async function loadCategoryExpenses() {
      setIsCategoryExpensesLoading(true);
      setCategoryExpensesError(null);

      try {
        const nextCategoryExpensesReport = await getExpensesReport(
          selectedYear,
          selectedExpenseMonth,
          expenseCategory,
        );

        if (isMounted) {
          setCategoryExpensesReport(nextCategoryExpensesReport);
        }
      } catch (caughtError) {
        if (isMounted) {
          setCategoryExpensesReport(null);
          setCategoryExpensesError(
            caughtError instanceof Error
              ? caughtError.message
              : 'Unable to load category expenses.',
          );
        }
      } finally {
        if (isMounted) {
          setIsCategoryExpensesLoading(false);
        }
      }
    }

    loadCategoryExpenses();

    return () => {
      isMounted = false;
    };
  }, [selectedExpenseCategory, selectedExpenseMonth, selectedYear]);

  function handleSelectStatement(statement: Statement) {
    if (statement.id === selectedStatement?.id) {
      setSelectedStatement(null);
      setTransactions([]);
      setTransactionsError(null);
      setIsTransactionsLoading(false);
      return;
    }

    setSelectedStatement(statement);
    setTransactions([]);
    setTransactionsError(null);
  }

  function handleYearChange(nextYear: string) {
    setSelectedYear(nextYear);
    setSelectedStatement(null);
    setTransactions([]);
    setTransactionsError(null);
    setIsTransactionsLoading(false);
    setSelectedIncomeMonth('all');
    setIncomeTransactions([]);
    setIncomeError(null);
    setIsIncomeLoading(false);
    setExpensesReport(null);
    setExpensesError(null);
    setIsExpensesLoading(false);
    setSelectedExpenseCategory(null);
    setCategoryExpensesReport(null);
    setCategoryExpensesError(null);
    setIsCategoryExpensesLoading(false);
  }

  function handleExpenseMonthChange(nextMonth: string) {
    setSelectedExpenseMonth(nextMonth);
    setSelectedExpenseCategory(null);
    setCategoryExpensesReport(null);
    setCategoryExpensesError(null);
    setIsCategoryExpensesLoading(false);
  }

  function handleExpenseCategoryChange(category: string | null) {
    setSelectedExpenseCategory(category);
    setCategoryExpensesReport(null);
    setCategoryExpensesError(null);
    setIsCategoryExpensesLoading(false);
  }

  return (
    <main className="app-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Personal finance</p>
          <h1>Finance Dashboard</h1>
        </div>
        <p className="header-copy">
          A read-only view of imported statements, ordered by the latest period first.
        </p>
      </header>

      {isLoading && <p className="status-message">Loading statements...</p>}

      {error && !isLoading && (
        <div className="status-message error-message" role="alert">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <div className="dashboard-toolbar" aria-label="Dashboard filters">
            <div className="toolbar-metric">
              <span className="toolbar-label">Statement year</span>
              <strong>{selectedYear}</strong>
            </div>
            <div className="toolbar-metric">
              <span className="toolbar-label">Statements</span>
              <strong>{displayedStatements.length}</strong>
            </div>
            <label className="year-select">
              <span>Year</span>
              <select
                value={selectedYear}
                onChange={(event) => handleYearChange(event.target.value)}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <MonthlyIncome
            transactions={incomeTransactions}
            isLoading={isIncomeLoading}
            error={incomeError}
            selectedMonth={selectedIncomeMonth}
            selectedYear={selectedYear}
            onMonthChange={setSelectedIncomeMonth}
          />

          <MonthlyExpenses
            report={expensesReport}
            isLoading={isExpensesLoading}
            error={expensesError}
            selectedMonth={selectedExpenseMonth}
            selectedYear={selectedYear}
            onMonthChange={handleExpenseMonthChange}
            selectedCategory={selectedExpenseCategory}
            categoryReport={categoryExpensesReport}
            isCategoryLoading={isCategoryExpensesLoading}
            categoryError={categoryExpensesError}
            onCategoryChange={handleExpenseCategoryChange}
          />

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
    </main>
  );
}

export default App;
