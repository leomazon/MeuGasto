const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { before, after, test } = require('node:test');
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
      const extension = path.extname(filePath);
      response.writeHead(200, { 'content-type': extension === '.html' ? 'text/html; charset=utf-8'
        : extension === '.css' ? 'text/css; charset=utf-8'
          : extension === '.svg' ? 'image/svg+xml' : 'text/javascript; charset=utf-8' }).end(content);
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

test('creates Pix installments and pays each monthly installment independently', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  const form = page.locator('#expense-dialog');
  await form.locator('#description').fill('Compra Pix parcelada');
  assert.equal(await form.locator('#card-mode-wrap').isVisible(), true);
  await form.locator('#card-mode').selectOption('Parcelado');
  assert.equal(await form.locator('#amount-label').innerText(), 'Valor da parcela');
  await form.locator('#amount').fill('3000');
  assert.equal(await form.locator('#installments-wrap').isVisible(), true);
  assert.equal(await form.locator('#card-select-wrap').isHidden(), true);
  await form.locator('#installments').selectOption('3');
  await form.locator('#record-status').selectOption('realized');
  await form.locator('#save-expense').click();

  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.payment, 'Pix');
  assert.equal(entry.installments, 3);
  assert.equal(entry.amount, 90);
  assert.equal(await page.getByRole('button', { name: 'Reabrir Compra Pix parcelada' }).count(), 1);

  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pagar Compra Pix parcelada' }).count(), 1);
  await page.getByRole('button', { name: 'Pagar Compra Pix parcelada' }).click();
  await page.locator('#realization-dialog').getByRole('button', { name: 'Confirmar', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Reabrir Compra Pix parcelada' }).count(), 1);
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Pagar Compra Pix parcelada' }).count(), 1);
});

test('switching from an installment expense to income keeps the income as one receipt', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  await page.locator('#card-mode').selectOption('Parcelado');
  await page.locator('#installments').selectOption('3');
  await page.getByRole('radio', { name: 'Receita', exact: true }).check();
  assert.equal(await page.locator('#card-mode-wrap').isHidden(), true);
  await page.locator('#description').fill('Pagamento recebido');
  await page.locator('#amount').fill('5000');
  await page.locator('#save-expense').click();
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.type, 'income');
  assert.equal(entry.payment, 'Pix');
  assert.equal(entry.installments, 1);
  assert.equal(entry.amount, 50);
});

test('offers up to 24 installments while preserving older longer purchases on edit', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  await page.locator('#card-mode').selectOption('Parcelado');
  assert.deepEqual(await page.locator('#installments option').evaluateAll(options => options.map(option => Number(option.value))),
    Array.from({ length: 23 }, (_, index) => index + 2));
  await page.locator('#payment').selectOption('Cartão');
  assert.equal(await page.locator('#installments option:last-child').getAttribute('value'), '24');
  await page.locator('#close-dialog').click();

  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'old-long-pix', description: 'Parcelamento antigo', type: 'expense', amount: 300,
        installments: 30, payment: 'Pix', category: 'Compras', firstDate, status: 'planned' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Editar Parcelamento antigo' }).click();
  assert.equal(await page.locator('#installments').inputValue(), '30');
  await page.locator('#description').fill('Parcelamento antigo revisado');
  await page.locator('#save-expense').click();
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.installments, 30);
  assert.equal(entry.amount, 300);
});
