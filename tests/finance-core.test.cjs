const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../finance-core.js');

const sampleExpenses = [
  { id: 'installment', amount: 600, installments: 6, firstDate: '2026-01-12', payment: 'Cartão', cardId: 'card-a', type: 'expense' },
  { id: 'cash-purchase', amount: 70, installments: 1, firstDate: '2026-02-01', payment: 'Pix', type: 'expense' },
  { id: 'other-card', amount: 250, installments: 1, firstDate: '2026-03-03', payment: 'Cartão', cardId: 'card-b', type: 'expense' },
];

test('splits money to cents and assigns a rounding remainder to the final installment', () => {
  assert.deepEqual([0, 1, 2].map((index) => Core.installmentAmount(100, 3, index)), [33.33, 33.33, 33.34]);
});

test('counts all unpaid installments, including future ones, as card limit used', () => {
  const payments = [{ expenseId: 'installment', installmentIndex: 0, amount: 100 }];
  assert.equal(Core.cardUsed(sampleExpenses, payments, 'card-a'), 500);
  assert.equal(Core.cardUsed(sampleExpenses, [], 'card-b'), 250);
  assert.equal(Core.cardUsed(sampleExpenses, [], 'missing'), 0);
});

test('calculates monthly card due dates and detects overdue charges by calendar day', () => {
  assert.equal(Core.cardDueDate('2026-02-14', 31), '2026-02-28');
  assert.equal(Core.isChargeOverdue('2026-02-01', 10, '2026-02-10'), false);
  assert.equal(Core.isChargeOverdue('2026-02-01', 10, '2026-02-11'), true);
  assert.equal(Core.isChargeOverdue('2026-02-01', '', '2026-02-11'), false);
});

test('returns only the selected card month charges and subtracts prior settlements', () => {
  const payments = [{ expenseId: 'installment', installmentIndex: 3, amount: 100 }];
  const charges = Core.monthCharges(sampleExpenses, payments, 'card-a', '2026-04');
  assert.equal(charges.length, 1);
  assert.equal(charges[0].expense.id, 'installment');
  assert.equal(charges[0].index, 3);
  assert.equal(charges[0].amount, 100);
  assert.equal(charges[0].remaining, 0);
});

test('creates full-payment allocations only for unpaid charges', () => {
  const charges = Core.monthCharges(sampleExpenses, [], 'card-a', '2026-03');
  const allocations = Core.allocateFullPayment(charges);
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].expenseId, 'installment');
  assert.equal(allocations[0].installmentIndex, 2);
  assert.equal(allocations[0].amount, 100);
});

test('calculates available credit without allowing a negative used amount', () => {
  assert.equal(Core.availableLimit(1000, 500), 500);
  assert.equal(Core.availableLimit(400, 500), -100);
});

test('counts a card-funded bill payment as debt on the funding card', () => {
  const transfer = { id: 'transfer', amount: 80, installments: 1, firstDate: '2026-04-12', payment: 'Cartão', cardId: 'card-b', type: 'debt-transfer' };
  assert.equal(Core.cardUsed([...sampleExpenses, transfer], [], 'card-b'), 330);
});

test('returns only expense charges for the selected month, including that month installment only', () => {
  const transfer = { id: 'transfer', amount: 80, installments: 1, firstDate: '2026-02-12', payment: 'Cartão', cardId: 'card-b', type: 'debt-transfer' };
  const charges = Core.transactionCharges([...sampleExpenses, transfer], [], '2026-02');
  assert.deepEqual(charges.map(({ expense, index }) => [expense.id, index]), [['installment', 1], ['cash-purchase', 0]]);
});

test('paginates monthly charges with a selected page size and clamps an out-of-range page', () => {
  const charges = Array.from({ length: 26 }, (_, id) => id);
  assert.deepEqual(Core.paginate(charges, 2, 10), { items: Array.from({ length: 10 }, (_, id) => id + 10), page: 2, pageSize: 10, totalItems: 26, totalPages: 3 });
  assert.deepEqual(Core.paginate(charges, 99, 10), { items: [20, 21, 22, 23, 24, 25], page: 3, pageSize: 10, totalItems: 26, totalPages: 3 });
  assert.deepEqual(Core.paginate([], 1, 50), { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 1 });
});

test('builds the overview totals separately for Pix, cash, and card charges', () => {
  const expenses = [
    { id: 'bed', amount: 100, installments: 9, firstDate: '2026-11-04', payment: 'Cartão', cardId: 'card-a', type: 'expense' },
    { id: 'market', amount: 10, installments: 1, firstDate: '2026-11-03', payment: 'Pix', type: 'expense' },
    { id: 'cash', amount: 6.5, installments: 1, firstDate: '2026-11-02', payment: 'Dinheiro', type: 'expense' },
    { id: 'transfer', amount: 5, installments: 1, firstDate: '2026-11-01', payment: 'Cartão', cardId: 'card-a', type: 'debt-transfer' },
  ];
  const summary = Core.monthlyOverview(expenses, [], '2026-11');
  assert.equal(summary.charges.length, 3);
  assert.equal(summary.total, 27.61);
  assert.equal(summary.pix, 10);
  assert.equal(summary.card, 11.11);
  assert.equal(summary.cash, 6.5);
});

test('groups chart bars by category and orders the largest monthly spend first', () => {
  const charges = [
    { expense: { category: 'Alimentação' }, amount: 10 },
    { expense: { category: 'Saúde' }, amount: 11.11 },
    { expense: { category: 'Alimentação' }, amount: 4.25 },
  ];
  assert.deepEqual(Core.categoryBreakdown(charges), [
    { category: 'Alimentação', amount: 14.25 },
    { category: 'Saúde', amount: 11.11 },
  ]);
});

test('calculates the monthly average charge and handles an empty month', () => {
  const charges = [
    { expense: { category: 'Moradia' }, amount: 200 },
    { expense: { category: 'Alimentação' }, amount: 50 },
    { expense: { category: 'Moradia' }, amount: 10 },
  ];
  assert.deepEqual(Core.averageChargeSummary(charges), {
    averageCharge: 86.67,
    chargeCount: 3,
  });
  assert.deepEqual(Core.averageChargeSummary([]), {
    averageCharge: 0,
    chargeCount: 0,
  });
});

test('calculates each monthly charge share within its own category', () => {
  const charges = [
    { expense: { id: 'groceries-a', category: 'Alimentação' }, index: 0, amount: 50 },
    { expense: { id: 'groceries-b', category: 'Alimentação' }, index: 0, amount: 25 },
    { expense: { id: 'health', category: 'Saúde' }, index: 0, amount: 20 },
  ];
  assert.deepEqual(Core.categoryChargeShares(charges), [
    { expenseId: 'groceries-a', installmentIndex: 0, percent: 66.7 },
    { expenseId: 'groceries-b', installmentIndex: 0, percent: 33.3 },
    { expenseId: 'health', installmentIndex: 0, percent: 100 },
  ]);
});

test('filters monthly transaction charges by category and inclusive amount range', () => {
  const charges = [
    { expense: { id: 'low-food', category: 'Alimentação' }, amount: 10 },
    { expense: { id: 'mid-food', category: 'Alimentação' }, amount: 50 },
    { expense: { id: 'mid-home', category: 'Moradia' }, amount: 40 },
    { expense: { id: 'high-food', category: 'Alimentação' }, amount: 100 },
  ];
  assert.deepEqual(Core.filterTransactionCharges(charges, { category: 'Alimentação', minAmount: 10, maxAmount: 100 }).map((charge) => charge.expense.id), ['low-food', 'mid-food', 'high-food']);
  assert.deepEqual(Core.filterTransactionCharges(charges, { category: '', minAmount: 40, maxAmount: 50 }).map((charge) => charge.expense.id), ['mid-food', 'mid-home']);
});


test('monthly balance counts received income separately and avoids double counting paid installments', () => {
  const entries = [
    { id: 'salary', type: 'income', amount: 3000.50, firstDate: '2026-11-01', installments: 1, payment: 'Pix' },
    { id: 'other-month', type: 'income', amount: 900, firstDate: '2026-10-01', installments: 1 },
    { id: 'rent', type: 'expense', amount: 1200, firstDate: '2026-11-02', installments: 1, payment: 'Pix' },
    { id: 'purchase', type: 'expense', amount: 600, firstDate: '2026-10-05', installments: 3, payment: 'Cartão' },
    { id: 'transfer', type: 'debt-transfer', amount: 200, firstDate: '2026-11-05', installments: 1, payment: 'Cartão' },
  ];
  const payments = [{ expenseId: 'purchase', installmentIndex: 1, amount: 200 }];
  assert.deepEqual(Core.monthlyBalance(entries, payments, '2026-11'), { income: 3000.50, expenses: 1400, balance: 1600.50 });
  assert.equal(Core.transactionCharges(entries, payments, '2026-11').length, 2);
  assert.deepEqual(Core.monthlyBalance([], [], '2026-11'), { income: 0, expenses: 0, balance: 0 });
  assert.equal(Core.monthlyBalance(entries.filter(e => e.type !== 'income'), payments, '2026-11').balance, -1400);
});
