import type { ReportTransaction } from '../types/finance';

export function groupReportTransactions(transactions: ReportTransaction[]) {
  const grouping = transactions.some((transaction) => transaction.reportLabel.trim())
    ? 'label'
    : transactions.some((transaction) => transaction.category.trim())
      ? 'category'
      : 'none';
  const groups = new Map<string, ReportTransaction[]>();
  // ISO calendar dates sort chronologically; missing dates belong at the end.
  const sorted = [...transactions].sort((a, b) =>
    b.transactionDate.localeCompare(a.transactionDate),
  );

  // Insertion order also puts groups with the most recent activity first.
  for (const transaction of sorted) {
    const label = grouping === 'label'
      ? transaction.reportLabel.trim()
      : grouping === 'category' ? transaction.category.trim() : '';
    const rows = groups.get(label);
    if (rows) rows.push(transaction);
    else groups.set(label, [transaction]);
  }

  return {
    grouping,
    groups: [...groups].map(([label, rows]) => ({
      label: label || (grouping === 'none' ? 'All transactions' : 'Ungrouped transactions'),
      transactions: rows,
    })),
  };
}
