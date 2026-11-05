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



test('manages income and expenses through one form and filters them by type and category', async () => {
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Receitas',exact:true}).count(),0);
  await page.getByRole('button',{name:'Novo registro',exact:true}).click();
  const form=page.locator('#expense-dialog');
  await form.getByRole('radio',{name:'Receita',exact:true}).check();
  await form.locator('#description').fill('Serviço recebido');
  await form.locator('#amount').fill('1000,00');
  await form.locator('#category').selectOption('Prestação de serviço');
  assert.equal(await form.locator('#card-details-row').isHidden(),true);
  assert.equal(await form.locator('#payment option[value="Cartão"]').count(),0);
  await form.getByRole('button',{name:'Salvar registro',exact:true}).click();
  await page.getByRole('button',{name:'Novo registro',exact:true}).click();
  await form.locator('#description').fill('Material');
  await form.locator('#amount').fill('100,00');
  await form.locator('#category').selectOption('Compras');
  await form.getByRole('button',{name:'Salvar registro',exact:true}).click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
  await page.locator('#type-filter').selectOption('income');
  await page.locator('#category-filter').selectOption('Prestação de serviço');
  await page.locator('#amount-min').fill('900,00');
  await page.waitForFunction(()=>document.querySelector('#transactions-list').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#transactions-list .expense-row').count(),1);
  await page.getByRole('button',{name:'Editar Serviço recebido',exact:true}).click();
  assert.equal(await form.getByRole('radio',{name:'Receita',exact:true}).isChecked(),true);
  await form.locator('#category').selectOption('Salário');
  await form.locator('#amount').fill('1500,00');
  await form.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await page.locator('#clear-filters').click();
  await page.locator('#type-filter').selectOption('expense');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Material']);
  await page.locator('#clear-filters').click();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g,' '),'R$ 1.400,00');
  await page.getByRole('tab',{name:'Pagamentos'}).click();
  assert.equal((await page.locator('#month-total').innerText()).replace(/\s/g,' '),'R$ 100,00');
  await page.getByRole('tab',{name:'Saldo'}).click();
  await page.locator('#manage-income').click();
  assert.equal(await page.locator('#type-filter').inputValue(),'');
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Baixar backup'}).click();
  const backup=JSON.parse(fs.readFileSync(await (await downloaded).path(),'utf8'));
  assert.equal(backup.expenses.find(e=>e.type==='income').category,'Salário');
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.getByRole('button',{name:'Excluir Serviço recebido',exact:true}).click();
  await page.locator('#delete-dialog').getByRole('button',{name:'Manter',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Editar Serviço recebido',exact:true}).count(),1);
  await page.getByRole('button',{name:'Excluir Serviço recebido',exact:true}).click();
  await page.locator('#delete-dialog').getByRole('button',{name:'Excluir registro',exact:true}).click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(),1);
});

test('preserves older income categories and can reclassify a record without losing its value', async () => {
  await page.evaluate(() => {
    const d=new Date();
    const firstDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    localStorage.setItem('meu-financeiro-v1',JSON.stringify([{id:'old-income',type:'income',category:'Receitas',payment:'Transferência',amount:35.5,firstDate,installments:1,description:'Receita anterior'}]));
  });
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.locator('#type-filter').selectOption('income');
  await page.locator('#category-filter').selectOption('Receitas');
  assert.equal(await page.locator('#transactions-list').getByText('Liquidado',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Editar Receita anterior',exact:true}).click();
  const form=page.locator('#expense-dialog');
  assert.equal(await form.locator('#category').inputValue(),'Receitas');
  await form.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await page.getByRole('button',{name:'Editar Receita anterior',exact:true}).click();
  await form.getByRole('radio',{name:'Despesa',exact:true}).check();
  await form.locator('#category').selectOption('Moradia');
  await form.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await page.locator('#clear-filters').click();
  const entry=await page.evaluate(()=>JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.type,'expense');
  assert.equal(entry.amount,35.5);
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g,' '),'-R$ 35,50');
});
