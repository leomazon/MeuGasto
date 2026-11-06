const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');

const appRoot = path.resolve(__dirname, '../..');
let server, browser, page, appUrl;

before(async () => {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(appRoot, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!filePath.startsWith(`${appRoot}${path.sep}`)) { response.writeHead(404).end(); return; }
    fs.readFile(filePath, (error, content) => {
      if (error) { response.writeHead(404).end(); return; }
      const type = path.extname(filePath) === '.html' ? 'text/html; charset=utf-8'
        : path.extname(filePath) === '.css' ? 'text/css; charset=utf-8'
          : path.extname(filePath) === '.svg' ? 'image/svg+xml' : 'text/javascript; charset=utf-8';
      response.writeHead(200, { 'content-type': type }).end(content);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  appUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo' });
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

test('creates, renames and archives a revenue category without losing its records', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Categorias', exact: true }).click();
  await page.getByRole('tab', { name: 'Receitas' }).click();
  await page.locator('#new-category').click();
  await page.locator('#category-name').fill('Freelas');
  await page.locator('#managed-category-icon').selectOption('handyman');
  await page.locator('#managed-category-color').fill('#168b84');
  await page.locator('#category-form').getByRole('button', { name: 'Salvar categoria' }).click();
  assert.equal(await page.locator('#managed-income-categories .category-manager-card').filter({ hasText: 'Freelas' }).count(), 1);

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#new-expense').click();
  await page.getByRole('radio', { name: 'Receita', exact: true }).check();
  await page.locator('#category-trigger').click();
  await page.locator('#category-options [role="option"]').filter({ hasText: 'Freelas' }).click();
  await page.locator('#description').fill('Projeto concluído');
  await page.locator('#amount').fill('18000');
  await page.locator('#save-expense').click();
  assert.match(await page.locator('#transactions-list').innerText(), /Freelas/);

  await page.getByRole('button', { name: 'Categorias', exact: true }).click();
  await page.getByRole('tab', { name: 'Receitas' }).click();
  await page.getByRole('button', { name: 'Editar Freelas' }).click();
  await page.locator('#category-name').fill('Projetos');
  await page.locator('#managed-category-color').fill('#28774f');
  await page.locator('#category-form').getByRole('button', { name: 'Salvar categoria' }).click();
  await page.getByRole('button', { name: 'Arquivar Projetos' }).click();
  assert.match(await page.locator('#managed-income-categories').innerText(), /Arquivada/);

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  assert.match(await page.locator('#transactions-list').innerText(), /Projetos/);
  assert.equal(await page.locator('#category-filter option[value="Projetos"]').count(), 1);
  await page.locator('#new-expense').click();
  await page.getByRole('radio', { name: 'Receita', exact: true }).check();
  assert.equal(await page.locator('#category option[value="Projetos"]').count(), 0);
  await page.locator('#close-dialog').click();
  await page.reload();
  await page.getByRole('button', { name: 'Análises', exact: true }).click();
  await page.getByRole('tab', { name: 'Categorias' }).click();
  assert.match(await page.locator('#income-category-list').innerText(), /Projetos/);
  assert.equal(await page.locator('#income-category-pie .category-pie-slice').getAttribute('stroke'), '#28774f');
});

test('keeps an existing budget and recurring month exception when an expense category is renamed', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    const d = new Date();
    const firstDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([{ id: 'rent', description: 'Aluguel mensal', type: 'expense', category: 'Moradia', amount: 120, payment: 'Pix', installments: 1, firstDate, recurring: true, overrides: { [nextMonth]: { category: 'Moradia', amount: 130 } } }]));
    localStorage.setItem('meugasto-budgets-v1', JSON.stringify([{ category: 'Moradia', amount: 200 }]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Categorias', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Moradia' }).click();
  await page.locator('#category-name').fill('Casa');
  await page.locator('#category-form').getByRole('button', { name: 'Salvar categoria' }).click();
  await page.getByRole('button', { name: 'Arquivar Casa' }).click();

  await page.getByRole('button', { name: 'Orçamentos', exact: true }).click();
  assert.match(await page.locator('#budget-list').innerText(), /Casa/);
  await page.locator('#new-budget').click();
  assert.equal(await page.locator('#budget-category option[value="Casa"]').count(), 0);
  await page.locator('#budget-dialog [data-close]').first().click();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  assert.match(await page.locator('#transactions-list').innerText(), /Casa/);
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  assert.match(await page.locator('#transactions-list').innerText(), /Casa/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(stored.category, 'Casa');
  assert.equal(Object.values(stored.overrides)[0].category, 'Casa');
});

test('offers Financing among expense categories with its finance icon', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#new-expense').click();
  await page.locator('#category-trigger').click();

  const option = page.locator('#category-options [role="option"]').filter({ hasText: 'Financiamento' });
  assert.equal(await option.count(), 1);
  assert.equal(await option.locator('.material-icons').innerText(), 'account_balance');
  await option.click();
  assert.equal(await page.locator('#category-selected-name').innerText(), 'Financiamento');
});
