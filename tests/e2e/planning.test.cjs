const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const { chromium } = require('playwright');

const appRoot = path.resolve(__dirname, '../..');
let server;
let browser;
let page;
let appUrl;

before(async () => {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(appRoot, relativePath);
    if (!filePath.startsWith(`${appRoot}${path.sep}`)) { response.writeHead(404).end(); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404).end(); return; }
      const type = path.extname(filePath) === '.html' ? 'text/html; charset=utf-8'
        : path.extname(filePath) === '.css' ? 'text/css; charset=utf-8'
          : path.extname(filePath) === '.svg' ? 'image/svg+xml' : 'text/javascript; charset=utf-8';
      response.writeHead(200, { 'content-type': type }).end(content);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  appUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo' });
});

beforeEach(async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});


test('shows actual monthly totals and splits pending amounts from unpaid card invoices', async () => {
  const month = await page.locator('#month-picker').inputValue();
  await page.evaluate((selectedMonth) => {
    const date = day => `${selectedMonth}-${String(day).padStart(2,'0')}`;
    const entries = [
      {id:'salary',description:'Salário',type:'income',status:'planned',amount:1000,firstDate:date(1),installments:1,payment:'Pix',category:'Salário'},
      {id:'project',description:'Serviço a receber',type:'income',status:'planned',amount:250,firstDate:date(10),installments:1,payment:'Pix',category:'Prestação de serviço'},
      {id:'rent',description:'Aluguel',type:'expense',status:'planned',amount:300,firstDate:date(2),installments:1,payment:'Pix',category:'Moradia'},
      {id:'groceries',description:'Mercado',type:'expense',amount:80,firstDate:date(3),installments:1,payment:'Dinheiro',category:'Alimentação'},
      {id:'card-purchase',description:'Compra no cartão',type:'expense',status:'planned',amount:200,firstDate:date(4),installments:1,payment:'Cartão',cardId:'nu',card:'Nubank',category:'Compras'},
      {id:'card-transfer',description:'Pagamento da fatura',type:'debt-transfer',amount:120,firstDate:date(5),installments:1,payment:'Cartão',cardId:'bb',card:'Ourocard',category:'Outros'},
    ];
    const payments = [
      {id:'salary-paid',expenseId:'salary',installmentIndex:0,amount:1000,date:date(6),method:'Pix'},
      {id:'rent-partial',expenseId:'rent',installmentIndex:0,amount:100,date:date(7),method:'Pix'},
      {id:'card-partial',expenseId:'card-purchase',installmentIndex:0,amount:50,date:date(8),method:'Pix'},
    ];
    localStorage.setItem('meu-financeiro-v1',JSON.stringify(entries));
    localStorage.setItem('meugasto-card-payments-v1',JSON.stringify(payments));
  }, month);
  await page.reload();
  await page.getByRole('button',{name:'Análises',exact:true}).click();

  const closingHelp=page.getByRole('button',{name:'Sobre o fechamento mensal'});
  assert.equal(await closingHelp.count(),1);
  assert.equal(await closingHelp.getAttribute('aria-describedby'),'closing-tooltip');
  assert.match(await page.locator('#closing-tooltip').textContent(),/Faturas em aberto são cobranças de cartão não liquidadas/);
  await closingHelp.focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#closing-tooltip')).visibility === 'visible');
  assert.equal(await page.locator('#closing-tooltip').evaluate(element=>getComputedStyle(element).visibility),'visible');
  assert.equal((await page.locator('#closing-received').innerText()).replace(/\s/g,''),'R$1.000,00');
  assert.equal((await page.locator('#closing-paid').innerText()).replace(/\s/g,''),'R$230,00');
  assert.equal((await page.locator('#closing-balance').innerText()).replace(/\s/g,''),'R$770,00');
  assert.equal((await page.locator('#closing-to-receive').innerText()).replace(/\s/g,''),'R$250,00');
  assert.equal((await page.locator('#closing-to-pay').innerText()).replace(/\s/g,''),'R$200,00');
  assert.equal((await page.locator('#closing-open-cards').innerText()).replace(/\s/g,''),'R$270,00');
  assert.match(await page.locator('#closing-card-list').innerText(),/Nubank.*150,00/s);
  assert.match(await page.locator('#closing-card-list').innerText(),/Ourocard.*120,00/s);
});

test('separates overview and analysis into accessible topic tabs', async () => {
  const overviewTabs = page.getByRole('tablist', { name: 'Visão geral' });
  assert.equal(await overviewTabs.getByRole('tab').count(), 3);
  assert.equal(await page.getByRole('tab', { name: 'Saldo' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#month-balance').isVisible(), true);
  assert.equal(await page.locator('#overview-panel-balance #actual-balance').count(), 0, 'realized totals belong to the monthly closing, not the balance overview');
  assert.equal(await page.locator('#overview-panel-balance #overview-receivable-total').count(), 0, 'pending receipts belong to the monthly closing');
  assert.equal(await page.locator('#pix-total').isVisible(), false);

  await page.getByRole('tab', { name: 'Saldo' }).focus();
  await page.getByRole('tab', { name: 'Saldo' }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Despesas' }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#pix-total').isVisible(), true);
  assert.equal(await page.locator('#overview-panel-expenses .expense-status-grid').count(), 0, 'expense settlement and pending totals should not repeat the monthly closing');
  assert.equal(await page.locator('#average-charge').isVisible(), true);
  assert.equal(await page.locator('#month-balance').isVisible(), false);
  await page.getByRole('tab', { name: 'Recentes' }).click();
  assert.equal(await page.locator('#recent-list').isVisible(), true);

  await page.getByRole('button', { name: 'Análises', exact: true }).click();
  const analysisTabs = page.getByRole('tablist', { name: 'Análises' });
  assert.equal(await analysisTabs.getByRole('tab').count(), 3);
  assert.equal(await page.locator('#closing-title').isVisible(), true);
  assert.equal(await page.locator('#closing-balance').isVisible(), true);
  assert.equal(await page.locator('#closing-to-pay').isVisible(), true);
  await page.getByRole('tab', { name: 'Categorias' }).click();
  assert.equal(await page.locator('#category-list').isVisible(), true);
  assert.equal(await page.locator('#income-category-list').isVisible(), true);
  assert.equal(await page.locator('#closing-title').isVisible(), false);
  await page.getByRole('tab', { name: 'Evolução' }).click();
  assert.equal(await page.locator('#trend-chart').isVisible(), true);
  assert.equal(await page.locator('#budget-list').isVisible(), false);
});

test('groups independent card and budget screens under Pagamentos',async()=>{
  const topLevel=await page.locator('.main-nav').evaluate(nav=>[...nav.children].map(item=>item.dataset.view||item.dataset.navGroup));
  assert.deepEqual(topLevel,['alertas','inicio','analises','lancamentos','categorias','contas','pagamentos']);
  const paymentsToggle=page.getByRole('button',{name:'Pagamentos'});
  assert.equal(await paymentsToggle.getAttribute('aria-expanded'),'true');
  await paymentsToggle.click();
  assert.equal(await page.getByRole('button',{name:'Orçamentos',exact:true}).isVisible(),false);
  await paymentsToggle.click();
  await page.getByRole('button',{name:'Orçamentos',exact:true}).click();
  assert.equal(await page.locator('#budget-view').isVisible(),true);
  assert.equal(await page.locator('#analytics-view').isVisible(),false);
  assert.equal(await page.getByRole('tab',{name:'Orçamentos'}).count(),0);
  await page.getByRole('button',{name:'Cartões',exact:true}).click();
  assert.equal(await page.locator('#cards-view').isVisible(),true);
  assert.equal(await page.locator('#budget-view').isVisible(),false);
});

test('reflects manually selected paid or received status in row actions after reopening',async()=>{
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  const addRecord=async(type,description,status='planned')=>{
    await page.locator('#new-expense').click();
    await page.locator(`input[name="record-type"][value="${type}"]`).check();
    await page.locator('#description').fill(description);
    await page.locator('#amount').fill('100,00');
    await page.locator('#record-status').selectOption(status);
    await page.locator('#save-expense').click();
  };
  const confirmAction=async(label)=>{
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.locator('#realization-form button[type="submit"]').click();
  };
  const reopen=async(label)=>{
    await page.getByRole('button',{name:label,exact:true}).click();
    await page.locator('#confirm-delete').click();
  };
  await addRecord('income','Receita recebida diretamente','realized');
  const directIncome=page.locator('#transactions-list .expense-row').filter({hasText:'Receita recebida diretamente'});
  assert.equal(await directIncome.getByRole('button',{name:'Reabrir Receita recebida diretamente'}).count(),1);
  assert.equal(await directIncome.getByText('Recebido',{exact:true}).count(),1);
  await addRecord('expense','Despesa paga diretamente','realized');
  const directExpense=page.locator('#transactions-list .expense-row').filter({hasText:'Despesa paga diretamente'});
  assert.equal(await directExpense.getByRole('button',{name:'Reabrir Despesa paga diretamente'}).count(),1);
  assert.equal(await directExpense.getByText('Pago',{exact:true}).count(),1);
  await addRecord('income','Receita reaberta');
  await confirmAction('Receber Receita reaberta');
  await reopen('Reabrir Receita reaberta');
  await page.getByRole('button',{name:'Editar Receita reaberta',exact:true}).click();
  await page.locator('#record-status').selectOption('realized');
  await page.locator('#save-expense').click();
  const receivedRow=page.locator('#transactions-list .expense-row').filter({hasText:'Receita reaberta'});
  assert.equal(await receivedRow.getByRole('button',{name:'Reabrir Receita reaberta'}).count(),1);
  assert.equal(await receivedRow.getByText('Recebido',{exact:true}).count(),1);

  await addRecord('expense','Despesa reaberta');
  await confirmAction('Pagar Despesa reaberta');
  await reopen('Reabrir Despesa reaberta');
  await page.getByRole('button',{name:'Editar Despesa reaberta',exact:true}).click();
  await page.locator('#record-status').selectOption('realized');
  await page.locator('#save-expense').click();
  const paidRow=page.locator('#transactions-list .expense-row').filter({hasText:'Despesa reaberta'});
  assert.equal(await paidRow.getByRole('button',{name:'Reabrir Despesa reaberta'}).count(),1);
  assert.equal(await paidRow.getByText('Pago',{exact:true}).count(),1);
});

test('shows actionable financial alerts and opens the related budget and card views',async()=>{
  const dates=await page.evaluate(()=>{
    const key=offset=>{const date=new Date();date.setDate(date.getDate()+offset);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
    const priorMonth=new Date();priorMonth.setDate(1);priorMonth.setMonth(priorMonth.getMonth()-1);
    return {today:key(0),late:key(-2),near:key(3),cardLate:`${priorMonth.getFullYear()}-${String(priorMonth.getMonth()+1).padStart(2,'0')}-01`,dueDay:Number(key(3).slice(-2))};
  });
  await page.evaluate(({today,late,near,cardLate,dueDay})=>{
    localStorage.setItem('meugasto-cards-v1',JSON.stringify([{id:'alerts-card',name:'Cartão alerta',bank:'Nubank',limit:2000,dueDay}]));
    localStorage.setItem('meu-financeiro-v1',JSON.stringify([
      {id:'budget-over',description:'Aluguel acima do limite',type:'expense',category:'Moradia',amount:200,installments:1,firstDate:today,payment:'Pix',status:'planned'},
      {id:'expense-late',description:'Conta atrasada',type:'expense',category:'Contas',amount:80,installments:1,firstDate:late,payment:'Pix',status:'planned'},
      {id:'expense-soon',description:'Conta próxima',type:'expense',category:'Compras',amount:40,installments:1,firstDate:near,payment:'Dinheiro',status:'planned'},
      {id:'card-late',description:'Fatura antiga',type:'expense',category:'Outros',amount:120,installments:1,firstDate:cardLate,payment:'Cartão',cardId:'alerts-card',card:'Cartão alerta'},
      {id:'card-soon',description:'Fatura próxima',type:'expense',category:'Lazer',amount:70,installments:1,firstDate:near,payment:'Cartão',cardId:'alerts-card',card:'Cartão alerta'},
    ]));
    localStorage.setItem('meugasto-budgets-v1',JSON.stringify([{category:'Moradia',amount:100}]));
  },dates);
  await page.reload();
  const alertsNav=page.getByRole('button',{name:/Alertas/});
  assert.ok(Number(await page.locator('#alert-count').innerText())>=5);
  await alertsNav.click();
  assert.equal(await page.locator('#alerts-view').isVisible(),true);
  assert.match(await page.locator('#alerts-groups').innerText(),/Conta atrasada/);
  assert.match(await page.locator('#alerts-groups').innerText(),/Cartão alerta/);
  assert.match(await page.locator('#alerts-groups').innerText(),/passou do limite/);
  await page.getByRole('button',{name:'Ver orçamento'}).click();
  assert.equal(await page.locator('#budget-view').isVisible(),true);
  assert.equal(await page.locator('#analytics-view').isVisible(),false);
  await alertsNav.click();
  await page.locator('#alerts-overdue').getByRole('button',{name:'Ver cartão'}).click();
  assert.equal(await page.locator('#cards-view').isVisible(),true);
  assert.match(await page.locator('#cards-list').innerText(),/Cartão alerta/);
  await alertsNav.click();
  await page.locator('#alerts-overdue').getByRole('button',{name:'Ver lançamento'}).click();
  assert.equal(await page.locator('#transactions-view').isVisible(),true);
  assert.match(await page.locator('#transactions-list').innerText(),/Conta atrasada/);
});


test('keeps projected balances in overview and realized totals in monthly closing', async () => {
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  const form=page.locator('#expense-dialog');
  for (const [type,name,value] of [['income','Salário previsto','1000,00'],['expense','Aluguel previsto','300,00']]) {
    await page.locator('#new-expense').click();
    await form.locator(`input[value="${type}"]`).check();
    await form.locator('#description').fill(name);
    await form.locator('#amount').fill(value);
    await form.locator('#record-status').selectOption('planned');
    await form.locator('#save-expense').click();
  }
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  assert.match(await page.locator('#month-balance').innerText(),/700,00/);
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  assert.match(await page.locator('#closing-balance').innerText(),/0,00/);
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.locator('#manage-income').click();
  await page.getByRole('button',{name:'Receber Salário previsto',exact:true}).click();
  await page.locator('#realization-form button[type="submit"]').click();
  await page.getByRole('button',{name:'Pagar Aluguel previsto',exact:true}).click();
  await page.locator('#realization-form button[type="submit"]').click();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  assert.match(await page.locator('#closing-balance').innerText(),/700,00/);
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.locator('#manage-income').click();
  await page.getByRole('button',{name:'Reabrir Aluguel previsto',exact:true}).click();
  await page.locator('#confirm-delete').click();
  await page.reload();
  assert.match(await page.locator('#month-balance').innerText(),/700,00/);
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  assert.match(await page.locator('#closing-balance').innerText(),/1.000,00/);
});

test('edits a fixed record for one month while preserving neighboring months and payment history', async () => {
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();
  const form=page.locator('#expense-dialog');
  await form.locator('#description').fill('Internet fixa');
  await form.locator('#amount').fill('100,00');
  await form.locator('#first-date').fill('2025-01-10');
  await form.locator('#recurring-record').check();
  await form.locator('#save-expense').click();
  await page.getByRole('button',{name:'Pagar Internet fixa',exact:true}).click();
  await page.locator('#realization-date').fill('2025-01-10');
  await page.locator('#realization-form button[type="submit"]').click();
  await page.locator('#month-picker').fill('2025-02');
  await page.locator('#month-picker').dispatchEvent('change');
  await page.getByRole('button',{name:'Pagar Internet fixa',exact:true}).click();
  await page.locator('#realization-date').fill('2025-02-10');
  await page.locator('#realization-form button[type="submit"]').click();
  await page.getByRole('button',{name:'Editar Internet fixa',exact:true}).click();
  await page.locator('#confirm-delete').click();
  await form.locator('#edit-scope').selectOption('month');
  await form.locator('#amount').fill('150,00');
  await form.locator('#first-date').fill('2025-02-20');
  await form.locator('#save-expense').click();
  assert.match(await page.locator('#transactions-list .expense-value').innerText(),/150,00/);
  await page.getByRole('button',{name:'Pagar Internet fixa',exact:true}).waitFor();
  await page.locator('#prev-month').click();
  await page.getByRole('button',{name:'Reabrir Internet fixa',exact:true}).waitFor();
  assert.match(await page.locator('#transactions-list .expense-value').innerText(),/100,00/);
  await page.locator('#next-month').click();
  await page.locator('#next-month').click();
  assert.match(await page.locator('#transactions-list .expense-value').innerText(),/100,00/);
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#month-picker').fill('2025-02');
  await page.locator('#month-picker').dispatchEvent('change');
  assert.match(await page.locator('#transactions-list .expense-value').innerText(),/150,00/);
});

test('saves category budgets, shows overruns and compares consecutive months', async () => {
  await page.getByRole('button',{name:'Orçamentos',exact:true}).click();
  await page.locator('#new-budget').click();
  await page.locator('#budget-category').selectOption('Moradia');
  await page.locator('#budget-amount').fill('100,00');
  await page.locator('#budget-form button[type="submit"]').click();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();
  await page.locator('#description').fill('Condomínio');
  await page.locator('#amount').fill('150,00');
  await page.locator('#save-expense').click();
  await page.getByRole('button',{name:'Orçamentos',exact:true}).click();
  assert.match(await page.locator('#budget-list').innerText(),/50,00 acima/);
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  await page.getByRole('tab',{name:'Evolução'}).click();
  assert.equal(await page.locator('#trend-chart .trend-month').count(),6);
  assert.equal(await page.locator('#trend-chart .trend-bar-income').count(),6);
  assert.equal(await page.locator('#trend-chart .trend-bar-expense').count(),6);
  const currentExpenseBar=page.locator('#trend-chart .trend-bar-expense').last();
  await currentExpenseBar.hover();
  const currentExpenseTooltip=currentExpenseBar.locator('xpath=..').locator('.trend-bar-tooltip');
  await page.waitForFunction(element=>getComputedStyle(element).opacity==='1',await currentExpenseTooltip.elementHandle());
  assert.equal(await currentExpenseTooltip.evaluate(element=>getComputedStyle(element).opacity),'1');
  assert.match(await currentExpenseTooltip.locator('text').textContent(),/150,00/);
  await page.locator('#trend-period').selectOption('12');
  assert.equal(await page.locator('#trend-chart .trend-month').count(),12);
  await page.reload();
  await page.getByRole('button',{name:'Orçamentos',exact:true}).click();
  assert.match(await page.locator('#budget-list').innerText(),/50,00 acima/);
  await page.getByRole('button',{name:'Excluir orçamento de Moradia',exact:true}).click();
  await page.locator('#confirm-delete').click();
  assert.match(await page.locator('#budget-list').innerText(),/Defina/);
});

test('preserves the first realized month when editing fixed series notes and allows future planned income', async () => {
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();
  await page.locator('#description').fill('Salário fixo recebido');
  await page.locator('input[name="record-type"][value="income"]').check();
  await page.locator('#amount').fill('1000,00');
  await page.locator('#recurring-record').check();
  await page.locator('#record-status').selectOption('realized');
  await page.locator('#save-expense').click();
  await page.getByRole('button',{name:'Editar Salário fixo recebido',exact:true}).click();
  assert.equal(await page.locator('#record-status').inputValue(),'realized');
  await page.locator('#notes').fill('Contrato mensal');
  await page.locator('#save-expense').click();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  assert.match(await page.locator('#closing-received').innerText(),/1.000,00/);
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.locator('#manage-income').click();
  await page.locator('#new-expense').click();
  await page.locator('input[name="record-type"][value="income"]').check();
  await page.locator('#description').fill('Serviço futuro');
  await page.locator('#amount').fill('200,00');
  await page.locator('#record-status').selectOption('planned');
  await page.locator('#first-date').fill('2099-01-15');
  await page.locator('#save-expense').click();
  assert.equal(await page.locator('#expense-dialog').isVisible(),false);
  await page.getByRole('button',{name:'Receber Serviço futuro',exact:true}).waitFor();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  assert.match(await page.locator('#closing-received').innerText(),/0,00/);
});

test('opens navigation and local backup controls on a narrow screen', async () => {
  await page.setViewportSize({width:390,height:844});
  try {
    await page.reload();
    const toggle=page.getByRole('button',{name:'Abrir menu lateral',exact:true});
    await toggle.click();
    await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
    assert.equal(await page.locator('#page-top-title').innerText(),'Lançamentos');
    await page.getByRole('button',{name:'Abrir menu lateral',exact:true}).click();
    await page.locator('#local-backups').click();
    await page.locator('#backups-dialog').waitFor({state:'visible'});
    await page.locator('#backups-dialog [data-close]').first().click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  } finally { await page.setViewportSize({width:1440,height:900}); }
});

test('deleting a confirmed receipt removes its confirmation from persisted data', async () => {
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();
  await page.locator('input[name="record-type"][value="income"]').check();
  await page.locator('#description').fill('Recebimento removido');
  await page.locator('#amount').fill('50,00');
  await page.locator('#record-status').selectOption('planned');
  await page.locator('#save-expense').click();
  await page.getByRole('button',{name:'Receber Recebimento removido',exact:true}).click();
  await page.locator('#realization-form button[type="submit"]').click();
  await page.getByRole('button',{name:'Excluir Recebimento removido',exact:true}).click();
  await page.locator('#confirm-delete').click();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('meugasto-card-payments-v1') || '[]')),[]);
});
