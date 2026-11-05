(function exposeFinanceCore(root) {
  const cents = (value) => Math.round(Number(value) * 100);
  const categoryNameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  function validCatalogCategory(item) {
    return item && typeof item.id === 'string' && item.id.length > 0
      && ['income', 'expense'].includes(item.type)
      && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.trim().length <= 40
      && typeof item.icon === 'string' && /^[a-z][a-z_]{1,39}$/.test(item.icon)
      && typeof item.color === 'string' && /^#[\da-fA-F]{6}$/.test(item.color);
  }
  function hydrateCategoryCatalog(defaults, stored) {
    const result = [];
    const seenIds = new Set(), seenNames = new Set();
    for (const item of [...(Array.isArray(stored) ? stored : []), ...defaults]) {
      if (!validCatalogCategory(item) || seenIds.has(item.id) || seenNames.has(categoryNameKey(item.name))) continue;
      result.push({ ...item, archived: item.archived === true });
      seenIds.add(item.id);
      seenNames.add(categoryNameKey(item.name));
    }
    return result;
  }
  function saveCategoryInCatalog(catalog, input, expenses, budgets) {
    const old = catalog.find(item => item.id === input.id);
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    const next = { id: input.id, type: old?.type || input.type, name, icon: input.icon, color: input.color, archived: old?.archived === true };
    if (!name || name.length > 40) throw new Error('Informe um nome de até 40 caracteres.');
    if (catalog.some(item => item.id !== input.id && categoryNameKey(item.name) === categoryNameKey(name))) throw new Error('Já existe uma categoria com esse nome.');
    if (!/^[a-z][a-z_]{1,39}$/.test(next.icon || '')) throw new Error('Escolha um ícone válido.');
    if (!/^#[\da-fA-F]{6}$/.test(next.color || '')) throw new Error('Escolha uma cor válida.');
    if (!['income', 'expense'].includes(next.type) || !next.id) throw new Error('Tipo de categoria inválido.');
    const categories = old ? catalog.map(item => item.id === old.id ? next : item) : [...catalog, next];
    if (!old || old.name === name) return { categories, expenses, budgets };
    const updatedExpenses = expenses.map(entry => {
      if ((entry.type === 'income' ? 'income' : 'expense') !== next.type) return entry;
      const overrides = entry.overrides && Object.fromEntries(Object.entries(entry.overrides).map(([month, override]) => [month,
        override?.category === old.name ? { ...override, category: name } : override]));
      return { ...entry, category: entry.category === old.name ? name : entry.category, ...(overrides ? { overrides } : {}) };
    });
    const updatedBudgets = next.type === 'expense' ? budgets.map(item => item.category === old.name ? { ...item, category: name } : item) : budgets;
    return { categories, expenses: updatedExpenses, budgets: updatedBudgets };
  }
  function setCategoryArchived(catalog, id, archived) {
    const item = catalog.find(entry => entry.id === id);
    if (!item) throw new Error('Categoria não encontrada.');
    if (archived && !item.archived && catalog.filter(entry => entry.type === item.type && !entry.archived).length <= 1) {
      throw new Error('Não é possível arquivar a última categoria disponível.');
    }
    return catalog.map(entry => entry.id === id ? { ...entry, archived: Boolean(archived) } : entry);
  }
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
  function occurrenceEntry(entry, index) {
    const month = dateKey(installmentDate(entry.firstDate, index)).slice(0,7);
    const override = entry.recurring === true ? entry.overrides?.[month] : null;
    return override ? { ...entry, ...override, id: entry.id, firstDate: entry.firstDate, recurring: true, overrides: entry.overrides } : entry;
  }
  function occurrenceDate(entry, index) {
    const date = installmentDate(entry.firstDate, index);
    const override = entry.recurring === true ? entry.overrides?.[dateKey(date).slice(0,7)] : null;
    return override?.date && /^\d{4}-\d{2}-\d{2}$/.test(override.date) && override.date.slice(0,7) === dateKey(date).slice(0,7)
      ? new Date(`${override.date}T00:00:00`) : date;
  }
  function implicitRealized(entry, index) {
    const effective = occurrenceEntry(entry,index);
    if (effective.payment === 'Cartão') return false;
    if (entry.realizationStates?.[String(index)] === 'planned') return false;
    const month = dateKey(installmentDate(entry.firstDate,index)).slice(0,7);
    if (entry.overrides?.[month]?.status) return entry.overrides[month].status === 'realized';
    return entry.recurring === true ? index === 0 && entry.status === 'realized' : entry.status !== 'planned';
  }
  function realizedAmount(entry,index,payments) {
    const recorded = payments.filter(p=>p.expenseId === entry.id && Number(p.installmentIndex)===index);
    if (recorded.length) return recorded.reduce((sum,p)=>sum+cents(p.amount),0)/100;
    const effective=occurrenceEntry(entry,index);
    return implicitRealized(entry,index) ? (entry.recurring === true ? Number(effective.amount) : installmentAmount(entry.amount,entry.installments,index)) : 0;
  }
  function chargeRemaining(expense, index, payments) {
    return Math.max(0, cents(expense.recurring === true ? occurrenceEntry(expense,index).amount : installmentAmount(expense.amount, expense.installments, index)) - paymentTotal(expense.id, index, payments)) / 100;
  }
  function monthOffset(firstDate, month) {
    const [year, startMonth] = firstDate.split('-').map(Number);
    const [targetYear, targetMonth] = month.split('-').map(Number);
    return (targetYear - year) * 12 + targetMonth - startMonth;
  }
  function entryCharges(expense, payments, month) {
    const offset = monthOffset(expense.firstDate, month);
    if (offset < 0) return [];
    if (expense.recurring === true && expense.recurringUntil && month > expense.recurringUntil) return [];
    const indices = expense.recurring === true ? [offset] : Array.from({ length: Number(expense.installments) }, (_, index) => index);
    return indices.map(index => ({
      expense: occurrenceEntry(expense,index), index, date: occurrenceDate(expense,index),
      amount: expense.recurring === true ? Number(occurrenceEntry(expense,index).amount) : installmentAmount(expense.amount, expense.installments, index),
      remaining: expense.type === 'income' ? 0 : chargeRemaining(expense, index, payments),
    })).filter(charge => dateKey(charge.date).slice(0, 7) === month);
  }
  function monthCharges(expenses, payments, cardId, month) {
    return expenses.filter(expense => expense.type !== 'income')
      .flatMap(expense => entryCharges(expense, payments, month))
      .filter(charge => charge.expense.payment === 'Cartão' && (cardId === null || charge.expense.cardId === cardId)).sort((a,b) => b.date-a.date);
  }
  function transactionCharges(expenses, payments, month) {
    return expenses.filter(expense => expense.type !== 'debt-transfer' && expense.type !== 'income')
      .flatMap(expense => entryCharges(expense, payments, month)).sort((a,b) => b.date-a.date);
  }
  function monthlyRecords(entries, payments, month) {
    const income = entries.filter(entry => entry.type === 'income').flatMap(entry => entryCharges(entry, payments, month));
    return [...transactionCharges(entries, payments, month), ...income].sort((a,b) => b.date-a.date);
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
  function monthlyBalance(entries, payments, month) {
    const incomeCents = monthlyRecords(entries, payments, month).filter(record => record.expense.type === 'income')
      .reduce((sum, record) => sum + cents(record.amount), 0);
    const expenseCents = cents(monthlyOverview(entries, payments, month).total);
    return { income: incomeCents / 100, expenses: expenseCents / 100, balance: (incomeCents - expenseCents) / 100 };
  }
  function incomeCommitmentSummary(income, expenses) {
    const toCents = value => Number.isFinite(Number(value)) ? cents(value) : 0;
    const incomeCents = Math.max(0, toCents(income));
    const expenseCents = Math.max(0, toCents(expenses));
    return {
      income: incomeCents / 100,
      expenses: expenseCents / 100,
      remaining: (incomeCents - expenseCents) / 100,
      percent: incomeCents ? Math.round(expenseCents * 1000 / incomeCents) / 10 : null,
    };
  }
  function monthlyCashFlow(entries,payments,month) {
    let income=0, expenses=0;
    for (const payment of payments) {
      const entry=entries.find(e=>e.id===payment.expenseId);
      if (!entry || payment.method === 'Cartão') continue;
      const paidDate=payment.date || dateKey(occurrenceDate(entry,Number(payment.installmentIndex)));
      if (paidDate.slice(0,7)!==month) continue;
      if (entry.type==='income') income+=cents(payment.amount); else expenses+=cents(payment.amount);
    }
    for (const record of monthlyRecords(entries,payments,month)) {
      const entry=entries.find(e=>e.id===record.expense.id);
      if (payments.some(p=>p.expenseId===entry.id && Number(p.installmentIndex)===record.index)) continue;
      if (implicitRealized(entry,record.index)) {
        if (entry.type==='income') income+=cents(record.amount); else expenses+=cents(record.amount);
      }
    }
    return {income:income/100,expenses:expenses/100,balance:(income-expenses)/100};
  }
  function accountBalances(accounts, entries, payments, transfers, asOf, reconciliations = []) {
    const cutoff = dateKey(asOf);
    const balances = new Map(accounts.map(account => [String(account.id), Math.round(Number(account.openingBalance || 0) * 100)]));
    const openingDates = new Map(accounts.map(account => [String(account.id), dateKey(account.openingDate)]));
    const apply = (accountId, date, amountCents) => {
      const id = String(accountId || ''), dateValue = dateKey(date);
      if (!balances.has(id) || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || dateValue > cutoff || dateValue < openingDates.get(id)) return;
      balances.set(id, balances.get(id) + amountCents);
    };
    for (const entry of entries) {
      if (entry.type === 'debt-transfer' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey(entry.firstDate))) continue;
      const lastMonth = cutoff.slice(0, 7);
      const lastIndex = monthOffset(entry.firstDate, lastMonth);
      if (lastIndex < 0) continue;
      const count = entry.recurring === true ? lastIndex + 1 : Math.min(Math.max(1, Number(entry.installments) || 1), lastIndex + 1);
      for (let index = 0; index < count; index += 1) {
        if (entry.recurring === true && entry.recurringUntil && dateKey(installmentDate(entry.firstDate, index)).slice(0, 7) > entry.recurringUntil) continue;
        const occurrence = occurrenceEntry(entry, index);
        const occurrenceDay = dateKey(occurrenceDate(entry, index));
        if (occurrenceDay > cutoff) continue;
        const recorded = payments.filter(payment => payment.expenseId === entry.id && Number(payment.installmentIndex) === index);
        if (recorded.length) {
          for (const payment of recorded) {
            const paidByCard = payment.method === 'Cartão' || Boolean(payment.sourceCardId);
            const accountId = paidByCard ? '' : payment.accountId || occurrence.accountId || entry.accountId;
            const amount = Math.round(Number(payment.amount) * 100) * (entry.type === 'income' ? 1 : -1);
            apply(accountId, payment.date || occurrenceDay, amount);
          }
        } else if (entry.payment !== 'Cartão' && implicitRealized(entry, index)) {
          const amount = entry.recurring === true ? Number(occurrence.amount) : installmentAmount(entry.amount, entry.installments, index);
          apply(occurrence.accountId || entry.accountId, occurrenceDay, Math.round(amount * 100) * (entry.type === 'income' ? 1 : -1));
        }
      }
    }
    for (const transfer of transfers) {
      const amount = Math.round(Number(transfer.amount) * 100);
      if (!(amount > 0) || transfer.fromAccountId === transfer.toAccountId) continue;
      apply(transfer.fromAccountId, transfer.date, -amount);
      apply(transfer.toAccountId, transfer.date, amount);
    }
    for (const reconciliation of reconciliations) {
      const amount = Math.round(Number(reconciliation.adjustment) * 100);
      if (Number.isFinite(amount)) apply(reconciliation.accountId, reconciliation.date, amount);
    }
    return accounts.map(account => ({ ...account, balance: balances.get(String(account.id)) / 100 }));
  }
  function monthlyClosing(entries,payments,month) {
    const actual=monthlyCashFlow(entries,payments,month);
    let toReceiveCents=0, toPayCents=0, toReceiveCount=0, toPayCount=0;
    for (const record of monthlyRecords(entries,payments,month)) {
      const remaining=Math.max(0,cents(record.amount)-cents(realizedAmount(record.expense,record.index,payments)));
      if (!remaining) continue;
      if (record.expense.type==='income') { toReceiveCents+=remaining; toReceiveCount++; }
      else if (record.expense.payment!=='Cartão') { toPayCents+=remaining; toPayCount++; }
    }
    const cardGroups=new Map();
    let openCardChargeCount=0;
    for (const charge of monthCharges(entries,payments,null,month)) {
      if (charge.expense.payment!=='Cartão' || charge.remaining<=0) continue;
      const cardId=String(charge.expense.cardId || '');
      const cardName=String(charge.expense.card || 'Cartão sem identificação');
      const key=cardId || `name:${cardName}`;
      const current=cardGroups.get(key) || {cardId,cardName,amountCents:0,charges:0};
      current.amountCents+=cents(charge.remaining);
      current.charges++;
      cardGroups.set(key,current);
      openCardChargeCount++;
    }
    const openCardBills=[...cardGroups.values()]
      .map(({amountCents,...bill})=>({...bill,amount:amountCents/100}))
      .sort((a,b)=>a.cardName.localeCompare(b.cardName,'pt-BR',{sensitivity:'base'}));
    return {
      received:actual.income,
      paid:actual.expenses,
      balance:actual.balance,
      toReceive:toReceiveCents/100,
      toReceiveCount,
      toPay:toPayCents/100,
      toPayCount,
      openCardTotal:openCardBills.reduce((sum,bill)=>sum+cents(bill.amount),0)/100,
      openCardCount:openCardBills.length,
      openCardChargeCount,
      openCardBills,
    };
  }
  function budgetProgress(entries,payments,budgets,month) {
    const spent=new Map(categoryBreakdown(transactionCharges(entries,payments,month)).map(c=>[c.category,c.amount]));
    return budgets.map(item=>{
      const limit=cents(item.amount), used=cents(spent.get(item.category)||0);
      return {category:item.category,limit:limit/100,spent:used/100,remaining:(limit-used)/100,percent:limit?Math.round(used*1000/limit)/10:0};
    });
  }
  function financialAlerts(entries,payments,cards,budgets,today,month,daysAhead=7) {
    const todayKey=dateKey(today), todayDate=new Date(`${todayKey}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey) || Number.isNaN(todayDate.getTime())) return [];
    const horizon=new Date(todayDate);
    horizon.setUTCDate(horizon.getUTCDate()+Math.max(0,Math.floor(Number(daysAhead)||0)));
    const horizonKey=horizon.toISOString().slice(0,10), horizonMonth=horizonKey.slice(0,7);
    const cardById=new Map(cards.map(card=>[String(card.id),card]));
    const alerts=[], cardBills=new Map();
    const classify=(dueDate)=>dueDate<todayKey ? 'overdue' : dueDate<=horizonKey ? 'upcoming' : '';
    const addDueAlert=(kind,record,dueDate,remaining)=>{
      const timing=classify(dueDate);
      if (!timing || remaining<=0) return;
      alerts.push({kind:`${kind}-${timing}`,severity:timing,amount:remaining,dueDate,month:dueDate.slice(0,7),expenseId:record.expense.id,installmentIndex:record.index,description:record.expense.description,category:record.expense.category||'Outros',payment:record.expense.payment||'',cardId:record.expense.cardId||'',cardName:record.expense.card||''});
    };
    for (const entry of entries) {
      if (entry.type==='debt-transfer' || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.firstDate||''))) continue;
      const lastMonth=entry.recurring===true && entry.recurringUntil && entry.recurringUntil<horizonMonth ? entry.recurringUntil : horizonMonth;
      const lastIndex=monthOffset(entry.firstDate,lastMonth);
      if (lastIndex<0) continue;
      const count=entry.recurring===true ? lastIndex+1 : Math.min(Math.max(1,Number(entry.installments)||1),lastIndex+1);
      for (let index=0;index<count;index++) {
        const effective=occurrenceEntry(entry,index), dueDate=dateKey(occurrenceDate(entry,index));
        if (dueDate>horizonKey) continue;
        const amount=entry.recurring===true ? Number(effective.amount)||0 : installmentAmount(entry.amount,entry.installments,index);
        if (entry.type==='income') {
          addDueAlert('income',{expense:effective,index},dueDate,Math.max(0,cents(amount)-cents(realizedAmount(entry,index,payments)))/100);
          continue;
        }
        if (effective.payment==='Cartão') {
          const card=cardById.get(String(effective.cardId||''));
          const dueDay=card?.dueDay;
          const invoiceDueDate=cardDueDate(dueDate,dueDay);
          const remaining=chargeRemaining(entry,index,payments);
          if (!invoiceDueDate || invoiceDueDate>horizonKey || remaining<=0) continue;
          const key=`${effective.cardId||effective.card||'card'}::${invoiceDueDate}`;
          const bill=cardBills.get(key)||{kind:'card',cardId:effective.cardId||'',cardName:card?.name||effective.card||'Cartão',dueDate:invoiceDueDate,month:invoiceDueDate.slice(0,7),amountCents:0,charges:0};
          bill.amountCents+=cents(remaining); bill.charges++;
          cardBills.set(key,bill);
          continue;
        }
        addDueAlert('expense',{expense:effective,index},dueDate,Math.max(0,cents(amount)-cents(realizedAmount(entry,index,payments)))/100);
      }
    }
    for (const bill of cardBills.values()) {
      const timing=classify(bill.dueDate);
      if (!timing) continue;
      const {amountCents,...item}=bill;
      alerts.push({...item,kind:`card-${timing}`,severity:timing,amount:amountCents/100});
    }
    for (const item of budgetProgress(entries,payments,budgets,month)) {
      if (item.spent>item.limit) alerts.push({kind:'budget-exceeded',severity:'budget',amount:Math.round((item.spent-item.limit)*100)/100,spent:item.spent,limit:item.limit,category:item.category,month});
    }
    const severityOrder={overdue:0,budget:1,upcoming:2};
    return alerts.sort((a,b)=>(severityOrder[a.severity]-severityOrder[b.severity]) || String(a.dueDate||'').localeCompare(String(b.dueDate||'')) || String(a.category||a.cardName||'').localeCompare(String(b.category||b.cardName||''),'pt-BR'));
  }
  function monthlyTrends(entries,payments,endMonth,count=6) {
    const [year,month]=endMonth.split('-').map(Number);
    count = Math.min(12,Math.max(1,Math.floor(Number(count)||6)));
    return Array.from({length:count},(_,i)=>{
      const date=new Date(year,month-1-(count-1-i),1), key=dateKey(date).slice(0,7);
      return {month:key,projected:monthlyBalance(entries,payments,key),actual:monthlyCashFlow(entries,payments,key)};
    });
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
  function monthlyCategoryBreakdown(entries, payments, month) {
    const records = monthlyRecords(entries, payments, month);
    const summarize = type => {
      const items = records.filter(record => (record.expense.type === 'income' ? 'income' : 'expense') === type);
      const totalCents = items.reduce((sum, item) => sum + cents(item.amount), 0);
      return {
        total: totalCents / 100,
        categories: categoryBreakdown(items).map(item => ({ ...item, percent: totalCents ? Math.round(cents(item.amount) * 1000 / totalCents) / 10 : 0 })),
      };
    };
    return { income: summarize('income'), expense: summarize('expense') };
  }
  function categoryChargeShares(charges) {
    const totals = new Map();
    const groupKey = charge => JSON.stringify([charge.expense.type === 'income' ? 'income' : 'expense', charge.expense.category || 'Outros']);
    for (const charge of charges) {
      const key = groupKey(charge);
      totals.set(key, (totals.get(key) || 0) + cents(charge.amount));
    }
    return charges.map(charge => {
      const totalCents = totals.get(groupKey(charge)) || 0;
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
  function filterTransactionCharges(charges, { type = '', category = '', payment = '', minAmount = null, maxAmount = null } = {}) {
    const minimum = minAmount === null || minAmount === '' ? null : cents(minAmount);
    const maximum = maxAmount === null || maxAmount === '' ? null : cents(maxAmount);
    return charges.filter((charge) => {
      const amount = cents(charge.amount);
      const chargeCategory = charge.expense.category || 'Outros';
      return (!type || (charge.expense.type === 'income' ? 'income' : 'expense') === type)
        && (!category || chargeCategory === category)
        && (!payment || charge.expense.payment === payment)
        && (minimum === null || amount >= minimum)
        && (maximum === null || amount <= maximum);
    });
  }
  function sortTransactionCharges(charges, order = 'date-desc') {
    const recentFirst = (a, b) => b.date - a.date;
    return [...charges].sort((a, b) => {
      const fixedPriority = Number(b.expense.recurring === true) - Number(a.expense.recurring === true);
      if (fixedPriority) return fixedPriority;
      if (order === 'amount-asc') return cents(a.amount) - cents(b.amount) || recentFirst(a, b);
      if (order === 'amount-desc') return cents(b.amount) - cents(a.amount) || recentFirst(a, b);
      if (order === 'category-asc' || order === 'category-desc') {
        const comparison = (a.expense.category || 'Outros').localeCompare(b.expense.category || 'Outros', 'pt-BR', { sensitivity: 'base', numeric: true });
        return (order === 'category-desc' ? -comparison : comparison) || recentFirst(a, b);
      }
      return recentFirst(a, b);
    });
  }
  function cardUsed(expenses, payments, cardId, asOf = new Date()) {
    const currentMonth = dateKey(asOf).slice(0,7);
    const usedCents = expenses.filter(expense => expense.type !== 'income')
      .reduce((total, expense) => {
        const lastMonth = expense.recurringUntil && expense.recurringUntil < currentMonth ? expense.recurringUntil : currentMonth;
        const count = expense.recurring === true ? Math.max(0, monthOffset(expense.firstDate, lastMonth) + 1) : Number(expense.installments);
        return total + Array.from({length:count}, (_,index) => {
          const effective = occurrenceEntry(expense,index);
          return effective.payment === 'Cartão' && effective.cardId === cardId ? cents(chargeRemaining(expense,index,payments)) : 0;
        }).reduce((sum,value) => sum+value,0);
      },0);
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
    validCatalogCategory,
    hydrateCategoryCatalog,
    saveCategoryInCatalog,
    setCategoryArchived,
    installmentAmount,
    installmentDate,
    monthlyClosing,
    cardDueDate,
    isChargeOverdue,
    chargeRemaining,
    occurrenceEntry,
    occurrenceDate,
    realizedAmount,
    monthlyCashFlow,
    accountBalances,
    budgetProgress,
    financialAlerts,
    monthlyTrends,
    cardUsed,
    monthCharges,
    transactionCharges,
    monthlyOverview,
    monthlyRecords,
    monthlyBalance,
    incomeCommitmentSummary,
    categoryBreakdown,
    monthlyCategoryBreakdown,
    categoryChargeShares,
    averageChargeSummary,
    paginate,
    filterTransactionCharges,
    sortTransactionCharges,
    allocateFullPayment,
    availableLimit,
  };
  root.FinanceCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
