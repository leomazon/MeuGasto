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

test('shows the average charge with the overview payment breakdown', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'home', description: 'Aluguel', amount: 200, category: 'Moradia', payment: 'Pix', installments: 1, firstDate, type: 'expense' },
      { id: 'food', description: 'Mercado', amount: 50, category: 'Alimentação', payment: 'Dinheiro', installments: 1, firstDate, type: 'expense' },
      { id: 'fun', description: 'Cinema', amount: 30, category: 'Lazer', payment: 'Cartão', installments: 1, firstDate, type: 'expense' },
    ]));
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Despesas' }).click();

  assert.equal((await page.locator('#average-charge').textContent()).replace(/\s+/g, ' ').trim(), 'R$ 93,33');
  assert.equal(await page.locator('#average-charge-count').textContent(), 'em 3 cobranças');
});

test('shows a larger expense category pie in analysis and identifies slices on hover', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'income', description: 'Salário', type: 'income', amount: 1000, category: 'Salário', payment: 'Pix', installments: 1, firstDate, status: 'planned' },
      { id: 'home', description: 'Aluguel', type: 'expense', amount: 200, category: 'Moradia', payment: 'Pix', installments: 1, firstDate, status: 'planned' },
      { id: 'food', description: 'Mercado', type: 'expense', amount: 100, category: 'Alimentação', payment: 'Dinheiro', installments: 1, firstDate, status: 'planned' },
    ]));
  });
  await page.reload();

  await page.getByRole('button', { name: 'Análises', exact: true }).click();
  await page.getByRole('tab', { name: 'Categorias' }).click();
  const pie = page.locator('#expense-category-pie');
  assert.equal(await pie.isVisible(), true);
  assert.equal(await page.locator('#income-commitment #expense-category-pie').count(), 0);
  assert.equal(await pie.locator('.category-pie-slice').count(), 2);
  assert.match(await pie.getAttribute('aria-label'), /Moradia.*66,7%.*Alimentação.*33,3%/);
  assert.ok((await pie.boundingBox()).width >= 230, 'the category analysis should give the pie room to read');
  await pie.locator('.category-pie-slice[data-category="Moradia"]').hover({ position: { x: 205, y: 118 } });
  assert.equal(await page.locator('#category-pie-center-category').innerText(), 'Moradia');
  assert.match((await page.locator('#category-pie-center-amount').innerText()).replace(/\u00a0/g, ' '), /R\$ 200,00/);
  assert.match(await page.locator('#category-pie-center-details').innerText(), /66,7%/);
});

test('shows the newest expenses first and matches their count to category rows', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const categories = ['Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Lazer', 'Educação', 'Compras'];
    const expenses = [
      ...categories.map((category, index) => ({ id: `older-${index}`, description: `Antigo ${index + 1}`, amount: 10, category, payment: 'Pix', installments: 1, firstDate, type: 'expense' })),
      ...categories.map((category, index) => ({ id: `newer-${index}`, description: `Recente ${index + 1}`, amount: 20, category, payment: 'Pix', installments: 1, firstDate, type: 'expense' })),
    ];
    localStorage.setItem('meu-financeiro-v1', JSON.stringify(expenses));
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Recentes' }).click();

  assert.equal(await page.locator('#recent-list .expense-row').count(), 7, 'recent expenses should show as many items as the category breakdown');
  assert.equal(await page.locator('#recent-list .expense-name strong').first().textContent(), 'Recente 7', 'the most recently added expense should appear first when dates match');
  assert.equal(await page.locator('#recent-list .expense-name strong').last().textContent(), 'Recente 1', 'older expenses should follow newer expenses');
});
