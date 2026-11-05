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

test('shows each launch share of its category total for the selected month', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'food-50', description: 'Compra grande', amount: 50, category: 'Alimentação', payment: 'Pix', installments: 1, firstDate, type: 'expense' },
      { id: 'food-25', description: 'Compra pequena', amount: 25, category: 'Alimentação', payment: 'Dinheiro', installments: 1, firstDate, type: 'expense' },
      { id: 'health-20', description: 'Farmácia', amount: 20, category: 'Saúde', payment: 'Pix', installments: 1, firstDate, type: 'expense' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Análises', exact: true }).click();
  await page.getByRole('tab', { name: 'Categorias' }).click();
  const composition = page.locator('#analysis-panel-categories .expense-composition-panel');
  assert.equal(await composition.locator('#category-list .category-item').count(), 2, 'expense category bars should sit inside the composition card beside the pie');
  assert.equal(await page.locator('#analysis-panel-categories .category-comparison #category-list').count(), 0, 'the separate expense category card should be removed');
  assert.equal(await page.locator('#analysis-panel-categories .category-comparison #income-category-list').count(), 1, 'income categories should remain available in their own panel');
  assert.equal(await composition.locator('#category-list .category-emoji.material-icons').count(), 2, 'each expense bar should keep its category icon');
  const overviewColors = await page.locator('#category-list .category-item').evaluateAll((items) => Object.fromEntries(items.map((item) => [
    item.querySelector('.category-name').textContent,
    getComputedStyle(item.querySelector('.category-track i')).backgroundColor,
  ])));
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();

  assert.equal(await page.getByRole('img', { name: /Compra grande.*66,7% da categoria Alimentação/ }).count(), 1);
  assert.equal(await page.getByRole('img', { name: /Compra pequena.*33,3% da categoria Alimentação/ }).count(), 1);
  assert.equal(await page.getByRole('img', { name: /Farmácia.*100% da categoria Saúde/ }).count(), 1);
  assert.deepEqual(await page.locator('.category-share-track i').evaluateAll((bars) => bars.map((bar) => bar.style.width)), ['66.7%', '33.3%', '100%']);
  const transactionColors = await page.locator('.transactions-list .expense-row').evaluateAll((rows) => rows.map((row) => ({
    description: row.querySelector('.expense-name strong').textContent,
    color: getComputedStyle(row.querySelector('.category-share-track i')).backgroundColor,
  })));
  assert.equal(transactionColors.find((item) => item.description === 'Compra grande').color, overviewColors.Alimentação);
  assert.equal(transactionColors.find((item) => item.description === 'Compra pequena').color, overviewColors.Alimentação);
  assert.equal(transactionColors.find((item) => item.description === 'Farmácia').color, overviewColors.Saúde);
});
