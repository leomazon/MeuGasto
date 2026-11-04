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




test('repeats fixed income and expense monthly and stops future repetition without erasing history',async()=>{
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  const form=page.locator('#expense-dialog');
  for(const [type,name,value] of [['Receita','Salário fixo','3000,00'],['Despesa','Aluguel fixo','800,00']]) {
    await page.getByRole('button',{name:'Novo registro',exact:true}).click();
    await form.getByRole('radio',{name:type,exact:true}).check();
    await form.locator('#description').fill(name);
    await form.locator('#amount').fill(value);
    await form.getByRole('checkbox',{name:'Registro fixo mensal',exact:true}).check();
    await form.getByRole('button',{name:'Salvar registro',exact:true}).click();
  }
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  await page.getByRole('button',{name:'Editar Aluguel fixo',exact:true}).click();
  assert.equal(await form.getByRole('checkbox',{name:'Registro fixo mensal',exact:true}).isChecked(),true);
  await form.getByRole('checkbox',{name:'Registro fixo mensal',exact:true}).uncheck();
  await form.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Salário fixo']);
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(),2);
  await page.getByRole('button',{name:'Editar Aluguel fixo',exact:true}).click();
  await form.locator('#notes').fill('Nota no histórico');
  await form.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  assert.deepEqual(await page.locator('#transactions-list .expense-name strong').allTextContents(),['Salário fixo']);
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  assert.equal((await page.locator('#month-balance').innerText()).replace(/\s/g,' '),'R$ 2.200,00');
});


test('settles each fixed card month independently and preserves payments when recurrence is stopped',async()=>{
  await page.evaluate(()=>{
    const d=new Date();const firstDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    localStorage.setItem('meugasto-cards-v1',JSON.stringify([{id:'fixed-card',name:'Cartão fixo',bank:'Banco',limit:1000,dueDay:10}]));
    localStorage.setItem('meu-financeiro-v1',JSON.stringify([{id:'fixed-sub',description:'Assinatura fixa',type:'expense',recurring:true,amount:40,installments:1,firstDate,payment:'Cartão',cardId:'fixed-card',card:'Cartão fixo',cardMode:'À vista',category:'Assinaturas'}]));
    localStorage.setItem('meugasto-card-payments-v1',JSON.stringify([{id:'paid-first',expenseId:'fixed-sub',installmentIndex:0,amount:40}]));
  });
  await page.reload();
  await page.getByRole('button',{name:'Lançamentos',exact:true}).click();
  assert.equal(await page.locator('#transactions-list').getByText('Liquidado',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  assert.equal(await page.locator('#transactions-list').getByText('Liquidado',{exact:true}).count(),0);
  await page.getByRole('button',{name:/Liquidar Assinatura fixa/}).click();
  await page.locator('#settlement-dialog').getByRole('button',{name:'Confirmar pagamento',exact:true}).click();
  const payments=await page.evaluate(()=>JSON.parse(localStorage.getItem('meugasto-card-payments-v1')));
  assert.deepEqual(payments.map(p=>p.installmentIndex),[0,1]);
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  await page.getByRole('button',{name:'Editar Assinatura fixa',exact:true}).click();
  await page.locator('#delete-dialog').getByRole('button',{name:'Editar registro',exact:true}).click();
  await page.locator('#expense-dialog').getByRole('checkbox',{name:'Registro fixo mensal',exact:true}).uncheck();
  await page.locator('#expense-dialog').getByRole('button',{name:'Salvar alterações',exact:true}).click();
  assert.equal(await page.locator('#expense-dialog').isVisible(),true,'cannot end a series before a paid future occurrence');
  assert.match(await page.locator('#toast').innerText(),/liquidações posteriores/);
  await page.locator('#expense-dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  await page.getByRole('button',{name:'Editar Assinatura fixa',exact:true}).click();
  await page.locator('#delete-dialog').getByRole('button',{name:'Editar registro',exact:true}).click();
  await page.locator('#expense-dialog').getByRole('checkbox',{name:'Registro fixo mensal',exact:true}).uncheck();
  await page.locator('#expense-dialog').getByRole('button',{name:'Salvar alterações',exact:true}).click();
  assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('meugasto-card-payments-v1')))).length,2);
  await page.getByRole('button',{name:'Próximo mês',exact:true}).click();
  assert.equal(await page.locator('#transactions-list .expense-row').count(),0);
  await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  assert.equal(await page.locator('#transactions-list').getByText('Liquidado',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Novo registro',exact:true}).click();
  const form=page.locator('#expense-dialog');
  await form.locator('#description').fill('Assinatura criada');
  await form.locator('#amount').fill('80,00');
  await form.locator('#payment').selectOption('Cartão');
  await form.locator('#card-mode').selectOption('Parcelado');
  await form.getByRole('checkbox',{name:'Registro fixo mensal',exact:true}).check();
  assert.equal(await form.locator('#installments-wrap').isHidden(),true);
  await form.getByRole('button',{name:'Salvar registro',exact:true}).click();
  const created=await page.evaluate(()=>JSON.parse(localStorage.getItem('meu-financeiro-v1')).find(e=>e.description==='Assinatura criada'));
  assert.equal(created.recurring,true);
  assert.equal(created.installments,1);
  assert.equal(created.amount,80);
});
