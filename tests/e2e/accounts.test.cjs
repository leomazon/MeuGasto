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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  appUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Sao_Paulo' });
});

beforeEach(async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

test('tracks linked income and expenses in account balances while transfers stay out of monthly income and expenses', async () => {
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });

  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  await page.locator('#new-account').click();
  let accountForm = page.locator('#account-dialog');
  await accountForm.locator('#account-name').fill('Conta principal');
  await accountForm.locator('#account-kind').selectOption('checking');
  await accountForm.locator('#account-opening-balance').fill('50000');
  await accountForm.locator('#account-opening-date').fill(today);
  await accountForm.getByRole('button', { name: 'Salvar conta', exact: true }).click();

  await page.locator('#new-account').click();
  accountForm = page.locator('#account-dialog');
  await accountForm.locator('#account-name').fill('Carteira');
  await accountForm.locator('#account-kind').selectOption('cash');
  await accountForm.locator('#account-opening-balance').fill('5000');
  await accountForm.locator('#account-opening-date').fill(today);
  await accountForm.getByRole('button', { name: 'Salvar conta', exact: true }).click();

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  const recordForm = page.locator('#expense-dialog');
  await recordForm.locator('#description').fill('Mercado');
  await recordForm.locator('#amount').fill('3000');
  await recordForm.locator('#record-account').selectOption({ label: 'Conta principal' });
  await recordForm.getByRole('button', { name: 'Salvar registro', exact: true }).click();

  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  await recordForm.getByRole('radio', { name: 'Receita', exact: true }).check();
  await recordForm.locator('#description').fill('Salário');
  await recordForm.locator('#amount').fill('10000');
  await recordForm.locator('#record-account').selectOption({ label: 'Conta principal' });
  await recordForm.getByRole('button', { name: 'Salvar registro', exact: true }).click();

  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.locator('#new-card').click();
  const cardForm = page.locator('#card-dialog');
  await cardForm.locator('#card-name').fill('Cartão teste');
  await cardForm.locator('#card-bank').selectOption('Nubank');
  await cardForm.locator('#card-limit').fill('100000');
  await cardForm.locator('#card-due-day').fill('10');
  await cardForm.getByRole('button', { name: 'Salvar cartão', exact: true }).click();

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  await recordForm.locator('#description').fill('Compra no crédito');
  await recordForm.locator('#amount').fill('6000');
  await recordForm.locator('#payment').selectOption('Cartão');
  await recordForm.locator('#card-select').selectOption({ label: 'Cartão teste · Nubank' });
  await recordForm.getByRole('button', { name: 'Salvar registro', exact: true }).click();

  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g, ' '), 'R$ 10,00');

  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.locator('#cards-list').getByRole('button', { name: 'Liquidar fatura' }).click();
  const settlementForm = page.locator('#settlement-dialog');
  await settlementForm.locator('#settlement-method').selectOption('Transferência');
  await settlementForm.locator('#settlement-account').selectOption({ label: 'Conta principal' });
  await settlementForm.getByRole('button', { name: 'Confirmar pagamento', exact: true }).click();

  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  await page.getByRole('button', { name: 'Nova transferência', exact: true }).click();
  const transferForm = page.locator('#transfer-dialog');
  await transferForm.locator('#transfer-from').selectOption({ label: 'Conta principal' });
  await transferForm.locator('#transfer-to').selectOption({ label: 'Carteira' });
  await transferForm.locator('#transfer-amount').fill('4000');
  await transferForm.locator('#transfer-date').fill(today);
  await transferForm.getByRole('button', { name: 'Salvar transferência', exact: true }).click();

  assert.equal((await page.locator('#accounts-total-balance').innerText()).replace(/\s/g, ' '), 'R$ 560,00');
  const accounts = (await page.locator('#account-list').innerText()).replace(/\s/g, ' ');
  assert.match(accounts, /Conta principal[\s\S]*R\$ 470,00/);
  assert.match(accounts, /Carteira[\s\S]*R\$ 90,00/);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g, ' '), 'R$ 10,00', 'an internal transfer is neither income nor an expense');
});

test('debits a linked account when a planned cash expense is confirmed as paid', async () => {
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  await page.locator('#new-account').click();
  const accountForm = page.locator('#account-dialog');
  await accountForm.locator('#account-name').fill('Principal');
  await accountForm.locator('#account-opening-balance').fill('50000');
  await accountForm.locator('#account-opening-date').fill(today);
  await accountForm.getByRole('button', { name: 'Salvar conta', exact: true }).click();

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  const recordForm = page.locator('#expense-dialog');
  await recordForm.locator('#description').fill('Conta pendente');
  await recordForm.locator('#amount').fill('10000');
  await recordForm.locator('#record-status').selectOption('planned');
  await recordForm.getByRole('button', { name: 'Salvar registro', exact: true }).click();

  await page.getByRole('button', { name: 'Pagar Conta pendente', exact: true }).click();
  const realizationForm = page.locator('#realization-dialog');
  await realizationForm.waitFor({ state: 'visible' });
  await realizationForm.locator('#realization-account').selectOption({ label: 'Principal' });
  await realizationForm.getByRole('button', { name: 'Confirmar', exact: true }).click();

  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  assert.equal((await page.locator('#accounts-total-balance').innerText()).replace(/\s/g, ' '), 'R$ 400,00');
});

test('reconciles an account, keeps each adjustment in history and leaves monthly income and expenses unchanged', async () => {
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  await page.locator('#new-account').click();
  const accountForm = page.locator('#account-dialog');
  await accountForm.locator('#account-name').fill('Conta principal');
  await accountForm.locator('#account-opening-balance').fill('50000');
  await accountForm.locator('#account-opening-date').fill(today);
  await accountForm.getByRole('button', { name: 'Salvar conta', exact: true }).click();

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo registro', exact: true }).click();
  const recordForm = page.locator('#expense-dialog');
  await recordForm.locator('#description').fill('Compra debitada');
  await recordForm.locator('#amount').fill('10000');
  await recordForm.locator('#record-account').selectOption({ label: 'Conta principal' });
  await recordForm.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  const monthlyBalanceBefore = (await page.locator('#month-balance').innerText()).replace(/\s/g, ' ');

  await page.getByRole('button', { name: 'Contas', exact: true }).click();
  const accountList = page.locator('#account-list');
  await accountList.getByRole('button', { name: 'Conferir saldo' }).click();
  let reconciliation = page.locator('#reconciliation-dialog');
  await reconciliation.waitFor({ state: 'visible' });
  assert.match(await reconciliation.locator('#reconciliation-expected').innerText(), /400,00/);
  await reconciliation.locator('#reconciliation-actual').fill('35000');
  assert.match(await reconciliation.locator('#reconciliation-adjustment').innerText(), /-R\$\s50,00/);
  await reconciliation.getByRole('button', { name: 'Registrar ajuste', exact: true }).click();
  assert.match(await accountList.innerText(), /R\$\s350,00/);

  await accountList.getByRole('button', { name: 'Conferir saldo' }).click();
  reconciliation = page.locator('#reconciliation-dialog');
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await reconciliation.locator('#reconciliation-date').fill(yesterday);
  await reconciliation.locator('#reconciliation-actual').fill('32000');
  await reconciliation.getByRole('button', { name: 'Registrar ajuste', exact: true }).click();
  assert.equal(await page.locator('#reconciliation-list .reconciliation-row').count(), 1, 'a date before the last reconciliation cannot be saved');
  assert.match(await reconciliation.innerText(), /A data deve ser igual ou posterior à última conferência de saldo/);
  await reconciliation.locator('#reconciliation-date').fill(today);
  assert.match(await reconciliation.locator('#reconciliation-expected').innerText(), /350,00/);
  await reconciliation.locator('#reconciliation-actual').fill('32000');
  assert.match(await reconciliation.locator('#reconciliation-adjustment').innerText(), /-R\$\s30,00/);
  await reconciliation.getByRole('button', { name: 'Registrar ajuste', exact: true }).click();

  const history = page.locator('#reconciliation-list');
  assert.equal(await history.locator('.reconciliation-row').count(), 2);
  assert.match(await history.innerText(), /R\$\s350,00/);
  assert.match(await history.innerText(), /R\$\s320,00/);
  assert.deepEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-reconciliations-v1')))).map(item => item.adjustment), [-50, -30]);
  await page.getByRole('button', { name: 'Visão geral', exact: true }).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g, ' '), monthlyBalanceBefore);
});
