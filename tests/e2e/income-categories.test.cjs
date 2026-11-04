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
  await page.locator('#new-expense').click();

  assert.deepEqual(await page.locator('#category option').allTextContents(), [
    'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer',
    'Educação', 'Compras', 'Assinaturas', 'Contas', 'Outros',
  ]);
  assert.equal(await page.locator('.date-picker-control .date-picker-trigger').count(), 1);
  assert.equal(await page.locator('#first-date').evaluate(input =>
    getComputedStyle(input, '::-webkit-calendar-picker-indicator').display), 'none');
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
  const incomeRows=page.locator('#income-category-list .category-item');
  assert.deepEqual(await incomeRows.locator('.category-name').allTextContents(),['Salário','Prestação de serviço']);
  assert.deepEqual(await incomeRows.locator('.category-share').allTextContents(),['60%','40%']);
  assert.deepEqual(await page.locator('#category-list .category-share').allTextContents(),['100%']);
  const incomeColor=await incomeRows.filter({hasText:'Prestação de serviço'}).locator('.category-track i').evaluate(e=>getComputedStyle(e).backgroundColor);
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
  assert.equal(await page.locator('#income-category-list .category-item').count(),0);
  assert.match(await page.locator('#income-category-list').innerText(),/Nenhuma receita/);
  assert.equal(await page.locator('#category-list .category-item').count(),0);
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  assert.equal(await page.locator('#income-category-list .category-item').count(),2);
});
