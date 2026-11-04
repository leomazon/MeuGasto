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


test('creates, edits and deletes monthly income and updates the balance without inflating expenses', async () => {
  await page.evaluate(() => {
    const d = new Date();
    const firstDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([{ id:'rent', description:'Aluguel', type:'expense', amount:100, firstDate, installments:1, payment:'Pix', category:'Moradia' }]));
  });
  await page.reload();
  await page.getByRole('button', { name:'Receitas', exact:true }).click();
  await page.getByRole('button', { name:'Nova receita', exact:true }).click();
  const form = page.locator('#income-dialog');
  await form.getByLabel('Descrição').fill('Salário');
  await form.getByLabel('Valor recebido').fill('2500,50');
  await form.getByRole('button', { name:'Salvar receita', exact:true }).click();
  await page.getByRole('button', { name:'Visão geral', exact:true }).click();
  assert.equal((await page.locator('#income-total').innerText()).replace(/\s/g,' '), 'R$ 2.500,50');
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g,' '), 'R$ 2.400,50');
  assert.equal((await page.locator('#month-total').innerText()).replace(/\s/g,' '), 'R$ 100,00');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar backup' }).click();
  const backup = JSON.parse(fs.readFileSync(await (await downloaded).path(), 'utf8'));
  assert.equal(backup.expenses.find(entry => entry.type === 'income').amount, 2500.5);
  await page.getByRole('button', { name:'Receitas', exact:true }).click();
  await page.getByRole('button', { name:'Próximo mês', exact:true }).click();
  assert.equal(await page.getByRole('button', { name:'Editar receita Salário', exact:true }).count(), 0);
  await page.getByRole('button', { name:'Mês anterior', exact:true }).click();
  await page.getByRole('button', { name:'Editar receita Salário', exact:true }).click();
  await form.getByLabel('Valor recebido').fill('50,00');
  await form.getByRole('button', { name:'Salvar receita', exact:true }).click();
  await page.reload();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g,' '), '-R$ 50,00');
  await page.getByRole('button', { name:'Receitas', exact:true }).click();
  await page.getByRole('button', { name:'Excluir receita Salário', exact:true }).click();
  await page.locator('#delete-dialog').getByRole('button', { name:'Manter', exact:true }).click();
  assert.equal(await page.getByRole('button', { name:'Editar receita Salário', exact:true }).count(), 1);
  await page.getByRole('button', { name:'Excluir receita Salário', exact:true }).click();
  await page.locator('#delete-dialog').getByRole('button', { name:'Excluir receita', exact:true }).click();
  assert.equal(await page.getByRole('button', { name:'Editar receita Salário', exact:true }).count(), 0);
  await page.getByRole('button', { name:'Visão geral', exact:true }).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g,' '), '-R$ 100,00');
});
