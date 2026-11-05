const assert = require('node:assert/strict');
const { test } = require('node:test');
const Core = require('../finance-core.js');

const defaults = [
  { id: 'expense-home', type: 'expense', name: 'Moradia', icon: 'home', color: '#8665da', archived: false },
  { id: 'expense-food', type: 'expense', name: 'Alimentação', icon: 'restaurant', color: '#dc9b37', archived: false },
  { id: 'income-sales', type: 'income', name: 'Vendas', icon: 'shopping_bag', color: '#738b18', archived: false },
];

test('loads saved category changes without bringing a renamed default back', () => {
  const stored = [{ ...defaults[0], name: 'Casa', color: '#225577', archived: true }];
  const catalog = Core.hydrateCategoryCatalog(defaults, stored);
  assert.deepEqual(catalog.map(item => item.name), ['Casa', 'Alimentação', 'Vendas']);
  assert.equal(catalog[0].archived, true);
  assert.equal(catalog[0].color, '#225577');
});

test('renaming a category updates records, recurring month exceptions and its budget', () => {
  const expenses = [
    { id: 'rent', type: 'expense', category: 'Moradia', overrides: { '2026-12': { category: 'Moradia' }, '2027-01': { category: 'Alimentação' } } },
    { id: 'sale', type: 'income', category: 'Vendas', overrides: { '2026-12': { category: 'Moradia' } } },
  ];
  const budgets = [{ category: 'Moradia', amount: 500 }];
  const result = Core.saveCategoryInCatalog(defaults, { ...defaults[0], name: 'Casa', icon: 'home_work', color: '#225577' }, expenses, budgets);
  assert.equal(result.categories[0].name, 'Casa');
  assert.equal(result.expenses[0].category, 'Casa');
  assert.equal(result.expenses[0].overrides['2026-12'].category, 'Casa');
  assert.equal(result.expenses[0].overrides['2027-01'].category, 'Alimentação');
  assert.equal(result.expenses[1].overrides['2026-12'].category, 'Moradia');
  assert.equal(result.budgets[0].category, 'Casa');
  assert.equal(expenses[0].category, 'Moradia');
});

test('rejects duplicate names, unsafe colors and invalid icons', () => {
  const next = { id: 'income-new', type: 'income', name: '  morádia  ', icon: 'trending_up', color: '#118877' };
  assert.throws(() => Core.saveCategoryInCatalog(defaults, next, [], []), /nome/i);
  assert.throws(() => Core.saveCategoryInCatalog(defaults, { ...next, name: 'Bônus', color: 'red;position:absolute' }, [], []), /cor/i);
  assert.throws(() => Core.saveCategoryInCatalog(defaults, { ...next, name: 'Bônus', icon: '<img>' }, [], []), /ícone/i);
});

test('archiving hides a category from new choices while keeping it in the catalog', () => {
  const catalog = Core.setCategoryArchived(defaults, 'expense-home', true);
  assert.equal(catalog[0].archived, true);
  assert.equal(catalog[0].name, 'Moradia');
  assert.equal(catalog[1].archived, false);
  assert.throws(() => Core.setCategoryArchived(catalog, 'expense-food', true), /última/i);
  assert.equal(Core.setCategoryArchived(catalog, 'expense-home', false)[0].archived, false);
});
