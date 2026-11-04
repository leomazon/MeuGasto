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

test('filters monthly launches by category and an inclusive BRL amount range', async () => {
  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'food-low', description: 'Feira pequena', amount: 10, category: 'Alimentação', payment: 'Pix', installments: 1, firstDate, type: 'expense' },
      { id: 'food-mid', description: 'Mercado', amount: 50, category: 'Alimentação', payment: 'Pix', installments: 1, firstDate, type: 'expense' },
      { id: 'home-mid', description: 'Lâmpada', amount: 40, category: 'Moradia', payment: 'Dinheiro', installments: 1, firstDate, type: 'expense' },
      { id: 'food-high', description: 'Compra grande', amount: 100, category: 'Alimentação', payment: 'Pix', installments: 1, firstDate, type: 'expense' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#amount-min').fill('10,00');
  await page.locator('#amount-max').fill('100,00');
  await page.locator('#category-filter').selectOption('Alimentação');

  assert.equal((await page.locator('#amount-min').inputValue()).replace(/\s/g, ' '), 'R$ 10,00');
  assert.equal((await page.locator('#amount-max').inputValue()).replace(/\s/g, ' '), 'R$ 100,00');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(), ['Feira pequena', 'Mercado', 'Compra grande']);

  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(), 4, 'clearing filters restores all monthly launches');
});

test('formats purchase amounts and card limits as Brazilian reais while typing', async () => {
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro' }).first().click();
  const expenseDialog = page.locator('#expense-dialog');
  await expenseDialog.locator('#description').fill('Compra formatada');
  await expenseDialog.locator('#amount').pressSequentially('123456');
  assert.equal((await expenseDialog.locator('#amount').inputValue()).replace(/\s/g, ' '), 'R$ 1.234,56');
  await expenseDialog.getByRole('button', { name: 'Salvar registro' }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  assert.equal((await page.locator('#month-total').innerText()).replace(/\s/g, ' '), 'R$ 1.234,56');
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))))[0].amount, 1234.56);

  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar cartão', exact: true }).click();
  const cardDialog = page.locator('#card-dialog');
  await cardDialog.locator('#card-name').fill('Cartão formatado');
  await cardDialog.locator('#card-bank').fill('Banco');
  await cardDialog.locator('#card-limit').pressSequentially('200000');
  assert.equal((await cardDialog.locator('#card-limit').inputValue()).replace(/\s/g, ' '), 'R$ 2.000,00');
  await cardDialog.locator('#card-due-day').fill('10');
  await cardDialog.getByRole('button', { name: 'Salvar cartão' }).click();
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-cards-v1'))))[0].limit, 2000);
});


test('sorts all filtered monthly records before pagination and resets the page on sort changes', async () => {
  await page.evaluate(() => {
    const d=new Date(); const month=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const entries=Array.from({length:12},(_,index)=>({id:`row-${index+1}`,description:`Registro ${index+1}`,type:index===11?'income':'expense',category:index===11?'Prestação de serviço':index%2?'Alimentação':'Moradia',amount:(index+1)*10,installments:1,payment:'Pix',firstDate:`${month}-${String(index+1).padStart(2,'0')}`}));
    localStorage.setItem('meu-financeiro-v1',JSON.stringify(entries));
  });
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.getByRole('button',{name:'Próxima página',exact:true}).click();
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('amount-asc');
  assert.equal(await page.locator('#page-indicator').innerText(),'1 / 2');
  assert.equal(await page.locator('#transactions-list .expense-name strong').first().innerText(),'Registro 1');
  await page.getByRole('button',{name:'Próxima página',exact:true}).click();
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Registro 11','Registro 12']);
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('amount-desc');
  assert.equal(await page.locator('#transactions-list .expense-name strong').first().innerText(),'Registro 12');
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('category-asc');
  assert.equal(await page.locator('#transactions-list .expense-name strong').first().innerText(),'Registro 10');
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('category-desc');
  assert.equal(await page.locator('#transactions-list .expense-name strong').first().innerText(),'Registro 12');
  await page.locator('#type-filter').selectOption('expense');
  await page.locator('#category-filter').selectOption('Moradia');
  await page.locator('#amount-min').fill('30,00');
  await page.locator('#amount-max').fill('80,00');
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('amount-asc');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Registro 3','Registro 5','Registro 7']);
  await page.locator('#clear-filters').click();
  assert.equal(await page.getByLabel('Ordenar por',{exact:true}).inputValue(),'date-desc');
  assert.equal(await page.locator('#transactions-list .expense-name strong').first().innerText(),'Registro 12');
});


test('filters payment and receipt methods, resets pagination and clears incompatible selections',async()=>{
  await page.evaluate(()=>{
    const d=new Date();const firstDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const rows=Array.from({length:11},(_,i)=>({id:`pix-${i}`,description:`Conta Pix ${i}`,type:'expense',category:'Moradia',payment:'Pix',amount:10,installments:1,firstDate}));
    rows.push({id:'card',description:'Conta cartão',type:'expense',category:'Moradia',payment:'Cartão',amount:300,installments:1,firstDate});
    rows.push({id:'transfer',description:'Salário transferência',type:'income',category:'Salário',payment:'Transferência',amount:250,installments:1,firstDate});
    rows.push({id:'income-pix',description:'Salário Pix',type:'income',category:'Salário',payment:'Pix',amount:100,installments:1,firstDate});
    localStorage.setItem('meu-financeiro-v1',JSON.stringify(rows));
  });
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.getByRole('button',{name:'Próxima página',exact:true}).click();
  await page.locator('#payment-filter').selectOption('Pix');
  assert.equal(await page.locator('#page-indicator').innerText(),'1 / 2');
  await page.locator('#type-filter').selectOption('income');
  assert.equal(await page.locator('#transactions-view').getByLabel('Forma de recebimento',{exact:true}).inputValue(),'Pix');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Salário Pix']);
  await page.locator('#payment-filter').selectOption('Transferência');
  await page.locator('#category-filter').selectOption('Salário');
  await page.locator('#amount-min').fill('150,00');
  await page.locator('#amount-max').fill('300,00');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Salário transferência']);
  await page.locator('#clear-filters').click();
  assert.equal(await page.locator('#payment-filter').inputValue(),'');
  await page.locator('#type-filter').selectOption('expense');
  await page.locator('#transactions-view').getByLabel('Forma de pagamento',{exact:true}).selectOption('Cartão');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Conta cartão']);
  await page.locator('#type-filter').selectOption('income');
  assert.equal(await page.locator('#payment-filter').inputValue(),'');
  assert.equal(await page.locator('#payment-filter option[value="Cartão"]').count(),0);
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
});
