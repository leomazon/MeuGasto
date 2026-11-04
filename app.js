const CATEGORY_DATA = [
  { name: 'Moradia', icon: '🏠', color: '#8665da' },
  { name: 'Alimentação', icon: '🍋', color: '#dc9b37' },
  { name: 'Transporte', icon: '🚲', color: '#4a91b8' },
  { name: 'Saúde', icon: '🌿', color: '#46977c' },
  { name: 'Lazer', icon: '🎟️', color: '#d56c90' },
  { name: 'Educação', icon: '📚', color: '#8871cb' },
  { name: 'Compras', icon: '🛍️', color: '#cf805d' },
  { name: 'Assinaturas', icon: '🎧', color: '#577ab4' },
  { name: 'Contas', icon: '💡', color: '#c89b38' },
  { name: 'Outros', icon: '✳️', color: '#8b8298' },
];
const INCOME_CATEGORY_DATA = [
  { name: 'Prestação de serviço', icon: '🛠️', color: '#317c62' },
  { name: 'Trabalho físico', icon: '🧰', color: '#317c62' },
  { name: 'Salário', icon: '💼', color: '#317c62' },
  { name: 'Vendas', icon: '🛍️', color: '#317c62' },
  { name: 'Rendimentos', icon: '📈', color: '#317c62' },
  { name: 'Aluguéis', icon: '🏘️', color: '#317c62' },
  { name: 'Outras receitas', icon: '↙', color: '#317c62' },
];
const STORAGE_KEY = 'meu-financeiro-v1'; // Keep the existing key so current expenses stay available.
const CARD_STORAGE_KEY = 'meugasto-cards-v1';
const PAYMENT_STORAGE_KEY = 'meugasto-card-payments-v1';
const Core = window.FinanceCore;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);
function parseCurrencyInput(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? Number(digits) / 100 : 0;
}
function formatCurrencyInput(input) {
  const previous = input.value;
  const cursor = input.selectionStart ?? previous.length;
  const digitsBeforeCursor = previous.slice(0, cursor).replace(/\D/g, '').length;
  const digits = previous.replace(/\D/g, '');
  input.value = digits ? currency.format(Number(digits) / 100) : '';
  let nextCursor = input.value.length;
  if (digitsBeforeCursor === 0 && digits.length) {
    nextCursor = Math.max(0, input.value.search(/\d/));
  } else if (digitsBeforeCursor < digits.length) {
    let seenDigits = 0;
    for (let index = 0; index < input.value.length; index += 1) {
      if (/\d/.test(input.value[index])) seenDigits += 1;
      if (seenDigits >= digitsBeforeCursor) { nextCursor = index + 1; break; }
    }
  }
  input.setSelectionRange(nextCursor, nextCursor);
}
let cards = loadCards();
let expenses = loadExpenses();
let settlements = loadSettlements();
let view = 'inicio';
let transactionPage = 1;
let transactionPageSize = 10;
let toastTimer;
let settlementTarget = null;
let pendingDelete = null;
let settlementResetOnSave = null;
let localDatabaseEnabled = false;
let localDatabaseQueue = Promise.resolve();

function createId(prefix = 'item') { return crypto.randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function loadCards() {
  try {
    const stored = JSON.parse(localStorage.getItem(CARD_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(Number(item.limit)) && Number(item.limit) >= 0)
      .map((item) => ({ ...item, dueDay: Number.isInteger(Number(item.dueDay)) && Number(item.dueDay) >= 1 && Number(item.dueDay) <= 31 ? Number(item.dueDay) : null })) : [];
  } catch { return []; }
}
function loadExpenses() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter(isValidExpense) : [];
  } catch { return []; }
}
function loadSettlements() {
  try {
    const stored = JSON.parse(localStorage.getItem(PAYMENT_STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.filter((item) => item && typeof item.id === 'string' && typeof item.expenseId === 'string' && Number.isInteger(Number(item.installmentIndex)) && Number(item.amount) > 0) : [];
  } catch { return []; }
}
function isValidExpense(item) {
  return item && typeof item.id === 'string' && typeof item.description === 'string' && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 && Number.isInteger(Number(item.installments)) && Number(item.installments) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.firstDate);
}
function saveBrowserCache() {
  localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(cards));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(settlements));
}
function clearBrowserCache() {
  localStorage.removeItem(CARD_STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PAYMENT_STORAGE_KEY);
}
function persistLocalDatabase() {
  if (!localDatabaseEnabled) return Promise.resolve();
  const state = JSON.stringify({ expenses, cards, settlements });
  localDatabaseQueue = localDatabaseQueue.catch(() => {}).then(async () => {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: state,
      keepalive: true,
    });
    if (!response.ok) throw new Error('save failed');
  }).catch(() => {
    localDatabaseEnabled = false;
    saveBrowserCache();
    showToast('Não foi possível atualizar o banco local. A cópia do navegador foi mantida.');
  });
  return localDatabaseQueue;
}
function saveCards() { if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(cards)); }
function saveExpenses() { if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses)); }
function saveSettlements() { if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(settlements)); }
async function restoreLocalDatabase() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) return;
    const { initialized, state } = await response.json();
    localDatabaseEnabled = true;
    if (initialized) {
      cards = state.cards.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(Number(item.limit)) && Number(item.limit) >= 0)
        .map((item) => ({ ...item, dueDay: Number.isInteger(Number(item.dueDay)) && Number(item.dueDay) >= 1 && Number(item.dueDay) <= 31 ? Number(item.dueDay) : null }));
      expenses = state.expenses.filter(isValidExpense);
      settlements = state.settlements.filter((item) => item && typeof item.id === 'string' && typeof item.expenseId === 'string' && Number.isInteger(Number(item.installmentIndex)) && Number(item.amount) > 0);
      clearBrowserCache();
      migrateLegacyCardLinks();
      render();
    } else {
      await persistLocalDatabase();
      if (localDatabaseEnabled) clearBrowserCache();
    }
  } catch {
    localDatabaseEnabled = false;
  }
}
function migrateLegacyCardLinks() {
  let changed = false;
  for (const expense of expenses) {
    if (expense.payment !== 'Cartão' || expense.cardId) continue;
    const oldName = String(expense.card || '').trim();
    if (!oldName) continue;
    let card = cards.find((item) => item.name.toLocaleLowerCase('pt-BR') === oldName.toLocaleLowerCase('pt-BR'));
    if (!card) {
      card = { id: createId('card'), name: oldName, bank: oldName, limit: 0 };
      cards.push(card);
    }
    expense.cardId = card.id;
    changed = true;
  }
  if (changed) { saveCards(); saveExpenses(); }
}
migrateLegacyCardLinks();
function category(name, type = 'expense') {
  return [...CATEGORY_DATA, ...INCOME_CATEGORY_DATA].find(item => item.name === name)
    || (type === 'income' ? INCOME_CATEGORY_DATA.at(-1) : CATEGORY_DATA.at(-1));
}
function recordType() { return document.querySelector('input[name="record-type"]:checked').value; }
function recordCategories(type) {
  const base = type === 'income' ? INCOME_CATEGORY_DATA : CATEGORY_DATA;
  const names = new Set(base.map(item => item.name));
  const extra = [];
  for (const entry of expenses) {
    if ((entry.type === 'income' ? 'income' : 'expense') !== type || entry.type === 'debt-transfer' || !entry.category || names.has(entry.category)) continue;
    names.add(entry.category);
    extra.push({ ...category(entry.category, type), name: entry.category });
  }
  return [...base, ...extra];
}
function updateCategoryFilter() {
  const selected = $('category-filter').value;
  const type = $('type-filter').value;
  const group = (kind, label) => `<optgroup label="${label}">${recordCategories(kind).map(item => `<option value="${escapeHtml(item.name)}">${item.icon} ${escapeHtml(item.name)}</option>`).join('')}</optgroup>`;
  $('category-filter').innerHTML = '<option value="">Todas as categorias</option>' + (type !== 'income' ? group('expense', 'Despesas') : '') + (type !== 'expense' ? group('income', 'Receitas') : '');
  $('category-filter').value = [...$('category-filter').options].some(option => option.value === selected) ? selected : '';
}
function recordPaymentMethods(type) {
  return type === 'income' ? ['Transferência', 'Pix', 'Dinheiro'] : ['Pix', 'Dinheiro', 'Cartão'];
}
function updatePaymentFilter() {
  const type = $('type-filter').value;
  const selected = $('payment-filter').value;
  const methods = type ? recordPaymentMethods(type) : [...new Set([...recordPaymentMethods('expense'), ...recordPaymentMethods('income')])];
  for (const entry of expenses) {
    if (entry.type === 'debt-transfer' || (type && (entry.type === 'income' ? 'income' : 'expense') !== type)) continue;
    if (entry.payment && !methods.includes(entry.payment)) methods.push(entry.payment);
  }
  $('payment-filter-label').textContent = type === 'income' ? 'Forma de recebimento' : type === 'expense' ? 'Forma de pagamento' : 'Pagamento / recebimento';
  $('payment-filter').innerHTML = '<option value="">Todas as formas</option>' + methods.map(method => `<option value="${escapeHtml(method)}">${escapeHtml(method)}</option>`).join('');
  $('payment-filter').value = methods.includes(selected) ? selected : '';
}
function updateRecordType(selectedCategory = '') {
  const income = recordType() === 'income';
  const previousPayment = $('payment').value;
  $('category').innerHTML = recordCategories(income ? 'income' : 'expense').map(item => `<option value="${escapeHtml(item.name)}">${item.icon} ${escapeHtml(item.name)}</option>`).join('');
  if (selectedCategory) $('category').value = selectedCategory;
  const methods = recordPaymentMethods(income ? 'income' : 'expense');
  $('payment').innerHTML = methods.map(method => `<option value="${method}">${method}</option>`).join('');
  $('payment').value = methods.includes(previousPayment) ? previousPayment : methods[0];
  $('description').placeholder = income ? 'Ex.: salário, serviço prestado' : 'Ex.: mercado, conta de luz';
  $('payment-label').textContent = income ? 'Forma de recebimento' : 'Forma de pagamento';
  $('record-date-label').textContent = income ? 'Data de recebimento' : 'Data do primeiro pagamento';
  if (income) $('first-date').max = localDateKey(); else $('first-date').removeAttribute('max');
  updatePaymentFields();
}
function monthKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
function dateFromKey(value) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day); }
function localDateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function dateLabel(date) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date).replace('.', ''); }
function monthLabel(value) { return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(dateFromKey(`${value}-01`)); }
function selectedMonth() { return $('month-picker').value || monthKey(new Date()); }
function cardById(id) { return cards.find((item) => item.id === id); }
function cardForExpense(expense) { return cardById(expense.cardId) || cards.find((item) => item.name === expense.card); }
function chargeDate(expense, installmentIndex) {
  return Core.installmentDate(expense.firstDate, installmentIndex);
}
function chargeAmount(expense, installmentIndex) {
  return Core.installmentAmount(expense.amount, expense.installments, installmentIndex);
}
function settledFor(expenseId, installmentIndex) {
  return settlements.filter((item) => item.expenseId === expenseId && Number(item.installmentIndex) === installmentIndex).reduce((sum, item) => sum + Number(item.amount), 0);
}
function chargeRemaining(expense, installmentIndex) { return Core.chargeRemaining(expense, installmentIndex, settlements); }
function chargesForMonth(month, cardId = null) {
  return Core.monthCharges(expenses, settlements, cardId, month);
}
function cardUsed(cardId) { return Core.cardUsed(expenses, settlements, cardId); }
function setMonth(value) { $('month-picker').value = value; transactionPage = 1; render(); }
function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2800);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function expenseLabel(charge) {
  const { expense, index } = charge;
  if (expense.recurring === true) return expense.type === 'income' ? 'Receita mensal' : expense.payment === 'Cartão' ? `Mensal · ${escapeHtml(cardForExpense(expense)?.name || 'Cartão')}` : expense.payment;
  if (expense.type === 'income') return 'Receita recebida';
  const card = expense.payment === 'Cartão' ? cardForExpense(expense) : null;
  const cardLabel = card ? ` · ${escapeHtml(card.name)}` : '';
  return Number(expense.installments) > 1 ? `${index + 1}/${expense.installments} parcela${cardLabel}` : (expense.payment === 'Cartão' ? `${expense.cardMode || 'À vista'}${cardLabel}` : expense.payment);
}
function renderExpenseRow(charge, actions = false, categoryShare = null) {
  const income = charge.expense.type === 'income';
  const info = category(charge.expense.category, income ? 'income' : 'expense');
  const paymentCard = charge.expense.payment === 'Cartão' ? cardForExpense(charge.expense) : null;
  const isPaid = !income && charge.remaining <= 0;
  const isOverdue = !isPaid && paymentCard?.dueDay && Core.isChargeOverdue(charge.date, paymentCard.dueDay, localDateKey());
  const fixedStatus = charge.expense.recurring === true ? '<span class="fixed-tag">Fixo mensal</span>' : '';
  const paymentStatus = income ? '' : isPaid ? '<span class="paid-tag">Liquidado</span>' : isOverdue ? '<span class="overdue-tag">Vencido</span>' : '';
  const categoryShareMarkup = categoryShare === null ? '' : `<div class="category-share" role="img" aria-label="${escapeHtml(charge.expense.description)} corresponde a ${categoryShare.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da categoria ${escapeHtml(charge.expense.category || 'Outros')}"><span class="category-share-track" aria-hidden="true"><i style="width:${categoryShare}%;background:${info.color}"></i></span><span class="category-share-label">${categoryShare.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da categoria</span></div>`;
  const settleButton = actions && !income && charge.expense.payment === 'Cartão' && charge.remaining > 0
    ? `<button class="row-settle-button" data-pay-charge="${escapeHtml(charge.expense.id)}::${charge.index}" aria-label="Liquidar ${escapeHtml(charge.expense.description)}, ${charge.expense.recurring === true ? monthLabel(monthKey(charge.date)) : `parcela ${charge.index + 1}`}">Liquidar</button>` : '';
  return `<div class="expense-row">
    <span class="expense-emoji" aria-hidden="true">${info.icon}</span>
    <div class="expense-name"><strong>${escapeHtml(charge.expense.description)}</strong><span>${escapeHtml(charge.expense.category)} · ${escapeHtml(expenseLabel(charge))}${charge.expense.notes ? ` · ${escapeHtml(charge.expense.notes)}` : ''} ${fixedStatus} ${paymentStatus}</span>${categoryShareMarkup}</div>
    ${actions ? `<span class="row-date">${dateLabel(charge.date)}</span><span class="row-payment"><span class="record-kind ${income ? 'income-kind' : 'expense-kind'}">${income ? 'Receita' : 'Despesa'}</span><small>${escapeHtml(charge.expense.payment)}</small></span><strong class="expense-value ${income ? 'income-value' : ''}">${currency.format(charge.remaining > 0 ? charge.remaining : charge.amount)}</strong><div class="row-actions">${settleButton}<button class="icon-button" aria-label="Editar ${escapeHtml(charge.expense.description)}" data-edit="${escapeHtml(charge.expense.id)}">✎</button><button class="icon-button delete" aria-label="Excluir ${escapeHtml(charge.expense.description)}" data-delete="${escapeHtml(charge.expense.id)}">×</button></div>` : `<strong class="expense-value">${currency.format(charge.amount)}</strong>`}
  </div>`;
}
function renderOverview() {
  const summary = Core.monthlyOverview(expenses, settlements, selectedMonth());
  const { charges, total, pix, cash, card } = summary;
  const average = Core.averageChargeSummary(charges);
  const balance = Core.monthlyBalance(expenses, settlements, selectedMonth());
  $('income-total').textContent = currency.format(balance.income);
  $('balance-expenses').textContent = currency.format(balance.expenses);
  $('month-balance').textContent = currency.format(balance.balance);
  $('month-balance').className = balance.balance < 0 ? 'negative-balance' : 'income-value';
  $('month-total').textContent = currency.format(total);
  $('entry-count').textContent = charges.length === 0 ? 'Nenhum gasto lançado' : `${charges.length} cobrança${charges.length === 1 ? '' : 's'} neste mês`;
  $('average-charge').textContent = average.chargeCount ? currency.format(average.averageCharge) : '—';
  $('average-charge-count').textContent = average.chargeCount ? `em ${average.chargeCount} cobrança${average.chargeCount === 1 ? '' : 's'}` : 'Sem cobranças neste mês';
  $('pix-total').textContent = currency.format(pix);
  $('cash-total').textContent = currency.format(cash);
  $('card-total').textContent = currency.format(card);
  $('pix-bar').style.width = total ? `${(pix / total) * 100}%` : '0%';
  $('cash-bar').style.width = total ? `${(cash / total) * 100}%` : '0%';
  $('card-bar').style.width = total ? `${(card / total) * 100}%` : '0%';
  const pixShare = total ? Math.round((pix / total) * 100) : 0;
  const cashShare = total ? Math.round((cash / total) * 100) : 0;
  const cardShare = total ? Math.round((card / total) * 100) : 0;
  $('pix-share').textContent = `${pixShare}%`;
  $('cash-share').textContent = `${cashShare}%`;
  $('card-share').textContent = `${cardShare}%`;
  $('payment-foot').textContent = total ? `Distribuição dos ${currency.format(total)} gastos neste mês.` : 'Seus pagamentos aparecem aqui conforme você registra os gastos.';
  const breakdown = Core.monthlyCategoryBreakdown(expenses, settlements, selectedMonth());
  renderCategoryChart('category-list', breakdown.expense, 'expense');
  renderCategoryChart('income-category-list', breakdown.income, 'income');
  $('expense-category-context').textContent = `Percentuais sobre ${currency.format(breakdown.expense.total)} em despesas neste mês.`;
  $('income-category-context').textContent = `Percentuais sobre ${currency.format(breakdown.income.total)} em receitas neste mês.`;
  const recentLimit = Math.max(5, breakdown.expense.categories.length);
  const recentCharges = [...charges].sort((a, b) => b.date - a.date
    || expenses.indexOf(b.expense) - expenses.indexOf(a.expense)
    || b.index - a.index);
  $('recent-list').innerHTML = recentCharges.length ? recentCharges.slice(0, recentLimit).map((charge) => renderExpenseRow(charge)).join('') : '<p class="empty-note">Comece adicionando seu primeiro gasto.</p>';
  renderDashboardCards();
}
function renderCategoryChart(listId, summary, type) {
  const income = type === 'income';
  $(listId).innerHTML = summary.categories.length ? summary.categories.map(item => {
    const info = category(item.category, type);
    const percent = item.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const baseLabel = income ? 'das receitas' : 'das despesas';
    return `<div class="category-item" role="img" aria-label="${escapeHtml(item.category)}, ${currency.format(item.amount)}, ${percent}% ${baseLabel} do mês"><div class="category-chart-meta"><span class="category-emoji" aria-hidden="true">${info.icon}</span><span class="category-name">${escapeHtml(item.category)}</span><strong class="category-amount">${currency.format(item.amount)}</strong><span class="category-share">${percent}%</span></div><div class="category-track"><i style="width:${summary.total ? item.amount / summary.total * 100 : 0}%;background:${info.color}"></i></div></div>`;
  }).join('') : `<p class="empty-note">${income ? 'Nenhuma receita neste mês.' : 'Nenhuma despesa registrada neste mês.'}</p>`;
}
function showCategoryTransactions(type) {
  view = 'lancamentos';
  $('clear-filters').click();
  $('type-filter').value = type;
  render();
}
function renderDashboardCards() {
  if (!cards.length) {
    $('dashboard-cards').innerHTML = '<p class="empty-note">Cadastre seus cartões para acompanhar limites e faturas.</p>';
    return;
  }
  $('dashboard-cards').innerHTML = cards.map((card) => {
    const used = cardUsed(card.id);
    const limit = Number(card.limit) || 0;
    const percent = limit ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
    const available = limit - used;
    return `<article class="dashboard-card"><span class="card-chip" aria-hidden="true">▰</span><div class="dashboard-card-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.bank)} · ${card.dueDay ? `vence dia ${card.dueDay}` : 'vencimento não informado'}</span></div><strong class="dashboard-card-available">${currency.format(available)}<small> disponível</small></strong><div class="card-progress"><i style="width:${percent}%"></i></div></article>`;
  }).join('');
}
function renderTransactions() {
  const minAmount = $('amount-min').value.trim() ? parseCurrencyInput($('amount-min').value) : null;
  const maxAmount = $('amount-max').value.trim() ? parseCurrencyInput($('amount-max').value) : null;
  const invalidRange = minAmount !== null && maxAmount !== null && minAmount > maxAmount;
  $('amount-range-error').hidden = !invalidRange;
  for (const id of ['amount-min', 'amount-max']) {
    $(id).setAttribute('aria-invalid', String(invalidRange));
    if (invalidRange) $(id).setAttribute('aria-describedby', 'amount-range-error');
    else $(id).removeAttribute('aria-describedby');
  }
  const query = $('search-input').value.trim().toLocaleLowerCase('pt-BR');
  const allCharges = Core.monthlyRecords(expenses, settlements, selectedMonth());
  const shareByCharge = new Map(Core.categoryChargeShares(allCharges).map((share) => [`${share.expenseId}::${share.installmentIndex}`, share.percent]));
  const searchedCharges = allCharges.filter((charge) => {
    const card = cardForExpense(charge.expense);
    const haystack = `${charge.expense.description} ${charge.expense.category} ${charge.expense.payment} ${card?.name || ''} ${card?.bank || ''}`.toLocaleLowerCase('pt-BR');
    return !query || haystack.includes(query);
  });
  const filteredCharges = invalidRange ? [] : Core.filterTransactionCharges(searchedCharges, {
    type: $('type-filter').value,
    category: $('category-filter').value,
    payment: $('payment-filter').value,
    minAmount,
    maxAmount,
  });
  const charges = Core.sortTransactionCharges(filteredCharges, $('sort-order').value);
  const page = Core.paginate(charges, transactionPage, transactionPageSize);
  transactionPage = page.page;
  const hasFilters = $('payment-filter').value || query || $('type-filter').value || $('category-filter').value || $('amount-min').value || $('amount-max').value;
  $('transactions-list').innerHTML = page.items.length ? page.items.map((charge) => renderExpenseRow(charge, true, shareByCharge.get(`${charge.expense.id}::${charge.index}`) ?? 0)).join('') : `<p class="empty-note">${invalidRange ? 'Corrija o intervalo de valores para visualizar os lançamentos.' : hasFilters ? 'Nenhum lançamento deste mês combina com a busca e os filtros.' : 'Ainda não há registros neste mês.'}</p>`;
  const firstItem = page.totalItems ? (page.page - 1) * page.pageSize + 1 : 0;
  const lastItem = page.totalItems ? firstItem + page.items.length - 1 : 0;
  $('transactions-count').textContent = invalidRange ? 'Intervalo de valores inválido' : page.totalItems ? `Exibindo ${firstItem}–${lastItem} de ${page.totalItems} lançamentos` : 'Nenhum lançamento neste mês';
  $('page-indicator').textContent = `${page.page} / ${page.totalPages}`;
  $('previous-page').disabled = page.page <= 1;
  $('next-page').disabled = page.page >= page.totalPages;
  $('page-size').value = String(transactionPageSize);
}
function cardMonthCharges(cardId, month = selectedMonth()) { return chargesForMonth(month, cardId).filter((charge) => charge.expense.payment === 'Cartão' && charge.remaining > 0); }
function renderCardItem(card) {
  const limit = Number(card.limit) || 0;
  const used = cardUsed(card.id);
  const available = limit - used;
  const percentage = limit ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
  const monthlyCharges = chargesForMonth(selectedMonth(), card.id).filter((charge) => charge.expense.payment === 'Cartão');
  const due = monthlyCharges.reduce((sum, charge) => sum + charge.remaining, 0);
  const unpaid = monthlyCharges.filter((charge) => charge.remaining > 0);
  const rows = monthlyCharges.length ? monthlyCharges.map((charge) => `<div class="bill-line"><div class="bill-description"><strong>${escapeHtml(charge.expense.description)}</strong><span>${charge.expense.recurring === true ? 'Fixo mensal' : `${charge.index + 1}/${charge.expense.installments}`} · ${dateLabel(charge.date)} · ${currency.format(charge.amount)}</span></div><strong>${charge.remaining <= 0 ? '<span class="paid-tag">Liquidado</span>' : currency.format(charge.remaining)}</strong>${charge.remaining > 0 ? `<button class="pay-charge-button" data-pay-charge="${escapeHtml(charge.expense.id)}::${charge.index}">Liquidar</button>` : ''}</div>`).join('') : '<p class="empty-note compact-empty">Nenhuma cobrança neste mês.</p>';
  return `<article class="credit-card-card">
    <div class="credit-card-top"><span class="card-chip" aria-hidden="true">▰</span><div class="credit-card-title"><h3>${escapeHtml(card.name)}</h3><span>${escapeHtml(card.bank)} · ${card.dueDay ? `vence dia ${card.dueDay}` : 'vencimento não informado'}</span></div><div class="card-actions"><button class="icon-button" aria-label="Editar ${escapeHtml(card.name)}" data-edit-card="${escapeHtml(card.id)}">✎</button><button class="icon-button delete" aria-label="Excluir ${escapeHtml(card.name)}" data-delete-card="${escapeHtml(card.id)}">×</button></div></div>
    <div class="limit-line"><span>Limite utilizado</span><strong>${currency.format(used)} <small>de ${currency.format(limit)}</small></strong></div>
    <div class="card-progress large-progress"><i style="width:${percentage}%"></i></div>
    <div class="limit-foot"><span>Disponível</span><strong class="${available < 0 ? 'over-limit' : ''}">${currency.format(available)}</strong></div>
    <div class="bill-heading"><div><span>Fatura de ${escapeHtml(monthLabel(selectedMonth()))}</span><strong>${currency.format(due)}</strong></div><button class="add-button pay-bill-button" data-pay-bill="${escapeHtml(card.id)}" ${due <= 0 ? 'disabled' : ''}>Liquidar fatura</button></div>
    <div class="bill-lines">${rows}</div>
    ${unpaid.length ? `<p class="card-footnote">Cada liquidação libera do limite o valor pago. O restante em aberto continua comprometido.</p>` : ''}
  </article>`;
}
function renderCards() {
  $('cards-list').innerHTML = cards.length ? cards.map(renderCardItem).join('') : '<div class="cards-empty"><span class="empty-card-icon" aria-hidden="true">▰</span><h3>Cadastre seu primeiro cartão</h3><p>Informe o limite e vincule novas compras para acompanhar uso e faturas.</p><button class="add-button" data-create-card>＋ Adicionar cartão</button></div>';
}
function render() {
  $('month-picker').setAttribute('aria-label', `Mês de referência: ${monthLabel(selectedMonth())}`);
  const selectedMonthLabel = monthLabel(selectedMonth());
  const selectedMonthTitle = selectedMonthLabel.charAt(0).toLocaleUpperCase('pt-BR') + selectedMonthLabel.slice(1);
  $('month-long-label').textContent = selectedMonthTitle;
  $('month-long-label').hidden = false;
  $('page-top-title').textContent = view === 'inicio' ? 'Visão geral' : view === 'cartoes' ? 'Cartões' : 'Lançamentos';
  document.querySelector('.app-shell').classList.toggle('transactions-active', view === 'lancamentos');
  document.querySelector('.app-shell').classList.add('page-title-active');
  $('date-greeting').textContent = `SEU RESUMO DE ${monthLabel(selectedMonth())}`;
  $('page-heading').hidden = true;
  $('overview-view').hidden = view !== 'inicio';
  $('transactions-view').hidden = view !== 'lancamentos';
  $('cards-view').hidden = view !== 'cartoes';
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  renderOverview();
  updateCategoryFilter(); updatePaymentFilter();
  renderTransactions();
  renderCards();
}
function deleteIncome(id) {
  const entry = expenses.find((item) => item.id === id && item.type === 'income');
  if (!entry) return;
  openDeleteConfirmation({ title: 'Excluir registro?', message: `“${entry.description}” ${entry.recurring === true ? 'e todas as suas ocorrências mensais serão removidas' : 'será removida'} e o saldo será recalculado. Essa ação não pode ser desfeita.`, confirmLabel: 'Excluir registro', onConfirm: () => {
    expenses = expenses.filter((item) => item.id !== id);
    saveExpenses(); render(); showToast('Registro excluído.');
  } });
}
function populateCardSelect(select, excludeId = '') {
  const eligible = cards.filter((card) => card.id !== excludeId);
  select.innerHTML = eligible.length ? eligible.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)} · ${escapeHtml(card.bank)}</option>`).join('') : '<option value="">Cadastre um cartão primeiro</option>';
}
function openExpense(expense = null) {
  $('expense-form').reset();
  $('expense-id').value = expense?.id || '';
  $('description').value = expense?.description || '';
  $('amount').value = expense ? currency.format(Number(expense.amount)) : '';
  document.querySelector(`input[name="record-type"][value="${expense?.type === 'income' ? 'income' : 'expense'}"]`).checked = true;
  $('recurring-record').checked = expense?.recurring === true && (!expense.recurringUntil || expense.recurringUntil > selectedMonth());
  updateRecordType(expense?.category || '');
  $('payment').value = expense?.payment || 'Pix';
  $('card-mode').value = expense?.cardMode || (Number(expense?.installments) > 1 ? 'Parcelado' : 'À vista');
  $('installments').value = String(expense?.installments || 2);
  populateCardSelect($('card-select'));
  $('card-select').value = expense?.cardId || cardForExpense(expense || {})?.id || cards[0]?.id || '';
  $('first-date').value = expense?.firstDate || localDateKey();
  $('notes').value = expense?.notes || '';
  $('dialog-title').textContent = expense ? 'Editar registro' : 'Novo registro';
  $('save-expense').textContent = expense ? 'Salvar alterações' : 'Salvar registro';
  updatePaymentFields();
  $('expense-dialog').showModal();
  $('description').focus();
}
function updatePaymentFields() {
  const existing = expenses.find(entry => entry.id === $('expense-id').value);
  const fixed = $('recurring-record').checked || existing?.recurring === true;
  if (fixed) $('card-mode').value = 'À vista';
  let recurringHint = 'Repete o valor integral todo mês a partir da data inicial. Os valores de meses futuros são previstos.';
  if (existing?.recurring === true) {
    recurringHint = existing.recurringUntil && existing.recurringUntil <= selectedMonth() && !$('recurring-record').checked
      ? `A repetição termina após ${monthLabel(existing.recurringUntil)}. Marque para voltar a repetir nos próximos meses.`
      : `Alterações de valor e data afetam toda a série. Desmarcar encerra a repetição após ${monthLabel(selectedMonth())}, preservando os meses anteriores.`;
  }
  $('recurring-hint').textContent = recurringHint;
  const isCard = recordType() === 'expense' && $('payment').value === 'Cartão';
  const isInstallment = isCard && $('card-mode').value === 'Parcelado';
  $('card-mode-wrap').hidden = !isCard || fixed;
  $('card-details-row').hidden = !isCard;
  $('installments-wrap').hidden = !isInstallment;
  $('card-select').required = isCard;
  $('card-select').disabled = isCard && cards.length === 0;
  $('installment-hint').hidden = !isInstallment;
  if (!isInstallment) return;
  const amount = parseCurrencyInput($('amount').value);
  const parts = Number($('installments').value) || 2;
  $('installment-hint').textContent = amount ? `Serão lançadas ${parts} cobranças mensais de aproximadamente ${currency.format(amount / parts)}. O limite ficará comprometido pelo saldo total ainda em aberto.` : 'Informe o valor total para ver uma estimativa das parcelas.';
}
function submitExpense(event) {
  event.preventDefault();
  const previous = expenses.find(entry => entry.id === $('expense-id').value);
  const checkedFixed = $('recurring-record').checked;
  const recurring = checkedFixed || previous?.recurring === true;
  const previouslyRepeating = previous?.recurring === true && (!previous.recurringUntil || previous.recurringUntil > selectedMonth());
  let recurringUntil;
  if (previous?.recurring === true) {
    if (!checkedFixed) recurringUntil = selectedMonth();
    else if (previouslyRepeating) recurringUntil = previous.recurringUntil;
  }
  const type = recordType();
  const payment = $('payment').value;
  const cardId = payment === 'Cartão' ? $('card-select').value : '';
  const chosenCard = cardById(cardId);
  if (payment === 'Cartão' && !chosenCard) { showToast('Cadastre um cartão antes de lançar uma compra no crédito.'); return; }
  const cardMode = payment === 'Cartão' ? recurring ? 'À vista' : $('card-mode').value : '';
  const installments = payment === 'Cartão' && cardMode === 'Parcelado' ? Number($('installments').value) : 1;
  const amount = Math.round(parseCurrencyInput($('amount').value) * 100) / 100;
  if (!(amount > 0)) { showToast('Informe um valor maior que zero.'); return; }
  const expense = {
    id: $('expense-id').value || createId('expense'), description: $('description').value.trim(), amount,
    category: $('category').value, payment, cardId, card: chosenCard?.name || '', cardMode, installments,
    firstDate: $('first-date').value, notes: $('notes').value.trim(), type, recurring, ...(recurringUntil ? {recurringUntil} : {}),
  };
  if (!expense.description || (type === 'income' && expense.firstDate > localDateKey())) { showToast('Confira a descrição e a data de recebimento.'); return; }
  if (recurringUntil && expense.firstDate.slice(0,7) > recurringUntil) { showToast('A data inicial precisa ser anterior ao encerramento da repetição.'); return; }
  if (previous?.recurring === true && recurringUntil && settlements.some(payment => payment.expenseId === previous.id && monthKey(Core.installmentDate(previous.firstDate, Number(payment.installmentIndex))) > recurringUntil)) { showToast('Há liquidações posteriores. Encerre a repetição no último mês já liquidado ou depois dele.'); return; }
  const existing = expenses.findIndex((item) => item.id === expense.id);
  const authorizedEdit = existing >= 0 && settlementResetOnSave === expense.id;
  const financialState = entry => JSON.stringify([Math.round(Number(entry.amount) * 100), entry.firstDate, entry.payment, entry.cardId || '', entry.type || 'expense', Number(entry.installments) || 1, entry.recurring === true]);
  const financialChange = previous && financialState(previous) !== financialState(expense);
  const resetsSettlements = authorizedEdit && (!previous?.recurring || financialChange);
  if (existing >= 0 && settlements.some((item) => item.expenseId === expense.id) && !authorizedEdit) {
    showToast('Confirme a edição de uma compra com pagamentos antes de salvar.');
    return;
  }
  if (resetsSettlements) {
    settlements = settlements.filter((item) => item.expenseId !== expense.id);
    saveSettlements();
    settlementResetOnSave = null;
  }
  if (existing >= 0) expenses[existing] = expense; else expenses.push(expense);
  saveExpenses();
  $('expense-dialog').close();
  setMonth(previous?.recurring === true ? selectedMonth() : monthKey(dateFromKey(expense.firstDate)));
  showToast(resetsSettlements ? 'Registro atualizado. Os pagamentos anteriores foram removidos.' : existing >= 0 ? 'Registro atualizado.' : 'Registro salvo.');
}
function openDeleteConfirmation({ eyebrow = 'CONFIRME A EXCLUSÃO', title, message, confirmLabel, confirmClass = 'danger-button', onConfirm }) {
  $('confirm-dialog-eyebrow').textContent = eyebrow;
  $('delete-dialog-title').textContent = title;
  $('delete-dialog-message').textContent = message;
  $('confirm-delete').textContent = confirmLabel;
  $('confirm-delete').className = confirmClass;
  pendingDelete = onConfirm;
  $('delete-dialog').showModal();
  $('cancel-delete').focus();
}
function confirmDelete() {
  if (!pendingDelete) return;
  const action = pendingDelete;
  pendingDelete = null;
  $('delete-dialog').close();
  action();
}
function deleteExpense(id) {
  const expense = expenses.find((item) => item.id === id);
  if (!expense) return;
  if (expense.type === 'income') { deleteIncome(id); return; }
  const linkedPayments = settlements.filter((item) => item.expenseId === id);
  const charges = expense.recurring === true ? 'ocorrências de todos os meses' : `${expense.installments} cobrança${expense.installments === 1 ? '' : 's'}`;
  const paymentNotice = linkedPayments.length === 1 ? 'Também será removido 1 pagamento registrado.'
    : linkedPayments.length > 1 ? `Também serão removidos ${linkedPayments.length} pagamentos registrados.` : '';
  openDeleteConfirmation({
    title: 'Excluir registro?',
    message: `“${expense.description}” e suas ${charges} serão removidas. ${paymentNotice} Essa ação não pode ser desfeita.`.replace(/\s+/g, ' '),
    confirmLabel: 'Excluir registro',
    onConfirm: () => {
      expenses = expenses.filter((item) => item.id !== id);
      settlements = settlements.filter((item) => item.expenseId !== id);
      saveExpenses();
      saveSettlements();
      render();
      showToast('Registro excluído.');
    },
  });
}
function requestExpenseEdit(expense) {
  if (!expense) return;
  const linkedPayments = settlements.filter((item) => item.expenseId === expense.id);
  if (!linkedPayments.length) { openExpense(expense); return; }
  openDeleteConfirmation({
    eyebrow: 'CONFIRME A EDIÇÃO',
    title: expense.recurring === true ? 'Editar registro fixo?' : 'Editar compra liquidada?',
    message: expense.recurring === true ? `As alterações valem para toda a série. Mudar valor, data, forma de pagamento ou tipo removerá os pagamentos vinculados. Encerrar a repetição ou alterar descrição e categoria preserva os pagamentos. Cancelar mantém todos os dados.` : `A edição de “${expense.description}” removerá ${linkedPayments.length} pagamento${linkedPayments.length === 1 ? '' : 's'} vinculado${linkedPayments.length === 1 ? '' : 's'} e a compra voltará a ficar em aberto. Se você fechar o formulário sem salvar, os pagamentos serão mantidos.`,
    confirmLabel: expense.recurring === true ? 'Editar registro' : 'Editar compra',
    confirmClass: 'add-button',
    onConfirm: () => { settlementResetOnSave = expense.id; openExpense(expense); },
  });
}
function openCardDialog(card = null) {
  $('card-form').reset();
  $('card-id').value = card?.id || '';
  $('card-name').value = card?.name || '';
  $('card-bank').value = card?.bank || '';
  $('card-limit').value = card ? currency.format(Number(card.limit)) : '';
  $('card-due-day').value = card?.dueDay || '';
  $('card-dialog-title').textContent = card ? 'Editar cartão' : 'Adicionar cartão';
  $('save-card').textContent = card ? 'Salvar alterações' : 'Salvar cartão';
  $('card-dialog').showModal();
  $('card-name').focus();
}
function submitCard(event) {
  event.preventDefault();
  const name = $('card-name').value.trim();
  const bank = $('card-bank').value.trim();
  const limit = Math.round(parseCurrencyInput($('card-limit').value) * 100) / 100;
  const dueDay = Number($('card-due-day').value);
  if (!name || !bank || !(limit > 0) || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) { showToast('Preencha nome, banco, limite e um dia de vencimento entre 1 e 31.'); return; }
  const id = $('card-id').value || createId('card');
  if (cards.some((card) => card.id !== id && card.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) { showToast('Já existe um cartão com esse nome.'); return; }
  const updated = { id, name, bank, limit, dueDay };
  const index = cards.findIndex((card) => card.id === id);
  if (index >= 0) cards[index] = updated; else cards.push(updated);
  for (const expense of expenses) if (expense.cardId === id) expense.card = name;
  saveCards(); saveExpenses();
  $('card-dialog').close();
  render();
  showToast(index >= 0 ? 'Cartão atualizado.' : 'Cartão salvo.');
}
function deleteCard(id) {
  const card = cardById(id);
  if (!card) return;
  if (expenses.some((expense) => expense.cardId === id) || settlements.some((payment) => payment.sourceCardId === id || payment.targetCardId === id)) { showToast('Este cartão está ligado a compras ou pagamentos e não pode ser excluído.'); return; }
  openDeleteConfirmation({
    title: 'Excluir cartão?',
    message: `O cartão “${card.name}” será removido. Essa ação não pode ser desfeita.`,
    confirmLabel: 'Excluir cartão',
    onConfirm: () => {
      cards = cards.filter((item) => item.id !== id);
      saveCards(); render(); showToast('Cartão excluído.');
    },
  });
}
function startSettlement(charges) {
  const payable = charges.filter((charge) => charge.remaining > 0);
  if (!payable.length) { showToast('Não há cobranças em aberto para liquidar.'); return; }
  const targetCardId = payable[0].expense.cardId;
  if (payable.some((charge) => charge.expense.cardId !== targetCardId)) { showToast('Selecione cobranças de um mesmo cartão.'); return; }
  settlementTarget = { cardId: targetCardId, month: selectedMonth(), charges: payable.map((charge) => ({ expenseId: charge.expense.id, installmentIndex: charge.index })) };
  const total = payable.reduce((sum, charge) => sum + charge.remaining, 0);
  $('settlement-summary').textContent = `${cardById(targetCardId)?.name || 'Cartão'} · ${monthLabel(selectedMonth())} · ${currency.format(total)}${payable.length === 1 ? ' nesta cobrança' : ` em ${payable.length} cobranças`}`;
  populateCardSelect($('funding-card'), targetCardId);
  updateSettlementMethod();
  $('settlement-dialog').showModal();
}
function startSettlementForCharge(expenseId, installmentIndex) {
  const expense = expenses.find((item) => item.id === expenseId);
  if (!expense || expense.payment !== 'Cartão') return;
  const charge = chargesForMonth(selectedMonth(), expense.cardId).filter((item) => item.expense.id === expenseId && item.index === Number(installmentIndex));
  startSettlement(charge);
}
function updateSettlementMethod() {
  const byCard = $('settlement-method').value === 'Cartão';
  $('funding-card-wrap').hidden = !byCard;
  $('funding-card-hint').hidden = !byCard;
  $('funding-card').required = byCard;
  $('funding-card').disabled = byCard && cards.filter((card) => card.id !== settlementTarget?.cardId).length === 0;
}
function confirmSettlement(event) {
  event.preventDefault();
  if (!settlementTarget) return;
  const targetCard = cardById(settlementTarget.cardId);
  const method = $('settlement-method').value;
  const sourceCardId = method === 'Cartão' ? $('funding-card').value : '';
  const sourceCard = cardById(sourceCardId);
  if (method === 'Cartão' && (!sourceCard || sourceCard.id === targetCard?.id)) { showToast('Escolha outro cartão cadastrado para pagar esta fatura.'); return; }
  const payable = settlementTarget.charges.map((item) => {
    const expense = expenses.find((entry) => entry.id === item.expenseId);
    const remaining = expense ? chargeRemaining(expense, item.installmentIndex) : 0;
    return expense ? { ...item, expense, index: item.installmentIndex, amount: remaining, remaining } : null;
  }).filter((item) => item && item.amount > 0);
  const total = payable.reduce((sum, item) => sum + item.amount, 0);
  if (!total) { $('settlement-dialog').close(); render(); showToast('Essas cobranças já foram liquidadas.'); return; }
  const batchId = createId('payment');
  const paidAt = localDateKey();
  const allocations = Core.allocateFullPayment(payable);
  settlements.push(...allocations.map((allocation) => ({
    id: createId('allocation'), batchId, ...allocation,
    targetCardId: settlementTarget.cardId, date: paidAt, month: settlementTarget.month, method, sourceCardId,
  })));
  if (method === 'Cartão') {
    expenses.push({
      id: createId('transfer'), description: `Pagamento da fatura ${targetCard?.name || 'do cartão'}`,
      amount: total, category: 'Outros', payment: 'Cartão', cardId: sourceCard.id, card: sourceCard.name,
      cardMode: 'À vista', installments: 1, firstDate: paidAt, notes: 'Pagamento de fatura com outro cartão', type: 'debt-transfer',
    });
    saveExpenses();
  }
  saveSettlements();
  $('settlement-dialog').close();
  settlementTarget = null;
  render();
  showToast(`Pagamento de ${currency.format(total)} registrado via ${method}.`);
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'MeuGasto', version: 2, exportedAt: new Date().toISOString(), expenses, cards, settlements }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `meugasto-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Backup baixado.');
}
async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.expenses;
    const incomingCards = Array.isArray(parsed.cards) ? parsed.cards : [];
    const incomingSettlements = Array.isArray(parsed.settlements) ? parsed.settlements : [];
    if (!Array.isArray(incoming) || !incoming.every(isValidExpense) || !incomingCards.every((card) => card && typeof card.id === 'string' && Number.isFinite(Number(card.limit)))) throw new Error('invalid');
    if ((expenses.length || cards.length) && !window.confirm('Importar este backup vai substituir registros, cartões e pagamentos salvos neste PC. Continuar?')) return;
    expenses = incoming; cards = incomingCards; settlements = incomingSettlements;
    migrateLegacyCardLinks();
    saveExpenses(); saveCards(); saveSettlements(); render();
    showToast('Backup importado.');
  } catch { showToast('Não foi possível ler esse backup. Selecione um arquivo exportado pelo app.'); }
  finally { $('import-file').value = ''; }
}
function initialize() {
  $('sidebar-toggle').addEventListener('click', () => {
    const collapsed = document.querySelector('.app-shell').classList.toggle('sidebar-collapsed');
    $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('sidebar-toggle').setAttribute('aria-label', collapsed ? 'Abrir menu lateral' : 'Fechar menu lateral');
    $('sidebar-toggle').title = collapsed ? 'Abrir menu lateral' : 'Fechar menu lateral';
  });
  $('month-picker').value = monthKey(new Date());
  $('category').innerHTML = CATEGORY_DATA.map((item) => `<option value="${escapeHtml(item.name)}">${item.icon} ${escapeHtml(item.name)}</option>`).join('');
  updateCategoryFilter(); updatePaymentFilter();
  $('installments').innerHTML = Array.from({ length: 35 }, (_, index) => `<option value="${index + 2}">${index + 2}x</option>`).join('');
  populateCardSelect($('card-select'));
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
  $('new-expense').addEventListener('click', () => openExpense());
  $('manage-income').addEventListener('click', () => { view = 'lancamentos'; $('clear-filters').click(); render(); });
  document.querySelectorAll('input[name="record-type"]').forEach(input => input.addEventListener('change', () => updateRecordType()));
  $('new-card').addEventListener('click', () => openCardDialog());
  $('manage-cards').addEventListener('click', () => { view = 'cartoes'; render(); });
  $('all-categories').addEventListener('click', () => showCategoryTransactions('expense'));
  $('all-income-categories').addEventListener('click', () => showCategoryTransactions('income'));
  $('all-transactions').addEventListener('click', () => { view = 'lancamentos'; render(); });
  $('prev-month').addEventListener('click', () => { const date = dateFromKey(`${selectedMonth()}-01`); date.setMonth(date.getMonth() - 1); transactionPage = 1; setMonth(monthKey(date)); });
  $('next-month').addEventListener('click', () => { const date = dateFromKey(`${selectedMonth()}-01`); date.setMonth(date.getMonth() + 1); transactionPage = 1; setMonth(monthKey(date)); });
  $('month-picker').addEventListener('change', () => { transactionPage = 1; render(); });
  $('search-input').addEventListener('input', () => { transactionPage = 1; renderTransactions(); });
  $('sort-order').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  $('type-filter').addEventListener('change', () => { updateCategoryFilter(); updatePaymentFilter(); transactionPage = 1; renderTransactions(); });
  $('payment-filter').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  $('category-filter').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  for (const id of ['amount-min', 'amount-max']) $(id).addEventListener('input', (event) => {
    formatCurrencyInput(event.currentTarget);
    transactionPage = 1;
    renderTransactions();
  });
  $('clear-filters').addEventListener('click', () => {
    $('search-input').value = '';
    $('sort-order').value = 'date-desc';
    $('type-filter').value = '';
    updateCategoryFilter(); updatePaymentFilter();
    $('category-filter').value = '';
    $('payment-filter').value = '';
    $('amount-min').value = '';
    $('amount-max').value = '';
    transactionPage = 1;
    renderTransactions();
  });
  $('page-size').addEventListener('change', () => { transactionPageSize = Number($('page-size').value); transactionPage = 1; renderTransactions(); });
  $('previous-page').addEventListener('click', () => { transactionPage -= 1; renderTransactions(); });
  $('next-page').addEventListener('click', () => { transactionPage += 1; renderTransactions(); });
  $('close-dialog').addEventListener('click', () => $('expense-dialog').close());
  $('cancel-dialog').addEventListener('click', () => $('expense-dialog').close());
  $('expense-dialog').addEventListener('close', () => { settlementResetOnSave = null; });
  $('expense-form').addEventListener('submit', submitExpense);
  $('payment').addEventListener('change', updatePaymentFields);
  $('recurring-record').addEventListener('change', updatePaymentFields);
  $('card-mode').addEventListener('change', updatePaymentFields);
  $('installments').addEventListener('change', updatePaymentFields);
  $('amount').addEventListener('input', (event) => { formatCurrencyInput(event.currentTarget); updatePaymentFields(); });
  $('card-limit').addEventListener('input', (event) => formatCurrencyInput(event.currentTarget));
  $('transactions-list').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    const remove = event.target.closest('[data-delete]');
    const payCharge = event.target.closest('[data-pay-charge]');
    if (edit) requestExpenseEdit(expenses.find((item) => item.id === edit.dataset.edit));
    if (remove) deleteExpense(remove.dataset.delete);
    if (payCharge) {
      const [expenseId, installmentIndex] = payCharge.dataset.payCharge.split('::');
      startSettlementForCharge(expenseId, installmentIndex);
    }
  });
  $('cards-list').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-card]');
    const remove = event.target.closest('[data-delete-card]');
    const payBill = event.target.closest('[data-pay-bill]');
    const payCharge = event.target.closest('[data-pay-charge]');
    const create = event.target.closest('[data-create-card]');
    if (edit) openCardDialog(cardById(edit.dataset.editCard));
    if (remove) deleteCard(remove.dataset.deleteCard);
    if (payBill) startSettlement(cardMonthCharges(payBill.dataset.payBill));
    if (payCharge) {
      const [expenseId, installmentIndex] = payCharge.dataset.payCharge.split('::');
      startSettlementForCharge(expenseId, installmentIndex);
    }
    if (create) openCardDialog();
  });
  $('card-form').addEventListener('submit', submitCard);
  $('close-card-dialog').addEventListener('click', () => $('card-dialog').close());
  $('cancel-card-dialog').addEventListener('click', () => $('card-dialog').close());
  $('close-settlement-dialog').addEventListener('click', () => $('settlement-dialog').close());
  $('cancel-settlement').addEventListener('click', () => $('settlement-dialog').close());
  $('close-delete-dialog').addEventListener('click', () => $('delete-dialog').close());
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('confirm-delete').addEventListener('click', confirmDelete);
  $('delete-dialog').addEventListener('close', () => { pendingDelete = null; });
  $('settlement-method').addEventListener('change', updateSettlementMethod);
  $('settlement-form').addEventListener('submit', confirmSettlement);
  $('export-button').addEventListener('click', exportBackup);
  $('import-button').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (event) => event.target.files[0] && importBackup(event.target.files[0]));
  render();
  restoreLocalDatabase();
}
initialize();
