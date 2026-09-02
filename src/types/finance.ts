export type RawStatement = {
  id?: string | number;
  institution?: string;
  institution_name?: string;
  statement_type?: string;
  statementType?: string;
  type?: string;
  period_start?: string;
  periodStart?: string;
  period_end?: string;
  periodEnd?: string;
  source_file?: string | null;
  sourceFile?: string | null;
  file_name?: string | null;
  combined_ending_balance?: number | string | null;
  combinedEndingBalance?: number | string | null;
  ending_balance?: number | string | null;
  endingBalance?: number | string | null;
  accounts?: Array<{
    ending_balance?: number | string | null;
    endingBalance?: number | string | null;
    balance?: number | string | null;
  }>;
};

export type Statement = {
  id: string;
  institution: string;
  statementType: string;
  periodStart: string;
  periodEnd: string;
  sourceFile: string;
  combinedEndingBalance: number | null;
};

export type VerifiedStatementFile = {
  fileName: string;
  statementDate: string;
  statementType: string;
};

export type RawTransaction = {
  id?: string | number;
  transaction_date?: string;
  transactionDate?: string;
  date?: string;
  account_name?: string | null;
  accountName?: string | null;
  description?: string | null;
  name?: string | null;
  category?: string | null;
  amount?: number | string | null;
};

export type Transaction = {
  id: string;
  transactionDate: string;
  accountName: string;
  description: string;
  category: string;
  amount: number | null;
};

export type RawExpense = {
  id?: string | number;
  transaction_date?: string;
  transactionDate?: string;
  date?: string;
  month?: string;
  account_name?: string | null;
  accountName?: string | null;
  description?: string | null;
  category?: string | null;
  amount?: number | string | null;
  expense_amount?: number | string | null;
  expenseAmount?: number | string | null;
  transaction_type?: string | null;
  transactionType?: string | null;
  parent_category?: string | null;
  parentCategory?: string | null;
};

export type Expense = {
  id: string;
  transactionDate: string;
  month: string;
  accountName: string;
  description: string;
  category: string;
  amount: number | null;
  expenseAmount: number | null;
  transactionType: string;
  parentCategory: string;
};

export type RawExpenseSummary = {
  year?: number | string;
  month?: number | string;
  category?: string | null;
  parent?: string | null;
  selected_total?: number | string | null;
  selectedTotal?: number | string | null;
  yearly_calendar_average?: number | string | null;
  yearlyCalendarAverage?: number | string | null;
  difference_from_yearly_average?: number | string | null;
  differenceFromYearlyAverage?: number | string | null;
  yearly_total?: number | string | null;
  yearlyTotal?: number | string | null;
};

export type ExpenseSummary = {
  year: number | null;
  month: number | null;
  category: string | null;
  parent: string | null;
  selectedTotal: number | null;
  yearlyCalendarAverage: number | null;
  differenceFromYearlyAverage: number | null;
  yearlyTotal: number | null;
};

export type ExpensesReport = {
  summary: ExpenseSummary;
  transactions: Expense[];
};
