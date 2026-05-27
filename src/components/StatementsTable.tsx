import { Fragment } from 'react';
import type { Statement } from '../types/finance';
import { TransactionsPanel } from './TransactionsPanel';
import type { Transaction } from '../types/finance';

type StatementsTableProps = {
  statements: Statement[];
  selectedStatementId: string | null;
  onSelectStatement: (statement: Statement) => void;
  transactions: Transaction[];
  isTransactionsLoading: boolean;
  transactionsError: string | null;
  balanceHeading?: string;
};

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatDate(value: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatCurrency(value: number | null): string {
  return value === null ? '-' : usdFormatter.format(value);
}

function formatStatementType(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatSourceFile(value: string): string {
  return value.trim() ? value : '—';
}

export function StatementsTable({
  statements,
  selectedStatementId,
  onSelectStatement,
  transactions,
  isTransactionsLoading,
  transactionsError,
  balanceHeading = 'Combined ending balance',
}: StatementsTableProps) {
  if (statements.length === 0) {
    return <p className="empty-state">No statements found.</p>;
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th scope="col">Institution</th>
            <th scope="col">Statement type</th>
            <th scope="col">Period start</th>
            <th scope="col">Period end</th>
            <th scope="col">Source file</th>
            <th scope="col" className="numeric">
              {balanceHeading}
            </th>
          </tr>
        </thead>
        <tbody>
          {statements.map((statement) => {
            const isSelected = statement.id === selectedStatementId;

            return (
              <Fragment key={statement.id}>
                <tr
                  className={isSelected ? 'selected-row' : undefined}
                  tabIndex={0}
                  aria-expanded={isSelected}
                  onClick={() => onSelectStatement(statement)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectStatement(statement);
                    }
                  }}
                >
                  <td data-label="Institution">{statement.institution}</td>
                  <td data-label="Statement type">
                    {formatStatementType(statement.statementType)}
                  </td>
                  <td data-label="Period start">{formatDate(statement.periodStart)}</td>
                  <td data-label="Period end">{formatDate(statement.periodEnd)}</td>
                  <td data-label="Source file" className="source-file">
                    {formatSourceFile(statement.sourceFile)}
                  </td>
                  <td data-label={balanceHeading} className="numeric">
                    {formatCurrency(statement.combinedEndingBalance)}
                  </td>
                </tr>
                {isSelected && (
                  <tr className="expanded-row">
                    <td colSpan={6}>
                      <TransactionsPanel
                        selectedStatement={statement}
                        transactions={transactions}
                        isLoading={isTransactionsLoading}
                        error={transactionsError}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
