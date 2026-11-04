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
let nativeDialogs = 0;

before(async () => {
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(appRoot, relativePath);
    if (!filePath.startsWith(`${appRoot}${path.sep}`)) {
      response.writeHead(404).end();
      return;
    }
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
  page.setDefaultTimeout(3000);
  page.on('dialog', async (dialog) => { nativeDialogs += 1; await dialog.dismiss(); });
});

beforeEach(async () => {
  nativeDialogs = 0;
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([{
      id: 'e2e-market', description: 'Mercado E2E', amount: 25, category: 'Alimentação', payment: 'Pix',
      installments: 1, firstDate, notes: '', type: 'expense',
    }]));
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([{ id: 'e2e-card', name: 'Cartão E2E', bank: 'Banco E2E', limit: 500 }]));
  });
  await page.reload();
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test('confirms deleting an expense in an app modal and allows canceling safely', async () => {
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir Mercado E2E' }).click();

  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.isVisible(), true, 'the custom confirmation modal should open');
  assert.match(await dialog.innerText(), /Mercado E2E/);
  assert.match(await dialog.innerText(), /1 cobrança/);
  const modalBounds = await dialog.boundingBox();
  const closeBounds = await dialog.locator('#close-delete-dialog').boundingBox();
  assert.ok(closeBounds.y - modalBounds.y < 50, 'close button should sit near the modal upper edge');
  assert.ok(modalBounds.x + modalBounds.width - (closeBounds.x + closeBounds.width) < 48, 'close button should align with the modal right edge');
  assert.equal(nativeDialogs, 0, 'the browser-native confirm dialog should not be used');

  await dialog.getByRole('button', { name: 'Manter' }).click();
  assert.equal(await page.getByRole('button', { name: 'Excluir Mercado E2E' }).count(), 1, 'cancel leaves the expense in place');

  await page.getByRole('button', { name: 'Excluir Mercado E2E' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir gasto' }).click();
  assert.equal(await page.getByRole('button', { name: 'Excluir Mercado E2E' }).count(), 0, 'confirm removes the expense from the list');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1') || '[]')), []);
});

test('confirms deleting a card in the same app modal', async () => {
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.getByRole('button', { name: 'Excluir Cartão E2E' }).click();

  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.isVisible(), true);
  assert.match(await dialog.innerText(), /Cartão E2E/);
  assert.equal(nativeDialogs, 0, 'card deletion should also avoid a browser-native confirmation');
  await dialog.getByRole('button', { name: 'Excluir cartão' }).click();

  assert.equal(await page.getByRole('button', { name: 'Excluir Cartão E2E' }).count(), 0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-cards-v1') || '[]')), []);
});

async function seedPaidCardExpense(description = 'Compra liquidada') {
  await page.evaluate((name) => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([{
      id: 'paid-card-purchase', description: name, amount: 90, category: 'Saúde', payment: 'Cartão',
      cardId: 'e2e-card', card: 'Cartão E2E', cardMode: 'À vista', installments: 1, firstDate, notes: '', type: 'expense',
    }]));
    localStorage.setItem('meugasto-card-payments-v1', JSON.stringify([{
      id: 'paid-card-allocation', expenseId: 'paid-card-purchase', installmentIndex: 0, amount: 90,
      date: firstDate, month: firstDate.slice(0, 7), method: 'Pix',
    }]));
  }, description);
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
}

test('requires confirmation to edit a paid expense and preserves payment until changes are saved', async () => {
  await seedPaidCardExpense();
  const edit = () => page.getByRole('button', { name: 'Editar Compra liquidada' }).click();
  await edit();

  const confirmation = page.locator('#delete-dialog');
  assert.equal(await confirmation.isVisible(), true);
  assert.match(await confirmation.innerText(), /CONFIRME A EDIÇÃO/);
  assert.match(await confirmation.innerText(), /voltará a ficar em aberto/);
  await confirmation.getByRole('button', { name: 'Manter' }).click();
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-card-payments-v1')))).length, 1, 'canceling confirmation keeps the payment');

  await edit();
  await page.locator('#delete-dialog').getByRole('button', { name: 'Editar compra' }).click();
  const form = page.locator('#expense-dialog');
  assert.equal(await form.isVisible(), true);
  await form.locator('#description').fill('Compra ajustada');
  await form.getByRole('button', { name: 'Salvar alterações' }).click();

  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-card-payments-v1')))).length, 0, 'saving the edit removes the old payment');
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))))[0].description, 'Compra ajustada');
  assert.equal(await page.locator('#transactions-list').getByText('Liquidado', { exact: true }).count(), 0);
});

test('requires confirmation to delete a paid expense and removes its linked payments', async () => {
  await seedPaidCardExpense();
  await page.getByRole('button', { name: 'Excluir Compra liquidada' }).click();
  const confirmation = page.locator('#delete-dialog');
  assert.equal(await confirmation.isVisible(), true);
  assert.match(await confirmation.innerText(), /pagamento registrado/);
  await confirmation.getByRole('button', { name: 'Manter' }).click();
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1')))).length, 1);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-card-payments-v1')))).length, 1);

  await page.getByRole('button', { name: 'Excluir Compra liquidada' }).click();
  await page.locator('#delete-dialog').getByRole('button', { name: 'Excluir gasto' }).click();
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1')))).length, 0);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-card-payments-v1')))).length, 0);
});

test('lets the user settle one card installment from monthly transactions', async () => {
  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const expenses = JSON.parse(localStorage.getItem('meu-financeiro-v1'));
    expenses.push({ id: 'e2e-card-purchase', description: 'Compra para liquidar', amount: 90, category: 'Saúde', payment: 'Cartão', cardId: 'e2e-card', card: 'Cartão E2E', cardMode: 'Parcelado', installments: 1, firstDate, notes: '', type: 'expense' });
    localStorage.setItem('meu-financeiro-v1', JSON.stringify(expenses));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();

  await page.getByRole('button', { name: 'Liquidar Compra para liquidar, parcela 1' }).click();
  const dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /R\$\s?90,00/);
  await dialog.locator('#settlement-method').selectOption('Pix');
  await dialog.getByRole('button', { name: 'Confirmar pagamento' }).click();

  const payments = await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-card-payments-v1') || '[]'));
  assert.equal(payments.length, 1, `payment should persist; toast: ${await page.locator('#toast').innerText()}; data: ${await page.evaluate(() => localStorage.getItem('meugasto-card-payments-v1'))}`);
  assert.equal(payments[0].expenseId, 'e2e-card-purchase');
  assert.equal(payments[0].installmentIndex, 0);
  assert.equal(await page.locator('#transactions-list').getByText('Liquidado', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  assert.match(await page.locator('.credit-card-card .limit-line strong').innerText(), /R\$\s?0,00/);
});

test('uses larger readable type for transaction details and card billing details', async () => {
  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const expenses = JSON.parse(localStorage.getItem('meu-financeiro-v1'));
    expenses.push({ id: 'e2e-card-purchase', description: 'Compra legível', amount: 90, category: 'Saúde', payment: 'Cartão', cardId: 'e2e-card', card: 'Cartão E2E', cardMode: 'Parcelado', installments: 1, firstDate, notes: '', type: 'expense' });
    localStorage.setItem('meu-financeiro-v1', JSON.stringify(expenses));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  const transactionDetailSize = await page.locator('.transactions-list .expense-name span').first().evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(transactionDetailSize >= 14, `transaction detail text should be at least 14px, got ${transactionDetailSize}px`);

  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  const cardExplanationSize = await page.locator('.credit-card-card .card-footnote').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  const cardChargeDetailSize = await page.locator('.credit-card-card .bill-description span').evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  assert.ok(cardExplanationSize >= 13, `card explanation should be at least 13px, got ${cardExplanationSize}px`);
  assert.ok(cardChargeDetailSize >= 14, `card charge details should be at least 14px, got ${cardChargeDetailSize}px`);
});

test('adds a cash purchase and shows cash separately beside Pix and card in the overview', async () => {
  await page.getByRole('button', { name: 'Novo gasto' }).click();
  const dialog = page.locator('#expense-dialog');
  await dialog.locator('#description').fill('Compra em dinheiro');
  await dialog.locator('#amount').fill('12,50');
  await dialog.locator('#payment').selectOption('Dinheiro');
  await dialog.locator('#first-date').fill(await page.evaluate(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }));
  assert.equal(await dialog.locator('#card-details-row').isHidden(), true, 'cash purchases should not ask for card details');
  await dialog.getByRole('button', { name: 'Salvar gasto' }).click();

  const amountText = async (selector) => (await page.locator(selector).innerText()).replace(/\u00a0/g, ' ');
  assert.equal(await amountText('#cash-total'), 'R$ 12,50');
  assert.equal(await amountText('#pix-total'), 'R$ 25,00');
  assert.equal(await amountText('#card-total'), 'R$ 0,00');
  assert.equal(await page.locator('#cash-share').innerText(), '33%');
  const cashBarWidth = await page.locator('#cash-bar').evaluate((bar) => parseFloat(bar.style.width));
  assert.ok(Math.abs(cashBarWidth - (100 / 3)) < 0.01, `cash share bar should match its amount, got ${cashBarWidth}%`);
  assert.equal(await page.locator('.pix-brand').getAttribute('src'), 'pix-symbol.svg');
  assert.equal(await page.locator('.pix-brand').evaluate((image) => image.complete && image.naturalWidth > 0), true, 'overview should display the official Pix mark asset');
});

test('collapses the sidebar and lets the user reopen it from the same control', async () => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const sidebar = page.locator('.sidebar');
  const main = page.locator('.main-content');
  const initialWidth = (await sidebar.boundingBox()).width;

  await page.getByRole('button', { name: 'Fechar menu lateral' }).click();
  assert.equal(await page.locator('.app-shell').evaluate((shell) => shell.classList.contains('sidebar-collapsed')), true);
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
  const mainBounds = await main.boundingBox();
  const rightSpace = 1920 - mainBounds.x - mainBounds.width;
  assert.ok(Math.abs(mainBounds.x - rightSpace) < 1, `main content should be centered with equal side space, got ${mainBounds.x}px left and ${rightSpace}px right`);

  await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  assert.equal(await page.locator('.app-shell').evaluate((shell) => shell.classList.contains('sidebar-collapsed')), false);
  await page.waitForFunction((width) => document.querySelector('.sidebar').getBoundingClientRect().width === width, initialWidth);
});

test('aligns dates, payment labels and amounts across rows with different actions', async () => {
  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const expenses = JSON.parse(localStorage.getItem('meu-financeiro-v1'));
    expenses.push(
      { id: 'alignment-card', description: 'Compra cartão alinhamento', amount: 45, category: 'Saúde', payment: 'Cartão', cardId: 'e2e-card', card: 'Cartão E2E', cardMode: 'À vista', installments: 1, firstDate, notes: '', type: 'expense' },
      { id: 'alignment-cash', description: 'Compra dinheiro alinhamento', amount: 20, category: 'Outros', payment: 'Dinheiro', installments: 1, firstDate, notes: '', type: 'expense' },
    );
    localStorage.setItem('meu-financeiro-v1', JSON.stringify(expenses));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();

  const rows = ['Compra cartão alinhamento', 'Mercado E2E', 'Compra dinheiro alinhamento'].map((description) =>
    page.locator('.transactions-list .expense-row').filter({ hasText: description }));
  for (const selector of ['.row-date', '.row-payment', '.expense-value']) {
    const leftPositions = await Promise.all(rows.map(async (row) => (await row.locator(selector).boundingBox()).x));
    assert.ok(Math.max(...leftPositions) - Math.min(...leftPositions) < 1, `${selector} columns should align across all payment methods: ${leftPositions.join(', ')}`);
  }
});

test('uses payment bar colors that do not repeat category bar colors', async () => {
  await page.evaluate(() => {
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'palette-pix', description: 'Pix', amount: 10, category: 'Saúde', payment: 'Pix', installments: 1, firstDate, notes: '', type: 'expense' },
      { id: 'palette-cash', description: 'Dinheiro', amount: 20, category: 'Alimentação', payment: 'Dinheiro', installments: 1, firstDate, notes: '', type: 'expense' },
      { id: 'palette-card', description: 'Cartão', amount: 30, category: 'Moradia', payment: 'Cartão', cardId: 'e2e-card', card: 'Cartão E2E', cardMode: 'À vista', installments: 1, firstDate, notes: '', type: 'expense' },
    ]));
  });
  await page.reload();

  const paymentColors = await page.locator('#pix-bar, #cash-bar, #card-bar').evaluateAll((bars) => bars.map((bar) => getComputedStyle(bar).backgroundColor));
  const categoryColors = await page.locator('#category-list .category-track i').evaluateAll((bars) => bars.map((bar) => getComputedStyle(bar).backgroundColor));
  const rgb = (color) => color.match(/\d+/g).slice(0, 3).map(Number);
  const colorDistance = (a, b) => Math.hypot(...rgb(a).map((channel, index) => channel - rgb(b)[index]));
  assert.equal(new Set(paymentColors).size, 3, `payment colors should be distinct: ${paymentColors.join(', ')}`);
  for (const color of paymentColors) {
    const nearestCategoryColor = Math.min(...categoryColors.map((categoryColor) => colorDistance(color, categoryColor)));
    assert.ok(nearestCategoryColor >= 60, `payment color ${color} should remain visually distinct from category colors (nearest distance: ${nearestCategoryColor})`);
  }
});
