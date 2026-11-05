const CATEGORY_DATA = [
  { name: 'Moradia', icon: 'home', color: '#8665da' },
  { name: 'Alimentação', icon: 'restaurant', color: '#dc9b37' },
  { name: 'Transporte', icon: 'directions_bike', color: '#4a91b8' },
  { name: 'Saúde', icon: 'health_and_safety', color: '#46977c' },
  { name: 'Lazer', icon: 'local_activity', color: '#d56c90' },
  { name: 'Educação', icon: 'school', color: '#8871cb' },
  { name: 'Compras', icon: 'shopping_bag', color: '#cf805d' },
  { name: 'Assinaturas', icon: 'headphones', color: '#577ab4' },
  { name: 'Contas', icon: 'lightbulb', color: '#c89b38' },
  { name: 'Outros', icon: 'category', color: '#8b8298' },
];
const INCOME_CATEGORY_DATA = [
  { name: 'Prestação de serviço', icon: 'handyman', color: '#317c62', iconColor: '#c8793a' },
  { name: 'Salário', icon: 'work', color: '#317c62', iconColor: '#317c62' },
  { name: 'Vendas', icon: 'shopping_bag', color: '#317c62', iconColor: '#c89b38' },
  { name: 'Rendimentos', icon: 'trending_up', color: '#317c62', iconColor: '#8a68c4' },
  { name: 'Aluguéis', icon: 'home_work', color: '#317c62', iconColor: '#46977c' },
  { name: 'Outras receitas', icon: 'north_east', color: '#317c62', iconColor: '#4a91b8' },
];
const BANK_DATA = [
  { key: 'bb', name: 'Banco do Brasil', aliases: ['bb'], symbol: 'BB', icon: 'assets/banks/00000000.svg', color: '#ffdc00', surface: '#FCFC30' },
  { key: 'nubank', name: 'Nubank', aliases: ['nu'], symbol: 'nu', icon: 'assets/banks/18236120.svg', color: '#820ad1', surface: '#f4e8fb' },
  { key: 'bradesco', name: 'Bradesco', aliases: ['bradesco'], symbol: 'B', icon: 'assets/banks/60746948.svg', color: '#cc092f', surface: '#fff0f3' },
  { key: 'itau', name: 'Itaú', aliases: ['itau'], symbol: 'Itaú', icon: 'assets/banks/60701190.svg', color: '#003399', surface: '#ff9e00' },
  { key: 'santander', name: 'Santander', aliases: ['santander'], symbol: 'S', icon: 'assets/banks/90400888.svg', color: '#ec0000', surface: '#fff0f0' },
];
const OTHER_BANK_VALUE = '__other__';
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
let budgets = loadBudgets();
let view = 'inicio';
let currentFinancialAlerts = [];
let transactionPage = 1;
let transactionPageSize = 10;
let transactionFilterTimer = null;
let lastTransactionMarkup = null;
const TRANSACTION_FILTER_PAUSE = 1000;
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
  localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(budgets));
}
function clearBrowserCache() {
  localStorage.removeItem(CARD_STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PAYMENT_STORAGE_KEY);
  localStorage.removeItem(BUDGET_STORAGE_KEY);
}
function persistLocalDatabase() {
  if (!localDatabaseEnabled) return Promise.resolve();
  const state = JSON.stringify({ expenses, cards, settlements, budgets });
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
    showToast('Não foi possível salvar no banco local. Seus dados continuam disponíveis nesta cópia do navegador.', 'error');
  });
  return localDatabaseQueue;
}
function saveCards() { if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(cards)); }
function saveExpenses() { if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses)); }
function saveSettlements() { if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(PAYMENT_STORAGE_KEY, JSON.stringify(settlements)); }
async function restoreLocalDatabase() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) return false;
    const { initialized, state } = await response.json();
    localDatabaseEnabled = true;
    if (initialized) {
      cards = state.cards.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && Number.isFinite(Number(item.limit)) && Number(item.limit) >= 0)
        .map((item) => ({ ...item, dueDay: Number.isInteger(Number(item.dueDay)) && Number(item.dueDay) >= 1 && Number(item.dueDay) <= 31 ? Number(item.dueDay) : null }));
      expenses = state.expenses.filter(isValidExpense);
      settlements = state.settlements.filter((item) => item && typeof item.id === 'string' && typeof item.expenseId === 'string' && Number.isInteger(Number(item.installmentIndex)) && Number(item.amount) > 0);
      budgets = Array.isArray(state.budgets) ? state.budgets.filter(validBudget) : [];
      clearBrowserCache();
      migrateLegacyCardLinks();
      render();
    } else {
      await persistLocalDatabase();
      if (localDatabaseEnabled) clearBrowserCache();
    }
    return true;
  } catch {
    localDatabaseEnabled = false;
    return false;
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
  const group = (kind, label) => `<optgroup label="${label}">${recordCategories(kind).map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('')}</optgroup>`;
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
  $('category').innerHTML = recordCategories(income ? 'income' : 'expense').filter(item=>item.name!=='Trabalho físico' || selectedCategory==='Trabalho físico').map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  if (selectedCategory) $('category').value = selectedCategory;
  syncCategoryPicker();
  const methods = recordPaymentMethods(income ? 'income' : 'expense');
  $('payment').innerHTML = methods.map(method => `<option value="${method}">${method}</option>`).join('');
  $('payment').value = methods.includes(previousPayment) ? previousPayment : methods[0];
  syncPaymentPicker();
  $('description').placeholder = income ? 'Ex.: salário, serviço prestado' : 'Ex.: mercado, conta de luz';
  $('payment-label').textContent = income ? 'Forma de recebimento' : 'Forma de pagamento';
  $('record-date-label').textContent = income ? 'Data de recebimento' : 'Data do primeiro pagamento';
  if (income) $('first-date').max = localDateKey(); else $('first-date').removeAttribute('max');
  updatePaymentFields();
}
function syncCategoryPicker() {
  const select=$('category'), trigger=$('category-trigger');
  if (!select || !trigger) return;
  const income=recordType()==='income';
  const selected=category(select.value,income);
  const color=selected.iconColor || selected.color;
  $('category-selected-icon').textContent=selected.icon;
  $('category-selected-icon').style.color=color;
  $('category-selected-icon').style.backgroundColor=`${color}1a`;
  $('category-selected-name').textContent=select.value;
  $('category-options').innerHTML=[...select.options].map(option=>{
    const info=category(option.value,income), iconColor=info.iconColor || info.color;
    return `<div class="category-picker-option" role="option" tabindex="-1" data-category-option="${escapeHtml(option.value)}" aria-selected="${String(option.value===select.value)}"><span class="material-icons category-picker-option-icon" style="color:${iconColor};background-color:${iconColor}1a" aria-hidden="true">${escapeHtml(info.icon)}</span><span>${escapeHtml(option.value)}</span></div>`;
  }).join('');
}
function setupCategoryPicker() {
  const select=$('category'), picker=$('category-picker'), trigger=$('category-trigger'), options=$('category-options');
  const setOpen=(open,focusSelected=false)=>{
    options.hidden=!open;
    trigger.setAttribute('aria-expanded',String(open));
    if (open && focusSelected) (options.querySelector('[aria-selected="true"]') || options.querySelector('[role="option"]'))?.focus();
  };
  select.addEventListener('change',syncCategoryPicker);
  trigger.addEventListener('click',()=>setOpen(options.hidden));
  trigger.addEventListener('keydown',event=>{
    if (event.key==='ArrowDown' || event.key==='ArrowUp') {event.preventDefault();setOpen(true,true);}
  });
  options.addEventListener('click',event=>{
    const option=event.target.closest('[data-category-option]');
    if (!option) return;
    select.value=option.dataset.categoryOption;
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
    setOpen(false);trigger.focus();
  });
  options.addEventListener('keydown',event=>{
    const items=[...options.querySelectorAll('[role="option"]')], index=items.indexOf(document.activeElement);
    let next=index;
    if (event.key==='ArrowDown') next=Math.min(items.length-1,index+1);
    else if (event.key==='ArrowUp') next=Math.max(0,index-1);
    else if (event.key==='Home') next=0;
    else if (event.key==='End') next=items.length-1;
    else if (event.key==='Escape') {event.preventDefault();setOpen(false);trigger.focus();return;}
    else if (event.key==='Enter' || event.key===' ') {event.preventDefault();document.activeElement.click();return;}
    else return;
    event.preventDefault();items[next]?.focus();
  });
  document.addEventListener('pointerdown',event=>{if (!picker.contains(event.target)) setOpen(false);});
  syncCategoryPicker();
}
function paymentMethodInfo(method) {
  const methods={
    Pix:{icon:'pix',color:'#299e91',image:'pix-symbol.svg'},
    Dinheiro:{icon:'payments',color:'#b78027'},
    Cartão:{icon:'credit_card',color:'#6541c8'},
    Transferência:{icon:'account_balance',color:'#4a91b8'},
  };
  return methods[method] || {icon:'swap_horiz',color:'#8b8298'};
}
function paymentIconMarkup(method) {
  const info=paymentMethodInfo(method);
  return info.image ? `<img class="payment-picker-pix" src="${info.image}" alt="" />` : `<span class="material-icons" aria-hidden="true">${escapeHtml(info.icon)}</span>`;
}
function syncPaymentPicker() {
  const select=$('payment'), trigger=$('payment-trigger');
  if (!select || !trigger) return;
  const selected=$('payment-selected-icon'), info=paymentMethodInfo(select.value);
  selected.innerHTML=paymentIconMarkup(select.value);
  selected.style.color=info.color;
  selected.style.backgroundColor=`${info.color}1a`;
  $('payment-selected-name').textContent=select.value;
  $('payment-options').innerHTML=[...select.options].map(option=>{
    const methodInfo=paymentMethodInfo(option.value);
    return `<div class="payment-picker-option" role="option" tabindex="-1" data-payment-option="${escapeHtml(option.value)}" aria-selected="${String(option.value===select.value)}"><span class="payment-picker-option-icon" style="color:${methodInfo.color};background-color:${methodInfo.color}1a">${paymentIconMarkup(option.value)}</span><span>${escapeHtml(option.value)}</span></div>`;
  }).join('');
}
function setupPaymentPicker() {
  const select=$('payment'), picker=$('payment-picker'), trigger=$('payment-trigger'), options=$('payment-options');
  const setOpen=(open,focusSelected=false)=>{
    options.hidden=!open;
    trigger.setAttribute('aria-expanded',String(open));
    if (open && focusSelected) (options.querySelector('[aria-selected="true"]') || options.querySelector('[role="option"]'))?.focus();
  };
  select.addEventListener('change',syncPaymentPicker);
  trigger.addEventListener('click',()=>setOpen(options.hidden));
  trigger.addEventListener('keydown',event=>{
    if (event.key==='ArrowDown' || event.key==='ArrowUp') {event.preventDefault();setOpen(true,true);}
  });
  options.addEventListener('click',event=>{
    const option=event.target.closest('[data-payment-option]');
    if (!option) return;
    select.value=option.dataset.paymentOption;
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
    setOpen(false);trigger.focus();
  });
  options.addEventListener('keydown',event=>{
    const items=[...options.querySelectorAll('[role="option"]')], index=items.indexOf(document.activeElement);
    let next=index;
    if (event.key==='ArrowDown') next=Math.min(items.length-1,index+1);
    else if (event.key==='ArrowUp') next=Math.max(0,index-1);
    else if (event.key==='Home') next=0;
    else if (event.key==='End') next=items.length-1;
    else if (event.key==='Escape') {event.preventDefault();setOpen(false);trigger.focus();return;}
    else if (event.key==='Enter' || event.key===' ') {event.preventDefault();document.activeElement.click();return;}
    else return;
    event.preventDefault();items[next]?.focus();
  });
  document.addEventListener('pointerdown',event=>{if (!picker.contains(event.target)) setOpen(false);});
  syncPaymentPicker();
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
const toastCenter = new Notyf({
  duration: 3600,
  position: { x: 'right', y: 'bottom' },
  ripple: false,
  dismissible: false,
  types: [
    {
      type: 'success',
      className: 'notyf__toast--success meugasto-notice meugasto-notice-success',
      background: '#fff',
      icon: { className: 'material-icons', tagName: 'span', text: 'check_circle', color: '#317c62' },
    },
    {
      type: 'error',
      className: 'notyf__toast--error meugasto-notice meugasto-notice-error',
      background: '#fff',
      icon: { className: 'material-icons', tagName: 'span', text: 'error', color: '#b44450' },
    },
    {
      type: 'info',
      className: 'meugasto-notice meugasto-notice-info',
      background: '#fff',
      icon: { className: 'material-icons', tagName: 'span', text: 'info', color: '#6541c8' },
    },
  ],
});
function showToast(message, tone = 'info') {
  const messageText = String(message);
  if (tone === 'success') toastCenter.success({ message: messageText, duration: 3600 });
  else if (tone === 'error') toastCenter.error({ message: messageText, duration: 5200 });
  else toastCenter.open({ type: 'info', message: messageText, duration: 4200 });
}
const FIELD_ERROR_MESSAGES = {
  description: 'Informe a descrição deste registro.',
  amount: 'Informe um valor maior que zero.',
  category: 'Escolha uma categoria para o registro.',
  payment: 'Escolha a forma de pagamento ou recebimento.',
  'card-select': 'Selecione o cartão usado neste registro.',
  installments: 'Escolha o número de parcelas.',
  'first-date': 'Informe a data do primeiro pagamento ou recebimento.',
  'card-name': 'Informe o nome do cartão.',
  'card-bank': 'Selecione o banco ou emissor do cartão.',
  'card-bank-other': 'Digite o nome do banco.',
  'card-limit': 'Informe um limite maior que zero.',
  'card-due-day': 'Informe um dia de vencimento entre 1 e 31.',
  'funding-card': 'Selecione outro cartão para pagar esta fatura.',
  'realization-date': 'Informe a data do pagamento ou recebimento.',
  'budget-category': 'Escolha uma categoria para o orçamento.',
  'budget-amount': 'Informe um limite maior que zero.',
};
function fieldValidationTarget(control) {
  return control.matches('select[aria-hidden="true"]') ? $(`${control.id}-trigger`) || control : control;
}
function fieldValidationMessage(control) {
  const value = String(control.value || '').trim();
  const id = control.id;
  if (control.required && !value) return FIELD_ERROR_MESSAGES[id] || 'Preencha este campo.';
  if (['amount', 'card-limit', 'budget-amount'].includes(id) && parseCurrencyInput(value) <= 0) return FIELD_ERROR_MESSAGES[id];
  if (id === 'card-due-day') {
    const day = Number(value);
    if (!Number.isInteger(day) || day < 1 || day > 31) return FIELD_ERROR_MESSAGES[id];
  }
  if (id === 'first-date' && $('record-status').value === 'realized' && value > localDateKey()) return 'A data do registro não pode ser futura quando ele já está pago ou recebido.';
  if (id === 'realization-date' && value > localDateKey()) return 'A data de confirmação não pode ser futura.';
  if (!control.validity.valid) {
    if (control.validity.rangeOverflow && control.type === 'date') return 'Informe uma data igual ou anterior a hoje.';
    if (control.validity.rangeUnderflow && id === 'card-due-day') return FIELD_ERROR_MESSAGES[id];
    if (control.validity.typeMismatch) return 'Confira o formato informado.';
    return FIELD_ERROR_MESSAGES[id] || 'Confira o valor informado.';
  }
  return '';
}
function clearFieldValidation(control, markValid = false) {
  if (!control?.id) return;
  const target = fieldValidationTarget(control);
  const field = control.closest('.field') || target.closest('.field');
  const errorId = `field-error-${control.id}`;
  const hadError = Boolean(field?.classList.contains('has-error'));
  $(errorId)?.remove();
  field?.classList.remove('has-error', 'is-valid');
  target.removeAttribute('aria-errormessage');
  const descriptions = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
  if (descriptions.length) target.setAttribute('aria-describedby', descriptions.join(' '));
  else target.removeAttribute('aria-describedby');
  if (hadError && markValid) {
    target.setAttribute('aria-invalid', 'false');
    field?.classList.add('is-valid');
  } else target.removeAttribute('aria-invalid');
}
function setFieldValidationError(control, message) {
  const target = fieldValidationTarget(control);
  const field = control.closest('.field') || target.closest('.field');
  if (!field) { showToast(message, 'error'); return; }
  clearFieldValidation(control);
  const error = document.createElement('span');
  error.className = 'field-error-message';
  error.id = `field-error-${control.id}`;
  error.setAttribute('role', 'alert');
  error.textContent = message;
  field.append(error);
  field.classList.add('has-error');
  target.setAttribute('aria-invalid', 'true');
  target.setAttribute('aria-errormessage', error.id);
  const descriptions = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  descriptions.add(error.id);
  target.setAttribute('aria-describedby', [...descriptions].join(' '));
}
function clearFormValidation(form) {
  form.querySelectorAll('.field-error-message').forEach((error) => error.remove());
  form.querySelectorAll('.field.has-error,.field.is-valid').forEach((field) => field.classList.remove('has-error', 'is-valid'));
  form.querySelectorAll('[aria-invalid],[aria-errormessage]').forEach((control) => {
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-errormessage');
    const descriptions = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && !id.startsWith('field-error-'));
    if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' '));
    else control.removeAttribute('aria-describedby');
  });
  delete form.dataset.validationAttempted;
}
function validateForm(form) {
  clearFormValidation(form);
  const invalidTargets = [];
  for (const control of form.querySelectorAll('input,select,textarea')) {
    if (control.type === 'hidden' || control.disabled || control.closest('[hidden]')) continue;
    const message = fieldValidationMessage(control);
    if (!message) continue;
    setFieldValidationError(control, message);
    invalidTargets.push(fieldValidationTarget(control));
  }
  if (invalidTargets.length) {
    invalidTargets[0].focus();
    invalidTargets[0].scrollIntoView({ block: 'nearest' });
    return false;
  }
  return true;
}
function refreshFieldValidation(control) {
  if (!control?.matches('input,select,textarea') || control.type === 'hidden') return;
  const field = control.closest('.field');
  if (!field) return;
  const message = fieldValidationMessage(control);
  if (field.classList.contains('has-error')) {
    if (message) setFieldValidationError(control, message);
    else clearFieldValidation(control, true);
  } else if (field.classList.contains('is-valid')) {
    if (message) {
      field.classList.remove('is-valid');
      fieldValidationTarget(control).removeAttribute('aria-invalid');
      if (control.form?.dataset.validationAttempted) setFieldValidationError(control, message);
    }
  } else if (message && control.form?.dataset.validationAttempted) setFieldValidationError(control, message);
}
function setupFormValidation() {
  for (const form of document.querySelectorAll('form')) {
    form.noValidate = true;
    form.addEventListener('reset', () => clearFormValidation(form));
    form.addEventListener('input', (event) => refreshFieldValidation(event.target));
    form.addEventListener('change', (event) => refreshFieldValidation(event.target));
    form.addEventListener('submit', (event) => {
      if (!validateForm(form)) {
        form.dataset.validationAttempted = 'true';
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }
}
function materialIcon(name, className = '') {
  return `<span class="material-icons ${className}" aria-hidden="true">${escapeHtml(name)}</span>`;
}
function categoryIcon(info, className) {
  const color=info.iconColor || info.color;
  return `<span class="material-icons ${className}" style="color:${color};background-color:${color}1a" aria-hidden="true">${escapeHtml(info.icon)}</span>`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function bankInfo(value) {
  const name = String(value || '').trim();
  if (name === OTHER_BANK_VALUE) return { key: 'other', name: 'Outro', generic: true, color: '#6541c8', surface: '#efeaff' };
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const known = BANK_DATA.find((item) => [item.name, ...item.aliases].some((alias) => alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR') === normalized));
  if (known) return known;
  const symbol = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('pt-BR') || '?';
  return { key: 'other', name: name || 'Banco ou emissor', symbol, generic: true, color: '#6541c8', surface: '#efeaff' };
}
function bankBadgeMarkup(bank, className = '') {
  const info = bankInfo(bank);
  const logo = info.icon ? `<img src="${escapeHtml(info.icon)}" alt="" draggable="false" />` : info.generic ? materialIcon('credit_card') : escapeHtml(info.symbol);
  return `<span class="bank-badge ${className}" data-bank-key="${escapeHtml(info.key)}" style="--bank-color:${info.color};--bank-surface:${info.surface}" title="${escapeHtml(info.name)}" role="img" aria-label="${escapeHtml(info.name)}">${logo}</span>`;
}
function syncBankPicker() {
  const select = $('card-bank');
  if (!select) return;
  const selected = select.value;
  $('card-bank-trigger').classList.toggle('is-placeholder', !selected);
  $('bank-selected-name').textContent = selected ? bankInfo(selected).name : 'Selecione um banco';
  $('card-bank-selected-icon').outerHTML = selected ? bankBadgeMarkup(selected, 'bank-badge-selected').replace('<span ', '<span id="card-bank-selected-icon" aria-hidden="true" ') : '<span class="bank-badge bank-badge-selected" id="card-bank-selected-icon" aria-hidden="true"></span>';
  $('bank-options').innerHTML = [...select.options].filter((option) => option.value).map((option) => `<div class="bank-picker-option" role="option" tabindex="-1" data-bank-option="${escapeHtml(option.value)}" aria-selected="${String(option.value === selected)}">${bankBadgeMarkup(option.value, 'bank-badge-option-icon').replace(' role="img"', ' aria-hidden="true"').replace(/ aria-label="[^"]*"/, '')}<span>${escapeHtml(bankInfo(option.value).name)}</span></div>`).join('');
}
function syncCardPicker() {
  const select = $('card-select');
  if (!select) return;
  const selectedCard = cardById(select.value);
  $('card-selected-name').textContent = selectedCard ? selectedCard.name : 'Cadastre um cartão primeiro';
  $('card-selected-bank').textContent = selectedCard ? bankInfo(selectedCard.bank).name : '';
  $('card-selected-icon').outerHTML = selectedCard ? bankBadgeMarkup(selectedCard.bank, 'card-picker-selected-icon').replace('<span ', '<span id="card-selected-icon" aria-hidden="true" ') : '<span class="bank-badge card-picker-selected-icon" id="card-selected-icon" aria-hidden="true"></span>';
  $('card-options').innerHTML = [...select.options].filter((option) => option.value).map((option) => {
    const card = cardById(option.value);
    return `<div class="card-picker-option" role="option" tabindex="-1" data-card-option="${escapeHtml(option.value)}" aria-selected="${String(option.value === select.value)}">${bankBadgeMarkup(card?.bank, 'card-picker-option-icon').replace(' role="img"', ' aria-hidden="true"').replace(/ aria-label="[^"]*"/, '')}<span class="card-picker-option-copy"><strong>${escapeHtml(card?.name || option.textContent)}</strong><small>${escapeHtml(bankInfo(card?.bank).name)}</small></span></div>`;
  }).join('');
}
function setupCardPicker() {
  const select = $('card-select'), picker = $('card-picker'), trigger = $('card-select-trigger'), options = $('card-options');
  const setOpen = (open, focusSelected = false) => {
    options.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open && focusSelected) (options.querySelector('[aria-selected="true"]') || options.querySelector('[role="option"]'))?.focus();
  };
  select.addEventListener('change', syncCardPicker);
  trigger.addEventListener('click', () => setOpen(options.hidden));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true, true); }
  });
  options.addEventListener('click', (event) => {
    const option = event.target.closest('[data-card-option]');
    if (!option) return;
    select.value = option.dataset.cardOption;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false); trigger.focus();
  });
  options.addEventListener('keydown', (event) => {
    const items = [...options.querySelectorAll('[role="option"]')], index = items.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.focus(); return; }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); return; }
    else return;
    event.preventDefault(); items[next]?.focus();
  });
  document.addEventListener('pointerdown', (event) => { if (!picker.contains(event.target)) setOpen(false); });
  syncCardPicker();
}
function setCardBankOptions(selectedBank = '') {
  const select = $('card-bank');
  select.innerHTML = '<option value="">Selecione um banco</option>' + BANK_DATA.map((bank) => `<option value="${escapeHtml(bank.name)}">${escapeHtml(bank.name)}</option>`).join('') + `<option value="${OTHER_BANK_VALUE}">Outro</option>`;
  const normalizedBank = String(selectedBank || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const knownBank = BANK_DATA.find((bank) => [bank.name, ...bank.aliases].some((alias) => alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR') === normalizedBank));
  select.value = selectedBank ? (knownBank?.name || OTHER_BANK_VALUE) : '';
  $('card-bank-other').value = selectedBank && !knownBank ? selectedBank : '';
  syncBankPicker();
  updateOtherBankField();
}
function updateOtherBankField() {
  const isOther = $('card-bank').value === OTHER_BANK_VALUE;
  $('other-bank-wrap').hidden = !isOther;
  $('card-bank-other').required = isOther;
}
function setupBankPicker() {
  const select = $('card-bank'), picker = $('bank-picker'), trigger = $('card-bank-trigger'), options = $('bank-options');
  const setOpen = (open, focusSelected = false) => {
    options.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    $('card-dialog').classList.toggle('bank-picker-open', open);
    if (open && focusSelected) (options.querySelector('[aria-selected="true"]') || options.querySelector('[role="option"]'))?.focus();
  };
  select.addEventListener('change', () => { syncBankPicker(); updateOtherBankField(); });
  trigger.addEventListener('click', () => setOpen(options.hidden));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true, true); }
  });
  options.addEventListener('click', (event) => {
    const option = event.target.closest('[data-bank-option]');
    if (!option) return;
    select.value = option.dataset.bankOption;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    setOpen(false); trigger.focus();
  });
  options.addEventListener('keydown', (event) => {
    const items = [...options.querySelectorAll('[role="option"]')], index = items.indexOf(document.activeElement);
    let next = index;
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.focus(); return; }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement.click(); return; }
    else return;
    event.preventDefault(); items[next]?.focus();
  });
  document.addEventListener('pointerdown', (event) => { if (!picker.contains(event.target)) setOpen(false); });
  syncBankPicker();
  updateOtherBankField();
}
function expenseLabel(charge) {
  const { expense, index } = charge;
  if (expense.recurring === true) return expense.type === 'income' ? 'Receita mensal' : expense.payment === 'Cartão' ? `Mensal · ${escapeHtml(cardForExpense(expense)?.name || 'Cartão')}` : expense.payment;
  if (expense.type === 'income') return expense.payment;
  const card = expense.payment === 'Cartão' ? cardForExpense(expense) : null;
  const cardLabel = card ? ` · ${escapeHtml(card.name)}` : '';
  return Number(expense.installments) > 1 ? `${index + 1}/${expense.installments} parcela${cardLabel}` : (expense.payment === 'Cartão' ? `${expense.cardMode || 'À vista'}${cardLabel}` : expense.payment);
}
function renderExpenseRow(charge, actions = false, categoryShare = null) {
  const income = charge.expense.type === 'income';
  const info = category(charge.expense.category, income ? 'income' : 'expense');
  const paymentCard = charge.expense.payment === 'Cartão' ? cardForExpense(charge.expense) : null;
  const cashStatus = realizationMarkup(charge, actions);
  const isPaid = charge.expense.payment === 'Cartão' ? charge.remaining <= 0 : cashStatus.paid;
  const isOverdue = !isPaid && paymentCard?.dueDay && Core.isChargeOverdue(charge.date, paymentCard.dueDay, localDateKey());
  const fixedStatus = charge.expense.recurring === true ? '<span class="fixed-tag">Fixo mensal</span>' : '';
  const paymentStatus = charge.expense.payment !== 'Cartão' ? cashStatus.badge : isPaid ? '<span class="paid-tag">Liquidado</span>' : isOverdue ? '<span class="overdue-tag">Vencido</span>' : '';
  const categoryShareMarkup = categoryShare === null ? '' : `<div class="category-share" role="img" aria-label="${escapeHtml(charge.expense.description)} corresponde a ${categoryShare.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da categoria ${escapeHtml(charge.expense.category || 'Outros')}"><span class="category-share-track" aria-hidden="true"><i style="width:${categoryShare}%;background:${info.color}"></i></span><span class="category-share-label">${categoryShare.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da categoria</span></div>`;
  const settleButton = actions && !income && charge.expense.payment === 'Cartão' && charge.remaining > 0
    ? `<button class="row-settle-button" data-pay-charge="${escapeHtml(charge.expense.id)}::${charge.index}" aria-label="Liquidar ${escapeHtml(charge.expense.description)}, ${charge.expense.recurring === true ? monthLabel(monthKey(charge.date)) : `parcela ${charge.index + 1}`}">Liquidar</button>` : charge.expense.payment !== 'Cartão' ? cashStatus.button : '';
  return `<div class="expense-row">
    ${categoryIcon(info, 'expense-emoji')}
    <div class="expense-name"><strong>${escapeHtml(charge.expense.description)}</strong><span>${escapeHtml(charge.expense.category)} · ${escapeHtml(expenseLabel(charge))}${charge.expense.notes ? ` · ${escapeHtml(charge.expense.notes)}` : ''} ${fixedStatus} ${paymentStatus}</span>${categoryShareMarkup}</div>
    ${actions ? `<span class="row-date">${dateLabel(charge.date)}</span><span class="row-payment"><span class="record-kind ${income ? 'income-kind' : 'expense-kind'}">${income ? 'Receita' : 'Despesa'}</span><small>${escapeHtml(charge.expense.payment)}</small></span><strong class="expense-value ${income ? 'income-value' : ''}">${currency.format(charge.remaining > 0 ? charge.remaining : charge.amount)}</strong><div class="row-actions">${settleButton}<button class="icon-button" aria-label="Editar ${escapeHtml(charge.expense.description)}" data-edit="${escapeHtml(charge.expense.id)}">${materialIcon('edit')}</button><button class="icon-button delete" aria-label="Excluir ${escapeHtml(charge.expense.description)}" data-delete="${escapeHtml(charge.expense.id)}">${materialIcon('close')}</button></div>` : `<strong class="expense-value">${currency.format(charge.amount)}</strong>`}
  </div>`;
}
function renderOverview() {
  const summary = Core.monthlyOverview(expenses, settlements, selectedMonth());
  const { charges, total, pix, cash, card } = summary;
  const average = Core.averageChargeSummary(charges);
  const balance = Core.monthlyBalance(expenses, settlements, selectedMonth());
  const commitment = Core.incomeCommitmentSummary(balance.income, balance.expenses);
  $('income-total').textContent = currency.format(balance.income);
  $('balance-expenses').textContent = currency.format(balance.expenses);
  $('month-balance').textContent = currency.format(balance.balance);
  $('month-balance').className = balance.balance < 0 ? 'negative-balance' : 'income-value';
  const commitmentPanel = $('income-commitment');
  const commitmentPercent = commitment.percent;
  const commitmentBar = Math.min(100, Math.max(0, commitmentPercent || 0));
  commitmentPanel.classList.toggle('is-near', commitmentPercent !== null && commitmentPercent >= 80 && commitmentPercent <= 100);
  commitmentPanel.classList.toggle('is-over', commitmentPercent !== null && commitmentPercent > 100);
  commitmentPanel.classList.toggle('is-empty', commitmentPercent === null);
  $('income-commitment-rate').textContent = commitmentPercent === null ? '—' : `${commitmentPercent.toLocaleString('pt-BR')}%`;
  $('income-commitment-bar').style.width = `${commitmentBar}%`;
  const commitmentProgress = commitmentPanel.querySelector('[role="progressbar"]');
  commitmentProgress.setAttribute('aria-valuenow', String(commitmentBar));
  commitmentProgress.setAttribute('aria-valuetext', commitmentPercent === null ? 'Sem receitas previstas' : `${commitmentPercent.toLocaleString('pt-BR')}% da renda prevista comprometida`);
  $('income-commitment-note').textContent = commitmentPercent === null
    ? balance.expenses ? 'Cadastre receitas previstas para medir o peso das despesas na sua renda.' : 'Cadastre receitas e despesas para acompanhar a renda comprometida.'
    : commitment.remaining < 0 ? 'As despesas previstas superam a renda prevista.'
      : commitment.remaining === 0 ? 'Toda a renda prevista está comprometida com despesas.'
        : commitmentPercent >= 80 ? 'Atenção: grande parte da renda prevista está comprometida.'
          : 'Parte da renda prevista permanece livre após as despesas.';
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
  $('payment-foot').textContent = total ? 'Os valores e percentuais mostram como as despesas previstas estão distribuídas entre as formas de pagamento.' : 'Registre despesas para comparar Pix, dinheiro e cartão.';
  const breakdown = Core.monthlyCategoryBreakdown(expenses, settlements, selectedMonth());
  renderExpenseCategoryPie(breakdown.expense);
  renderCategoryChart('category-list', breakdown.expense, 'expense');
  renderCategoryChart('income-category-list', breakdown.income, 'income');
  $('expense-category-context').textContent = `Percentuais sobre ${currency.format(breakdown.expense.total)} em despesas neste mês.`;
  $('income-category-context').textContent = `Percentuais sobre ${currency.format(breakdown.income.total)} em receitas neste mês.`;
  const recentLimit = Math.max(5, breakdown.expense.categories.length);
  const recentCharges = [...charges].sort((a, b) => b.date - a.date
    || expenses.findIndex(entry=>entry.id===b.expense.id) - expenses.findIndex(entry=>entry.id===a.expense.id)
    || b.index - a.index);
  $('recent-list').innerHTML = recentCharges.length ? recentCharges.slice(0, recentLimit).map((charge) => renderExpenseRow(charge)).join('') : '<p class="empty-note">Comece adicionando seu primeiro gasto.</p>';
  renderDashboardCards();
  renderInsights();
}
function renderCategoryChart(listId, summary, type) {
  const income = type === 'income';
  $(listId).innerHTML = summary.categories.length ? summary.categories.map(item => {
    const info = category(item.category, type);
    const percent = item.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    const baseLabel = income ? 'das receitas' : 'das despesas';
    return `<div class="category-item" role="img" aria-label="${escapeHtml(item.category)}, ${currency.format(item.amount)}, ${percent}% ${baseLabel} do mês"><div class="category-chart-meta">${categoryIcon(info, 'category-emoji')}<span class="category-name">${escapeHtml(item.category)}</span><strong class="category-amount">${currency.format(item.amount)}</strong><span class="category-share">${percent}%</span></div><div class="category-track"><i style="width:${summary.total ? item.amount / summary.total * 100 : 0}%;background:${info.color}"></i></div></div>`;
  }).join('') : `<p class="empty-note">${income ? 'Nenhuma receita neste mês.' : 'Nenhuma despesa registrada neste mês.'}</p>`;
}
function renderExpenseCategoryPie(summary) {
  const categories = summary.categories;
  const svg = $('expense-category-pie');
  const circumference = 2 * Math.PI * 96;
  let offset = 0;
  const slices = categories.map(item => {
    const share = summary.total ? item.amount / summary.total : 0;
    const length = circumference * share;
    const color = category(item.category, 'expense').color;
    const percent = summary.total ? (item.amount / summary.total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0';
    const sliceLabel = `${item.category}: ${currency.format(item.amount)}, ${percent}% das despesas`;
    const slice = `<circle class="category-pie-slice" data-category="${escapeHtml(item.category)}" data-amount="${item.amount}" data-percent="${percent}" cx="140" cy="140" r="96" fill="none" stroke="${color}" stroke-width="44" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 140 140)" tabindex="0" role="img" aria-label="${escapeHtml(sliceLabel)}"><title>${escapeHtml(sliceLabel)}</title></circle>`;
    offset += length;
    return slice;
  });
  const chartDescription = summary.total
    ? `Despesas previstas por categoria: ${categories.map(item => `${item.category}, ${currency.format(item.amount)}, ${(item.amount / summary.total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`).join('; ')}`
    : 'Nenhuma despesa prevista por categoria neste mês.';
  svg.setAttribute('aria-label', chartDescription);
  svg.dataset.total = String(summary.total);
  svg.innerHTML = `<title>${escapeHtml(chartDescription)}</title>${summary.total ? slices.join('') : '<circle class="category-pie-empty" cx="140" cy="140" r="96"></circle>'}`;
  $('commitment-pie-total').textContent = currency.format(summary.total);
  $('category-pie-center-category').textContent = summary.total ? 'Total das despesas' : 'Sem despesas previstas';
  $('category-pie-center-amount').textContent = currency.format(summary.total);
  $('category-pie-center-details').textContent = summary.total ? '100% do total mensal' : 'No mês selecionado';
  $('category-pie-legend').innerHTML = categories.length ? categories.map(item => {
    const percent = summary.total ? (item.amount / summary.total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '0';
    const color = category(item.category, 'expense').color;
    return `<div class="category-pie-item"><i style="background:${color}" aria-hidden="true"></i><span title="${escapeHtml(item.category)}">${escapeHtml(item.category)}</span><strong>${currency.format(item.amount)}</strong><small>${percent}%</small></div>`;
  }).join('') : '<p class="commitment-pie-empty-note">Nenhuma despesa prevista neste mês.</p>';
}
function updateCategoryPieCenter(slice) {
  if (!slice) {
    const total = Number($('expense-category-pie').dataset.total || 0);
    $('category-pie-center-category').textContent = total ? 'Total das despesas' : 'Sem despesas previstas';
    $('category-pie-center-amount').textContent = currency.format(total);
    $('category-pie-center-details').textContent = total ? '100% do total mensal' : 'No mês selecionado';
    return;
  }
  $('category-pie-center-category').textContent = slice.dataset.category;
  $('category-pie-center-amount').textContent = currency.format(Number(slice.dataset.amount));
  $('category-pie-center-details').textContent = `${slice.dataset.percent}% das despesas`;
}
function setupCategoryPieInteraction() {
  const chart = $('expense-category-pie');
  chart.addEventListener('pointerover', event => updateCategoryPieCenter(event.target.closest('.category-pie-slice')));
  chart.addEventListener('pointerleave', () => updateCategoryPieCenter(null));
  chart.addEventListener('focusin', event => updateCategoryPieCenter(event.target.closest('.category-pie-slice')));
  chart.addEventListener('focusout', event => { if (!chart.contains(event.relatedTarget)) updateCategoryPieCenter(null); });
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
    return `<article class="dashboard-card">${bankBadgeMarkup(card.bank, 'dashboard-bank-badge')}<div class="dashboard-card-info"><strong>${escapeHtml(card.name)}</strong><span>${escapeHtml(card.bank)} · ${card.dueDay ? `vence dia ${card.dueDay}` : 'vencimento não informado'}</span></div><strong class="dashboard-card-available">${currency.format(available)}<small> disponível</small></strong><div class="card-progress"><i style="width:${percent}%"></i></div></article>`;
  }).join('');
}
function validateTransactionRange() {
  const minAmount = $('amount-min').value.trim() ? parseCurrencyInput($('amount-min').value) : null;
  const maxAmount = $('amount-max').value.trim() ? parseCurrencyInput($('amount-max').value) : null;
  const invalidRange = minAmount !== null && maxAmount !== null && minAmount > maxAmount;
  $('amount-range-error').hidden = !invalidRange;
  for (const id of ['amount-min', 'amount-max']) {
    $(id).setAttribute('aria-invalid', String(invalidRange));
    if (invalidRange) $(id).setAttribute('aria-describedby', 'amount-range-error');
    else $(id).removeAttribute('aria-describedby');
  }
  return { minAmount, maxAmount, invalidRange };
}
function setTransactionsLoading(loading) {
  const container = $('transactions-results');
  const list = $('transactions-list');
  const wasLoading = container.classList.contains('is-filtering');
  if (loading && !wasLoading) {
    const count = Math.max(1, list.querySelectorAll('.expense-row').length);
    $('transactions-skeleton').innerHTML = Array.from({ length: count }, () => '<div class="skeleton-row"><span class="skeleton-block skeleton-icon"></span><div class="skeleton-description"><span class="skeleton-block skeleton-title"></span><span class="skeleton-block skeleton-detail"></span></div><span class="skeleton-block skeleton-amount"></span></div>').join('');
  }
  container.classList.toggle('is-filtering', loading);
  container.setAttribute('aria-busy', String(loading));
  $('transactions-skeleton').hidden = !loading;
  list.inert = loading;
  list.setAttribute('aria-busy', String(loading));
  if (loading) list.setAttribute('aria-hidden', 'true'); else list.removeAttribute('aria-hidden');
  if (loading !== wasLoading) $('transactions-loading-status').textContent = loading ? 'Atualizando lançamentos…' : '';
}
function scheduleTransactionFilters() {
  clearTimeout(transactionFilterTimer);
  transactionPage = 1;
  setTransactionsLoading(true);
  transactionFilterTimer = setTimeout(renderTransactions, TRANSACTION_FILTER_PAUSE);
}
function renderTransactions() {
  clearTimeout(transactionFilterTimer);
  transactionFilterTimer = null;
  const { minAmount, maxAmount, invalidRange } = validateTransactionRange();
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
  const markup = page.items.length ? page.items.map((charge) => renderExpenseRow(charge, true, shareByCharge.get(`${charge.expense.id}::${charge.index}`) ?? 0)).join('') : `<p class="empty-note">${invalidRange ? 'Corrija o intervalo de valores para visualizar os lançamentos.' : hasFilters ? 'Nenhum lançamento deste mês combina com a busca e os filtros.' : 'Ainda não há registros neste mês.'}</p>`;
  if (markup !== lastTransactionMarkup) {
    $('transactions-list').innerHTML = markup;
    lastTransactionMarkup = markup;
  }
  const firstItem = page.totalItems ? (page.page - 1) * page.pageSize + 1 : 0;
  const lastItem = page.totalItems ? firstItem + page.items.length - 1 : 0;
  $('transactions-count').textContent = invalidRange ? 'Intervalo de valores inválido' : page.totalItems ? `Exibindo ${firstItem}–${lastItem} de ${page.totalItems} lançamentos` : 'Nenhum lançamento neste mês';
  $('page-indicator').textContent = `${page.page} / ${page.totalPages}`;
  $('previous-page').disabled = page.page <= 1;
  $('next-page').disabled = page.page >= page.totalPages;
  $('page-size').value = String(transactionPageSize);
  setTransactionsLoading(false);
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
  return `<article class="credit-card-card" data-card-id="${escapeHtml(card.id)}">
    <div class="credit-card-top">${bankBadgeMarkup(card.bank, 'credit-bank-badge')}<div class="credit-card-title"><h3>${escapeHtml(card.name)}</h3><span>${escapeHtml(card.bank)} · ${card.dueDay ? `vence dia ${card.dueDay}` : 'vencimento não informado'}</span></div><div class="card-actions"><button class="icon-button" aria-label="Editar ${escapeHtml(card.name)}" data-edit-card="${escapeHtml(card.id)}">${materialIcon('edit')}</button><button class="icon-button delete" aria-label="Excluir ${escapeHtml(card.name)}" data-delete-card="${escapeHtml(card.id)}">${materialIcon('close')}</button></div></div>
    <div class="limit-line"><span>Limite utilizado</span><strong>${currency.format(used)} <small>de ${currency.format(limit)}</small></strong></div>
    <div class="card-progress large-progress"><i style="width:${percentage}%"></i></div>
    <div class="limit-foot"><span>Disponível</span><strong class="${available < 0 ? 'over-limit' : ''}">${currency.format(available)}</strong></div>
    <div class="bill-heading"><div><span class="bill-period"><span>Fatura de ${escapeHtml(monthLabel(selectedMonth()))}</span>${bankBadgeMarkup(card.bank, 'invoice-bank-badge')}</span><strong>${currency.format(due)}</strong></div><button class="add-button pay-bill-button" data-pay-bill="${escapeHtml(card.id)}" ${due <= 0 ? 'disabled' : ''}>Liquidar fatura</button></div>
    <div class="bill-lines">${rows}</div>
    ${unpaid.length ? `<p class="card-footnote">Cada liquidação libera do limite o valor pago. O restante em aberto continua comprometido.</p>` : ''}
  </article>`;
}
function renderCards() {
  $('cards-list').innerHTML = cards.length ? cards.map(renderCardItem).join('') : `<div class="cards-empty">${materialIcon('credit_card', 'empty-card-icon')}<h3>Cadastre seu primeiro cartão</h3><p>Informe o limite e vincule novas compras para acompanhar uso e faturas.</p><button class="add-button" data-create-card>${materialIcon('add')} Adicionar cartão</button></div>`;
}
function alertDateLabel(value) { return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short'}).format(dateFromKey(value)).replace('.',''); }
function renderAlertItem(alert,index) {
  const isBudget=alert.kind==='budget-exceeded', isCard=alert.kind.startsWith('card-'), isIncome=alert.kind.startsWith('income-');
  const overdue=alert.severity==='overdue';
  const tone=isBudget?'budget':overdue?'overdue':'upcoming';
  const icon=isBudget?'account_balance_wallet':overdue?'error_outline':'schedule';
  let title,detail,action;
  if (isBudget) {
    title=`${alert.category} passou do limite planejado`;
    detail=`${currency.format(alert.spent)} utilizados de ${currency.format(alert.limit)} no mês selecionado.`;
    action='Ver orçamento';
  } else if (isCard) {
    const dateText=alertDateLabel(alert.dueDate);
    title=`Fatura ${alert.cardName} ${overdue?'está vencida':`vence em ${dateText}`}`;
    detail=`${alert.charges} cobrança${alert.charges===1?'':'s'} em aberto${overdue?` · venceu em ${dateText}`:''}.`;
    action='Ver cartão';
  } else {
    const typeName=isIncome?'Receita':'Despesa', dateText=alertDateLabel(alert.dueDate);
    if (isIncome) title=overdue?`Receita em atraso: ${alert.description}`:`Receita prevista para ${dateText}: ${alert.description}`;
    else title=overdue?`Despesa em atraso: ${alert.description}`:`Despesa vence em ${dateText}: ${alert.description}`;
    detail=`${alert.category}${alert.payment?` · ${alert.payment}`:''}${overdue?` · vencida em ${dateText}`:''}.`;
    action='Ver lançamento';
  }
  return `<article class="alert-item alert-item-${tone}"><span class="alert-item-icon"><span class="material-icons" aria-hidden="true">${icon}</span></span><div class="alert-item-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div><div class="alert-item-action"><strong>${currency.format(alert.amount)}</strong><button class="alert-action-button" type="button" data-alert-action="${index}">${action}<span class="material-icons" aria-hidden="true">arrow_forward</span></button></div></article>`;
}
function renderAlerts() {
  currentFinancialAlerts=Core.financialAlerts(expenses,settlements,cards,budgets,localDateKey(),selectedMonth());
  const groups={
    overdue:currentFinancialAlerts.filter(item=>item.severity==='overdue'),
    upcoming:currentFinancialAlerts.filter(item=>item.severity==='upcoming'),
    budget:currentFinancialAlerts.filter(item=>item.severity==='budget'),
  };
  const total=currentFinancialAlerts.length;
  $('alert-count').textContent=String(total);
  $('alert-count').hidden=total===0;
  $('alert-overdue-count').textContent=String(groups.overdue.length);
  $('alert-upcoming-count').textContent=String(groups.upcoming.length);
  $('alert-budget-count').textContent=String(groups.budget.length);
  for (const [key,items] of Object.entries(groups)) {
    const group=$(key==='budget'?'alerts-budget-group':`alerts-${key}-group`);
    const list=$(key==='budget'?'alerts-budget':`alerts-${key==='overdue'?'overdue':'upcoming'}`);
    const count=$(key==='budget'?'alerts-budget-group-count':`alerts-${key}-group-count`);
    group.hidden=items.length===0;
    count.textContent=String(items.length);
    list.innerHTML=items.map(item=>renderAlertItem(item,currentFinancialAlerts.indexOf(item))).join('');
  }
  $('alerts-budget-period').textContent=`Orçamentos de ${monthLabel(selectedMonth())}.`;
  $('alerts-empty').hidden=total>0;
  $('alerts-groups').hidden=total===0;
}
function openAlertContext(alert) {
  if (alert.month) $('month-picker').value=alert.month;
  if (alert.kind==='budget-exceeded') {
    setPaymentsMenuExpanded(true); view='orcamentos'; render(); return;
  }
  if (alert.kind.startsWith('card-')) {
    setPaymentsMenuExpanded(true); view='cartoes'; render();
    const card=[...$('cards-list').querySelectorAll('[data-card-id]')].find(item=>item.dataset.cardId===alert.cardId);
    if (card) { card.scrollIntoView({behavior:'smooth',block:'center'}); card.classList.add('alert-focus'); setTimeout(()=>card.classList.remove('alert-focus'),2200); }
    return;
  }
  $('search-input').value=alert.description||'';
  $('sort-order').value='date-desc'; $('type-filter').value=alert.kind.startsWith('income-')?'income':'expense';
  updateCategoryFilter(); updatePaymentFilter(); $('category-filter').value=''; $('payment-filter').value='';
  $('amount-min').value=''; $('amount-max').value=''; transactionPage=1;
  view='lancamentos'; render();
}
function render() {
  $('month-picker').setAttribute('aria-label', `Mês de referência: ${monthLabel(selectedMonth())}`);
  const selectedMonthLabel = monthLabel(selectedMonth());
  const selectedMonthTitle = selectedMonthLabel.charAt(0).toLocaleUpperCase('pt-BR') + selectedMonthLabel.slice(1);
  $('month-long-label').textContent = selectedMonthTitle;
  $('month-long-label').hidden = false;
  $('page-top-title').textContent = view === 'inicio' ? 'Visão geral' : view === 'cartoes' ? 'Cartões' : view === 'orcamentos' ? 'Orçamentos' : view === 'analises' ? 'Análises' : view === 'alertas' ? 'Alertas' : 'Lançamentos';
  document.querySelector('.app-shell').classList.toggle('transactions-active', view === 'lancamentos');
  document.querySelector('.app-shell').classList.add('page-title-active');
  $('date-greeting').textContent = `SEU RESUMO DE ${monthLabel(selectedMonth())}`;
  $('page-heading').hidden = true;
  $('overview-view').hidden = view !== 'inicio';
  $('transactions-view').hidden = view !== 'lancamentos';
  $('analytics-view').hidden = view !== 'analises';
  $('cards-view').hidden = view !== 'cartoes';
  $('budget-view').hidden = view !== 'orcamentos';
  $('alerts-view').hidden = view !== 'alertas';
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  const paymentsActive=view==='cartoes'||view==='orcamentos';
  $('payments-nav').classList.toggle('has-active-view',paymentsActive);
  $('payments-toggle').classList.toggle('active',paymentsActive);
  renderOverview();
  updateCategoryFilter(); updatePaymentFilter();
  renderTransactions();
  renderCards();
  renderAlerts();
}
function activateViewTab(tab, moveFocus = false) {
  const tablist = tab.closest('[role="tablist"]');
  if (!tablist) return;
  const panelIds = [...tablist.querySelectorAll('[role="tab"]')].map(item => item.getAttribute('aria-controls'));
  tablist.querySelectorAll('[role="tab"]').forEach(item => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  panelIds.forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = id !== tab.getAttribute('aria-controls');
  });
  if (moveFocus) tab.focus();
}
function setupViewTabs() {
  document.querySelectorAll('[role="tablist"]').forEach(tablist => {
    tablist.addEventListener('click', event => {
      const tab = event.target.closest('[role="tab"]');
      if (tab && tablist.contains(tab)) activateViewTab(tab);
    });
    tablist.addEventListener('keydown', event => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      const nextIndex = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (nextIndex < 0) return;
      event.preventDefault();
      activateViewTab(tabs[nextIndex], true);
    });
  });
}
function deleteIncome(id) {
  const entry = expenses.find((item) => item.id === id && item.type === 'income');
  if (!entry) return;
  openDeleteConfirmation({ title: 'Excluir registro?', message: `“${entry.description}” ${entry.recurring === true ? 'e todas as suas ocorrências mensais serão removidas' : 'será removida'} e o saldo será recalculado. Essa ação não pode ser desfeita.`, confirmLabel: 'Excluir registro', onConfirm: () => {
    expenses = expenses.filter((item) => item.id !== id);
    settlements = settlements.filter(item=>item.expenseId!==id);
    saveExpenses(); saveSettlements(); render(); showToast('Registro excluído.', 'success');
  } });
}
function populateCardSelect(select, excludeId = '') {
  const eligible = cards.filter((card) => card.id !== excludeId);
  select.innerHTML = eligible.length ? eligible.map((card) => `<option value="${escapeHtml(card.id)}">${escapeHtml(card.name)} · ${escapeHtml(card.bank)}</option>`).join('') : '<option value="">Cadastre um cartão primeiro</option>';
  syncCardPicker();
}
function openExpense(expense = null, scope = 'series') {
  const root = expense;
  const monthOnly = root?.recurring === true && scope === 'month';
  const index = root ? occurrenceIndex(root) : 0;
  if (monthOnly) expense = Core.occurrenceEntry(root,index);
  $('expense-form').reset();
  $('edit-scope-wrap').hidden = root?.recurring !== true;
  $('edit-scope').value = scope;
  $('recurring-record').disabled = monthOnly;
  document.querySelectorAll('input[name="record-type"]').forEach(input=>{input.disabled=monthOnly;});
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
  $('first-date').value = monthOnly ? localDateKey(Core.occurrenceDate(root,index)) : expense?.firstDate || localDateKey();
  $('notes').value = expense?.notes || '';
  $('dialog-title').textContent = expense ? 'Editar registro' : 'Novo registro';
  $('save-expense').textContent = expense ? 'Salvar alterações' : 'Salvar registro';
  updatePaymentFields();
  $('record-status').value = expense ? ((monthOnly ? Core.realizedAmount(root,index,settlements)>0 : (expense.recurring === true ? expense.status === 'realized' : expense.status !== 'planned')) ? 'realized' : 'planned') : 'realized';
  updateRecordStatus();
  if (!$('expense-dialog').open) $('expense-dialog').showModal();
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
  $('card-select-trigger').disabled = isCard && cards.length === 0;
  syncCardPicker();
  $('installment-hint').hidden = !isInstallment;
  updateRecordStatus();
  if ($('edit-scope').value === 'month' && existing?.recurring) $('recurring-hint').textContent = `Somente ${monthLabel(selectedMonth())} será alterado. Os demais meses e seus pagamentos serão preservados.`;
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
  if (payment === 'Cartão' && !chosenCard) {
    setFieldValidationError(cards.length ? $('card-select') : $('payment'), cards.length ? FIELD_ERROR_MESSAGES['card-select'] : 'Cadastre um cartão antes de registrar uma compra no crédito.');
    return;
  }
  const cardMode = payment === 'Cartão' ? recurring ? 'À vista' : $('card-mode').value : '';
  const installments = payment === 'Cartão' && cardMode === 'Parcelado' ? Number($('installments').value) : 1;
  const amount = Math.round(parseCurrencyInput($('amount').value) * 100) / 100;
  if (!(amount > 0)) { setFieldValidationError($('amount'), FIELD_ERROR_MESSAGES.amount); return; }
  if (previous?.recurring === true && $('edit-scope').value === 'month') { submitMonthlyOverride(previous, amount, chosenCard); return; }
  const expense = {
    ...previous,
    id: $('expense-id').value || createId('expense'), description: $('description').value.trim(), amount,
    category: $('category').value, payment, cardId, card: chosenCard?.name || '', cardMode, installments,
    firstDate: $('first-date').value, notes: $('notes').value.trim(), type, recurring, status: payment==='Cartão' ? 'planned' : previous?.recurring === true ? previous.status || 'planned' : $('record-status').value, recurringUntil,
  };
  if (!expense.description) { setFieldValidationError($('description'), FIELD_ERROR_MESSAGES.description); return; }
  if (expense.status === 'realized' && expense.firstDate > localDateKey()) { setFieldValidationError($('first-date'), 'A data do registro não pode ser futura quando ele já está pago ou recebido.'); return; }
  if (recurringUntil && expense.firstDate.slice(0,7) > recurringUntil) { setFieldValidationError($('first-date'), 'A data inicial precisa ser anterior ao encerramento da repetição.'); return; }
  if (previous?.recurring === true && recurringUntil && settlements.some(payment => payment.expenseId === previous.id && monthKey(Core.installmentDate(previous.firstDate, Number(payment.installmentIndex))) > recurringUntil)) { showToast('Há liquidações posteriores a esse mês. Encerre a repetição no último mês já liquidado ou depois dele.', 'error'); return; }
  const existing = expenses.findIndex((item) => item.id === expense.id);
  const authorizedEdit = existing >= 0 && settlementResetOnSave === expense.id;
  const financialState = entry => JSON.stringify([Math.round(Number(entry.amount) * 100), entry.firstDate, entry.payment, entry.cardId || '', entry.type || 'expense', Number(entry.installments) || 1, entry.recurring === true]);
  const financialChange = previous && financialState(previous) !== financialState(expense);
  const resetsSettlements = authorizedEdit && (!previous?.recurring || financialChange);
  if (existing >= 0 && settlements.some((item) => item.expenseId === expense.id) && !authorizedEdit) {
    showToast('Confirme a edição antes de salvar uma compra que já tem pagamentos.', 'error');
    return;
  }
  if (resetsSettlements) {
    settlements = settlements.filter((item) => item.expenseId !== expense.id);
    expense.status = 'planned';
    saveSettlements();
    settlementResetOnSave = null;
  }
  if (previous?.recurring !== true) {
    const realizationStates={...(expense.realizationStates||{})};
    if (expense.status==='realized') delete realizationStates['0'];
    else realizationStates['0']='planned';
    if (Object.keys(realizationStates).length) expense.realizationStates=realizationStates;
    else delete expense.realizationStates;
  }
  if (existing >= 0) expenses[existing] = expense; else expenses.push(expense);
  saveExpenses();
  $('expense-dialog').close();
  setMonth(previous?.recurring === true ? selectedMonth() : monthKey(dateFromKey(expense.firstDate)));
  showToast(resetsSettlements ? 'Registro atualizado. Os pagamentos anteriores foram removidos.' : existing >= 0 ? 'Registro atualizado.' : 'Registro salvo.', 'success');
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
      showToast('Registro excluído.', 'success');
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
    message: expense.recurring === true ? `No formulário, escolha somente este mês ou toda a série. Mudanças financeiras removem os pagamentos do período escolhido. Os demais meses são preservados ao editar somente este mês. Cancelar mantém todos os dados.` : `A edição de “${expense.description}” removerá ${linkedPayments.length} pagamento${linkedPayments.length === 1 ? '' : 's'} vinculado${linkedPayments.length === 1 ? '' : 's'} e a compra voltará a ficar em aberto. Se você fechar o formulário sem salvar, os pagamentos serão mantidos.`,
    confirmLabel: expense.recurring === true ? 'Editar registro' : 'Editar compra',
    confirmClass: 'add-button',
    onConfirm: () => { settlementResetOnSave = expense.id; openExpense(expense); },
  });
}
function openCardDialog(card = null) {
  $('card-form').reset();
  $('card-id').value = card?.id || '';
  $('card-name').value = card?.name || '';
  setCardBankOptions(card?.bank || '');
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
  const selectedBank = $('card-bank').value;
  const bank = selectedBank === OTHER_BANK_VALUE ? $('card-bank-other').value.trim() : bankInfo(selectedBank).name;
  const limit = Math.round(parseCurrencyInput($('card-limit').value) * 100) / 100;
  const dueDay = Number($('card-due-day').value);
  if (!name) { setFieldValidationError($('card-name'), FIELD_ERROR_MESSAGES['card-name']); return; }
  if (!selectedBank) { setFieldValidationError($('card-bank'), FIELD_ERROR_MESSAGES['card-bank']); return; }
  if (selectedBank === OTHER_BANK_VALUE && !bank) { setFieldValidationError($('card-bank-other'), FIELD_ERROR_MESSAGES['card-bank-other']); return; }
  if (!(limit > 0)) { setFieldValidationError($('card-limit'), FIELD_ERROR_MESSAGES['card-limit']); return; }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) { setFieldValidationError($('card-due-day'), FIELD_ERROR_MESSAGES['card-due-day']); return; }
  const id = $('card-id').value || createId('card');
  if (cards.some((card) => card.id !== id && card.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) { setFieldValidationError($('card-name'), 'Já existe um cartão com esse nome.'); return; }
  const updated = { id, name, bank, limit, dueDay };
  const index = cards.findIndex((card) => card.id === id);
  if (index >= 0) cards[index] = updated; else cards.push(updated);
  for (const expense of expenses) if (expense.cardId === id) expense.card = name;
  saveCards(); saveExpenses();
  $('card-dialog').close();
  render();
  showToast(index >= 0 ? 'Cartão atualizado.' : 'Cartão salvo.', 'success');
}
function deleteCard(id) {
  const card = cardById(id);
  if (!card) return;
  if (expenses.some((expense) => expense.cardId === id) || settlements.some((payment) => payment.sourceCardId === id || payment.targetCardId === id)) { showToast('Este cartão ainda está vinculado a compras ou pagamentos. Remova esses vínculos antes de excluí-lo.', 'error'); return; }
  openDeleteConfirmation({
    title: 'Excluir cartão?',
    message: `O cartão “${card.name}” será removido. Essa ação não pode ser desfeita.`,
    confirmLabel: 'Excluir cartão',
    onConfirm: () => {
      cards = cards.filter((item) => item.id !== id);
      saveCards(); render(); showToast('Cartão excluído.', 'success');
    },
  });
}
function startSettlement(charges) {
  const payable = charges.filter((charge) => charge.remaining > 0);
  if (!payable.length) { showToast('Não há cobranças em aberto para liquidar.', 'info'); return; }
  const targetCardId = payable[0].expense.cardId;
  if (payable.some((charge) => charge.expense.cardId !== targetCardId)) { showToast('Selecione cobranças de um único cartão para liquidar a fatura.', 'error'); return; }
  settlementTarget = { cardId: targetCardId, month: selectedMonth(), charges: payable.map((charge) => ({ expenseId: charge.expense.id, installmentIndex: charge.index })) };
  clearFormValidation($('settlement-form'));
  const total = payable.reduce((sum, charge) => sum + charge.remaining, 0);
  $('settlement-summary').textContent = `${cardById(targetCardId)?.name || 'Cartão'} · ${monthLabel(selectedMonth())} · ${currency.format(total)}${payable.length === 1 ? ' nesta cobrança' : ` em ${payable.length} cobranças`}`;
  populateCardSelect($('funding-card'), targetCardId);
  updateSettlementMethod();
  $('settlement-dialog').showModal();
}
function startSettlementForCharge(expenseId, installmentIndex) {
  const expense = expenses.find((item) => item.id === expenseId);
  if (!expense) return;
  const effective = Core.occurrenceEntry(expense,Number(installmentIndex));
  if (effective.payment !== 'Cartão') return;
  const charge = chargesForMonth(selectedMonth(), effective.cardId).filter((item) => item.expense.id === expenseId && item.index === Number(installmentIndex));
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
  if (method === 'Cartão' && !sourceCard) {
    const hasOtherCard = cards.some((card) => card.id !== targetCard?.id);
    setFieldValidationError(hasOtherCard ? $('funding-card') : $('settlement-method'), hasOtherCard ? FIELD_ERROR_MESSAGES['funding-card'] : 'Cadastre outro cartão antes de escolher essa forma de pagamento.');
    return;
  }
  if (method === 'Cartão' && sourceCard.id === targetCard?.id) { setFieldValidationError($('funding-card'), 'Use um cartão diferente daquele cuja fatura está sendo paga.'); return; }
  const payable = settlementTarget.charges.map((item) => {
    const root = expenses.find((entry) => entry.id === item.expenseId);
    const expense = root && Core.occurrenceEntry(root,item.installmentIndex);
    const remaining = expense ? chargeRemaining(expense, item.installmentIndex) : 0;
    return expense ? { ...item, expense, index: item.installmentIndex, amount: remaining, remaining } : null;
  }).filter((item) => item && item.amount > 0);
  const total = payable.reduce((sum, item) => sum + item.amount, 0);
  if (!total) { $('settlement-dialog').close(); render(); showToast('Essas cobranças já foram liquidadas.', 'info'); return; }
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
  showToast(`Pagamento de ${currency.format(total)} registrado via ${method}.`, 'success');
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ app: 'MeuGasto', version: 3, exportedAt: new Date().toISOString(), expenses, cards, settlements, budgets }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `meugasto-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Backup baixado.', 'success');
}
async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.expenses;
    const incomingCards = Array.isArray(parsed.cards) ? parsed.cards : [];
    const incomingSettlements = Array.isArray(parsed.settlements) ? parsed.settlements : [];
    if (!Array.isArray(incoming) || !incoming.every(isValidExpense) || !incomingCards.every((card) => card && typeof card.id === 'string' && Number.isFinite(Number(card.limit)))) throw new Error('invalid');
    if ((expenses.length || cards.length) && !window.confirm('Importar este backup vai substituir registros, cartões e pagamentos salvos neste PC. Continuar?')) return;
    if (parsed.budgets !== undefined && (!Array.isArray(parsed.budgets) || !parsed.budgets.every(validBudget))) throw new Error('invalid');
    expenses = incoming; cards = incomingCards; settlements = incomingSettlements; budgets = parsed.budgets || [];
    saveBudgets();
    migrateLegacyCardLinks();
    saveExpenses(); saveCards(); saveSettlements(); render();
    showToast('Backup importado.', 'success');
  } catch { showToast('Não foi possível importar esse arquivo. Confira se ele foi exportado pelo MeuGasto e tente novamente.', 'error'); }
  finally { $('import-file').value = ''; }
}
function initialize() {
  setupFormValidation();
  setupEnhancements();
  setupViewTabs();
  setupCategoryPieInteraction();
  $('sidebar-toggle').addEventListener('click', () => setSidebarCollapsed(!document.querySelector('.app-shell').classList.contains('sidebar-collapsed')));
  $('month-picker').value = monthKey(new Date());
  $('category').innerHTML = CATEGORY_DATA.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  setupCategoryPicker();
  setupPaymentPicker();
  setupBankPicker();
  setupCardPicker();
  $('alerts-view').addEventListener('click',event=>{const button=event.target.closest('[data-alert-action]');if (!button) return;const alert=currentFinancialAlerts[Number(button.dataset.alertAction)];if (alert) openAlertContext(alert);});
  updateCategoryFilter(); updatePaymentFilter();
  $('installments').innerHTML = Array.from({ length: 35 }, (_, index) => `<option value="${index + 2}">${index + 2}x</option>`).join('');
  populateCardSelect($('card-select'));
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { view = button.dataset.view; if (view==='cartoes'||view==='orcamentos') setPaymentsMenuExpanded(true); render(); }));
  $('new-expense').addEventListener('click', () => openExpense());
  $('manage-income').addEventListener('click', () => { view = 'lancamentos'; $('clear-filters').click(); render(); });
  document.querySelectorAll('input[name="record-type"]').forEach(input => input.addEventListener('change', () => updateRecordType()));
  $('new-card').addEventListener('click', () => openCardDialog());
  $('all-categories').addEventListener('click', () => showCategoryTransactions('expense'));
  $('all-income-categories').addEventListener('click', () => showCategoryTransactions('income'));
  $('all-transactions').addEventListener('click', () => { view = 'lancamentos'; render(); });
  $('prev-month').addEventListener('click', () => { const date = dateFromKey(`${selectedMonth()}-01`); date.setMonth(date.getMonth() - 1); transactionPage = 1; setMonth(monthKey(date)); });
  $('next-month').addEventListener('click', () => { const date = dateFromKey(`${selectedMonth()}-01`); date.setMonth(date.getMonth() + 1); transactionPage = 1; setMonth(monthKey(date)); });
  $('month-picker').addEventListener('change', () => { transactionPage = 1; render(); });
  $('search-input').addEventListener('input', scheduleTransactionFilters);
  $('search-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); transactionPage = 1; renderTransactions(); } });
  $('sort-order').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  $('type-filter').addEventListener('change', () => { updateCategoryFilter(); updatePaymentFilter(); transactionPage = 1; renderTransactions(); });
  $('payment-filter').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  $('category-filter').addEventListener('change', () => { transactionPage = 1; renderTransactions(); });
  for (const id of ['amount-min', 'amount-max']) $(id).addEventListener('input', (event) => {
    formatCurrencyInput(event.currentTarget);
    validateTransactionRange();
    scheduleTransactionFilters();
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
