(function exposeFinanceCore(root) {
  const cents = (value) => Math.round(Number(value) * 100);
  function installmentAmount(total, count, index) {
    const totalCents = cents(total);
    const parts = Math.max(1, Number(count) || 1);
    const baseCents = Math.floor(totalCents / parts);
    return (index === parts - 1 ? totalCents - baseCents * (parts - 1) : baseCents) / 100;
  }
  function paymentTotal(expenseId, installmentIndex, payments) {
    return payments.filter((payment) => payment.expenseId === expenseId && Number(payment.installmentIndex) === installmentIndex)
      .reduce((total, payment) => total + cents(payment.amount), 0);
  }
  function installmentDate(firstDate, index) {
    const [year, month, day] = firstDate.split('-').map(Number);
    const offset = month - 1 + index;
    return new Date(year, offset, Math.min(day, new Date(year, offset + 1, 0).getDate()));
  }
  function dateKey(value) {
    if (value instanceof Date) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    return String(value || '').slice(0, 10);
  }
  function cardDueDate(chargeDate, dueDay) {
    const day = Number(dueDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    const [year, month] = dateKey(chargeDate).split('-').map(Number);
    if (!year || !month || month > 12) return null;
    const lastDay = new Date(year, month, 0).getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  }
  function isChargeOverdue(chargeDate, dueDay, today) {
    const dueDate = cardDueDate(chargeDate, dueDay);
    const currentDate = dateKey(today);
    return Boolean(dueDate && /^\d{4}-\d{2}-\d{2}$/.test(currentDate) && currentDate > dueDate);
  }
  function chargeRemaining(expense, index, payments) {
    return Math.max(0, cents(installmentAmount(expense.amount, expense.installments, index)) - paymentTotal(expense.id, index, payments)) / 100;
  }
  function monthCharges(expenses, payments, cardId, month) {
    return expenses.filter((expense) => expense.payment === 'Cartão' && (cardId === null || expense.cardId === cardId))
      .flatMap((expense) => Array.from({ length: Number(expense.installments) }, (_, index) => ({
        expense, index, date: installmentDate(expense.firstDate, index),
        amount: installmentAmount(expense.amount, expense.installments, index),
        remaining: chargeRemaining(expense, index, payments),
      })))
      .filter((charge) => `${charge.date.getFullYear()}-${String(charge.date.getMonth() + 1).padStart(2, '0')}` === month)
      .sort((a, b) => b.date - a.date);
  }
  function transactionCharges(expenses, payments, month) {
    return expenses.filter((expense) => expense.type !== 'debt-transfer')
      .flatMap((expense) => Array.from({ length: Number(expense.installments) }, (_, index) => ({
        expense, index, date: installmentDate(expense.firstDate, index),
        amount: installmentAmount(expense.amount, expense.installments, index),
        remaining: chargeRemaining(expense, index, payments),
      })))
      .filter((charge) => `${charge.date.getFullYear()}-${String(charge.date.getMonth() + 1).padStart(2, '0')}` === month)
      .sort((a, b) => b.date - a.date);
  }
  function monthlyOverview(expenses, payments, month) {
    const charges = transactionCharges(expenses, payments, month);
    const totalCents = charges.reduce((sum, charge) => sum + cents(charge.amount), 0);
    const pixCents = charges.filter((charge) => charge.expense.payment === 'Pix')
      .reduce((sum, charge) => sum + cents(charge.amount), 0);
    const cashCents = charges.filter((charge) => charge.expense.payment === 'Dinheiro')
      .reduce((sum, charge) => sum + cents(charge.amount), 0);
    const cardCents = charges.filter((charge) => charge.expense.payment === 'Cartão')
      .reduce((sum, charge) => sum + cents(charge.amount), 0);
    return { charges, total: totalCents / 100, pix: pixCents / 100, cash: cashCents / 100, card: cardCents / 100 };
  }
  function categoryBreakdown(charges) {
    const totals = new Map();
    for (const charge of charges) {
      const category = charge.expense.category || 'Outros';
      totals.set(category, (totals.get(category) || 0) + cents(charge.amount));
    }
    return [...totals].map(([category, amountCents]) => ({ category, amount: amountCents / 100 }))
      .sort((a, b) => b.amount - a.amount);
  }
  function categoryChargeShares(charges) {
    const totals = new Map();
    for (const charge of charges) {
      const category = charge.expense.category || 'Outros';
      totals.set(category, (totals.get(category) || 0) + cents(charge.amount));
    }
    return charges.map((charge) => {
      const category = charge.expense.category || 'Outros';
      const totalCents = totals.get(category) || 0;
      return {
        expenseId: charge.expense.id,
        installmentIndex: Number(charge.index) || 0,
        percent: totalCents ? Math.round(cents(charge.amount) * 1000 / totalCents) / 10 : 0,
      };
    });
  }
  function averageChargeSummary(charges) {
    const totalCents = charges.reduce((total, charge) => total + cents(charge.amount), 0);
    return {
      averageCharge: charges.length ? Math.round(totalCents / charges.length) / 100 : 0,
      chargeCount: charges.length,
    };
  }
  function paginate(items, requestedPage, requestedSize) {
    const pageSize = Math.max(1, Math.floor(Number(requestedSize) || 10));
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(totalPages, Math.max(1, Math.floor(Number(requestedPage) || 1)));
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), page, pageSize, totalItems, totalPages };
  }
  function filterTransactionCharges(charges, { category = '', minAmount = null, maxAmount = null } = {}) {
    const minimum = minAmount === null || minAmount === '' ? null : cents(minAmount);
    const maximum = maxAmount === null || maxAmount === '' ? null : cents(maxAmount);
    return charges.filter((charge) => {
      const amount = cents(charge.amount);
      const chargeCategory = charge.expense.category || 'Outros';
      return (!category || chargeCategory === category)
        && (minimum === null || amount >= minimum)
        && (maximum === null || amount <= maximum);
    });
  }
  function cardUsed(expenses, payments, cardId) {
    const usedCents = expenses.filter((expense) => expense.payment === 'Cartão' && expense.cardId === cardId)
      .reduce((total, expense) => total + Array.from({ length: Number(expense.installments) }, (_, index) => Math.round(chargeRemaining(expense, index, payments) * 100)).reduce((sum, amount) => sum + amount, 0), 0);
    return usedCents / 100;
  }
  function allocateFullPayment(charges) {
    return charges.filter((charge) => charge.remaining > 0).map((charge) => ({
      expenseId: charge.expense.id,
      installmentIndex: charge.index,
      amount: Math.round(charge.remaining * 100) / 100,
    }));
  }
  function availableLimit(limit, used) { return Math.round((Number(limit) - Number(used)) * 100) / 100; }
  const api = {
    installmentAmount,
    installmentDate,
    cardDueDate,
    isChargeOverdue,
    chargeRemaining,
    cardUsed,
    monthCharges,
    transactionCharges,
    monthlyOverview,
    categoryBreakdown,
    categoryChargeShares,
    averageChargeSummary,
    paginate,
    filterTransactionCharges,
    allocateFullPayment,
    availableLimit,
  };
  root.FinanceCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
