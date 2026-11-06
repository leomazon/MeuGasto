# MeuGasto — app web pessoal

Um app web pessoal, sem contas ou serviços externos. O app roda no próprio computador e guarda os dados em um banco SQLite local.

## Como iniciar

1. Baixe e extraia esta pasta.
2. No terminal, entre nela e execute `python3 server.py`, ou clique no atalho **MeuGasto**.
3. Abra `http://127.0.0.1:8000` no navegador.

O servidor local usa apenas a biblioteca padrão do Python. Ele atende o app somente em `127.0.0.1`, sem expor o banco para a rede. Não é necessário fazer build nem instalar dependências para executar o app.

## O que está incluído

- Lançamentos unificados de receitas e despesas, com seletor de tipo, categorias específicas e edição/exclusão.
- **Saldo previsto**: receitas menos despesas previstas no mês, incluindo registros fixos e parcelas em Pix ou cartão.
- **Saldo realizado**: recebimentos menos pagamentos confirmados, pela data em que ocorreram. Os dois saldos são movimentos do mês e não incluem saldo anterior.
- Situação de receitas e despesas (previsto/em aberto ou recebido/pago), com confirmação de data e reabertura mediante confirmação. Pix, dinheiro e transferência entram no realizado quando confirmados; cartões entram ao pagar a fatura, sem contar transferências de dívida entre cartões como saída de dinheiro.
- Registros avulsos antigos em Pix/dinheiro e receitas antigas são tratados como realizados para manter a compatibilidade. Registros fixos antigos seguem previstos até a confirmação mensal.
- Aba Análises com gráficos separados de receitas e despesas por categoria, evolução mensal e orçamentos por categoria. A Visão geral reúne saldos, formas de pagamento e registros recentes.
- Barras em Lançamentos mostram a participação de cada receita ou despesa na própria categoria do mês, sem mudar a base ao aplicar filtros.
- Cadastro de cartões, limites e crédito disponível no dashboard. Cada cartão pode ter uma conta padrão vinculada para pagar faturas.
- Faturas mensais com liquidação integral ou cobrança por cobrança, via conta vinculada, Pix ou outro cartão.
- Contas e carteiras com saldo inicial, saldo atual e vínculo de receitas, despesas e pagamentos de fatura. Transferências entre contas atualizam os dois saldos sem serem tratadas como receita ou despesa. **Conferência de saldo** compara o valor calculado com o extrato e registra ajustes datados com histórico, sem reescrever lançamentos nem alterar os totais mensais.
- Lançamentos filtrados pelo mês selecionado, com busca, paginação e opções de 10, 20, 30 ou 50 itens por página.
- Categorias personalizadas de receita e despesa com nome, ícone Material e cor. Renomear atualiza lançamentos, exceções de registros fixos e orçamentos vinculados; arquivar impede novos usos sem apagar o histórico. Categorias arquivadas podem ser reativadas.
- Despesas em Pix ou cartão à vista ou parceladas em até 24 vezes. No parcelamento, informe o valor de cada parcela: o app mostra o total calculado e lança as parcelas nos meses seguintes. No Pix, cada parcela pode ser paga ou reaberta separadamente. Compras parceladas antigas com mais de 24 vezes continuam editáveis e preservam o total já salvo, inclusive ajustes de centavos na última parcela.
- Exportação e importação de backup em JSON, incluindo categorias, orçamentos, contas, transferências e conferências de saldo.
- Cópias SQLite automáticas ao salvar, com intervalo mínimo de 30 minutos e retenção das 30 cópias mais recentes. Em **Backups locais**, gere uma cópia manual ou restaure uma anterior. Antes da restauração, o estado atual recebe uma cópia de segurança.
- Evolução dos últimos 6 ou 12 meses até o mês selecionado, com receitas e despesas previstas, saldo previsto e saldo realizado.
- Orçamentos mensais por categoria de despesa: limites recorrentes, valor comprometido, percentual utilizado e destaque ao se aproximar ou ultrapassar o limite.
- Filtros de lançamentos por tipo (receita/despesa), categoria, forma de pagamento ou recebimento e intervalo de valores.
- Busca e valores dos filtros são aplicados após 1 segundo sem digitação, mostrando um skeleton sem alterar a altura da lista; Enter aplica a busca imediatamente.
- Ordenação de lançamentos por data, categoria (A–Z ou Z–A), maior ou menor valor, aplicada antes da paginação.
- Registros fixos mensais de receitas e despesas, repetidos a partir da data inicial. Ao editar, escolha **Somente este mês** para ajustar valor, categoria, descrição, data, forma de pagamento ou recebimento sem mudar os demais meses, ou **Toda a série** para alterar o registro base. Desmarcar a opção ao editar encerra a repetição após o mês selecionado e preserva o histórico.
- Para registros fixos no cartão, cada mês tem sua própria liquidação; apenas os meses já iniciados comprometem o limite. O valor informado é mensal, sem parcelamento.
- Campos de dinheiro formatados automaticamente em reais.
- Ícones Material Icons hospedados localmente, sem consulta a fontes externas.
- Layout adaptado para celular e computador.

## Onde ficam os dados

Os dados ficam no arquivo `~/.local/share/meugasto/meugasto.sqlite3`, fora da pasta do projeto e do repositório Git. Na primeira execução, o app migra automaticamente lançamentos, cartões e pagamentos do `localStorage` do navegador, se já houver dados. Depois disso, o SQLite é a fonte principal, então os dados continuam disponíveis mesmo que o armazenamento do navegador seja limpo. As cópias SQLite ficam em `~/.local/share/meugasto/backups/`, também fora do Git. Use **Baixar backup** para guardar uma cópia em outro local ou transferi-la para outro computador. As cópias automáticas no mesmo PC ajudam a recuperar alterações, mas não protegem contra perda do disco.

## Testes

As regras financeiras têm testes no Node.js, a persistência SQLite usa `unittest` do Python, e os fluxos de navegador usam Playwright. Na pasta do app, execute `npm test` e `npm run test:e2e`. Para preparar o ambiente E2E, execute `npm install` e `npx playwright install chromium`. Ao desenvolver novas funcionalidades ou corrigir defeitos, escreva primeiro um teste que descreva o comportamento esperado, confirme que ele falha e só então implemente a mudança.

## Decisões de implementação

A conciliação usa o núcleo financeiro e a persistência local já existentes. Não foi adicionada uma biblioteca externa: o cálculo é pequeno e depende das regras específicas de data, conta e lançamentos do MeuGasto; uma dependência genérica não reduziria a complexidade nem melhoraria a integração. O cadastro de categorias reutiliza os ícones Material já hospedados no projeto e os controles nativos de cor e seleção, evitando uma dependência apenas para esses campos. O Pix parcelado reutiliza o seletor mensal, a confirmação de pagamentos e os cálculos de parcelas já existentes; outra biblioteca acrescentaria dependência sem oferecer a integração com os saldos e alertas do app.
