// Planning, realized cash flow and local recovery share the app's persisted state.
const BUDGET_STORAGE_KEY = 'meugasto-budgets-v1';
let realizationTarget = null;
let restoringBackup = false;
function validBudget(item) {
  return item && typeof item.category === 'string' && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0;
}
function loadBudgets() {
  try { const items = JSON.parse(localStorage.getItem(BUDGET_STORAGE_KEY) || '[]'); return Array.isArray(items) ? items.filter(validBudget) : []; }
  catch { return []; }
}
function saveBudgets() {
  if (localDatabaseEnabled) persistLocalDatabase(); else localStorage.setItem(BUDGET_STORAGE_KEY, JSON.stringify(budgets));
}
function occurrenceIndex(entry, month = selectedMonth()) {
  const [y,m] = entry.firstDate.split('-').map(Number);
  const [year,mon] = month.split('-').map(Number);
  return entry.recurring === true ? (year-y)*12+mon-m : 0;
}
function updateRecordStatus() {
  const income = recordType() === 'income';
  const byCard = $('payment').value === 'Cartão';
  const selected = $('record-status').value || 'realized';
  $('record-status').innerHTML = `<option value="realized">${income ? 'Recebido' : 'Pago'}</option><option value="planned">${income ? 'Previsto' : 'Em aberto'}</option>`;
  $('record-status').value = selected;
  const seriesEdit = expenses.some(item=>item.id===$('expense-id').value && item.recurring === true) && $('edit-scope').value==='series';
  $('record-status-wrap').hidden = byCard || seriesEdit;
  $('record-status').disabled = byCard || seriesEdit;
  if (byCard) $('record-status').value = 'planned';
  if (!byCard && $('record-status').value === 'realized') $('first-date').max = localDateKey();
  else $('first-date').removeAttribute('max');
  $('record-date-label').textContent = income ? ($('record-status').value === 'realized' ? 'Data de recebimento' : 'Data prevista de recebimento') : 'Data do primeiro pagamento';
}
function realizationMarkup(charge, actions) {
  const root = expenses.find(entry => entry.id === charge.expense.id);
  const income = charge.expense.type === 'income';
  const paid = Core.realizedAmount(root,charge.index,settlements) >= charge.amount;
  return {
    paid,
    badge: `<span class="${paid ? 'paid-tag' : 'planned-tag'}">${paid ? income ? 'Recebido' : 'Pago' : income ? 'Previsto' : 'Em aberto'}</span>`,
    button: actions ? `<button class="row-settle-button ${paid ? 'reopen-button' : ''}" data-realize="${escapeHtml(root.id)}::${charge.index}" aria-label="${paid ? 'Reabrir' : income ? 'Receber' : 'Pagar'} ${escapeHtml(charge.expense.description)}">${paid ? 'Reabrir' : income ? 'Receber' : 'Pagar'}</button>` : '',
  };
}
function startRealization(id,index) {
  const root = expenses.find(entry => entry.id === id);
  const charge = Core.monthlyRecords(expenses,settlements,selectedMonth()).find(item=>item.expense.id===id && item.index===index);
  if (!root || !charge || charge.expense.payment === 'Cartão') return;
  const income = charge.expense.type === 'income';
  if (Core.realizedAmount(root,index,settlements) >= charge.amount) {
    openDeleteConfirmation({eyebrow:'CONFIRME A ALTERAÇÃO',title:income ? 'Reabrir receita?' : 'Reabrir despesa?',message:`“${charge.expense.description}” voltará a ficar em aberto somente neste mês. O valor previsto será mantido e a confirmação de ${income ? 'recebimento' : 'pagamento'} será removida.`,confirmLabel:'Reabrir registro',confirmClass:'add-button',onConfirm:()=>{
      root.realizationStates = {...root.realizationStates,[index]:'planned'};
      settlements = settlements.filter(payment=>payment.expenseId!==id || Number(payment.installmentIndex)!==index);
      saveExpenses(); saveSettlements(); render(); showToast('Registro reaberto.', 'success');
    }});
    return;
  }
  realizationTarget = {id,index,amount:charge.amount,income};
  $('realization-title').textContent = income ? 'Confirmar recebimento' : 'Confirmar pagamento';
  $('realization-date-label').textContent = income ? 'Data do recebimento' : 'Data do pagamento';
  $('realization-summary').textContent = `${charge.expense.description} · ${currency.format(charge.amount)} · ${charge.expense.payment}`;
  const effective = Core.occurrenceEntry(root,index);
  $('realization-account-wrap').hidden = accounts.length === 0;
  $('realization-account').required = accounts.length > 0;
  populateAccountSelect($('realization-account'), effective.accountId || root.accountId || accounts[0]?.id || '');
  $('realization-date').max = localDateKey();
  $('realization-date').value = localDateKey();
  clearFormValidation($('realization-form'));
  $('realization-dialog').showModal();
}
function confirmRealization(event) {
  event.preventDefault();
  if (!realizationTarget) return;
  const {id,index,amount,income} = realizationTarget;
  const entry = expenses.find(item=>item.id===id);
  const date = $('realization-date').value;
  if (!entry) { showToast('Este registro não está mais disponível. Atualize a lista e tente novamente.', 'error'); return; }
  if (!date) { setFieldValidationError($('realization-date'), FIELD_ERROR_MESSAGES['realization-date']); return; }
  if (date > localDateKey()) { setFieldValidationError($('realization-date'), 'A data de confirmação não pode ser futura.'); return; }
  const accountId = accounts.length ? $('realization-account').value : '';
  if (accounts.length && !accountById(accountId)) { setFieldValidationError($('realization-account'), 'Selecione a conta ou carteira usada.'); return; }
  const effective = Core.occurrenceEntry(entry,index);
  // Replacing this occurrence's confirmation makes double submission harmless.
  settlements = settlements.filter(payment=>payment.expenseId!==id || Number(payment.installmentIndex)!==index);
  settlements.push({id:createId('cashflow'),expenseId:id,installmentIndex:index,amount,date,month:selectedMonth(),method:effective.payment,accountId,kind:income ? 'receipt' : 'cash-payment'});
  entry.realizationStates = {...entry.realizationStates,[index]:'confirmed'};
  saveExpenses(); saveSettlements(); $('realization-dialog').close(); realizationTarget=null; render();
  showToast(income ? 'Recebimento confirmado.' : 'Pagamento confirmado.', 'success');
}
function submitMonthlyOverride(previous, amount, chosenCard, accountId) {
  const month = selectedMonth(), index = occurrenceIndex(previous);
  const date = $('first-date').value;
  if (index < 0 || date.slice(0,7)!==month) { setFieldValidationError($('first-date'), 'Escolha uma data dentro do mês selecionado.'); return; }
  const old = Core.occurrenceEntry(previous,index);
  const payment = $('payment').value;
  const override = {description:$('description').value.trim(),amount,category:$('category').value,payment,cardId:chosenCard?.id || '',card:chosenCard?.name || '',accountId,notes:$('notes').value.trim(),date,status:payment==='Cartão' ? 'planned' : $('record-status').value};
  const changed = Number(old.amount)!==amount || old.payment!==payment || (old.cardId || '')!==override.cardId || (old.accountId || '')!==accountId || localDateKey(Core.occurrenceDate(previous,index))!==date;
  const linked = settlements.some(item=>item.expenseId===previous.id && Number(item.installmentIndex)===index);
  if (linked && settlementResetOnSave!==previous.id) { showToast('Confirme a edição antes de alterar um mês já liquidado.', 'error'); return; }
  if (linked && (changed || override.status==='planned')) {
    settlements = settlements.filter(item=>item.expenseId!==previous.id || Number(item.installmentIndex)!==index);
    override.status='planned';
  }
  previous.overrides={...previous.overrides,[month]:override};
  previous.realizationStates={...previous.realizationStates,[index]:override.status==='planned' ? 'planned' : 'confirmed'};
  saveExpenses(); saveSettlements(); $('expense-dialog').close(); render(); showToast('Somente este mês foi atualizado.', 'success');
}
function trendChartMarkup(series) {
  const largestValue=Math.max(0,...series.flatMap(item=>[item.projected.income,item.projected.expenses]));
  const magnitude=largestValue>0 ? 10**Math.floor(Math.log10(largestValue)) : 1;
  const axisMaximum=largestValue>0 ? Math.ceil(largestValue/magnitude)*magnitude : 1;
  const width=934, height=340;
  const left=94, right=18, top=20, bottom=48;
  const plotWidth=width-left-right, plotHeight=height-top-bottom;
  const groupWidth=plotWidth/series.length, barWidth=Math.min(25,groupWidth*.3), gap=Math.min(7,groupWidth*.08);
  const axisCurrency=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
  const grid=Array.from({length:5},(_,index)=>{
    const value=axisMaximum*(4-index)/4, y=top+plotHeight*index/4;
    return `<g class="trend-grid-line"><line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/><text x="${left-12}" y="${y+4}" text-anchor="end">${axisCurrency.format(value)}</text></g>`;
  }).join('');
  const bands=series.map((item,index)=>item.month===selectedMonth() ? `<rect class="trend-current-band" x="${left+index*groupWidth+2}" y="${top}" width="${Math.max(0,groupWidth-4)}" height="${plotHeight+30}" rx="8"/>` : '').join('');
  const bars=series.map((item,index)=>{
    const center=left+groupWidth*(index+.5), incomeHeight=item.projected.income/axisMaximum*plotHeight, expenseHeight=item.projected.expenses/axisMaximum*plotHeight;
    const date=dateFromKey(`${item.month}-01`), monthShort=new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(date).replace('.','');
    const label=`${monthShort}/${String(date.getFullYear()).slice(-2)}`;
    const details=`${monthLabel(item.month)}. Receitas previstas: ${currency.format(item.projected.income)}. Despesas previstas: ${currency.format(item.projected.expenses)}. Saldo previsto: ${currency.format(item.projected.balance)}. Saldo realizado: ${currency.format(item.actual.balance)}.`;
    const bar=(type,value,x,barHeight)=>{
      const barY=top+plotHeight-barHeight, tooltipWidth=112, tooltipHeight=28;
      const tooltipX=Math.max(left,Math.min(width-right-tooltipWidth,x+barWidth/2-tooltipWidth/2));
      const tooltipY=Math.max(2,barY-tooltipHeight-7);
      const name=type==='income' ? 'Receitas previstas' : 'Despesas previstas';
      return `<g class="trend-column trend-column-${type}" tabindex="${value>0 ? '0' : '-1'}" role="img" aria-label="${escapeHtml(name)} em ${escapeHtml(monthLabel(item.month))}: ${currency.format(value)}"><rect class="trend-bar-${type}" x="${x}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="3"/><g class="trend-bar-tooltip" aria-hidden="true"><rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="7"/><text x="${tooltipX+tooltipWidth/2}" y="${tooltipY+18}" text-anchor="middle">${currency.format(value)}</text></g></g>`;
    };
    return `<g class="trend-month${item.month===selectedMonth() ? ' is-current' : ''}" aria-label="${escapeHtml(details)}">${bar('income',item.projected.income,center-gap/2-barWidth,incomeHeight)}${bar('expense',item.projected.expenses,center+gap/2,expenseHeight)}<text class="trend-month-label" x="${center}" y="${top+plotHeight+23}" text-anchor="middle">${escapeHtml(label)}</text></g>`;
  }).join('');
  return `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de colunas agrupadas com receitas previstas em verde e despesas previstas em vermelho, por mês"><title>Evolução mensal de receitas e despesas previstas</title>${bands}${grid}<line class="trend-axis" x1="${left}" y1="${top}" x2="${left}" y2="${top+plotHeight}"/><line class="trend-axis" x1="${left}" y1="${top+plotHeight}" x2="${width-right}" y2="${top+plotHeight}"/>${bars}</svg>`;
}
function renderMonthlyClosing() {
  const closing=Core.monthlyClosing(expenses,settlements,selectedMonth());
  $('closing-month').textContent=monthLabel(selectedMonth());
  $('closing-received').textContent=currency.format(closing.received);
  $('closing-paid').textContent=currency.format(closing.paid);
  $('closing-balance').textContent=currency.format(closing.balance);
  $('closing-balance').className=closing.balance<0 ? 'negative-balance' : 'income-value';
  $('closing-to-receive').textContent=currency.format(closing.toReceive);
  $('closing-to-receive-count').textContent=closing.toReceiveCount
    ? `${closing.toReceiveCount} receita${closing.toReceiveCount===1 ? '' : 's'} pendente${closing.toReceiveCount===1 ? '' : 's'}`
    : 'Nenhuma receita pendente';
  $('closing-to-pay').textContent=currency.format(closing.toPay);
  $('closing-to-pay-count').textContent=closing.toPayCount
    ? `${closing.toPayCount} despesa${closing.toPayCount===1 ? '' : 's'} pendente${closing.toPayCount===1 ? '' : 's'}`
    : 'Nenhuma despesa pendente';
  $('closing-open-cards').textContent=currency.format(closing.openCardTotal);
  $('closing-open-cards-count').textContent=closing.openCardCount
    ? `${closing.openCardCount} fatura${closing.openCardCount===1 ? '' : 's'} · ${closing.openCardChargeCount} cobrança${closing.openCardChargeCount===1 ? '' : 's'}`
    : 'Nenhuma fatura em aberto';
  $('closing-card-list').innerHTML=closing.openCardBills.length
    ? closing.openCardBills.map(bill=>`<div class="closing-card-line"><span>${escapeHtml(bill.cardName)}<small>${bill.charges} cobrança${bill.charges===1 ? '' : 's'} em aberto</small></span><strong>${currency.format(bill.amount)}</strong></div>`).join('')
    : '<p class="closing-empty">Sem faturas abertas neste mês.</p>';
}
function renderInsights() {
  renderMonthlyClosing();
  const series = Core.monthlyTrends(expenses,settlements,selectedMonth(),Number($('trend-period').value));
  $('trend-chart').innerHTML=trendChartMarkup(series);
  const current=series.at(-1), previous=series.at(-2);
  const diff=previous ? Math.round((current.projected.expenses-previous.projected.expenses)*100)/100 : 0;
  $('month-comparison').textContent = previous ? `Despesas previstas: ${diff===0 ? 'mesmo valor do mês anterior' : `${currency.format(Math.abs(diff))} ${diff>0 ? 'a mais' : 'a menos'} que no mês anterior`}.` : '';
  const progress = Core.budgetProgress(expenses,settlements,budgets,selectedMonth());
  $('budget-list').innerHTML=progress.length ? progress.map(item=>{
    const status=item.percent>100 ? 'budget-over' : item.percent>=80 ? 'budget-near' : '';
    const info=category(item.category,'expense');
    const remainingText=item.remaining<0 ? `${currency.format(-item.remaining)} acima do limite` : `${currency.format(item.remaining)} disponíveis`;
    return `<article class="budget-item credit-card-card ${status}"><div class="credit-card-top">${categoryIcon(info,'budget-icon')}<div class="credit-card-title"><h3>${escapeHtml(item.category)}</h3><span>Orçamento da categoria</span></div><div class="card-actions"><button class="icon-button" data-budget-edit="${escapeHtml(item.category)}" aria-label="Editar orçamento de ${escapeHtml(item.category)}">${materialIcon('edit')}</button><button class="icon-button" data-budget-delete="${escapeHtml(item.category)}" aria-label="Excluir orçamento de ${escapeHtml(item.category)}">${materialIcon('close')}</button></div></div><div class="limit-line"><span>Gasto previsto</span><strong>${currency.format(item.spent)} <small>de ${currency.format(item.limit)}</small></strong></div><div class="budget-track" style="--budget-color:${info.color}" role="progressbar" aria-label="${escapeHtml(item.category)}: ${item.percent.toLocaleString('pt-BR')}% do orçamento utilizado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.max(0,item.percent))}"><i style="width:${Math.min(100,Math.max(0,item.percent))}%"></i></div><div class="limit-foot"><span>${item.percent.toLocaleString('pt-BR')}% utilizado</span><strong class="budget-remaining">${remainingText}</strong></div></article>`;
  }).join('') : '<p class="empty-note">Defina um orçamento para acompanhar os limites de cada categoria.</p>';
}
function openBudget(name='') {
  $('budget-form').reset();
  const names=recordCategories('expense',{selectedName:name}).map(item=>item.name);
  $('budget-category').innerHTML=names.map(name=>{
    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
  }).join('');
  $('budget-category').disabled=Boolean(name);
  $('budget-category').classList.toggle('budget-category-fixed',Boolean(name));
  if (name) $('budget-category').setAttribute('aria-description','A categoria não pode ser alterada ao editar um orçamento.');
  else $('budget-category').removeAttribute('aria-description');
  if (name) { $('budget-category').value=name; $('budget-amount').value=currency.format(budgets.find(item=>item.category===name).amount); }
  $('budget-dialog').showModal();
}
async function loadLocalBackups() {
  $('backup-list').innerHTML='';
  $('backups-feedback').textContent='Carregando cópias…';
  $('create-backup').disabled=true;
  try {
    await localDatabaseQueue;
    const response=await fetch('/api/backups');
    if (!response.ok) throw new Error();
    const {backups:items}=await response.json();
    $('backups-feedback').textContent=items.length ? `${items.length} cópia${items.length===1 ? '' : 's'} neste PC.` : 'Nenhuma cópia disponível. Gere a primeira cópia agora.';
    $('backup-list').innerHTML=items.map(item=>`<div class="backup-item"><div><strong>${escapeHtml(new Date(item.createdAt).toLocaleString('pt-BR'))}</strong><small>${(item.size/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} KB</small></div><button class="cancel-button" data-restore="${escapeHtml(item.name)}">Restaurar</button></div>`).join('');
    $('create-backup').disabled=false;
  } catch { $('backups-feedback').textContent='Não foi possível carregar as cópias. Abra o MeuGasto pelo iniciador local atualizado ou baixe um backup pelo menu.'; }
}
function setSidebarCollapsed(collapsed) {
  document.querySelector('.app-shell').classList.toggle('sidebar-collapsed',collapsed);
  $('sidebar').inert=collapsed;
  $('sidebar-toggle').setAttribute('aria-expanded',String(!collapsed));
  $('sidebar-toggle').setAttribute('aria-label',collapsed ? 'Abrir menu lateral' : 'Fechar menu lateral');
  $('sidebar-toggle').title=collapsed ? 'Abrir menu lateral' : 'Fechar menu lateral';
}
function setPaymentsMenuExpanded(expanded) {
  $('payments-toggle').setAttribute('aria-expanded',String(expanded));
  $('payments-submenu').hidden=!expanded;
}
function setupEnhancements() {
  setupDatePicker('first-date');
  setupDatePicker('realization-date');
  setupDatePicker('account-opening-date');
  setupDatePicker('transfer-date');
  setupDatePicker('reconciliation-date');
  const smallScreen=matchMedia('(max-width:760px)');
  setSidebarCollapsed(smallScreen.matches);
  smallScreen.addEventListener('change',event=>setSidebarCollapsed(event.matches));
  $('sidebar-shade').addEventListener('click',()=>setSidebarCollapsed(true));
  document.querySelectorAll('.nav-item:not(.nav-group-toggle),.nav-subitem,.side-action').forEach(button=>button.addEventListener('click',()=>{if (smallScreen.matches) setSidebarCollapsed(true);}));
  $('payments-toggle').addEventListener('click',()=>setPaymentsMenuExpanded($('payments-toggle').getAttribute('aria-expanded')!=='true'));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',() => $(button.dataset.close).close()));
  $('record-status').addEventListener('change',updateRecordStatus);
  $('recurring-record').addEventListener('change',()=>{ if ($('recurring-record').checked) $('record-status').value='planned'; });
  $('edit-scope').addEventListener('change',()=>openExpense(expenses.find(item=>item.id===$('expense-id').value),$('edit-scope').value));
  $('transactions-list').addEventListener('click',event=>{ const button=event.target.closest('[data-realize]'); if (button) { const [id,index]=button.dataset.realize.split('::'); startRealization(id,Number(index)); } });
  $('realization-form').addEventListener('submit',confirmRealization);
  $('new-budget').addEventListener('click',()=>openBudget());
  $('budget-amount').addEventListener('input',event=>formatCurrencyInput(event.currentTarget));
  $('budget-form').addEventListener('submit',event=>{
    event.preventDefault(); const amount=parseCurrencyInput($('budget-amount').value), name=$('budget-category').value;
    if (!(amount>0)) { setFieldValidationError($('budget-amount'), FIELD_ERROR_MESSAGES['budget-amount']); return; }
    budgets=budgets.filter(item=>item.category!==name); budgets.push({category:name,amount}); saveBudgets(); $('budget-dialog').close(); render(); showToast('Orçamento salvo.', 'success');
  });
  $('budget-list').addEventListener('click',event=>{
    const edit=event.target.closest('[data-budget-edit]'),remove=event.target.closest('[data-budget-delete]');
    if (edit) openBudget(edit.dataset.budgetEdit);
    if (remove) openDeleteConfirmation({title:'Excluir orçamento?',message:`O limite mensal de ${remove.dataset.budgetDelete} será removido. Os lançamentos serão mantidos.`,confirmLabel:'Excluir orçamento',onConfirm:()=>{ budgets=budgets.filter(item=>item.category!==remove.dataset.budgetDelete); saveBudgets(); render(); }});
  });
  $('trend-period').addEventListener('change',renderInsights);
  $('backups-dialog').addEventListener('cancel',event=>{ if (restoringBackup) event.preventDefault(); });
  $('local-backups').addEventListener('click',()=>{ $('backups-dialog').showModal(); loadLocalBackups(); });
  $('create-backup').addEventListener('click',async()=>{
    $('create-backup').disabled=true;
    try { await localDatabaseQueue; const response=await fetch('/api/backups',{method:'POST'}); if (!response.ok) throw new Error(); await loadLocalBackups(); showToast('Cópia local criada.', 'success'); }
    catch { $('backups-feedback').textContent='Não foi possível criar a cópia. Tente novamente.'; $('create-backup').disabled=false; }
  });
  $('backup-list').addEventListener('click',event=>{
    const button=event.target.closest('[data-restore]'); if (!button) return;
    openDeleteConfirmation({eyebrow:'CONFIRME A RESTAURAÇÃO',title:'Restaurar cópia local?',message:'Registros, cartões, pagamentos e orçamentos serão substituídos pela cópia escolhida. Uma cópia dos dados atuais será criada antes da restauração.',confirmLabel:'Restaurar cópia',onConfirm:async()=>{
      restoringBackup=true;
      $('backup-list').inert=true; $('create-backup').disabled=true;
      $('backups-dialog').setAttribute('aria-busy','true');
      document.querySelectorAll('#backups-dialog [data-close]').forEach(button=>{button.disabled=true;});
      try {
        await localDatabaseQueue;
        const response=await fetch('/api/backups/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:button.dataset.restore})});
        if (!response.ok) throw new Error();
        if (!await restoreLocalDatabase()) throw new Error();
        render(); await loadLocalBackups(); showToast('Cópia restaurada.', 'success');
      } catch { $('backups-feedback').textContent='Não foi possível concluir a restauração. Reabra o app para conferir os dados locais.'; $('create-backup').disabled=false; }
      finally {
        restoringBackup=false; $('backup-list').inert=false;
        $('backups-dialog').setAttribute('aria-busy','false');
        document.querySelectorAll('#backups-dialog [data-close]').forEach(button=>{button.disabled=false;});
      }
    }});
  });
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(year,month-1,day);
  return date.getFullYear()===year && date.getMonth()===month-1 && date.getDate()===day;
}
function calendarMonthLabel(date) {
  return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(date);
}
function calendarDateLabel(date) {
  return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(date);
}
function renderDatePicker(input, month) {
  const host=input.closest('.date-picker-control');
  const popover=host.querySelector('.date-picker-popover');
  const title=popover.querySelector('.date-picker-month');
  title.textContent=calendarMonthLabel(month);
  const grid=popover.querySelector('.date-picker-days');
  const first=new Date(month.getFullYear(),month.getMonth(),1);
  const start=new Date(first.getFullYear(),first.getMonth(),1-first.getDay());
  const selected=input.value;
  const today=localDateKey();
  const min=input.getAttribute('min') || '';
  const max=input.getAttribute('max') || '';
  grid.innerHTML=Array.from({length:42},(_,index)=>{
    const date=new Date(start.getFullYear(),start.getMonth(),start.getDate()+index);
    const key=localDateKey(date);
    const outside=date.getMonth()!==month.getMonth();
    const disabled=(Boolean(min) && key<min) || (Boolean(max) && key>max);
    return `<button type="button" class="date-picker-day${outside ? ' outside-month' : ''}${key===today ? ' today' : ''}" role="gridcell" aria-label="${escapeHtml(calendarDateLabel(date))}" aria-selected="${String(key===selected)}" ${key===selected ? 'aria-current="date"' : ''} ${disabled ? 'disabled' : ''} data-date="${key}">${date.getDate()}</button>`;
  }).join('');
}
function setupDatePicker(inputId) {
  const input=$(inputId);
  if (!input || input.type!=='date') return;
  const wrapper=document.createElement('div');
  wrapper.className='date-picker-control';
  input.parentNode.insertBefore(wrapper,input);
  wrapper.append(input);
  input.classList.add('date-picker-input');
  input.tabIndex=-1;
  const trigger=document.createElement('button');
  trigger.className='date-picker-trigger';trigger.type='button';trigger.setAttribute('aria-label','Abrir calendário');trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  trigger.innerHTML='<span class="material-icons" aria-hidden="true">calendar_month</span>';
  const popover=document.createElement('div');popover.className='date-picker-popover';popover.setAttribute('popover','manual');popover.setAttribute('role','dialog');popover.setAttribute('aria-label','Escolher data');
  popover.innerHTML='<div class="date-picker-header"><button type="button" class="date-picker-nav" data-month-step="-1" aria-label="Mês anterior">‹</button><strong class="date-picker-month"></strong><button type="button" class="date-picker-nav" data-month-step="1" aria-label="Próximo mês">›</button></div><div class="date-picker-weekdays" aria-hidden="true"><span>Do</span><span>Se</span><span>Te</span><span>Qu</span><span>Qu</span><span>Se</span><span>Sa</span></div><div class="date-picker-days" role="grid"></div><div class="date-picker-footer"><button type="button" class="date-picker-today">Hoje</button></div>';
  wrapper.append(trigger,popover);
  wrapper.addEventListener('click',event=>{if(event.target===wrapper)trigger.click();});
  let shownMonth=null;
  const isOpen=()=>popover.matches(':popover-open') || !popover.hidden;
  const close=()=>{
    if (popover.matches(':popover-open')) popover.hidePopover();
    else popover.hidden=true;
    trigger.setAttribute('aria-expanded','false');
  };
  const position=()=>{
    let anchor=wrapper.getBoundingClientRect();
    const dialog=wrapper.closest('dialog');
    let bounds=dialog?.getBoundingClientRect();
    const width=popover.getBoundingClientRect().width;
    const height=popover.getBoundingClientRect().height;
    const left=Math.max(12,Math.min(anchor.left,window.innerWidth-width-12));
    let below=anchor.bottom+8;
    if (dialog && bounds && below+height>Math.min(window.innerHeight-12,bounds.bottom-12)) {
      const availableBottom=Math.min(window.innerHeight-12,bounds.bottom-12);
      const needed=below+height-availableBottom;
      dialog.scrollTop=Math.min(dialog.scrollHeight-dialog.clientHeight,dialog.scrollTop+needed);
      anchor=wrapper.getBoundingClientRect();bounds=dialog.getBoundingClientRect();below=anchor.bottom+8;
    }
    const lowerBound=dialog && bounds ? Math.min(window.innerHeight-12,bounds.bottom-12) : window.innerHeight-12;
    const upperBound=dialog && bounds ? Math.max(12,bounds.top+12) : 12;
    const top=below+height<=lowerBound ? below : Math.max(upperBound,anchor.top-height-8);
    popover.style.left=`${left}px`;popover.style.top=`${top}px`;
  };
  trigger.addEventListener('click',()=>{
    const parts=(input.value || localDateKey()).split('-').map(Number);
    shownMonth=new Date(parts[0],parts[1]-1,1);
    renderDatePicker(input,shownMonth);
    popover.hidden=false;
    if (typeof popover.showPopover==='function') popover.showPopover();
    else popover.hidden=false;
    position();trigger.setAttribute('aria-expanded','true');
  });
  popover.addEventListener('click',event=>{
    const navigation=event.target.closest('[data-month-step]');
    if (navigation) {shownMonth.setMonth(shownMonth.getMonth()+Number(navigation.dataset.monthStep));renderDatePicker(input,shownMonth);return;}
    const day=event.target.closest('[data-date]');
    if (day && !day.disabled) {
      input.value=day.dataset.date;
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      close();input.focus();
    }
    if (event.target.closest('.date-picker-today')) {
      const today=localDateKey();
      if ((!(input.getAttribute('min') || '') || today>=input.getAttribute('min')) && (!(input.getAttribute('max') || '') || today<=input.getAttribute('max'))) { input.value=today;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();input.focus(); }
    }
  });
  input.addEventListener('input',()=>{if(!isOpen())return;const parts=input.value.split('-').map(Number);if(parts.length===3&&validCalendarDate(input.value)){shownMonth=new Date(parts[0],parts[1]-1,1);renderDatePicker(input,shownMonth);}});
  input.addEventListener('keydown',event=>{if(event.key==='Escape'&&isOpen()){close();trigger.focus();}});
  document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target)&&!popover.contains(event.target))close();});
}
