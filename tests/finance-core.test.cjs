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

test('calculates how much of projected income is committed to expenses', () => {
  assert.deepEqual(Core.incomeCommitmentSummary(4000, 2500), {
    income: 4000,
    expenses: 2500,
    remaining: 1500,
    percent: 62.5,
  });
  assert.deepEqual(Core.incomeCommitmentSummary(500, 750), {
    income: 500,
    expenses: 750,
    remaining: -250,
    percent: 150,
  });
  assert.deepEqual(Core.incomeCommitmentSummary(0, 100), {
    income: 0,
    expenses: 100,
    remaining: -100,
    percent: null,
  });
});

test('calculates account balances from opening amounts, settled records and internal transfers', () => {
  const accounts = [
    { id: 'checking', name: 'Conta principal', kind: 'checking', openingBalance: 500.1, openingDate: '2026-11-01' },
    { id: 'wallet', name: 'Carteira', kind: 'cash', openingBalance: 100, openingDate: '2026-11-01' },
  ];
  const entries = [
    { id: 'salary', type: 'income', amount: 1000, installments: 1, firstDate: '2026-11-02', payment: 'Transferência', accountId: 'checking', status: 'realized' },
    { id: 'rent', type: 'expense', amount: 250, installments: 1, firstDate: '2026-11-03', payment: 'Pix', accountId: 'checking', status: 'realized' },
    { id: 'old-cash', type: 'expense', amount: 20, installments: 1, firstDate: '2026-10-30', payment: 'Dinheiro', accountId: 'wallet', status: 'planned' },
    { id: 'planned', type: 'expense', amount: 70, installments: 1, firstDate: '2026-11-04', payment: 'Pix', accountId: 'checking', status: 'planned' },
    { id: 'card-buy', type: 'expense', amount: 300, installments: 1, firstDate: '2026-11-05', payment: 'Cartão', status: 'planned' },
  ];
  const payments = [
    { expenseId: 'old-cash', installmentIndex: 0, amount: 20, date: '2026-11-06', method: 'Dinheiro', accountId: 'wallet' },
    { expenseId: 'card-buy', installmentIndex: 0, amount: 60, date: '2026-11-07', method: 'Pix', accountId: 'checking' },
  ];
  const transfers = [{ id: 'move', fromAccountId: 'checking', toAccountId: 'wallet', amount: 75, date: '2026-11-08' }];

  const balances = Core.accountBalances(accounts, entries, payments, transfers, '2026-11-30');
  assert.deepEqual(balances.map(({ id, balance }) => [id, balance]), [['checking', 1115.1], ['wallet', 155]]);
  assert.equal(balances.reduce((total, account) => total + Math.round(account.balance * 100), 0) / 100, 1270.1,
    'moving money between owned accounts must leave the combined balance unchanged');
});

test('uses the opening date to exclude earlier activity and ignores records without an account', () => {
  const accounts = [{ id: 'checking', openingBalance: 100, openingDate: '2026-11-05' }];
  const entries = [
    { id: 'already-included', type: 'income', amount: 500, installments: 1, firstDate: '2026-11-04', payment: 'Pix', accountId: 'checking', status: 'realized' },
    { id: 'unassigned', type: 'income', amount: 200, installments: 1, firstDate: '2026-11-06', payment: 'Pix', status: 'realized' },
    { id: 'new-income', type: 'income', amount: 25, installments: 1, firstDate: '2026-11-06', payment: 'Pix', accountId: 'checking', status: 'realized' },
  ];
  assert.deepEqual(Core.accountBalances(accounts, entries, [], [], '2026-11-30').map(({ balance }) => balance), [125]);
});

test('applies dated reconciliation adjustments to account balances without rewriting transactions', () => {
  const accounts = [{ id: 'checking', openingBalance: 1000, openingDate: '2026-11-01' }];
  const entries = [
    { id: 'salary', type: 'income', amount: 100, installments: 1, firstDate: '2026-11-02', payment: 'Pix', accountId: 'checking', status: 'realized' },
    { id: 'rent', type: 'expense', amount: 200, installments: 1, firstDate: '2026-11-03', payment: 'Pix', accountId: 'checking', status: 'realized' },
  ];
  const reconciliations = [
    { id: 'check-1', accountId: 'checking', date: '2026-11-05', expectedBalance: 900, actualBalance: 875, adjustment: -25 },
    { id: 'check-2', accountId: 'checking', date: '2026-11-05', expectedBalance: 875, actualBalance: 865, adjustment: -10 },
    { id: 'check-future', accountId: 'checking', date: '2026-12-01', expectedBalance: 865, actualBalance: 900, adjustment: 35 },
  ];

  assert.equal(Core.accountBalances(accounts, entries, [], [], '2026-11-04', reconciliations)[0].balance, 900);
  assert.equal(Core.accountBalances(accounts, entries, [], [], '2026-11-30', reconciliations)[0].balance, 865);
  assert.equal(Core.accountBalances(accounts, entries, [], [], '2026-12-02', reconciliations)[0].balance, 900);
  assert.deepEqual(Core.monthlyBalance(entries, [], '2026-11'), { income: 100, expenses: 200, balance: -100 });
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


test('combines monthly income and expense installments and filters by record type', () => {
  const entries = [
    { id:'salary', type:'income', category:'Salário', amount:3000, installments:1, firstDate:'2026-11-03', payment:'Pix' },
    { id:'purchase', type:'expense', category:'Compras', amount:600, installments:3, firstDate:'2026-10-01', payment:'Cartão' },
    { id:'old-income', type:'income', amount:900, installments:1, firstDate:'2026-10-03' },
    { id:'funding', type:'debt-transfer', amount:200, installments:1, firstDate:'2026-11-01' },
  ];
  const records = Core.monthlyRecords(entries, [], '2026-11');
  assert.deepEqual(records.map(r => [r.expense.id,r.amount]), [['salary',3000],['purchase',200]]);
  assert.deepEqual(Core.filterTransactionCharges(records,{type:'income',category:'Salário',minAmount:3000,maxAmount:3000}).map(r=>r.expense.id), ['salary']);
  assert.deepEqual(Core.filterTransactionCharges(records,{type:'expense'}).map(r=>r.expense.id), ['purchase']);
  assert.equal(Core.monthlyOverview(entries, [], '2026-11').total, 200);
});


test('sorts monthly records by category and amount without mutating their source order', () => {
  const records = [
    { expense:{id:'health',category:'Saúde'}, amount:15.5, date:new Date(2026,10,3) },
    { expense:{id:'food',category:'Alimentação'}, amount:100, date:new Date(2026,10,1) },
    { expense:{id:'education',category:'Educação'}, amount:9.99, date:new Date(2026,10,2) },
  ];
  const ids = mode => Core.sortTransactionCharges(records,mode).map(r=>r.expense.id);
  assert.deepEqual(ids('category-asc'),['food','education','health']);
  assert.deepEqual(ids('category-desc'),['health','education','food']);
  assert.deepEqual(ids('amount-asc'),['education','health','food']);
  assert.deepEqual(ids('amount-desc'),['food','health','education']);
  assert.deepEqual(ids('date-desc'),['health','education','food']);
  assert.deepEqual(records.map(r=>r.expense.id),['health','food','education']);
});


test('keeps category percentages separate for income and expenses with the same category name', () => {
  const entries = [
    {id:'a',type:'income',category:'Outros',amount:300,installments:1,firstDate:'2026-11-01'},
    {id:'b',type:'income',category:'Outros',amount:100,installments:1,firstDate:'2026-11-02'},
    {id:'c',type:'income',category:'Salário',amount:600,installments:1,firstDate:'2026-11-03'},
    {id:'d',type:'expense',category:'Outros',amount:200,installments:1,firstDate:'2026-11-01'},
    {id:'e',type:'expense',category:'Moradia',amount:600,installments:3,firstDate:'2026-10-01'},
    {id:'old',type:'income',category:'Outros',amount:9000,installments:1,firstDate:'2026-10-01'},
    {id:'funding',type:'debt-transfer',amount:1000,installments:1,firstDate:'2026-11-01'},
  ];
  const result=Core.monthlyCategoryBreakdown(entries,[],'2026-11');
  assert.equal(result.income.total,1000);
  assert.equal(result.expense.total,400);
  assert.deepEqual(result.income.categories,[{category:'Salário',amount:600,percent:60},{category:'Outros',amount:400,percent:40}]);
  assert.deepEqual(result.expense.categories.map(c=>c.percent),[50,50]);
  const shares=Core.categoryChargeShares(Core.monthlyRecords(entries,[],'2026-11'));
  assert.equal(shares.find(s=>s.expenseId==='a').percent,75);
  assert.equal(shares.find(s=>s.expenseId==='b').percent,25);
  assert.equal(shares.find(s=>s.expenseId==='d').percent,100);
  assert.deepEqual(Core.monthlyCategoryBreakdown([],[],'2026-11'),{income:{total:0,categories:[]},expense:{total:0,categories:[]}});
});


test('fixed records recur from their first month, clamp month-end dates and respect an inclusive end month', () => {
  const entries=[
    {id:'salary',type:'income',recurring:true,amount:3000,installments:1,firstDate:'2026-01-31',category:'Salário'},
    {id:'rent',type:'expense',recurring:true,recurringUntil:'2026-03',amount:800,installments:1,firstDate:'2026-01-31',payment:'Pix',category:'Moradia'},
  ];
  assert.equal(Core.monthlyRecords(entries,[],'2025-12').length,0);
  const feb=Core.monthlyRecords(entries,[],'2026-02');
  assert.equal(feb.length,2);
  assert.ok(feb.every(r=>r.date.getDate()===28 && r.index===1 && r.amount===r.expense.amount));
  assert.deepEqual(Core.monthlyBalance(entries,[],'2026-02'),{income:3000,expenses:800,balance:2200});
  assert.equal(Core.monthlyRecords(entries,[],'2026-03').length,2);
  assert.equal(Core.monthlyRecords(entries,[],'2026-04').length,1);
  assert.equal(Core.monthlyCategoryBreakdown(entries,[],'2026-02').income.total,3000);
});

test('fixed card payments settle only their own month and commit no infinite future credit', () => {
  const entry={id:'subscription',type:'expense',recurring:true,amount:100,installments:1,firstDate:'2026-01-31',payment:'Cartão',cardId:'card'};
  const payments=[{expenseId:entry.id,installmentIndex:0,amount:100}];
  assert.equal(Core.monthCharges([entry],payments,'card','2026-01')[0].remaining,0);
  const feb=Core.monthCharges([entry],payments,'card','2026-02')[0];
  assert.equal(feb.index,1);
  assert.equal(feb.remaining,100);
  assert.equal(Core.cardUsed([entry],payments,'card',new Date(2026,1,28)),100);
  assert.deepEqual(Core.allocateFullPayment([feb]),[{expenseId:entry.id,installmentIndex:1,amount:100}]);
  assert.equal(Core.cardUsed([{...entry,recurringUntil:'2026-01'}],payments,'card',new Date(2026,2,1)),0);
});


test('combines payment and receipt method filters with type, category and amount',()=>{
  const records=[
    {expense:{id:'spent',type:'expense',category:'Moradia',payment:'Pix'},amount:100},
    {expense:{id:'cash',type:'expense',category:'Moradia',payment:'Dinheiro'},amount:100},
    {expense:{id:'received',type:'income',category:'Salário',payment:'Pix'},amount:200},
    {expense:{id:'transfer',type:'income',category:'Salário',payment:'Transferência'},amount:300},
  ];
  assert.deepEqual(Core.filterTransactionCharges(records,{payment:'Pix'}).map(r=>r.expense.id),['spent','received']);
  assert.deepEqual(Core.filterTransactionCharges(records,{type:'income',payment:'Transferência',category:'Salário',minAmount:250,maxAmount:300}).map(r=>r.expense.id),['transfer']);
  assert.equal(Core.filterTransactionCharges(records,{type:'expense',payment:'Transferência'}).length,0);
  assert.equal(Core.filterTransactionCharges(records,{payment:''}).length,4);
});


test('monthly overrides change only one recurring occurrence and its remaining card limit',()=>{
 const entry={id:'fixed',type:'expense',recurring:true,amount:100,installments:1,firstDate:'2026-01-31',payment:'Cartão',cardId:'c',category:'Contas',overrides:{'2026-02':{amount:150,date:'2026-02-25',notes:'Ajuste'}}};
 assert.equal(Core.monthlyRecords([entry],[],'2026-01')[0].amount,100);
 const feb=Core.monthlyRecords([entry],[],'2026-02')[0];assert.equal(feb.amount,150);assert.equal(feb.date.getDate(),25);
 assert.equal(Core.monthlyRecords([entry],[],'2026-03')[0].amount,100);
 assert.equal(Core.chargeRemaining(entry,1,[{expenseId:'fixed',installmentIndex:1,amount:50}]),100);
 assert.equal(Core.cardUsed([entry],[],'c',new Date(2026,1,28)),250);
});
test('separates projected and actual cashflow by receipt or payment date without counting credit transfers twice',()=>{
 const entries=[
 {id:'income',type:'income',status:'planned',amount:1000,firstDate:'2026-11-01',installments:1},
 {id:'rent',type:'expense',status:'planned',amount:300,payment:'Pix',firstDate:'2026-11-01',installments:1},
 {id:'cash',type:'expense',amount:20,payment:'Dinheiro',firstDate:'2026-11-02',installments:1},
 {id:'card',type:'expense',amount:200,payment:'Cartão',firstDate:'2026-11-03',installments:1},
 {id:'debt',type:'debt-transfer',amount:200,payment:'Cartão',firstDate:'2026-11-03',installments:1},
 ];
 const payments=[{expenseId:'income',installmentIndex:0,amount:1000,date:'2026-11-04'}, {expenseId:'rent',installmentIndex:0,amount:300,date:'2026-12-01'}, {expenseId:'card',installmentIndex:0,amount:200,date:'2026-11-04',method:'Cartão'}, {expenseId:'debt',installmentIndex:0,amount:200,date:'2026-12-03',method:'Pix'}];
 assert.deepEqual(Core.monthlyCashFlow(entries,payments,'2026-11'),{income:1000,expenses:20,balance:980});
 assert.deepEqual(Core.monthlyCashFlow(entries,payments,'2026-12'),{income:0,expenses:500,balance:-500});
 assert.equal(Core.monthlyBalance(entries,payments,'2026-11').balance,480);
});
test('summarizes a monthly close with actuals, unpaid cash records and open card balances',()=>{
 const entries=[
  {id:'salary',type:'income',status:'planned',amount:1000,firstDate:'2026-11-01',installments:1,payment:'Pix'},
  {id:'project',type:'income',status:'planned',amount:250,firstDate:'2026-11-10',installments:1,payment:'Pix'},
  {id:'rent',type:'expense',status:'planned',amount:300,firstDate:'2026-11-02',installments:1,payment:'Pix'},
  {id:'groceries',type:'expense',amount:80,firstDate:'2026-11-03',installments:1,payment:'Dinheiro'},
  {id:'card-purchase',type:'expense',status:'planned',amount:200,firstDate:'2026-11-04',installments:1,payment:'Cartão',cardId:'nu',card:'Nubank'},
  {id:'card-transfer',type:'debt-transfer',amount:120,firstDate:'2026-11-05',installments:1,payment:'Cartão',cardId:'bb',card:'Ourocard'},
 ];
 const payments=[
  {id:'salary-paid',expenseId:'salary',installmentIndex:0,amount:1000,date:'2026-11-06',method:'Pix'},
  {id:'rent-partial',expenseId:'rent',installmentIndex:0,amount:100,date:'2026-11-07',method:'Pix'},
  {id:'card-partial',expenseId:'card-purchase',installmentIndex:0,amount:50,date:'2026-11-08',method:'Pix'},
 ];
 assert.deepEqual(Core.monthlyClosing(entries,payments,'2026-11'),{
  received:1000,paid:230,balance:770,toReceive:250,toReceiveCount:1,toPay:200,toPayCount:1,
  openCardTotal:270,openCardCount:2,openCardChargeCount:2,
  openCardBills:[
   {cardId:'nu',cardName:'Nubank',amount:150,charges:1},
   {cardId:'bb',cardName:'Ourocard',amount:120,charges:1},
  ],
 });
 assert.deepEqual(Core.monthlyClosing([],[],'2026-11'),{
  received:0,paid:0,balance:0,toReceive:0,toReceiveCount:0,toPay:0,toPayCount:0,
  openCardTotal:0,openCardCount:0,openCardChargeCount:0,openCardBills:[],
 });
});
test('legacy one-off records remain realized and recurring future records remain planned',()=>{
 const entries=[{id:'legacy',type:'income',amount:50,installments:1,firstDate:'2026-11-01'}, {id:'fixed',type:'income',recurring:true,status:'realized',amount:100,installments:1,firstDate:'2026-11-01'}];
 assert.equal(Core.monthlyCashFlow(entries,[],'2026-11').income,150);
 assert.equal(Core.monthlyCashFlow(entries,[],'2026-12').income,0);
 entries[0].realizationStates={'0':'planned'};
 assert.equal(Core.monthlyCashFlow(entries,[],'2026-11').income,100);
});
test('budgets include monthly commitments and trends cross year boundaries',()=>{
 const entries=[{id:'bill',type:'expense',recurring:true,payment:'Pix',amount:120,installments:1,firstDate:'2025-12-01',category:'Contas'}];
 assert.deepEqual(Core.budgetProgress(entries,[],[{category:'Contas',amount:100},{category:'Lazer',amount:50}],'2026-01'),[{category:'Contas',limit:100,spent:120,remaining:-20,percent:120},{category:'Lazer',limit:50,spent:0,remaining:50,percent:0}]);
 const trends=Core.monthlyTrends(entries,[],'2026-02',3);
 assert.deepEqual(trends.map(t=>t.month),['2025-12','2026-01','2026-02']);assert.equal(trends[2].projected.expenses,120);
});

test('monthly card overrides affect the selected card only and remove cash occurrences from credit usage', () => {
  const entry={id:'fixed-switch',amount:100,installments:1,firstDate:'2026-01-10',recurring:true,type:'expense',payment:'Pix',overrides:{'2026-02':{amount:150,payment:'Cartão',cardId:'b'},'2026-03':{amount:180,payment:'Cartão',cardId:'a'}}};
  assert.equal(Core.monthCharges([entry],[],'b','2026-02')[0]?.amount,150);
  assert.equal(Core.monthCharges([entry],[],'a','2026-02').length,0);
  assert.equal(Core.cardUsed([entry],[],'b',new Date(2026,2,15)),150);
  assert.equal(Core.cardUsed([entry],[],'a',new Date(2026,2,15)),180);
});

test('collects budget, overdue and seven-day due alerts while ignoring paid and later items',()=>{
 const entries=[
  {id:'budget-over',description:'Aluguel',type:'expense',category:'Moradia',amount:150,installments:1,firstDate:'2026-11-03',payment:'Pix',status:'realized'},
  {id:'expense-late',description:'Conta atrasada',type:'expense',category:'Contas',amount:100,installments:1,firstDate:'2026-11-02',payment:'Pix',status:'planned'},
  {id:'expense-soon',description:'Conta próxima',type:'expense',category:'Compras',amount:80,installments:1,firstDate:'2026-11-10',payment:'Dinheiro',status:'planned'},
  {id:'income-late',description:'Receita atrasada',type:'income',category:'Salário',amount:200,installments:1,firstDate:'2026-11-01',payment:'Pix',status:'planned'},
  {id:'income-soon',description:'Receita próxima',type:'income',category:'Vendas',amount:300,installments:1,firstDate:'2026-11-09',payment:'Pix',status:'planned'},
  {id:'card-late',description:'Fatura antiga',type:'expense',category:'Outros',amount:120,installments:1,firstDate:'2026-10-01',payment:'Cartão',cardId:'card-a',card:'Nubank'},
  {id:'card-soon',description:'Compra próxima',type:'expense',category:'Lazer',amount:70,installments:1,firstDate:'2026-11-08',payment:'Cartão',cardId:'card-a',card:'Nubank'},
  {id:'card-paid',description:'Compra liquidada',type:'expense',category:'Lazer',amount:50,installments:1,firstDate:'2026-11-08',payment:'Cartão',cardId:'card-a',card:'Nubank'},
  {id:'outside-window',description:'Conta distante',type:'expense',category:'Contas',amount:999,installments:1,firstDate:'2026-11-20',payment:'Pix',status:'planned'},
 ];
 const payments=[
  {expenseId:'expense-late',installmentIndex:0,amount:25,date:'2026-11-02',method:'Pix'},
  {expenseId:'card-paid',installmentIndex:0,amount:50,date:'2026-11-04',method:'Pix'},
 ];
 const alerts=Core.financialAlerts(entries,payments,[{id:'card-a',name:'Nubank',dueDay:8}],[{category:'Moradia',amount:100}],'2026-11-05','2026-11');
 assert.deepEqual(alerts.map(alert=>alert.kind).sort(),[
  'budget-exceeded','card-overdue','card-upcoming','expense-overdue','expense-upcoming','income-overdue','income-upcoming',
 ]);
 assert.equal(alerts.find(alert=>alert.kind==='budget-exceeded').amount,50);
 assert.equal(alerts.find(alert=>alert.kind==='expense-overdue').amount,75);
 assert.equal(alerts.find(alert=>alert.kind==='card-upcoming').amount,70);
 assert.equal(alerts.some(alert=>alert.expenseId==='outside-window'),false);
});

test('returns no financial alerts when everything is within date and budget limits',()=>{
 assert.deepEqual(Core.financialAlerts([],[],[],[],'2026-11-05','2026-11'),[]);
});
