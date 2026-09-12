import type { Category, VerifiedStatementFile } from '../types/finance';

export type StatementDocument = Record<string, unknown>;
export type LoadedStatement = VerifiedStatementFile & { data?: StatementDocument; error?: string };

export function record(value: unknown): StatementDocument {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StatementDocument : {};
}

export function statementDate(file: LoadedStatement): string {
  const data = file.data;
  const date = data?.statement_closing_date ?? data?.period_end ?? file.statementDate;
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return file.fileName.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
}

export function statementLabel(file: LoadedStatement): string {
  const data = file.data ?? {};
  const type = String(data.statement_type ?? data.account_type ?? file.statementType).toLowerCase();
  if (/deposit|checking|savings/.test(type) || (Array.isArray(data.accounts) && data.accounts.length > 0)) {
    return 'Checking / Savings';
  }
  for (const value of [data.card_product, data.cardProduct, data.product_name, data.productName, data.account_name, data.accountName]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const institution = typeof data.financial_institution === 'string' ? data.financial_institution.trim() : '';
  return [institution, /credit/.test(type) ? 'Credit Card' : 'Statement'].filter(Boolean).join(' ');
}

export function statementTransactions(data: StatementDocument): StatementDocument[] {
  const own = Array.isArray(data.transactions) ? data.transactions.map(record) : [];
  const accounts = Array.isArray(data.accounts) ? data.accounts.flatMap((account) => statementTransactions(record(account))) : [];
  return [...own, ...accounts];
}

export function updateCategory(data: StatementDocument, transactionId: string, category: Category): StatementDocument {
  return {
    ...data,
    ...(Array.isArray(data.transactions) ? { transactions: data.transactions.map((value) => {
      const transaction = record(value);
      return (transaction.transaction_id ?? transaction.transactionId) === transactionId
        ? { ...transaction, category_id: category.id, category: category.name } : value;
    }) } : {}),
    ...(Array.isArray(data.accounts) ? { accounts: data.accounts.map((account) => updateCategory(record(account), transactionId, category)) } : {}),
  };
}

export function categoryCounts(files: LoadedStatement[]) {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const file of files) {
    for (const transaction of statementTransactions(file.data ?? {})) {
      const id = transaction.transaction_id ?? transaction.transactionId;
      if (typeof id === 'string' && id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const category = typeof transaction.category === 'string' && transaction.category.trim()
        ? transaction.category.trim() : 'Uncategorized';
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
