// Run with: node --test src/tests/mysql-api.test.cjs (from the repository root).
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023 },
    }).outputText;
    module._compile(output, filename);
  };
}
const api = require('../api/financesApi.ts');
const { categoryCounts, categoryYearAverage } = require('../components/verifiedStatementData.ts');
const { ImportStatusNotice } = require('../components/ImportStatusNotice.tsx');
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const canonical = 'statement:account:1';

// Exercise the actual editor's async handler with lightweight hook stubs.
function editor(props) {
  const filename = require.resolve('../components/TransactionCategorySelect.tsx');
  const module = new Module(filename, moduleParent);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(require('node:path').dirname(filename));
  const realRequire = module.require.bind(module);
  let stateIndex = 0;
  const states = [];
  module.require = (name) => name === 'react' ? {
    ...React, useContext: () => null, useId: () => 'test-editor', useRef: (value) => ({ current: value }),
    useState: (initial) => {
      const index = stateIndex++;
      return [index === 2 ? true : initial, (value) => { states[index] = value; }];
    },
  } : realRequire(name);
  require.extensions['.tsx'](module, filename);
  const tree = module.exports.TransactionCategorySelect({
    transactionId: canonical, numericId: 17, description: 'Fixture', categoryId: 1,
    categoryName: 'Old', categories: [{ id: 1, name: 'Old' }, { id: 2, name: 'New' }],
    onSaved: async () => {}, ...props,
  });
  const select = tree.props.children.find((child) => child?.type === 'select');
  return { tree, select, states };
}
const moduleParent = module;

test('POST uses canonical identity and rejects numeric IDs and NULL categories', async () => {
  const calls = [];
  global.fetch = async (url, init) => { calls.push([url, init]); return response({ success: true }); };
  await api.setTransactionCategory(canonical, 2);
  assert.equal(calls[0][0], 'https://finances.toews-api.com/transaction-categories');
  assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(JSON.parse(calls[0][1].body), { transaction_id: canonical, category_id: 2 });
  await assert.rejects(api.setTransactionCategory('17', 2), /canonical/);
  await assert.rejects(api.setTransactionCategory(17, 2), /canonical/);
  await assert.rejects(api.setTransactionCategory(canonical, null), /category ID/);
  assert.equal(calls.length, 1);
});

test('numeric reset handles successful reset, failure envelope, conflict and unavailable', async () => {
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://finances.toews-api.com/transactions/17/category');
    assert.equal(init.method, 'PATCH');
    assert.deepEqual(JSON.parse(init.body), { category_id: null });
    return response({ success: true });
  };
  await api.resetTransactionCategory(17);
  await assert.rejects(api.resetTransactionCategory(canonical), /numeric/);
  for (const [body, status, message] of [[{ success: false }, 200, /did not apply/], [{}, 409, /no canonical ID/], [{}, 503, /temporarily unavailable/]]) {
    global.fetch = async () => response(body, status);
    await assert.rejects(api.resetTransactionCategory(17), message);
  }
});

test('editor waits for backend refresh and replaces parent fields and totals after save/reset', async () => {
  let data = { transactions: [{ transaction_id: canonical, category: 'Old', parent_category: 'Old parent', amount: 10 }] };
  const next = { transactions: [{ transaction_id: canonical, category: 'New', category_id: 2, parent_category: null, parent_category_id: null, merchant: null }] };
  next.transactions[0].amount = 10;
  const calls = [];
  global.fetch = async (url, init) => { calls.push(init?.method || 'GET'); return response(init?.method ? { success: true } : next); };
  for (const value of ['2', 'reset']) {
    const ui = editor({ onSaved: async () => { data = await api.getVerifiedStatementData('2026', 'fixture.json'); } });
    await ui.select.props.onChange({ target: { value } });
    assert.equal(ui.states[0], 'saved');
    assert.equal(data.transactions[0].parent_category, null);
    assert.deepEqual(categoryCounts([{ data }]).map((item) => [item.name, item.amountCents]), [['New', 1000]]);
  }
  assert.deepEqual(calls, ['POST', 'GET', 'PATCH', 'GET']);
});

test('editor reports refresh failure and hides reset without numeric identity', async () => {
  global.fetch = async () => response({ success: true });
  const ui = editor({ numericId: undefined, onSaved: async () => { throw new Error('unavailable'); } });
  assert.equal(ui.select.props.children.some((child) => child?.props?.value === 'reset'), false);
  await ui.select.props.onChange({ target: { value: '2' } });
  assert.match(ui.states[1], /Category saved, but refreshed data/);
  assert.equal(ui.states[0], 'idle');
});

test('relational normalization preserves canonical/numeric IDs and NULL enrichment; old responses work', async () => {
  global.fetch = async (url) => {
    assert.match(url, /\/statements\/42\/transactions$/);
    return response([{ id: 17, transaction_id: canonical, merchant: null, merchant_id: null, category: null, category_id: null, parent_category: null, parent_category_id: null, amount: '-10.20' }, { id: 18, amount: 5 }]);
  };
  const rows = await api.getStatementTransactions('42');
  assert.equal(rows[0].numericId, 18); // Stable ID tie-break ordering.
  const row = rows.find((item) => item.id === canonical);
  assert.equal(row.numericId, 17);
  assert.equal(row.merchant, null);
  assert.equal(row.parent_category, null);
  assert.equal(row.category_id, null);
  assert.equal(row.category, null);
  assert.equal(row.amount, -10.2);
});

test('import notice tolerates absent status and retains nested archive evidence', async () => {
  const data = { accounts: [{ transactions: [{ description: 'Archive evidence', amount: 8, category: null }] }], import_status: { fully_imported: false, missing_transaction_ids: ['missing'], incomplete_account_period_count: 1 } };
  global.fetch = async () => response(data);
  const loaded = await api.getVerifiedStatementData('2026', 'fixture.json');
  assert.deepEqual(loaded, data);
  assert.match(renderToStaticMarkup(React.createElement(ImportStatusNotice, { data: loaded })), /Some statement data is awaiting import/);
  assert.equal(categoryCounts([{ data: loaded }])[0].amountCents, 800);
  assert.equal(categoryYearAverage([{ fileName: '2026-04-30.json', data: loaded }], '2026', 'grocery').months, 0);
  for (const old of [{}, { import_status: { fully_imported: true } }]) assert.equal(renderToStaticMarkup(React.createElement(ImportStatusNotice, { data: old })), '');
});

test('PDF numeric and filename routes remain unchanged', async () => {
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return new Response('%PDF-fixture', { headers: { 'Content-Type': 'application/pdf' } }); };
  assert.equal((await api.getStatementPdf('42')).type, 'application/pdf');
  await api.getStatementPdfByFilename('April 2026.pdf');
  assert.deepEqual(urls, ['https://finances.toews-api.com/statements/42/pdf', 'https://finances.toews-api.com/statements/by-filename/April%202026.pdf/pdf']);
});

test('saved report labels and signed values are not reclassified; expense parent fallback is preserved', async () => {
  global.fetch = async () => response({ currency: 'USD', transactions: [{ transaction_id: canonical, category: 'Current', report_category: 'Saved category', report_label: '  Saved label  ', amount: -12, source_json: 'original.json' }] });
  const report = await api.getReportTransactions('saved');
  assert.equal(report.transactions[0].category, 'Saved category');
  assert.equal(report.transactions[0].reportLabel, '  Saved label  ');
  assert.equal(report.transactions[0].amount, -12);
  assert.equal(report.transactions[0].sourceFile, 'original.json');
  global.fetch = async () => response({ summary: { selected_total: -12 }, transactions: [{ transaction_id: canonical, category: 'Utilities', parent_category: 'Utilities', amount: -12, expense_amount: 12 }] });
  const expenses = await api.getExpensesReport('2026', '04');
  assert.equal(expenses.transactions[0].parentCategory, 'Utilities');
  assert.equal(expenses.summary.selectedTotal, -12);
});

test('503 reads give a temporary unavailability message', async () => {
  global.fetch = async () => response({}, 503);
  await assert.rejects(api.getVerifiedStatementData('2026', 'fixture.json'), /temporarily unavailable/);
  await assert.rejects(api.getStatementPdf('42'), /temporarily unavailable/);
});

test('Overview loads only the selected closing month through numeric statement routes', async () => {
  const { overviewMonths, loadOverviewMonth } = require('../components/overviewData.ts');
  const statements = [
    { id: '42', periodEnd: '2026-04-30', periodStart: '2026-03-31', sourceFile: 'april.json', institution: 'Bank', statementType: 'credit_card_statement' },
    { id: '43', periodEnd: '2026-05-31', sourceFile: 'may.json' },
    { id: '44', periodEnd: '2025-12-31', sourceFile: 'december.json' },
  ];
  assert.deepEqual(overviewMonths(statements), ['2026-05', '2026-04', '2025-12']);
  const calls = [];
  const controller = new AbortController();
  global.fetch = async (url, init) => {
    calls.push(url);
    assert.equal(init.signal, controller.signal);
    return response([{ id: 17, transaction_id: canonical, category: 'grocery', parent_category: 'food', amount: -25, transaction_date: '2026-03-31' }]);
  };
  const loaded = await loadOverviewMonth(statements, '2026-04', controller.signal);
  assert.deepEqual(calls, ['https://finances.toews-api.com/statements/42/transactions']);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].data.transactions[0].transaction_id, canonical);
  assert.equal(loaded[0].data.transactions[0].id, 17);
  assert.equal(loaded[0].data.transactions[0].transaction_date, '2026-03-31');
  assert.equal(categoryCounts(loaded)[0].amountCents, -2500);
  assert.equal(categoryCounts(loaded)[0].name, 'food');
});

test('Overview exposes API failures without falling back to archive JSON and honors cancellation', async () => {
  const { loadOverviewMonth } = require('../components/overviewData.ts');
  const statements = [{ id: '42', periodEnd: '2026-04-30', sourceFile: 'april.json' }];
  const calls = [];
  global.fetch = async (url) => { calls.push(url); return response({}, 503); };
  const controller = new AbortController();
  const loaded = await loadOverviewMonth(statements, '2026-04', controller.signal);
  assert.match(loaded[0].error, /temporarily unavailable/);
  assert.equal(loaded[0].data, undefined);
  controller.abort();
  assert.deepEqual(await loadOverviewMonth(statements, '2026-04', controller.signal), []);
  assert.equal(calls.length, 1);
  assert.equal(calls.some((url) => url.includes('verified-statements')), false);
});
