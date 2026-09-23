import type {
  AvailableReport,
  Category,
  ReportTransactions,
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

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 503) throw new Error('Database or statement evidence is temporarily unavailable. Please try again.');
  return response;
}

export function canonicalTransactionId(value: unknown): string {
  return typeof value === 'string' && value.trim() && !/^\d+$/.test(value) ? value : '';
}

export async function resetTransactionCategory(numericId: number): Promise<void> {
  if (!Number.isSafeInteger(numericId) || numericId <= 0) throw new Error('A numeric transaction ID is required to reset a category.');
  const response = await apiFetch(`${API_BASE_URL}/transactions/${numericId}/category`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: null }),
  });
  if (response.status === 409) throw new Error('This transaction has no canonical ID. Its category cannot be reset yet.');
  if (!response.ok) throw new Error(`Unable to reset category (${response.status}). Please try again.`);
  const result = await response.json();
  if (result.success === false) throw new Error('Unable to reset category. The server did not apply the change.');
}


export async function getCategories(signal?: AbortSignal): Promise<Category[]> {
  const response = await apiFetch(`${API_BASE_URL}/categories`, { signal });
  if (!response.ok) throw new Error(`Unable to load categories (${response.status})`);
  const data: unknown = await response.json();
  if (!Array.isArray(data) || !data.every((item) =>
    item && Number.isInteger(item.id) && typeof item.name === 'string',
  )) throw new Error('Unable to load categories: unexpected response.');
  return (data as Category[]).sort((a, b) => a.name.localeCompare(b.name));
}

export async function setTransactionCategory(transactionId: string, categoryId: number): Promise<void> {
  if (!canonicalTransactionId(transactionId)) throw new Error('A canonical transaction ID is required.');
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new Error('A category ID is required.');
  const response = await apiFetch(`${API_BASE_URL}/transaction-categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction_id: transactionId, category_id: categoryId }),
  });
  if (!response.ok) throw new Error(`Unable to save category (${response.status}). Please try again.`);
}

export async function getReports(signal?: AbortSignal): Promise<AvailableReport[]> {
  const response = await apiFetch(`${API_BASE_URL}/reports`, { signal });

  if (!response.ok) {
    throw new Error(`Unable to load reports (${response.status})`);
  }

  const data = await response.json();
  if (!data || !Array.isArray(data.reports)) {
    throw new Error('Unable to load reports: unexpected response.');
  }

  return data.reports;
}

export function getStatementPdfUrl(statementId: string): string {
  return `${API_BASE_URL}/statements/${encodeURIComponent(statementId)}/pdf`;
}

export async function getReportTransactions(
  reportId: string,
  signal?: AbortSignal,
): Promise<ReportTransactions> {
  const response = await apiFetch(
    `${API_BASE_URL}/reports/${encodeURIComponent(reportId)}/transactions`,
    { signal },
  );
  if (!response.ok) {
    throw new Error(`Unable to load report transactions (${response.status})`);
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.transactions) || typeof data.currency !== 'string') {
    throw new Error('Unable to load report transactions: unexpected response.');
  }
  return {
    currency: data.currency,
    transactions: data.transactions.map((transaction: RawTransaction & {
      transaction_id?: string;
      report_category?: string;
      report_label?: string;
      financial_institution?: string;
      source_json?: string;
    }, index: number) => ({
      ...normalizeTransaction({
        ...transaction,
        id: transaction.transaction_id,
        category: transaction.report_category,
        account_name: transaction.financial_institution,
      }, index),
      category: transaction.report_category ?? '',
      sourceFile: transaction.source_json ?? '',
      reportLabel: transaction.report_label ?? '',
    })),
  };
}

export async function getStatementPdf(
  statementId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await apiFetch(getStatementPdfUrl(statementId), { signal });

  if (!response.ok) {
    throw new Error(`Unable to load statement PDF (${response.status})`);
  }

  return response.blob();
}

export async function getStatementPdfByFilename(
  filename: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await apiFetch(
    `${API_BASE_URL}/statements/by-filename/${encodeURIComponent(filename)}/pdf`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`Unable to load statement PDF by filename (${response.status})`);
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
    id: canonicalTransactionId(transaction.transaction_id) || String(transaction.id ?? `${transactionDate}-${description}-${index}`),
    transaction_id: canonicalTransactionId(transaction.transaction_id) || null,
    numericId: typeof transaction.id === 'number' ? transaction.id : null,
    merchant_id: transaction.merchant_id ?? null,
    merchant: transaction.merchant ?? null,
    category_id: transaction.category_id ?? null,
    parent_category_id: transaction.parent_category_id ?? null,
    parent_category: transaction.parent_category ?? null,
    transactionDate,
    accountName: transaction.account_name ?? transaction.accountName ?? '',
    description,
    category: transaction.category ?? null,
    amount: toNumber(transaction.amount),
  };
}

function normalizeExpense(expense: RawExpense, index: number): Expense {
  const transactionDate =
    expense.transaction_date ?? expense.transactionDate ?? expense.date ?? '';
  const description = expense.description ?? '';

  return {
    id: canonicalTransactionId(expense.transaction_id) || String(expense.id ?? `${transactionDate}-${description}-${index}`),
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

export async function getStatements(signal?: AbortSignal): Promise<Statement[]> {
  const response = await apiFetch(`${API_BASE_URL}/statements`, { signal });

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
  signal?: AbortSignal,
): Promise<VerifiedStatementFile[]> {
  const response = await apiFetch(
    `${API_BASE_URL}/verified-statements/${encodeURIComponent(year)}/files`,
    { signal },
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
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await apiFetch(
    `${API_BASE_URL}/verified-statements/${encodeURIComponent(year)}/files/${encodeURIComponent(fileName)}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error(`Unable to load verified statement data (${response.status})`);
  }

  return response.json();
}

export async function getStatementTransactions(statementId: string, signal?: AbortSignal): Promise<Transaction[]> {
  const response = await apiFetch(
    `${API_BASE_URL}/statements/${encodeURIComponent(statementId)}/transactions`,
    { signal },
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

  const response = await apiFetch(`${API_BASE_URL}/reports/expenses?${params}`, { signal });

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
