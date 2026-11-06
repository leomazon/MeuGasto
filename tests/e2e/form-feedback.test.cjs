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
      const extension = path.extname(filePath);
      const contentType = extension === '.html' ? 'text/html; charset=utf-8'
        : extension === '.css' ? 'text/css; charset=utf-8'
          : extension === '.svg' ? 'image/svg+xml' : 'text/javascript; charset=utf-8';
      response.writeHead(200, { 'content-type': contentType }).end(content);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  appUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo' });
  page.setDefaultTimeout(3000);
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test('shows accessible Portuguese field errors instead of browser validation bubbles', async () => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.locator('#new-card').click();
  await page.locator('#save-card').click();

  assert.equal(await page.locator('#card-form').evaluate((form) => form.noValidate), true);
  assert.equal(await page.locator('#card-name').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#field-error-card-name').innerText(), 'Informe o nome do cartão.');
  assert.equal(await page.locator('#card-bank-trigger').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#field-error-card-bank').innerText(), 'Selecione o banco ou emissor do cartão.');
  assert.equal(await page.locator('#field-error-card-limit').innerText(), 'Informe um limite maior que zero.');
  assert.equal(await page.locator('#field-error-card-closing-day').innerText(), 'Informe um dia de fechamento entre 1 e 31.');
  assert.equal(await page.locator('#field-error-card-due-day').innerText(), 'Informe um dia de vencimento entre 1 e 31.');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'card-name');
});

test('clears a corrected card field error and shows a success toast after saving', async () => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.locator('#new-card').click();
  await page.locator('#save-card').click();
  await page.getByLabel('Nome do cartão').fill('Cartão Feedback');
  assert.equal(await page.locator('#card-name').getAttribute('aria-invalid'), 'false');
  assert.equal(await page.locator('#field-error-card-name').count(), 0);
  await page.locator('#card-bank-trigger').click();
  await page.locator('#bank-options [data-bank-option="Banco do Brasil"]').click();
  await page.getByLabel('Limite total').fill('100000');
  await page.getByLabel('Dia de vencimento mensal').fill('15');
  await page.getByLabel('Dia de fechamento mensal').fill('4');
  await page.locator('#save-card').click();

  assert.equal(await page.locator('.notyf__toast--success .notyf__message').innerText(), 'Cartão salvo.');
});

test('shows expense field errors in Portuguese and confirms a saved record', async () => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#new-expense').click();
  await page.locator('#save-expense').click();

  assert.equal(await page.locator('#expense-form').evaluate((form) => form.noValidate), true);
  assert.equal(await page.locator('#description').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#field-error-description').innerText(), 'Informe a descrição deste registro.');
  assert.equal(await page.locator('#field-error-amount').innerText(), 'Informe um valor maior que zero.');

  await page.getByLabel('Descrição').fill('Mercado');
  await page.getByLabel('Valor total').fill('2550');
  await page.locator('#save-expense').click();
  assert.equal(await page.locator('.notyf__toast--success .notyf__message').innerText(), 'Registro salvo.');
});

test('shows branded accessible success and error notifications in a stack', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    showToast('Registro salvo.', 'success');
    showToast('Não foi possível salvar.', 'error');
  });

  const toasts = page.locator('.notyf__toast');
  assert.equal(await toasts.count(), 2);
  assert.equal(await page.locator('.notyf__toast--success .notyf__message').innerText(), 'Registro salvo.');
  assert.equal(await page.locator('.notyf__toast--error .notyf__message').innerText(), 'Não foi possível salvar.');
  assert.equal(await page.locator('.notyf__toast--success .material-icons').innerText(), 'check_circle');
  assert.equal(await page.locator('.notyf__toast--error .material-icons').innerText(), 'error');
  assert.equal(await page.locator('.notyf-announcer').getAttribute('aria-live'), 'polite');
});
