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

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

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
  page.setDefaultTimeout(3000);
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

test('saves the monthly closing and due days when creating and editing a card', async () => {
  await page.goto(appUrl);
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.locator('#new-card').click();
  await page.getByLabel('Nome do cartão').fill('Cartão Prazo');
  await page.locator('#card-bank-trigger').click();
  const bankOptions = page.locator('#bank-options [role="option"]');
  assert.equal(await bankOptions.count(), 6);
  const bankBrands = [
    ['Banco do Brasil', 'bb', '#FCFC30', '#ffdc00', '00000000.svg'], ['Nubank', 'nubank', '#f4e8fb', '#820ad1', '18236120.svg'],
    ['Bradesco', 'bradesco', '#fff0f3', '#cc092f', '60746948.svg'], ['Itaú', 'itau', '#ff9e00', '#003399', '60701190.svg'],
    ['Santander', 'santander', '#fff0f0', '#ec0000', '90400888.svg'],
  ];
  for (const [bankName, bankKey, surface, brandColor, asset] of bankBrands) {
    const option = bankOptions.filter({ hasText: bankName });
    assert.equal(await option.count(), 1);
    assert.equal(await option.locator('.bank-badge-option-icon').getAttribute('data-bank-key'), bankKey);
    const iconStyle = await option.locator('.bank-badge-option-icon').getAttribute('style');
    assert.ok(iconStyle.includes(`--bank-surface:${surface}`));
    assert.ok(iconStyle.includes(`--bank-color:${brandColor}`));
    assert.equal(await option.locator('.bank-badge-option-icon img').getAttribute('src'), `assets/banks/${asset}`);
  }
  const otherBankOption = bankOptions.filter({ hasText: 'Outro' });
  assert.equal(await otherBankOption.locator('.bank-badge-option-icon').getAttribute('data-bank-key'), 'other');
  assert.equal(await otherBankOption.locator('.bank-badge-option-icon .material-icons').textContent(), 'credit_card');
  await page.waitForFunction(() => {
    const logos = [...document.querySelectorAll('#bank-options .bank-badge-option-icon img')];
    return logos.length === 5 && logos.every((logo) => logo.complete && logo.naturalWidth > 0);
  });
  await bankOptions.filter({ hasText: 'Banco do Brasil' }).click();
  assert.equal(await page.locator('#card-bank-selected-icon img').getAttribute('src'), 'assets/banks/00000000.svg');
  await page.getByLabel('Limite total').fill('1200');
  await page.getByLabel('Dia de vencimento mensal').fill('15');
  await page.getByLabel('Dia de fechamento mensal').fill('4');
  await page.locator('#save-card').click();

  let cards = await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-cards-v1') || '[]'));
  assert.equal(cards[0].dueDay, 15);
  assert.equal(cards[0].closingDay, 4);
  assert.equal(cards[0].bank, 'Banco do Brasil');
  assert.equal(await page.locator('#cards-list .credit-card-top .bank-badge img').getAttribute('src'), 'assets/banks/00000000.svg');
  assert.equal(await page.locator('#cards-list .bill-heading .bank-badge img').getAttribute('src'), 'assets/banks/00000000.svg');
  assert.match(await page.locator('.credit-card-title').innerText(), /vence dia 15/);

  await page.getByRole('button', { name: 'Editar Cartão Prazo' }).click();
  assert.equal(await page.getByLabel('Dia de vencimento mensal').inputValue(), '15');
  assert.equal(await page.getByLabel('Dia de fechamento mensal').inputValue(), '4');
  await page.getByLabel('Dia de vencimento mensal').fill('22');
  await page.locator('#save-card').click();
  cards = await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-cards-v1') || '[]'));
  assert.equal(cards[0].dueDay, 22);
});

test('records the purchase date and bills card installments after closing', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([
      { id: 'bb-cycle', name: 'Ourocard', bank: 'Banco do Brasil', limit: 1000, closingDay: 4, dueDay: 16 },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#new-expense').click();
  await page.getByLabel('Descrição').fill('Compra após fechamento');
  await page.locator('#payment').selectOption('Cartão');
  await page.locator('#card-mode').selectOption('Parcelado');
  await page.locator('#installments').selectOption('2');
  assert.equal(await page.locator('#amount-label').innerText(), 'Valor da parcela');
  await page.locator('#amount').fill('12000');
  await page.locator('#card-select').selectOption('bb-cycle');
  await page.locator('#first-date').fill('2026-11-05');
  assert.equal(await page.locator('#record-date-label').innerText(), 'Data da compra');
  assert.match(await page.locator('#card-invoice-preview').innerText(), /dezembro de 2026/);
  await page.locator('#save-expense').click();
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.purchaseDate, '2026-11-05');
  assert.equal(entry.firstDate, '2026-12-16');
  assert.equal(entry.billingDay, 16);
  assert.equal(entry.amount, 240);
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  assert.match(await page.locator('#cards-list').innerText(), /Compra após fechamento/);
  assert.match((await page.locator('#cards-list').innerText()).replace(/\u00a0/g, ' '), /R\$ 120,00/);
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  assert.match(await page.locator('#cards-list').innerText(), /Compra após fechamento/);
});

test('keeps the invoice month of an older card record when it is edited', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([
      { id: 'bb-legacy', name: 'Ourocard', bank: 'Banco do Brasil', limit: 1000, closingDay: 4, dueDay: 16 },
    ]));
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'older-buy', description: 'Compra antiga', type: 'expense', amount: 30, installments: 1,
        payment: 'Cartão', cardId: 'bb-legacy', card: 'Ourocard', category: 'Compras', firstDate: '2026-11-03' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#month-picker').fill('2026-11');
  await page.locator('#month-picker').dispatchEvent('change');
  await page.getByRole('button', { name: 'Editar Compra antiga' }).click();
  assert.match(await page.locator('#card-invoice-preview').innerText(), /Registro antigo/);
  await page.locator('#save-expense').click();
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.firstDate, '2026-11-03');
});

test('does not change an older uneven installment total when its description is edited', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([
      { id: 'old-card', name: 'Ourocard', bank: 'Banco do Brasil', limit: 1000, closingDay: 4, dueDay: 16 },
    ]));
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'old-parts', description: 'Compra antiga', type: 'expense', amount: 100, installments: 3,
        payment: 'Cartão', cardId: 'old-card', card: 'Ourocard', category: 'Compras', firstDate: '2026-11-16' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#month-picker').fill('2026-11');
  await page.locator('#month-picker').dispatchEvent('change');
  await page.getByRole('button', { name: 'Editar Compra antiga' }).click();
  assert.equal(await page.locator('#amount-label').innerText(), 'Valor da parcela');
  assert.equal((await page.locator('#amount').inputValue()).replace(/\s/g, ' '), 'R$ 33,33');
  await page.locator('#description').fill('Compra antiga revisada');
  await page.locator('#save-expense').click();
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1'))[0]);
  assert.equal(entry.amount, 100);
  assert.equal(entry.description, 'Compra antiga revisada');
});

test('keeps a paid fixed card month settled when only its note changes', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([
      { id: 'fixed-cycle-card', name: 'Ourocard', bank: 'Banco do Brasil', limit: 1000, closingDay: 4, dueDay: 16 },
    ]));
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'fixed-cycle', description: 'Assinatura', type: 'expense', amount: 30, installments: 1,
        recurring: true, payment: 'Cartão', cardId: 'fixed-cycle-card', card: 'Ourocard',
        category: 'Assinaturas', purchaseDate: '2026-11-05', firstDate: '2026-12-16', billingDay: 16 },
    ]));
    localStorage.setItem('meugasto-card-payments-v1', JSON.stringify([
      { id: 'fixed-paid', expenseId: 'fixed-cycle', installmentIndex: 1, amount: 30, date: '2027-01-16', method: 'Pix' },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#month-picker').fill('2027-01');
  await page.locator('#month-picker').dispatchEvent('change');
  await page.getByRole('button', { name: 'Editar Assinatura' }).click();
  await page.locator('#delete-dialog').getByRole('button', { name: 'Editar registro' }).click();
  await page.locator('#edit-scope').selectOption('month');
  await page.locator('#notes').fill('Nota do mês');
  await page.locator('#save-expense').click();
  const payments = await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-card-payments-v1')));
  assert.equal(payments.length, 1);
});

test('lets the user enter another bank and uses the generic purple card icon', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Cartões', exact: true }).click();
  await page.locator('#new-card').click();
  await page.locator('#card-bank-trigger').click();
  await page.locator('#bank-options [data-bank-option="__other__"]').click();

  assert.equal(await page.locator('#other-bank-wrap').isVisible(), true);
  assert.equal(await page.locator('#card-bank-selected-icon .material-icons').textContent(), 'credit_card');
  await page.getByLabel('Nome do banco').fill('Banco Inter');
  await page.getByLabel('Nome do cartão').fill('Inter Gold');
  await page.getByLabel('Limite total').fill('2500');
  await page.getByLabel('Dia de vencimento mensal').fill('12');
  await page.getByLabel('Dia de fechamento mensal').fill('3');
  await page.locator('#save-card').click();

  const cards = await page.evaluate(() => JSON.parse(localStorage.getItem('meugasto-cards-v1') || '[]'));
  assert.equal(cards[0].bank, 'Banco Inter');
  const badge = page.locator('#cards-list .credit-card-top .bank-badge');
  assert.equal(await badge.getAttribute('data-bank-key'), 'other');
  assert.equal(await badge.locator('.material-icons').textContent(), 'credit_card');
  assert.equal(await badge.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(239, 234, 255)');

  await page.getByRole('button', { name: 'Editar Inter Gold' }).click();
  assert.equal(await page.locator('#card-bank').inputValue(), '__other__');
  assert.equal(await page.getByLabel('Nome do banco').inputValue(), 'Banco Inter');
});

test('shows each card bank logo in the new-record card selector', async () => {
  await page.goto(appUrl);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([
      { id: 'bb-card', name: 'Ourocard', bank: 'Banco do Brasil', limit: 3000, dueDay: 12 },
      { id: 'nubank-card', name: 'Roxinho', bank: 'Nubank', limit: 2000, dueDay: 15 },
    ]));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  await page.locator('#new-expense').click();
  await page.locator('#payment-trigger').click();
  await page.locator('#payment-options [data-payment-option="Cartão"]').click();
  await page.locator('#card-select-trigger').click();

  const cardOptions = page.locator('#card-options [role="option"]');
  assert.equal(await cardOptions.count(), 2);
  assert.equal(await cardOptions.filter({ hasText: 'Ourocard' }).locator('.card-picker-option-icon img').getAttribute('src'), 'assets/banks/00000000.svg');
  assert.equal(await cardOptions.filter({ hasText: 'Roxinho' }).locator('.card-picker-option-icon img').getAttribute('src'), 'assets/banks/18236120.svg');
  await cardOptions.filter({ hasText: 'Ourocard' }).click();
  assert.equal(await page.locator('#card-selected-icon img').getAttribute('src'), 'assets/banks/00000000.svg');

  await page.getByLabel('Descrição').fill('Compra no Ourocard');
  await page.getByLabel('Valor total').fill('1250');
  await page.locator('#save-expense').click();
  const expenses = await page.evaluate(() => JSON.parse(localStorage.getItem('meu-financeiro-v1') || '[]'));
  assert.equal(expenses[0].cardId, 'bb-card');
});

test('marks unpaid card charges overdue and keeps settled charges as paid', async () => {
  await page.goto(appUrl);
  const today = new Date();
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 15);
  const firstDate = localDateKey(previousMonth);
  const previousMonthKey = firstDate.slice(0, 7);
  const paidAt = localDateKey(today);
  await page.evaluate(({ firstDate, previousMonthKey, paidAt }) => {
    localStorage.clear();
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([{ id: 'due-card', name: 'Cartão Prazo', bank: 'Banco Teste', limit: 1000, dueDay: 1 }]));
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([
      { id: 'overdue-expense', description: 'Compra vencida', amount: 80, category: 'Moradia', payment: 'Cartão', cardId: 'due-card', card: 'Cartão Prazo', cardMode: 'À vista', installments: 1, firstDate, type: 'expense' },
      { id: 'paid-expense', description: 'Compra liquidada', amount: 60, category: 'Saúde', payment: 'Cartão', cardId: 'due-card', card: 'Cartão Prazo', cardMode: 'À vista', installments: 1, firstDate, type: 'expense' },
    ]));
    localStorage.setItem('meugasto-card-payments-v1', JSON.stringify([
      { id: 'paid-allocation', expenseId: 'paid-expense', installmentIndex: 0, amount: 60, date: paidAt, month: previousMonthKey, method: 'Pix' },
    ]));
  }, { firstDate, previousMonthKey, paidAt });
  await page.reload();
  await page.locator('#prev-month').click();
  await page.getByRole('tab', { name: 'Recentes' }).click();

  const recentOverdue = page.locator('#recent-list .expense-row').filter({ hasText: 'Compra vencida' });
  const recentPaid = page.locator('#recent-list .expense-row').filter({ hasText: 'Compra liquidada' });
  assert.equal(await recentOverdue.getByText('Vencido', { exact: true }).count(), 1);
  assert.equal(await recentPaid.getByText('Liquidado', { exact: true }).count(), 1);
  assert.equal(await recentPaid.getByText('Vencido', { exact: true }).count(), 0);
  assert.ok(await recentPaid.locator('.paid-tag').evaluate((tag) => tag.getBoundingClientRect().width < 120), 'the paid badge should fit its text in recent expenses');

  await page.getByRole('button', { name: 'Lançamentos', exact: true }).click();
  const transactionOverdue = page.locator('.transactions-list .expense-row').filter({ hasText: 'Compra vencida' });
  const transactionPaid = page.locator('.transactions-list .expense-row').filter({ hasText: 'Compra liquidada' });
  assert.equal(await transactionOverdue.getByText('Vencido', { exact: true }).count(), 1);
  assert.equal(await transactionPaid.getByText('Liquidado', { exact: true }).count(), 1);
  assert.equal(await transactionPaid.getByText('Vencido', { exact: true }).count(), 0);
});
