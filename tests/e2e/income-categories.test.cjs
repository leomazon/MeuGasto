const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
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

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});


test('keeps category option labels clean and hides the native calendar control', async () => {
  await page.goto(appUrl);
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();

  assert.deepEqual(await page.locator('#category option').allTextContents(), [
    'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer',
    'Educação', 'Compras', 'Assinaturas', 'Contas', 'Outros',
  ]);
  assert.equal(await page.locator('#first-date').evaluate(input =>
    input.closest('.date-picker-control').querySelectorAll('.date-picker-trigger').length), 1);
  const dateControl = await page.locator('#first-date').evaluate(input => {
    const icon = input.closest('.date-picker-control').querySelector('.date-picker-trigger');
    const inputRect = input.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      nativeInputPointerEvents: getComputedStyle(input).pointerEvents,
      verticalCenterOffset: Math.abs((inputRect.top + inputRect.height / 2) - (iconRect.top + iconRect.height / 2)),
    };
  });
  assert.equal(dateControl.nativeInputPointerEvents, 'none');
  assert.ok(dateControl.verticalCenterOffset <= 1);
});

test('shows Material icons in expense and income category choices', async () => {
  await page.goto(appUrl);
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();
  assert.equal(await page.locator('input[name="record-type"][value="expense"] + span').evaluate(button=>getComputedStyle(button).backgroundColor),'rgb(180, 71, 82)');

  await page.locator('#category-trigger').click();
  const expenseOptions=page.locator('#category-options [role="option"]');
  assert.equal(await expenseOptions.count(),10);
  assert.equal(await expenseOptions.first().locator('.material-icons').innerText(),'home');
  await expenseOptions.filter({hasText:'Alimentação'}).click();
  assert.equal(await page.locator('#category').inputValue(),'Alimentação');
  assert.equal(await page.locator('#category-selected-name').innerText(),'Alimentação');

  await page.locator('input[name="record-type"][value="income"]').check();
  await page.locator('#category-trigger').click();
  const incomeOptions=page.locator('#category-options [role="option"]');
  assert.equal(await incomeOptions.count(),6);
  assert.equal(await incomeOptions.first().locator('.material-icons').innerText(),'handyman');
  assert.equal(await incomeOptions.filter({hasText:'Trabalho físico'}).count(),0);
  const otherIncomeIcon=incomeOptions.filter({hasText:'Outras receitas'}).locator('.material-icons');
  assert.equal(await otherIncomeIcon.innerText(),'north_east');
  assert.notEqual(await otherIncomeIcon.evaluate(icon=>getComputedStyle(icon).color),'rgb(180, 71, 82)');
  await incomeOptions.filter({hasText:'Vendas'}).click();
  assert.equal(await page.locator('#category').inputValue(),'Vendas');
  assert.equal(await page.locator('#category-selected-icon').innerText(),'shopping_bag');
});

test('shows centered icons for payment methods and keeps the selected method in the form', async () => {
  await page.goto(appUrl);
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#new-expense').click();
  await page.locator('#payment-trigger').click();

  const methods=page.locator('#payment-options [role="option"]');
  assert.deepEqual(await methods.evaluateAll(elements=>elements.map(option=>option.lastElementChild.textContent)),['Pix','Transferência','Dinheiro','Cartão']);
  assert.equal(await methods.nth(0).locator('.payment-picker-pix').count(),1);
  assert.equal(await methods.filter({hasText:'Dinheiro'}).locator('.material-icons').innerText(),'payments');
  assert.equal(await methods.filter({hasText:'Cartão'}).locator('.material-icons').innerText(),'credit_card');
  await methods.filter({hasText:'Dinheiro'}).click();
  assert.equal(await page.locator('#payment').inputValue(),'Dinheiro');
  assert.equal(await page.locator('#payment-selected-name').innerText(),'Dinheiro');
  const iconStyle=await page.locator('#payment-selected-icon').evaluate(icon=>getComputedStyle(icon));
  assert.equal(iconStyle.display,'grid');
  assert.equal(iconStyle.alignItems,'center');
  assert.equal(iconStyle.justifyItems,'center');

  await page.locator('input[name="record-type"][value="income"]').check();
  await page.locator('#payment-trigger').click();
  const receiptMethods=page.locator('#payment-options [role="option"]');
  assert.deepEqual(await receiptMethods.evaluateAll(elements=>elements.map(option=>option.lastElementChild.textContent)),['Transferência','Pix','Dinheiro']);
  assert.equal(await receiptMethods.first().locator('.material-icons').innerText(),'account_balance');
});


test('shows separate monthly category charts and income shares that survive filtering', async () => {
  await page.goto(appUrl);
  await page.evaluate(()=>{
    localStorage.clear(); const d=new Date();
    const firstDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    localStorage.setItem('meu-financeiro-v1',JSON.stringify([
      {id:'service-a',description:'Serviço principal',type:'income',category:'Prestação de serviço',amount:300,installments:1,firstDate,payment:'Pix'},
      {id:'service-b',description:'Serviço menor',type:'income',category:'Prestação de serviço',amount:100,installments:1,firstDate,payment:'Pix'},
      {id:'salary',description:'Salário recebido',type:'income',category:'Salário',amount:600,installments:1,firstDate,payment:'Transferência'},
      {id:'rent',description:'Aluguel',type:'expense',category:'Moradia',amount:500,installments:1,firstDate,payment:'Pix'},
    ]));
  });
  await page.reload();
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  await page.getByRole('tab',{name:'Categorias'}).click();
  const incomeRows=page.locator('#income-category-list .category-item');
  assert.deepEqual(await incomeRows.locator('.category-name').allTextContents(),['Salário','Prestação de serviço']);
  assert.deepEqual(await incomeRows.locator('.category-share').allTextContents(),['60%','40%']);
  assert.deepEqual(await page.locator('#category-list .category-share').allTextContents(),['100%']);
  const incomePie=page.locator('#income-category-pie');
  assert.equal(await incomePie.locator('.category-pie-slice').count(),2);
  assert.equal(await page.locator('.income-composition-panel #income-category-list .category-item').count(),2);
  const incomeColors=await incomePie.locator('.category-pie-slice').evaluateAll(slices=>slices.map(slice=>slice.getAttribute('stroke')));
  assert.equal(new Set(incomeColors).size,2);
  assert.equal(await incomePie.locator('.category-pie-slice').nth(1).evaluate(e=>getComputedStyle(e).stroke),
    await incomeRows.filter({hasText:'Prestação de serviço'}).locator('.category-track i').evaluate(e=>getComputedStyle(e).backgroundColor));
  await incomePie.locator('.category-pie-slice').nth(1).focus();
  assert.equal(await page.locator('#income-pie-center-category').innerText(),'Prestação de serviço');
  assert.match((await page.locator('#income-pie-center-amount').innerText()).replace(/\u00a0/g,' '),/R\$ 400,00/);
  assert.match(await page.locator('#income-pie-center-details').innerText(),/40% das receitas/);
  await page.locator('#all-income-categories').focus();
  assert.equal(await page.locator('#income-pie-center-category').innerText(),'Total das receitas');
  const incomeColor=await incomeRows.filter({hasText:'Prestação de serviço'}).locator('.category-track i').evaluate(e=>getComputedStyle(e).backgroundColor);
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  await page.locator('#all-income-categories').click();
  assert.equal(await page.locator('#type-filter').inputValue(),'income');
  const mainRow=page.locator('#transactions-list .expense-row').filter({hasText:'Serviço principal'});
  assert.match(await mainRow.locator('.category-share').getAttribute('aria-label'),/75% da categoria Prestação de serviço/);
  assert.equal(await mainRow.locator('.category-share-track i').evaluate(e=>getComputedStyle(e).backgroundColor),incomeColor);
  await page.locator('#search-input').fill('Serviço principal');
  await page.waitForFunction(()=>document.querySelector('#transactions-list').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#transactions-list .expense-row').count(),1);
  assert.match(await mainRow.locator('.category-share').innerText(),/75%/);
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  await page.getByRole('button',{name:'Análises',exact:true}).click();
  assert.equal(await page.locator('#income-category-list .category-item').count(),0);
  assert.match(await page.locator('#income-category-list').innerText(),/Nenhuma receita/);
  assert.equal(await incomePie.locator('.category-pie-slice').count(),0);
  assert.equal(await page.locator('#income-pie-center-category').innerText(),'Sem receitas previstas');
  assert.equal(await page.locator('#category-list .category-item').count(),0);
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  assert.equal(await page.locator('#income-category-list .category-item').count(),2);
});
