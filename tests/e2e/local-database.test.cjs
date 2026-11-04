const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');

const appRoot = path.resolve(__dirname, '../..');
let browser;
let page;
let appUrl;
let backend;
let dataDir;

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meugasto-db-e2e-'));
  const port = await freePort();
  appUrl = `http://127.0.0.1:${port}`;
  backend = spawn('python3', [path.join(appRoot, 'server.py'), '--bind', '127.0.0.1', '--port', String(port), '--data-dir', dataDir], { stdio: 'ignore' });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/state`);
      if (response.ok) { ready = true; break; }
    } catch { /* wait for the local server to bind */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'SQLite-backed app server should start');
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Sao_Paulo' });
});

after(async () => {
  await browser?.close();
  backend?.kill('SIGTERM');
  if (backend) await new Promise((resolve) => backend.once('exit', resolve));
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test('migrates existing browser expenses to SQLite and restores them after browser data is cleared', async () => {
  await page.addInitScript(() => {
    if (!location.search.includes('seed') || sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', 'yes');
    const today = new Date();
    const firstDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    localStorage.setItem('meu-financeiro-v1', JSON.stringify([{ id: 'legacy', description: 'Compra migrada', amount: 42.5, category: 'Alimentação', payment: 'Pix', installments: 1, firstDate, type: 'expense' }]));
    localStorage.setItem('meugasto-cards-v1', JSON.stringify([]));
    localStorage.setItem('meugasto-card-payments-v1', JSON.stringify([]));
  });
  await page.goto(`${appUrl}/?seed`);
  await page.waitForFunction(async () => {
    const response = await fetch('/api/state');
    const { initialized, state } = await response.json();
    return initialized && state.expenses.some((expense) => expense.id === 'legacy');
  });
  await page.locator('#recent-list').getByText('Compra migrada').waitFor();
  await page.waitForFunction(() => localStorage.getItem('meu-financeiro-v1') === null, null, { timeout: 3000 });

  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await page.locator('#recent-list').getByText('Compra migrada').waitFor();
  assert.equal((await page.evaluate(async () => (await (await fetch('/api/state')).json()).state.expenses))[0].amount, 42.5);
  await page.getByRole('button', { name: 'Receitas', exact: true }).click();
  await page.getByRole('button', { name: 'Nova receita', exact: true }).click();
  const incomeForm = page.locator('#income-dialog');
  await incomeForm.getByLabel('Descrição').fill('Receita persistida');
  await incomeForm.getByLabel('Valor recebido').fill('1000,00');
  await incomeForm.getByRole('button', { name: 'Salvar receita', exact: true }).click();
  await page.waitForFunction(async () => {
    const { state } = await (await fetch('/api/state')).json();
    return state.expenses.some(entry => entry.type === 'income' && entry.amount === 1000);
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#income-total').textContent.replace(/\s/g, ' ') === 'R$ 1.000,00');
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g, ' '), 'R$ 957,50');

});
