# MeuGasto — app web pessoal

Um app web pessoal, sem contas ou serviços externos. O app roda no próprio computador e guarda os dados em um banco SQLite local.

## Como iniciar

1. Baixe e extraia esta pasta.
2. No terminal, entre nela e execute `python3 server.py`, ou clique no atalho **MeuGasto**.
3. Abra `http://127.0.0.1:8000` no navegador.

O servidor local usa apenas a biblioteca padrão do Python. Ele atende o app somente em `127.0.0.1`, sem expor o banco para a rede. Não é necessário fazer build nem instalar dependências para executar o app.

## O que está incluído

- Lançamentos unificados de receitas e despesas, com seletor de tipo, categorias específicas e edição/exclusão.
- Saldo mensal: receitas recebidas menos despesas do mês, incluindo a parcela mensal de compras no cartão. Não acumula saldo anterior nem desconta novamente os pagamentos de fatura.
- Dashboard mensal com gráficos de barras para comparar pagamentos e gastos por categoria.
- Cadastro de cartões, limites e crédito disponível no dashboard.
- Faturas mensais com liquidação integral ou cobrança por cobrança, via Pix ou outro cartão.
- Lançamentos filtrados pelo mês selecionado, com busca, paginação e opções de 10, 20, 30 ou 50 itens por página.
- Categorias com ícones, edição e exclusão de lançamentos.
- Compras no cartão à vista ou parceladas. O app distribui o valor total em cobranças mensais; a última parcela ajusta a diferença de centavos.
- Exportação e importação de backup em JSON.
- Filtros de lançamentos por tipo (receita/despesa), categoria e intervalo de valores.
- Campos de dinheiro formatados automaticamente em reais.
- Layout adaptado para celular e computador.

## Onde ficam os dados

Os dados ficam no arquivo `~/.local/share/meugasto/meugasto.sqlite3`, fora da pasta do projeto e do repositório Git. Na primeira execução, o app migra automaticamente lançamentos, cartões e pagamentos do `localStorage` do navegador, se já houver dados. Depois disso, o SQLite é a fonte principal, então os dados continuam disponíveis mesmo que o armazenamento do navegador seja limpo. Use **Baixar backup** para guardar uma cópia ou transferi-la para outro computador.

## Testes

As regras financeiras têm testes no Node.js, a persistência SQLite usa `unittest` do Python, e os fluxos de navegador usam Playwright. Na pasta do app, execute `npm test` e `npm run test:e2e`. Para preparar o ambiente E2E, execute `npm install` e `npx playwright install chromium`. Ao desenvolver novas funcionalidades ou corrigir defeitos, escreva primeiro um teste que descreva o comportamento esperado, confirme que ele falha e só então implemente a mudança.

## Próximas evoluções possíveis

Orçamentos por categoria, receitas, mais formas de pagamento e sincronização opcional entre dispositivos.
