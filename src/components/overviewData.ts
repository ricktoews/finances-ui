import { getStatementTransactions } from '../api/financesApi';
import type { Statement } from '../types/finance';
import type { LoadedStatement } from './verifiedStatementData';

export function overviewMonths(statements: Statement[]): string[] {
  return [...new Set(statements.map((statement) => statement.periodEnd.slice(0, 7))
    .filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)))].sort().reverse();
}

export async function loadOverviewMonth(statements: Statement[], month: string, signal: AbortSignal): Promise<LoadedStatement[]> {
  const matching = statements.filter((statement) => statement.periodEnd.slice(0, 7) === month);
  const loaded: LoadedStatement[] = [];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, matching.length) }, async () => {
    while (index < matching.length && !signal.aborted) {
      const statement = matching[index++];
      const file = { fileName: statement.sourceFile || statement.id, statementDate: statement.periodEnd, statementType: statement.statementType };
      try {
        if (!/^\d+$/.test(statement.id)) throw new Error('Statement numeric ID is unavailable.');
        const transactions = await getStatementTransactions(statement.id, signal);
        loaded.push({ ...file, data: {
          statement_id: statement.id,
          financial_institution: statement.institution,
          statement_type: statement.statementType,
          period_start: statement.periodStart,
          period_end: statement.periodEnd,
          source_file: statement.sourceFile,
          transactions: transactions.map((transaction) => ({ ...transaction, id: transaction.numericId, transaction_date: transaction.transactionDate })),
        } });
      } catch (caught) {
        if (signal.aborted) throw caught;
        loaded.push({ ...file, error: caught instanceof Error ? caught.message : 'Unable to load transactions.' });
      }
    }
  }));
  return loaded.sort((a, b) => a.fileName.localeCompare(b.fileName));
}
