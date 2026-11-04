# MeuGasto — app web pessoal

Um MVP sem contas, senhas, banco de dados ou serviços externos. As despesas ficam no `localStorage` do navegador usado para abrir o app.

## Como iniciar

1. Baixe e extraia esta pasta.
2. No terminal, entre nela e execute `python3 -m http.server 8000` ou clique no atalho **MeuGasto**.
3. Abra `http://localhost:8000` no navegador.

Também pode hospedar os arquivos estáticos em um servidor web próprio. O app não precisa de build nem de dependências.

## O que está incluído

- Dashboard mensal com gráficos de barras para comparar pagamentos e gastos por categoria.
- Cadastro de cartões, limites e crédito disponível no dashboard.
- Faturas mensais com liquidação integral ou cobrança por cobrança, via Pix ou outro cartão.
- Lançamentos filtrados pelo mês selecionado, com busca, paginação e opções de 10, 20, 30 ou 50 itens por página.
- Categorias com ícones, edição e exclusão de lançamentos.
- Compras no cartão à vista ou parceladas. O app distribui o valor total em cobranças mensais; a última parcela ajusta a diferença de centavos.
- Exportação e importação de backup em JSON.
- Layout adaptado para celular e computador.

## Onde ficam os dados

Os dados são salvos automaticamente no armazenamento local do perfil do navegador e permanecem lá quando você fecha e abre o app novamente no mesmo PC e endereço. Eles não são enviados a um servidor, e não é preciso exportar/importar a cada sessão. Limpar os dados do navegador pode apagá-los; use **Baixar backup** para guardar uma cópia ou transferir os dados para outro navegador ou dispositivo.

## Testes

As regras financeiras têm testes automatizados com o test runner embutido no Node.js. Os fluxos de navegador usam Playwright. Na pasta do app, execute `npm test` e `npm run test:e2e`. Para preparar o ambiente E2E, execute `npm install` e `npx playwright install chromium`. Ao desenvolver novas funcionalidades ou corrigir defeitos, escreva primeiro um teste que descreva o comportamento esperado, confirme que ele falha e só então implemente a mudança.

## Próximas evoluções possíveis

Orçamentos por categoria, receitas, mais formas de pagamento e sincronização opcional entre dispositivos.
