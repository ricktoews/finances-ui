import { Fragment, useEffect, useRef, useState } from 'react';
import {
  getStatementPdf,
  getStatements,
  getVerifiedStatementData,
  getVerifiedStatementFiles,
} from '../api/financesApi';
import type { Statement, VerifiedStatementFile } from '../types/finance';

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

function ExtractedTransactions({ data }: { data: unknown }) {
  const root = asRecord(data);
  const summary = asRecord(getField(root, 'summary'));
  const transactions = Array.isArray(root?.transactions)
    ? root.transactions.flatMap((transaction) => {
        const record = asRecord(transaction);
        return record ? [record] : [];
      })
    : [];

  if (transactions.length === 0) return null;

  return (
    <div className="extracted-transactions">
      <div className="extracted-summary-heading">
        <h3>Transactions</h3>
        <p>{transactions.length} entries shown in their original JSON array order.</p>
      </div>
      <div className="extracted-transactions-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Transaction date</th>
              <th scope="col">Posting date</th>
              <th scope="col">Description</th>
              <th scope="col">Reference</th>
              <th scope="col">Account</th>
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
              const account = getField(transaction, 'account_number_last4', 'accountNumberLast4');
              const sectionTotal = section === 'Payments and Other Credits'
                ? getField(summary, 'payments_and_other_credits', 'paymentsAndOtherCredits')
                : section === 'Purchases and Adjustments'
                  ? getField(summary, 'purchases_and_adjustments', 'purchasesAndAdjustments')
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
                      <th colSpan={6} scope="rowgroup">{section}</th>
                    </tr>
                  )}
                  <tr>
                    <td>{formatTransactionDate(getField(transaction, 'transaction_date', 'transactionDate'))}</td>
                    <td>{formatTransactionDate(getField(transaction, 'posting_date', 'postingDate'))}</td>
                    <td className="transaction-description">{String(getField(transaction, 'description') ?? '—')}</td>
                    <td>{String(reference ?? '—')}</td>
                    <td>{String(account ?? '—')}</td>
                    <td className="transaction-amount">{formatMoney(getField(transaction, 'amount'))}</td>
                  </tr>
                  {section !== nextSection && isFinalSectionOccurrence && sectionTotal !== undefined && (
                    <>
                      <tr className="transaction-total-row">
                        <th colSpan={5} scope="row">Recorded {section} Total</th>
                        <td className="transaction-amount">{formatMoney(sectionTotal)}</td>
                      </tr>
                      <tr className="transaction-total-row calculated-total-row">
                        <th colSpan={5} scope="row">
                          Calculated from {sectionTransactions.length} Transaction Rows
                        </th>
                        <td className="transaction-amount">
                          {calculatedTotalCents === null
                            ? 'Unable to calculate'
                            : formatMoney(calculatedTotalCents / 100)}
                        </td>
                      </tr>
                      <tr className={`transaction-variance-row${differenceCents === null ? '' : differenceCents === 0 ? ' totals-match' : ' totals-mismatch'}`}>
                        <th colSpan={5} scope="row">
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

function DepositAccount({ account, index }: { account: JsonRecord; index: number }) {
  const summary = asRecord(getField(account, 'summary'));
  const transactions = Array.isArray(account.transactions)
    ? account.transactions.flatMap((transaction) => {
        const record = asRecord(transaction);
        return record ? [record] : [];
      })
    : [];
  const beginningBalanceCents = moneyInCents(
    getField(account, 'beginning_balance', 'beginningBalance'),
  );
  const endingBalanceCents = moneyInCents(
    getField(account, 'ending_balance', 'endingBalance'),
  );
  const activityTotalCents = transactions.reduce<number | null>((total, transaction) => {
    const amount = moneyInCents(getField(transaction, 'amount'));
    return total === null || amount === null ? null : total + amount;
  }, 0);
  const calculatedEndingCents = beginningBalanceCents !== null && activityTotalCents !== null
    ? beginningBalanceCents + activityTotalCents
    : null;
  const differenceCents = endingBalanceCents !== null && calculatedEndingCents !== null
    ? calculatedEndingCents - endingBalanceCents
    : null;
  const accountType = formatType(getField(account, 'account_type', 'accountType'));
  const productName = String(getField(account, 'product_name', 'productName') ?? accountType);
  const accountNumber = String(
    getField(account, 'account_number_masked', 'accountNumberMasked') ?? 'Number unavailable',
  );
  const summaryRows = [
    ['Beginning Balance', formatMoney(getField(account, 'beginning_balance', 'beginningBalance'))],
    ['Deposits and Other Additions', formatMoney(getField(summary, 'deposits_and_other_additions', 'depositsAndOtherAdditions'))],
    ['Withdrawals and Other Subtractions', formatMoney(getField(summary, 'withdrawals_and_other_subtractions', 'withdrawalsAndOtherSubtractions'))],
    ['Checks', formatMoney(getField(summary, 'checks'))],
    ['Service Fees', formatMoney(getField(summary, 'service_fees', 'serviceFees'))],
    ['Annual Percentage Yield Earned', getField(summary, 'annual_percentage_yield_earned', 'annualPercentageYieldEarned') === undefined
      ? 'Not extracted'
      : `${String(getField(summary, 'annual_percentage_yield_earned', 'annualPercentageYieldEarned'))}%`],
    ['Interest Paid Year to Date', formatMoney(getField(summary, 'interest_paid_year_to_date', 'interestPaidYearToDate'))],
    ['Ending Balance', formatMoney(getField(account, 'ending_balance', 'endingBalance'))],
  ];

  return (
    <section className="deposit-account" aria-labelledby={`deposit-account-${index}`}>
      <div className="deposit-account-heading">
        <div>
          <h4 id={`deposit-account-${index}`}>{productName}</h4>
          <p>{accountType} · {accountNumber}</p>
        </div>
        <strong>{formatMoney(getField(account, 'ending_balance', 'endingBalance'))}</strong>
      </div>

      <dl className="deposit-account-summary">
        {summaryRows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <div className="deposit-transactions-heading">
        <h5>Transactions</h5>
        <p>{transactions.length} entries in original JSON array order.</p>
      </div>
      <div className="extracted-transactions-table deposit-transactions-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Transaction date</th>
              <th scope="col">Description</th>
              <th scope="col">Type</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((transaction, transactionIndex) => (
              <tr key={`${String(getField(transaction, 'transaction_date', 'transactionDate') ?? '')}-${transactionIndex}`}>
                <td>{formatTransactionDate(getField(transaction, 'transaction_date', 'transactionDate'))}</td>
                <td className="transaction-description">{String(getField(transaction, 'description') ?? '—')}</td>
                <td>{formatType(getField(transaction, 'type'))}</td>
                <td className="transaction-amount">{formatMoney(getField(transaction, 'amount'))}</td>
              </tr>
            ))}
            <tr className="transaction-total-row">
              <th colSpan={3} scope="row">Calculated Net Transaction Activity</th>
              <td className="transaction-amount">
                {activityTotalCents === null ? 'Unable to calculate' : formatMoney(activityTotalCents / 100)}
              </td>
            </tr>
            <tr className="transaction-total-row calculated-total-row">
              <th colSpan={3} scope="row">Calculated Ending Balance</th>
              <td className="transaction-amount">
                {calculatedEndingCents === null ? 'Unable to calculate' : formatMoney(calculatedEndingCents / 100)}
              </td>
            </tr>
            <tr className={`transaction-variance-row${differenceCents === null ? '' : differenceCents === 0 ? ' totals-match' : ' totals-mismatch'}`}>
              <th colSpan={3} scope="row">
                Ending Balance Variance {differenceCents === null ? '— Unavailable' : differenceCents === 0 ? '— Match' : '— Mismatch'}
              </th>
              <td className="transaction-amount">
                {differenceCents === null ? 'Unavailable' : formatMoney(differenceCents / 100)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExtractedDepositStatement({ data }: { data: unknown }) {
  const root = asRecord(data);
  const accounts = Array.isArray(root?.accounts)
    ? root.accounts.flatMap((account) => {
        const record = asRecord(account);
        return record ? [record] : [];
      })
    : [];

  if (accounts.length === 0) return null;

  return (
    <div className="extracted-deposit-statement">
      <div className="extracted-summary-heading deposit-statement-heading">
        <div>
          <h3>Extracted checking and savings accounts</h3>
          <p>{accounts.length} accounts · {formatStatementDate(getField(root, 'period_start', 'periodStart'))}–{formatStatementDate(getField(root, 'period_end', 'periodEnd'))}</p>
        </div>
        <div className="combined-balance">
          <span>Combined ending balance</span>
          <strong>{formatMoney(getField(root, 'combined_ending_balance', 'combinedEndingBalance'))}</strong>
        </div>
      </div>
      <div className="deposit-accounts">
        {accounts.map((account, index) => (
          <DepositAccount account={account} index={index} key={`${String(getField(account, 'account_number_masked', 'accountNumberMasked') ?? '')}-${index}`} />
        ))}
      </div>
    </div>
  );
}

function ExtractedStatementSummary({ data }: { data: unknown }) {
  const root = asRecord(data);
  const summary = asRecord(getField(root, 'summary'));

  if (!root || !summary) return null;

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
  const paymentInformation = [
    ['New Balance Total', formatMoney(getField(summary, 'new_balance_total', 'newBalanceTotal'))],
    ['Total Minimum Payment Due', formatMoney(getField(summary, 'total_minimum_payment_due', 'totalMinimumPaymentDue'))],
    ['Payment Due Date', formatStatementDate(getField(root, 'payment_due_date', 'paymentDueDate'))],
  ];

  return (
    <div className="extracted-statement-summary">
      <div className="extracted-summary-heading">
        <h3>Extracted summary</h3>
        <p>Structured values to compare with the first page of the PDF.</p>
      </div>
      <div className="extracted-summary-grid">
        <section aria-labelledby="account-summary-heading">
          <h4 id="account-summary-heading">Account Summary / Payment Information</h4>
          <dl>
            {accountSummary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="payment-information-heading">
          <h4 id="payment-information-heading">Payment Information</h4>
          <dl>
            {paymentInformation.map(([label, value]) => (
              <div key={label}>
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

    let pdfRequest: Promise<void>;
    if (!statement) {
      setPdfError('No matching statement ID was found for this verified file.');
      pdfRequest = Promise.resolve();
    } else {
      pdfRequest = getStatementPdf(statement.id, controller.signal)
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

    }

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
                  <ExtractedTransactions data={statementData} />
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
