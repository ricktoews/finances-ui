import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  getStatementPdf,
  getCategories,
  getStatementPdfByFilename,
  getStatements,
  getVerifiedStatementData,
  getVerifiedStatementFiles,
} from '../api/financesApi';
import type { Category, Statement, VerifiedStatementFile } from '../types/finance';
import { TransactionCategorySelect } from './TransactionCategorySelect';

const defaultYear = '2026';

function formatLabel(value: string, fallback: string): string {
  if (!value.trim()) return fallback;
  return value.replaceAll('_', ' ');
}

function fileStem(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  return baseName.replace(/\.(json|pdf)$/i, '').toLowerCase();
}

function findStatement(
  file: VerifiedStatementFile,
  statements: Statement[],
): Statement | undefined {
  const matchingStem = statements.find(
    (statement) => statement.sourceFile && fileStem(statement.sourceFile) === fileStem(file.fileName),
  );
console.log(`====> findStatement`, file, statements)
  return matchingStem ?? statements.find(
    (statement) => statement.periodEnd === file.statementDate,
  );
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function getField(record: JsonRecord | null, ...names: string[]): unknown {
  if (!record) return undefined;
  return names.map((name) => record[name]).find((value) => value !== undefined && value !== null);
}

function formatMoney(value: unknown): string {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.replace(/[$,]/g, ''))
      : Number.NaN;

  if (!Number.isFinite(amount)) return 'Not extracted';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function moneyInCents(value: unknown): number | null {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.replace(/[$,]/g, ''))
      : Number.NaN;

  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function formatStatementDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'Not extracted';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function formatLongStatementDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return 'date not extracted';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function formatTransactionDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}/${match[3]}` : value;
}

function getTransactionSection(type: unknown): string {
  switch (type) {
    case 'credit':
    case 'payment':
      return 'Payments and Other Credits';
    case 'purchase':
      return 'Purchases and Adjustments';
    case 'fee':
      return 'Fees Charged';
    case 'interest':
      return 'Interest Charged';
    default:
      return 'Other Transactions';
  }
}

export function ExtractedTransactions({ data, onCategorySaved }: {
  data: unknown;
  onCategorySaved: (transactionId: string, category: Category) => void;
}) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryAttempt, setCategoryAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getCategories(controller.signal).then((result) => {
      if (!controller.signal.aborted) setCategories(result);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCategoriesError(error instanceof Error ? error.message : 'Unable to load categories.');
    }).finally(() => {
      if (!controller.signal.aborted) setCategoriesLoading(false);
    });
    return () => controller.abort();
  }, [categoryAttempt]);
  const root = asRecord(data);
  const summary = asRecord(getField(root, 'summary'));
  const transactions = Array.isArray(root?.transactions)
    ? root.transactions.flatMap((transaction) => {
        const record = asRecord(transaction);
        return record ? [record] : [];
      })
    : [];

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const heading = headingRef.current;
    if (!section || !heading) return;
    const updateOffset = () => section.style.setProperty(
      '--transaction-heading-height', `${heading.getBoundingClientRect().height}px`,
    );
    updateOffset();
    const observer = new ResizeObserver(updateOffset);
    observer.observe(heading);
    return () => observer.disconnect();
  }, [transactions.length]);

  if (transactions.length === 0) return null;

  return (
    <div className="extracted-transactions" ref={sectionRef}>
      <div className="extracted-summary-heading" ref={headingRef}>
        <h3>Transactions</h3>
        {categoriesLoading && <p role="status">Loading categories…</p>}
        {categoriesError && <div role="alert">
          {categoriesError}{' '}
          <button type="button" onClick={() => {
            setCategoriesError(null);
            setCategoriesLoading(true);
            setCategoryAttempt((attempt) => attempt + 1);
          }}>Retry categories</button>
        </div>}
        {!categoriesLoading && !categoriesError && categories.length === 0 && <p>No categories available.</p>}
      </div>
      <div className="extracted-transactions-table">
        <table>
          <colgroup><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col /><col style={{ width: '24%' }} /></colgroup>
          <thead>
            <tr>
              <th scope="col">Transaction<br />Date</th>
              <th scope="col">Posting<br />Date</th>
              <th scope="col">Description</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction, index) => {
              const section = getTransactionSection(getField(transaction, 'type'));
              const previousSection = index > 0
                ? getTransactionSection(getField(transactions[index - 1], 'type'))
                : null;
              const nextSection = index < transactions.length - 1
                ? getTransactionSection(getField(transactions[index + 1], 'type'))
                : null;
              const reference = getField(transaction, 'reference_number', 'referenceNumber');
              const category = getField(transaction, 'category');
              const transactionId = getField(transaction, 'transaction_id', 'transactionId');
              const sectionTotal = section === 'Payments and Other Credits'
                ? getField(summary, 'payments_and_other_credits', 'paymentsAndOtherCredits')
                : section === 'Purchases and Adjustments'
                  ? getField(summary, 'purchases_and_adjustments', 'purchasesAndAdjustments')
                  : section === 'Interest Charged'
                    ? getField(summary, 'interest_charged', 'interestCharged')
                    : undefined;
              const isFinalSectionOccurrence = !transactions
                .slice(index + 1)
                .some((nextTransaction) => (
                  getTransactionSection(getField(nextTransaction, 'type')) === section
                ));
              const sectionTransactions = transactions.filter((candidate) => (
                getTransactionSection(getField(candidate, 'type')) === section
              ));
              const calculatedTotalCents = sectionTransactions.reduce<number | null>(
                (total, candidate) => {
                  const amount = moneyInCents(getField(candidate, 'amount'));
                  return total === null || amount === null ? null : total + amount;
                },
                0,
              );
              const recordedTotalCents = moneyInCents(sectionTotal);
              const differenceCents = recordedTotalCents !== null && calculatedTotalCents !== null
                ? calculatedTotalCents - recordedTotalCents
                : null;

              return (
                <Fragment key={`${String(reference ?? '')}-${index}`}>
                  {section !== previousSection && (
                    <tr className="transaction-section-row">
                      <td colSpan={2} />
                      <th colSpan={2} scope="rowgroup">{section}</th>
                    </tr>
                  )}
                  <tr>
                    <td>{formatTransactionDate(getField(transaction, 'transaction_date', 'transactionDate'))}</td>
                    <td>{formatTransactionDate(getField(transaction, 'posting_date', 'postingDate'))}</td>
                    <td className="transaction-description">{String(getField(transaction, 'description') ?? '—')}
                      <TransactionCategorySelect
                        key={String(transactionId ?? index)}
                        transactionId={typeof transactionId === 'string' ? transactionId : ''}
                        description={String(getField(transaction, 'description') ?? '')}
                        categoryId={getField(transaction, 'category_id', 'categoryId')}
                        categoryName={typeof category === 'string' ? category : ''}
                        categories={categories}
                        onSaved={onCategorySaved}
                      />
                    </td>
                    <td className="transaction-amount">{formatMoney(getField(transaction, 'amount'))}</td>
                  </tr>
                  {section !== nextSection && isFinalSectionOccurrence && sectionTotal !== undefined && (
                    <>
                      <tr className="transaction-total-row">
                        <th colSpan={3} scope="row">{`TOTAL ${section.toUpperCase()} FOR THIS PERIOD`}</th>
                        <td className="transaction-amount">{formatMoney(sectionTotal)}</td>
                      </tr>
                      <tr className="transaction-total-row calculated-total-row">
                        <th colSpan={3} scope="row">
                          Calculated from {sectionTransactions.length} Transaction Rows
                        </th>
                        <td className="transaction-amount">
                          {calculatedTotalCents === null
                            ? 'Unable to calculate'
                            : formatMoney(calculatedTotalCents / 100)}
                        </td>
                      </tr>
                      <tr className={`transaction-variance-row${differenceCents === null ? '' : differenceCents === 0 ? ' totals-match' : ' totals-mismatch'}`}>
                        <th colSpan={3} scope="row">
                          Variance {differenceCents === null ? '— Unavailable' : differenceCents === 0 ? '— Match' : '— Mismatch'}
                        </th>
                        <td className="transaction-amount">
                          {differenceCents === null ? 'Unavailable' : formatMoney(differenceCents / 100)}
                        </td>
                      </tr>
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatType(value: unknown): string {
  return typeof value === 'string' && value
    ? value.replaceAll('_', ' ')
    : '—';
}

function DepositAccount({
  categories, onCategorySaved,
  account,
  index,
  periodStart,
  periodEnd,
}: {
  categories: Category[];
  onCategorySaved?: (transactionId: string, category: Category) => void;
  account: JsonRecord;
  index: number;
  periodStart: unknown;
  periodEnd: unknown;
}) {
  const summary = asRecord(getField(account, 'summary'));
  const transactions = Array.isArray(account.transactions)
    ? account.transactions.flatMap((transaction) => {
        const record = asRecord(transaction);
        return record ? [record] : [];
      })
    : [];
  const beginningBalanceCents = moneyInCents(
    getField(summary, 'beginning_balance', 'beginningBalance')
      ?? getField(account, 'beginning_balance', 'beginningBalance'),
  );
  const endingBalanceCents = moneyInCents(
    getField(summary, 'ending_balance', 'endingBalance')
      ?? getField(account, 'ending_balance', 'endingBalance'),
  );
  const accountType = formatType(getField(account, 'account_type', 'accountType'));
  const productName = String(
    getField(account, 'account_name', 'accountName', 'product_name', 'productName') ?? accountType,
  );
  const summaryRows = [
    [`Beginning balance on ${formatLongStatementDate(periodStart)}`, formatMoney(
      beginningBalanceCents === null ? undefined : beginningBalanceCents / 100,
    )],
    ['Deposits and Other Additions', formatMoney(getField(summary, 'deposits_and_other_additions', 'depositsAndOtherAdditions'))],
    ['Withdrawals and Other Subtractions', formatMoney(getField(summary, 'withdrawals_and_other_subtractions', 'withdrawalsAndOtherSubtractions'))],
    ['Checks', formatMoney(getField(summary, 'checks'))],
    ['Service Fees', formatMoney(getField(summary, 'service_fees', 'serviceFees'))],
    [`Ending balance on ${formatLongStatementDate(periodEnd)}`, formatMoney(
      endingBalanceCents === null ? undefined : endingBalanceCents / 100,
    )],
  ];
  const isServiceFee = (transaction: JsonRecord) => (
    ['fee', 'service_fee'].includes(String(getField(transaction, 'type') ?? '').toLowerCase())
  );
  const transactionGroups = [
    {
      title: 'Deposits and other additions',
      transactions: transactions.filter((transaction) => (
        !isServiceFee(transaction)
          && (moneyInCents(getField(transaction, 'amount')) ?? 0) >= 0
      )),
      total: getField(summary, 'deposits_and_other_additions', 'depositsAndOtherAdditions'),
    },
    {
      title: 'Withdrawals and other subtractions',
      transactions: transactions.filter((transaction) => (
        !isServiceFee(transaction)
          && (moneyInCents(getField(transaction, 'amount')) ?? 0) < 0
      )),
      total: getField(summary, 'withdrawals_and_other_subtractions', 'withdrawalsAndOtherSubtractions'),
    },
    {
      title: 'Service fees',
      transactions: transactions.filter(isServiceFee),
      total: getField(summary, 'service_fees', 'serviceFees'),
    },
  ];

  return (
    <section className="deposit-account" aria-labelledby={`deposit-account-${index}`}>
      <div className="deposit-account-heading">
        <div>
          <h4 id={`deposit-account-${index}`}>Your {productName}</h4>
        </div>
      </div>

      <h5 className="deposit-section-title">Account summary</h5>
      <dl className="deposit-account-summary pdf-account-summary">
        {summaryRows.map(([label, value]) => (
          <div className={label.startsWith('Ending balance') ? 'ending-balance-row' : undefined} key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {transactionGroups.map((group) => group.transactions.length > 0 && (
        <div className="deposit-transaction-group" key={group.title}>
          <h5 className="deposit-section-title">{group.title}</h5>
          <div className="extracted-transactions-table deposit-transactions-table">
            <table>
              <colgroup><col style={{ width: '15%' }} /><col /><col style={{ width: '24%' }} /></colgroup>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Description</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {group.transactions.map((transaction, transactionIndex) => (
                  <tr key={`${String(getField(transaction, 'transaction_date', 'transactionDate', 'date') ?? '')}-${transactionIndex}`}>
                    <td>{formatTransactionDate(getField(transaction, 'transaction_date', 'transactionDate', 'date'))}</td>
                    <td className="transaction-description">{String(getField(transaction, 'description') ?? '—')}
                    {onCategorySaved && <TransactionCategorySelect
                      transactionId={String(getField(transaction, 'transaction_id', 'transactionId') ?? '')}
                      description={String(getField(transaction, 'description') ?? '')}
                      categoryId={getField(transaction, 'category_id', 'categoryId')}
                      categoryName={String(getField(transaction, 'category') ?? '')}
                      categories={categories} onSaved={onCategorySaved}
                    />}</td>
                    <td className="transaction-amount">{formatMoney(getField(transaction, 'amount'))}</td>
                  </tr>
                ))}
                <tr className="transaction-total-row">
                  <th colSpan={2} scope="row">Total {group.title.toLowerCase()}</th>
                  <td className="transaction-amount">{formatMoney(group.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

export function ExtractedDepositStatement({ data, categories = [], onCategorySaved }: {
  data: unknown;
  categories?: Category[];
  onCategorySaved?: (transactionId: string, category: Category) => void;
}) {
  const root = asRecord(data);
  const accounts = Array.isArray(root?.accounts)
    ? root.accounts.flatMap((account) => {
        const record = asRecord(account);
        return record ? [record] : [];
      })
    : [];

  if (accounts.length === 0) return null;

  const combinedEndingBalanceCents = accounts.reduce<number | null>((total, account) => {
    const summary = asRecord(getField(account, 'summary'));
    const endingBalance = moneyInCents(
      getField(summary, 'ending_balance', 'endingBalance')
        ?? getField(account, 'ending_balance', 'endingBalance'),
    );
    return total === null || endingBalance === null ? null : total + endingBalance;
  }, 0);
  const extractedCombinedEndingBalance = getField(
    root,
    'combined_ending_balance',
    'combinedEndingBalance',
  );
  const combinedEndingBalance = moneyInCents(extractedCombinedEndingBalance) !== null
    ? extractedCombinedEndingBalance
    : combinedEndingBalanceCents === null
      ? undefined
      : combinedEndingBalanceCents / 100;

  return (
    <div className="extracted-deposit-statement">
      <section className="combined-account-summary" aria-labelledby="combined-account-summary-heading">
        <h3 id="combined-account-summary-heading">Your combined statement</h3>
        <p className="combined-statement-period">for {formatLongStatementDate(getField(root, 'period_start', 'periodStart'))} to {formatLongStatementDate(getField(root, 'period_end', 'periodEnd'))}</p>
        <table>
          <thead>
            <tr>
              <th scope="col">Your deposit accounts</th>
              <th scope="col">Ending balance</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account, index) => {
              const summary = asRecord(getField(account, 'summary'));
              const accountName = getField(
                account,
                'account_name',
                'accountName',
                'product_name',
                'productName',
                'account_type',
                'accountType',
              );
              const accountNumber = getField(
                account,
                'account_number_masked',
                'accountNumberMasked',
                'account_number_last4',
                'accountNumberLast4',
              );
              const endingBalance = getField(summary, 'ending_balance', 'endingBalance')
                ?? getField(account, 'ending_balance', 'endingBalance');

              return (
                <tr key={`${String(accountNumber ?? '')}-${index}`}>
                  <td>{String(accountName ?? 'Account')}</td>
                  <td>{formatMoney(endingBalance)}</td>
                </tr>
              );
            })}
            <tr className="combined-account-total">
              <th scope="row">Total balance</th>
              <td>{formatMoney(combinedEndingBalance)}</td>
            </tr>
          </tbody>
        </table>
      </section>
      <div className="deposit-accounts">
        {accounts.map((account, index) => (
          <DepositAccount
            categories={categories}
            onCategorySaved={onCategorySaved}
            account={account}
            index={index}
            key={`${String(getField(account, 'account_number_masked', 'accountNumberMasked', 'account_number_last4', 'accountNumberLast4') ?? '')}-${index}`}
            periodEnd={getField(root, 'period_end', 'periodEnd')}
            periodStart={getField(root, 'period_start', 'periodStart')}
          />
        ))}
      </div>
    </div>
  );
}

function AmexStatementSummary({ root, summary }: { root: JsonRecord; summary: JsonRecord }) {
  const newBalance = formatMoney(getField(summary, 'new_balance_total', 'newBalanceTotal'));
  const minimumPayment = formatMoney(getField(summary, 'total_minimum_payment_due', 'totalMinimumPaymentDue'));
  const rows = [
    ['Previous Balance', formatMoney(getField(summary, 'previous_balance', 'previousBalance'))],
    ['Payments/Credits', formatMoney(getField(summary, 'payments_and_other_credits', 'paymentsAndOtherCredits'))],
    ['New Charges', formatMoney(getField(summary, 'purchases_and_adjustments', 'purchasesAndAdjustments'))],
    ['Fees', formatMoney(getField(summary, 'fees_charged', 'feesCharged'))],
    ['Interest Charged', formatMoney(getField(summary, 'interest_charged', 'interestCharged'))],
  ];
  const creditRows = [
    ['Credit Limit', getField(summary, 'total_credit_line', 'totalCreditLine')],
    ['Available Credit', getField(summary, 'total_credit_available', 'totalCreditAvailable')],
    ['Cash Advance Limit', getField(summary, 'cash_advance_limit', 'cashAdvanceLimit', 'cash_credit_line')],
    ['Available Cash', getField(summary, 'available_cash', 'availableCash', 'cash_credit_available')],
  ].filter(([, value]) => value !== undefined);

  return <div className="extracted-statement-summary amex-statement-summary">
    <div className="amex-summary-grid">
      <section className="amex-balance-block" aria-label="New balance and payment due">
        <dl>
          <div><dt>New Balance</dt><dd>{newBalance}</dd></div>
          <div><dt>Minimum Payment Due</dt><dd>{minimumPayment}</dd></div>
          <div className="amex-payment-date"><dt>Payment Due Date</dt><dd>{formatStatementDate(getField(root, 'payment_due_date', 'paymentDueDate'))}</dd></div>
        </dl>
      </section>
      <section className="amex-account-block" aria-labelledby="amex-account-summary-heading">
        <h4 id="amex-account-summary-heading">Account Summary</h4>
        <div className="amex-account-box">
          <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <dl className="amex-summary-totals">
            <div><dt>New Balance</dt><dd>{newBalance}</dd></div>
            <div><dt>Minimum Payment Due</dt><dd>{minimumPayment}</dd></div>
          </dl>
        </div>
        {creditRows.length > 0 && <dl className="amex-credit-details">{creditRows.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{formatMoney(value)}</dd></div>)}</dl>}
      </section>
    </div>
  </div>;
}

export function ExtractedStatementSummary({ data }: { data: unknown }) {
  const root = asRecord(data);
  const summary = asRecord(getField(root, 'summary'));

  if (!root || !summary) return null;

  const institution = String(getField(root, 'financial_institution', 'financialInstitution') ?? '');
  if (/american\s+express|\bamex\b/i.test(institution)) {
    return <AmexStatementSummary root={root} summary={summary} />;
  }

  const accountSummary = [
    ['Previous Balance', formatMoney(getField(summary, 'previous_balance', 'previousBalance'))],
    ['Payments and Other Credits', formatMoney(getField(summary, 'payments_and_other_credits', 'paymentsAndOtherCredits'))],
    ['Purchases and Adjustments', formatMoney(getField(summary, 'purchases_and_adjustments', 'purchasesAndAdjustments'))],
    ['Fees Charged', formatMoney(getField(summary, 'fees_charged', 'feesCharged'))],
    ['Interest Charged', formatMoney(getField(summary, 'interest_charged', 'interestCharged'))],
    ['New Balance Total', formatMoney(getField(summary, 'new_balance_total', 'newBalanceTotal'))],
    ['Statement Closing Date', formatStatementDate(getField(root, 'statement_closing_date', 'statementClosingDate', 'period_end', 'periodEnd'))],
    ['Days in Billing Cycle', String(getField(root, 'days_in_billing_cycle', 'daysInBillingCycle') ?? 'Not extracted')],
  ];
  const currentPaymentDue = getField(summary, 'current_payment_due', 'currentPaymentDue')
    ?? getField(root, 'current_payment_due', 'currentPaymentDue');
  const paymentInformation = [
    ['New Balance Total', formatMoney(getField(summary, 'new_balance_total', 'newBalanceTotal'))],
    ...(currentPaymentDue !== undefined ? [['Current Payment Due', formatMoney(currentPaymentDue)]] : []),
    ['Total Minimum Payment Due', formatMoney(getField(summary, 'total_minimum_payment_due', 'totalMinimumPaymentDue'))],
    ['Payment Due Date', formatStatementDate(getField(root, 'payment_due_date', 'paymentDueDate'))],
  ];

  return (
    <div className="extracted-statement-summary">
      <div className="extracted-summary-grid">
        <section aria-labelledby="account-summary-heading">
          <h4 id="account-summary-heading">Account Summary / Payment Information</h4>
          <dl>
            {accountSummary.map(([label, value]) => (
              <div key={label} className={label === 'New Balance Total' ? 'summary-divider' : undefined}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-label="Payment information">
          <dl>
            {paymentInformation.map(([label, value]) => (
              <div key={label} className={label === 'Total Minimum Payment Due' ? 'summary-divider' : undefined}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

export function JsonStatements() {
  const [year, setYear] = useState(defaultYear);
  const [files, setFiles] = useState<VerifiedStatementFile[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [statementData, setStatementData] = useState<unknown>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isFilesLoading, setIsFilesLoading] = useState(true);
  const [isStatementIndexLoading, setIsStatementIndexLoading] = useState(true);
  const [isStatementLoading, setIsStatementLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [statementError, setStatementError] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const selectionRequest = useRef<AbortController | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    getVerifiedStatementFiles(year)
      .then((nextFiles) => {
        if (isMounted) setFiles(nextFiles);
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setFiles([]);
          setStatements([]);
          setFilesError(error instanceof Error ? error.message : 'Unable to load files.');
        }
      })
      .finally(() => {
        if (isMounted) setIsFilesLoading(false);
      });

    getStatements()
      .then((nextStatements) => {
        if (isMounted) setStatements(nextStatements);
      })
      .catch(() => {
        if (isMounted) setStatements([]);
      })
      .finally(() => {
        if (isMounted) setIsStatementIndexLoading(false);
      });

    return () => { isMounted = false; };
  }, [year]);

  useEffect(() => () => {
    selectionRequest.current?.abort();
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
  }, []);

  function clearPdf() {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = null;
    setPdfUrl(null);
  }

  function changeYear(nextYear: string) {
    setYear(nextYear);
    setFiles([]);
    setStatements([]);
    setSelectedFile(null);
    setStatementData(null);
    selectionRequest.current?.abort();
    clearPdf();
    setFilesError(null);
    setStatementError(null);
    setPdfError(null);
    setIsFilesLoading(true);
    setIsStatementIndexLoading(true);
    setIsStatementLoading(false);
  }

  async function selectFile(fileName: string) {
    selectionRequest.current?.abort();
    const controller = new AbortController();
    selectionRequest.current = controller;

    setSelectedFile(fileName);
    setStatementData(null);
    clearPdf();
    setStatementError(null);
    setPdfError(null);
    setIsStatementLoading(true);

    const file = files.find((candidate) => candidate.fileName === fileName);
    const statement = file ? findStatement(file, statements) : undefined;

    const jsonRequest = getVerifiedStatementData(year, fileName)
      .then((data) => {
        if (!controller.signal.aborted) setStatementData(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setStatementError(
            error instanceof Error ? error.message : 'Unable to load statement data.',
          );
        }
      });

    const pdfFileName = fileName.replace(/\.json$/i, '.pdf');
    const pdfRequest = (statement
      ? getStatementPdf(statement.id, controller.signal)
      : getStatementPdfByFilename(pdfFileName, controller.signal))
      .then((blob) => {
        if (controller.signal.aborted) return;
        const nextPdfUrl = URL.createObjectURL(blob);
        pdfUrlRef.current = nextPdfUrl;
        setPdfUrl(nextPdfUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPdfError(error instanceof Error ? error.message : 'Unable to load statement PDF.');
        }
      });

    try {
      await Promise.all([jsonRequest, pdfRequest]);
    } finally {
      if (!controller.signal.aborted) setIsStatementLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <h1>JSON Statements</h1>
        <p>Compare each source PDF directly with its extracted JSON data.</p>
      </div>

      <div className="dashboard-toolbar json-statement-filters" aria-label="JSON statement filters">
        <label className="year-select">
          <span>Year</span>
          <input
            type="number"
            min="2000"
            max="2100"
            value={year}
            onChange={(event) => changeYear(event.target.value)}
          />
        </label>
        <label className="statement-select">
          <span>Statement</span>
          <select
            value={selectedFile ?? ''}
            disabled={
              isFilesLoading ||
              isStatementIndexLoading ||
              Boolean(filesError) ||
              files.length === 0
            }
            onChange={(event) => {
              if (event.target.value) void selectFile(event.target.value);
            }}
          >
            <option value="">
              {isFilesLoading || isStatementIndexLoading
                ? 'Loading statements…'
                : 'Choose a statement…'}
            </option>
            {files.map((file) => (
              <option key={file.fileName} value={file.fileName}>
                {formatLabel(file.statementDate, 'Date unavailable')} — {formatLabel(file.statementType, 'Type unavailable')} — {file.fileName}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-metric statement-count">
          <span className="toolbar-label">Available</span>
          <strong>{files.length}</strong>
        </div>
      </div>

      {filesError && <p className="status-message error-message" role="alert">{filesError}</p>}
      {!isFilesLoading && !filesError && files.length === 0 && (
        <p className="status-message">No verified statements found for {year}.</p>
      )}

      {!filesError && files.length > 0 && (
        <div className="json-statement-details">
          <section className="content-section pdf-data-section" aria-labelledby="statement-pdf-heading">
            <div className="section-heading">
              <div>
                <h2 id="statement-pdf-heading">Statement PDF</h2>
                <p>{selectedFile ?? 'Select a file to view its source PDF.'}</p>
              </div>
            </div>
            {isStatementLoading && !pdfUrl && !pdfError && <p className="panel-state">Loading statement PDF...</p>}
            {pdfError && <p className="panel-state error-message" role="alert">{pdfError}</p>}
            {!selectedFile && <p className="empty-state">Choose a statement above to begin comparing.</p>}
            {pdfUrl && (
              <iframe
                className="statement-pdf"
                src={pdfUrl}
                title={`PDF for ${selectedFile ?? 'selected statement'}`}
              />
            )}
          </section>

          <section className="content-section json-data-section" aria-labelledby="statement-json-heading">
            <div className="section-heading">
              <div>
                <h2 id="statement-json-heading">Statement data</h2>
                <p>{selectedFile ?? 'Select a file to inspect its JSON.'}</p>
              </div>
            </div>
            <div className="json-derived-scroll">
              {isStatementLoading && statementData === null && !statementError && <p className="panel-state">Loading statement data...</p>}
              {statementError && <p className="panel-state error-message" role="alert">{statementError}</p>}
              {!selectedFile && <p className="empty-state">Choose a statement above to begin comparing.</p>}
              {statementData !== null && (
                <>
                  <ExtractedStatementSummary data={statementData} />
                  <ExtractedTransactions data={statementData} onCategorySaved={(transactionId, category) => {
                    setStatementData((current: unknown) => {
                      const root = asRecord(current);
                      if (!root || !Array.isArray(root.transactions)) return current;
                      return { ...root, transactions: root.transactions.map((value: unknown) => {
                        const transaction = asRecord(value);
                        return getField(transaction, 'transaction_id', 'transactionId') === transactionId
                          ? { ...transaction, category_id: category.id, category: category.name }
                          : value;
                      }) };
                    });
                  }} />
                  <ExtractedDepositStatement data={statementData} />
                  <div className="raw-json-heading">
                    <h3>Raw JSON</h3>
                  </div>
                  <pre className="statement-json"><code>{JSON.stringify(statementData, null, 2)}</code></pre>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
