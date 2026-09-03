import type {
  Expense,
  ExpensesReport,
  RawExpense,
  RawExpenseSummary,
  RawStatement,
  RawTransaction,
  Statement,
  Transaction,
  VerifiedStatementFile,
} from '../types/finance';

const API_BASE_URL = 'https://finances.toews-api.com';

export function getStatementPdfUrl(statementId: string): string {
  return `${API_BASE_URL}/statements/${encodeURIComponent(statementId)}/pdf`;
}

export async function getStatementPdf(
  statementId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await fetch(getStatementPdfUrl(statementId), { signal });

  if (!response.ok) {
    throw new Error(`Unable to load statement PDF (${response.status})`);
  }

  return response.blob();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getCombinedEndingBalance(statement: RawStatement): number | null {
  const directBalance = toNumber(
    statement.combined_ending_balance ??
      statement.combinedEndingBalance ??
      statement.ending_balance ??
      statement.endingBalance,
  );

  if (directBalance !== null) {
    return directBalance;
  }

  if (!Array.isArray(statement.accounts)) {
    return null;
  }

  const balances = statement.accounts
    .map((account) =>
      toNumber(account.ending_balance ?? account.endingBalance ?? account.balance),
    )
    .filter((balance): balance is number => balance !== null);

  if (balances.length === 0) {
    return null;
  }

  return balances.reduce((total, balance) => total + balance, 0);
}

function normalizeStatement(statement: RawStatement, index: number): Statement {
  const periodStart = statement.period_start ?? statement.periodStart ?? '';
  const periodEnd = statement.period_end ?? statement.periodEnd ?? '';
  const sourceFile = statement.source_file ?? statement.sourceFile ?? statement.file_name ?? '';

  return {
    id: String(statement.id ?? `${sourceFile}-${periodEnd}-${index}`),
    institution: statement.institution ?? statement.institution_name ?? 'Unknown',
    statementType: statement.statement_type ?? statement.statementType ?? statement.type ?? 'Statement',
    periodStart,
    periodEnd,
    sourceFile,
    combinedEndingBalance: getCombinedEndingBalance(statement),
  };
}

function normalizeTransaction(transaction: RawTransaction, index: number): Transaction {
  const transactionDate =
    transaction.transaction_date ?? transaction.transactionDate ?? transaction.date ?? '';
  const description = transaction.description ?? transaction.name ?? '';

  return {
    id: String(transaction.id ?? `${transactionDate}-${description}-${index}`),
    transactionDate,
    accountName: transaction.account_name ?? transaction.accountName ?? '',
    description,
    category: transaction.category ?? '',
    amount: toNumber(transaction.amount),
  };
}

function normalizeExpense(expense: RawExpense, index: number): Expense {
  const transactionDate =
    expense.transaction_date ?? expense.transactionDate ?? expense.date ?? '';
  const description = expense.description ?? '';

  return {
    id: String(expense.id ?? `${transactionDate}-${description}-${index}`),
    transactionDate,
    month: expense.month ?? transactionDate.slice(0, 7),
    accountName: expense.account_name ?? expense.accountName ?? '',
    description,
    category: expense.category ?? '',
    amount: toNumber(expense.amount),
    expenseAmount: toNumber(expense.expense_amount ?? expense.expenseAmount),
    transactionType: expense.transaction_type ?? expense.transactionType ?? '',
    parentCategory: expense.parent_category ?? expense.parentCategory ?? '',
  };
}

function normalizeExpenseSummary(summary: RawExpenseSummary = {}): ExpensesReport['summary'] {
  const year = toNumber(summary.year);
  const month = toNumber(summary.month);

  return {
    year,
    month,
    category: summary.category ?? null,
    parent: summary.parent ?? null,
    selectedTotal: toNumber(summary.selected_total ?? summary.selectedTotal),
    yearlyCalendarAverage: toNumber(
      summary.yearly_calendar_average ?? summary.yearlyCalendarAverage,
    ),
    differenceFromYearlyAverage: toNumber(
      summary.difference_from_yearly_average ?? summary.differenceFromYearlyAverage,
    ),
    yearlyTotal: toNumber(summary.yearly_total ?? summary.yearlyTotal),
  };
}

export async function getStatements(): Promise<Statement[]> {
  const response = await fetch(`${API_BASE_URL}/statements`);

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`Unable to load statements (${response.status})`);
  }

  const data: unknown = await response.json();
  const rawStatements = Array.isArray(data)
    ? data
    : Array.isArray((data as { statements?: unknown }).statements)
      ? (data as { statements: unknown[] }).statements
      : [];

  return rawStatements
    .map((statement, index) => normalizeStatement(statement as RawStatement, index))
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export async function getVerifiedStatementFiles(
  year: string,
): Promise<VerifiedStatementFile[]> {
  const response = await fetch(
    `${API_BASE_URL}/verified-statements/${encodeURIComponent(year)}/files`,
  );

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`Unable to load verified statement files (${response.status})`);
  }

  const data: unknown = await response.json();
  const files = Array.isArray(data)
    ? data
    : Array.isArray((data as { files?: unknown }).files)
      ? (data as { files: unknown[] }).files
      : [];

  return files.flatMap((file) => {
    if (typeof file === 'string') {
      return [{ fileName: file, statementDate: '', statementType: '' }];
    }

    if (typeof file !== 'object' || file === null) {
      return [];
    }

    const item = file as Record<string, unknown>;
    const fileName = item.file_name ?? item.fileName ?? item.filename ?? item.name;

    if (typeof fileName !== 'string') {
      return [];
    }

    const statementDate = item.statement_date ?? item.statementDate ?? item.date;
    const statementType =
      item.statement_type ??
      item.statementType ??
      item.likely_statement_type ??
      item.type;

    return [{
      fileName,
      statementDate: typeof statementDate === 'string' ? statementDate : '',
      statementType: typeof statementType === 'string' ? statementType : '',
    }];
  });
}

export async function getVerifiedStatementData(
  year: string,
  fileName: string,
): Promise<unknown> {
  const response = await fetch(
    `${API_BASE_URL}/verified-statements/${encodeURIComponent(year)}/files/${encodeURIComponent(fileName)}`,
  );

  if (!response.ok) {
    throw new Error(`Unable to load verified statement data (${response.status})`);
  }

  return response.json();
}

export async function getStatementTransactions(statementId: string): Promise<Transaction[]> {
  const response = await fetch(
    `${API_BASE_URL}/statements/${encodeURIComponent(statementId)}/transactions`,
  );

  if (!response.ok) {
    throw new Error(`Unable to load transactions (${response.status})`);
  }

  const data: unknown = await response.json();
  const rawTransactions = Array.isArray(data)
    ? data
    : Array.isArray((data as { transactions?: unknown }).transactions)
      ? (data as { transactions: unknown[] }).transactions
      : [];

  return rawTransactions
    .map((transaction, index) =>
      normalizeTransaction(transaction as RawTransaction, index),
    )
    .sort((a, b) => {
      const dateComparison = a.transactionDate.localeCompare(b.transactionDate);
      return dateComparison === 0 ? a.id.localeCompare(b.id) : dateComparison;
    });
}

export async function getExpensesReport(
  year: string,
  month: string,
  category?: string,
  signal?: AbortSignal,
): Promise<ExpensesReport> {
  const params = new URLSearchParams({
    year,
    month: String(Number(month)),
  });

  if (category) {
    params.set('category', category);
  }

  const response = await fetch(`${API_BASE_URL}/reports/expenses?${params}`, { signal });

  if (!response.ok) {
    throw new Error(`Unable to load expenses (${response.status})`);
  }

  const data: unknown = await response.json();
  const rawExpenses = Array.isArray(data)
    ? data
    : Array.isArray((data as { transactions?: unknown }).transactions)
      ? (data as { transactions: unknown[] }).transactions
      : Array.isArray((data as { expenses?: unknown }).expenses)
        ? (data as { expenses: unknown[] }).expenses
        : [];
  const rawSummary =
    !Array.isArray(data) && typeof data === 'object' && data !== null
      ? (data as { summary?: RawExpenseSummary }).summary
      : undefined;
  const transactions = rawExpenses
    .map((expense, index) => normalizeExpense(expense as RawExpense, index))
    .sort((a, b) => {
      const dateComparison = a.transactionDate.localeCompare(b.transactionDate);
      return dateComparison === 0 ? a.id.localeCompare(b.id) : dateComparison;
    });
  const fallbackTotal = transactions.reduce(
    (sum, expense) =>
      sum +
      (expense.expenseAmount !== null ? expense.expenseAmount : Math.abs(expense.amount ?? 0)),
    0,
  );
  const summary = normalizeExpenseSummary(rawSummary);

  return {
    summary: {
      ...summary,
      selectedTotal: summary.selectedTotal ?? fallbackTotal,
    },
    transactions,
  };
}
