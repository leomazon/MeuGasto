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


test('waits for typing to pause, preserves rows and cancels stale filter updates',async()=>{
  await page.clock.install({time:new Date('2026-11-04T12:00:00Z')});
  await page.clock.pauseAt(new Date('2026-11-04T12:01:00Z'));
  await page.evaluate(()=>{
    const firstDate='2026-11-01';
    localStorage.setItem('meu-financeiro-v1',JSON.stringify([
      {id:'market',description:'Mercado',category:'Alimentação',amount:100,type:'expense',payment:'Pix',installments:1,firstDate},
      {id:'health',description:'Farmácia',category:'Saúde',amount:50,type:'expense',payment:'Pix',installments:1,firstDate},
    ]));
  });
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.evaluate(()=>{
    const list=document.querySelector('#transactions-list');
    window.originalRow=list.firstElementChild;
    window.listUpdates=0;
    new MutationObserver(()=>window.listUpdates++).observe(list,{childList:true});
  });
  await page.locator('#search-input').pressSequentially('Mer');
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2,'keep the current rows while the user types');
  assert.equal(await page.evaluate(()=>window.originalRow===document.querySelector('#transactions-list').firstElementChild),true);
  await page.clock.fastForward(700);
  await page.locator('#search-input').pressSequentially('cado');
  await page.clock.fastForward(700);
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2,'each new keystroke restarts the pause');
  await page.clock.fastForward(400);
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Mercado']);
  assert.equal(await page.evaluate(()=>window.listUpdates),1);
  assert.equal(await page.locator('#transactions-list .category-share-track i').evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.locator('#search-input').fill('Mercad');
  await page.clock.fastForward(1100);
  assert.equal(await page.evaluate(()=>window.listUpdates),1,'identical results should preserve their DOM nodes');
  await page.locator('#search-input').fill('inexistente');
  await page.locator('#clear-filters').click();
  await page.clock.fastForward(2000);
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2,'clearing must cancel the pending search');
  await page.locator('#amount-min').fill('100,00');
  await page.locator('#amount-max').fill('3,00');
  assert.equal(await page.locator('#amount-range-error').isVisible(),true,'field validation stays immediate');
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
  await page.clock.fastForward(1100);
  assert.match(await page.locator('#transactions-list').innerText(),/Corrija o intervalo/);
  await page.locator('#amount-max').fill('200,00');
  assert.equal(await page.locator('#amount-range-error').isHidden(),true);
  await page.clock.fastForward(1100);
  assert.equal(await page.locator('#transactions-list .expense-row').count(),1);
  assert.equal(await page.locator('#transactions-list').getAttribute('aria-busy'),'false');
  await page.locator('#clear-filters').click();
  await page.locator('#search-input').fill('Mercado');
  await page.locator('#search-input').press('Enter');
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Mercado'],'Enter applies the search immediately');
  assert.equal(await page.locator('#transactions-list').getAttribute('aria-busy'),'false');
  await page.clock.fastForward(2000);
  assert.equal(await page.locator('#transactions-list .expense-row').count(),1);
});
