# Tarefas Pendentes: Facil

Atualizado em 21/10/2026. Este é o **backlog oficial** do projeto (plano + pendências em um só lugar).

## ETAPA 4 — CONCLUÍDA (21/10/2026)

- [x] **Compras v3 por setor:** gestor do setor cria/envia → responsável de Compras
      autoriza (cotação, orçamento ou compra direta) → comprador cota e envia para
      aprovação → responsável de Compras aprova e adjudica → comprador pede →
      responsável pelo estoque confere e lança a nota fiscal.
- [x] **Setores e gestores:** `departments`/`department_managers`; um gestor pode
      responder por vários setores; visibilidade por setor e fila única para a
      equipe de Compras.
- [x] **Formas de pagamento:** `payment_methods` com `requires_authorization` e
      `requires_quote`; cotação bloqueia compra direta quando exige cotação.
- [x] **Cotação/orçamento/compra direta:** mínimo de 2 propostas na cotação, 1 no
      orçamento, compra direta autorizada pelo responsável de Compras; aprovação da
      cotação cria a adjudicação e envia ao comprador.
- [x] **Recebimento com nota fiscal:** número, série, data, total e local; atualiza
      solicitação, pedido e itens.
- [x] **Notificações direcionadas:** internas + `email_outbox` na mesma transação,
      apenas para quem precisa agir; erro de permissão nomeia o responsável.
- [x] **Chat de suporte em tempo real:** Durable Object `SupportRoom` (WebSocket) com
      digitação, presença e fallback de polling de 60s em `/ajuda/:id` e
      `/suporte/acompanhar/:token`; mensagens persistidas no D1.
- [x] **Qualidade:** `npm run check` **175/175 em 20 arquivos**, typecheck, lint,
      contrato de API; `npm run build`; verificação visual do fluxo completo.
- [x] **Documentação:** `CHANGELOG.md`, `README.md`, `docs/COMPRAS.md` e memória
      atualizados para a release **0.4.0**.
- [x] **Release 0.4.0:** assinatura Ed25519 (tree
      `709ac6a2d36cf8eddcb84010caf993eacebe7f24b7a36ab99f01c962bfdbc9e6`, 172 arquivos,
      21/10/2026 06:48:25 −03:00), migration `0020` aplicada no D1 remoto, Worker
      `f0d3af42-bdfd-45f8-b7fe-39b739c8ef42`, publicada em
      `https://facil.cf-pilot-disposable.workers.dev` (tag `v0.4.0`).

## ETAPA 3 — CONCLUÍDA (20/10/2026)

- [x] **Item fora do catálogo:** formulário com alternativa explícita, descrição livre obrigatória,
      quantidade/unidade e aviso de que o cadastro será feito durante o processo ou no recebimento.
- [x] **Descoberta:** busca de produto sem resultado oferece “Solicitar este item fora do catálogo”,
      aproveitando o texto digitado; detalhe exibe o selo “Fora do catálogo”.
- [x] **Backend e recebimento:** item v2 aceito com `product_id = NULL` + `description`; cotação,
      adjudicação e pedido usam a descrição; recebimento mantém o cadastro rápido do produto.
- [x] **Qualidade:** `npm run check` **169/169 em 18 arquivos**, typecheck, lint, contrato de API;
      `npm run build`; verificação visual desktop/mobile do formulário e do detalhe.
- [x] **Documentação:** `CHANGELOG.md`, `README.md`, `docs/COMPRAS.md`, `docs/IMPLANTACAO.md` e
      `docs/VERSIONAMENTO.md` atualizados para a release **0.3.0**.
- [x] **Release 0.3.0:** assinatura Ed25519, tree
      `8757a04ed013ff3425f69837af402007b1a9c1f27a0c07154dde64dfc85a9c10`, Worker
      `cf468e3f-7a2f-4b06-96c2-948e6b38243e`, publicada em
      `https://facil.cf-pilot-disposable.workers.dev`.

## ETAPA 2 — CONCLUÍDA (20/10/2026)

- [x] **Fluxo corporativo de compras v2:** solicitante → gestor do setor → direção (necessidade e
      orçamento) → compras → comprador cota → superior adjudica item a item → comprador pede e
      recebe. Caminho alternativo gestor → compras, com devolução à direção ou compra direta.
- [x] **Permissões e perfis:** `purchases.view_all`, `purchases.authorize`, `purchases.award` e
      `purchases.direct`; papéis `operations_director` e `purchasing_manager`; 48 → 52 permissões.
- [x] **Dados:** migration `0019_purchase_workflow.sql` com centros de custo, orçamento, conta
      contábil, adjudicação, pedidos por fornecedor, recebimentos vinculados, outbox e intake.
- [x] **Integrações preparadas:** outbox transacional idempotente, intake ServiceNow autenticado,
      inspeção/confirmação em `/api/integrations`; consumo real fica para o integrador.
- [x] **Interface:** fila por perfil, detalhe com progresso, diálogos de decisão/cotação/adjudicação/
      pedido/recebimento, formulário com centro de custo e orçamento, branding CorpServices.
- [x] **Qualidade:** `npm run check` **168/168 em 18 arquivos**, typecheck, lint e contrato de API;
      `npm run build`; correções de destino padrão de cotação, preço adjudicado e dados financeiros
      do pedido.
- [x] **Documentação:** README de handoff, `docs/COMPRAS.md`, `docs/INTEGRACOES.md`,
      `docs/IMPLANTACAO.md`, `docs/VERSIONAMENTO.md`, `CHANGELOG.md` e relatório executivo externo.
- [x] **Release 0.2.0:** assinatura Ed25519, tree
      `c19025940127c05cbb4bf172a706868a306e983694df7a5d183034a6a4e121f7`, Worker
      `ab266118-20a8-4fc5-a0bd-c245a79c9462`, publicada em
      `https://facil.cf-pilot-disposable.workers.dev`.

Pendências externas (não bloqueiam o protótipo):

- [ ] Configurar `TICKET_INTAKE_KEY` em produção para habilitar o intake ServiceNow.
- [ ] Implementar o consumidor do outbox (NetSuite/ServiceNow) e confirmar os eventos.
- [ ] Ativar R2 para anexos de suporte (`503 R2_UNAVAILABLE` enquanto desativado).
- [ ] Definir domínio customizado e Cloudflare Access, se o piloto exigir.
- [ ] Adicionar CI dedicada para `npm run check` e `npm run verify` antes de cada release.

## ETAPA 1 — ENCERRADA (20/10/2026)

- [x] **Auditoria completa de bugs, falhas e vulnerabilidades:** 12 achados corrigidos (escopo por
      local, autoridade de usuários, anexos por entidade, ações de chamado/OS, segredos, uploads,
      cabeçalhos); nenhum crítico/alto aberto. Relatório em
      `docs/SEGURANCA-AUDITORIA-2026-10-20.md`.
- [x] **Endurecimento:** CSP/HSTS/COOP/frame-options/no-store, bloqueio de SVG/HTML, limites de
      JSON/anexos, Origin guard, máscara/limpeza de credenciais e throttle do suporte público.
- [x] **Testes:** `npm run check` **162/162 em 17 arquivos**, typecheck, lint e `check:api`
      50×119; `npm audit` 0 vulnerabilidades.
- [x] **Versionamento:** política em `docs/VERSIONAMENTO.md` e histórico em `CHANGELOG.md`;
      toda alteração futura sobe a versão.
- [x] **Release 0.1.2:** 160 arquivos, tree
      `7e4433f6448566ae5bf6f0df97d03ec0d0fe14fbbc839e9f332745609d1ae13c`, assinada em
      20/10/2026 01:31:40 −03:00; Worker `14b4a87b-ec15-4b70-8175-f55ef6943a6f`.
- [x] **Produção verificada:** `/api/health` 0.1.2, CSP/HSTS/COOP/`no-store`, `_headers` estático,
      cache imutável dos assets, Origin guard 403 e login exibindo **CorpServices Group**.
- [x] **Git:** commit `062ea85`; tags `v0.1.0` (histórica) e `v0.1.2` (fechamento). A 0.1.1 foi
      release intermediária, substituída pela 0.1.2 e não tagueada.
- [x] **Dados históricos:** 0 `settings.update`, 0 anexos e segredos `mail.*` vazios no D1 de
      produção; nenhum SVG histórico armazenado.

## FASE 0 — Preparação e inicialização (16/10/2026) — CONCLUÍDA

- [x] Diretório oficial, memória global e regras lidas; Serena ativo com memória `core`.
- [x] Inconsistências registradas (`PROBLEMAS.md`), decisões registradas (`DECISOES.md`).

## FASE 1 — Planejamento (17/10/2026) — CONCLUÍDA

- [x] PROMPT MESTRE (22 seções) lido integralmente e transformado em plano de execução.
- [x] Stack decidida e registrada (D-04): Workers + Hono + D1 + React 19 + Vite 7 + Tailwind v4
      + React Router 7 + Zod 4; rejeições justificadas (D-05).
- [x] Arquitetura registrada (`ARCHITECTURE.md`): milli-units, dinheiro em centavos, datas ISO UTC,
      movimentos como fonte de verdade, `db.batch` como primitiva de atomicidade.
- [x] Divergências do `padroes-codigo.md` documentadas (sem Next.js; sem ORM; sem multi-tenant).
- [x] Deploy mantido como PLANEJADO (D-10): sem credenciais e sem autorização, nada é publicado.

## FASE 2 — Implementação (17/10/2026) — CONCLUÍDA

Backend (16 módulos de rota Hono + migrations 0001–0006):

- [x] Setup, auth (PBKDF2 + sessão opaca + cookie HttpOnly), usuários/perfis/permissões, escopo por local.
- [x] Estrutura (unidades/locais), catálogo (produtos/categorias/UMs/fornecedores).
- [x] Motor de estoque (movimento único, reversão, saldo derivado, trigger anti-negativo, idempotência).
- [x] Consumo (com regra de reposição de água sem dupla dedução) e inventário cíclico.
- [x] Chamados, ordens de serviço (materiais no motor), compras (requisição → decisão → recebimento).
- [x] Painel, relatórios (7 visões) + exportação CSV, auditoria, configurações, anexos, notificações.

Frontend (React Router 7, SPA com chunks por página):

- [x] Libs: `api`, `format` (fuso), `session`, `hooks`, `ui` (design system único), `lookups`.
- [x] Shell com navegação por permissão, painel de notificações da campainha, tema/estado vazio/erro.
- [x] 20 rotas: setup, login, troca de senha, painel, estoque, consumo, inventário (+detalhe),
      chamados (+detalhe), ordens (+detalhe), compras (+detalhe), catálogo, relatórios, auditoria,
      usuários, configurações, perfil e 404.

## FASE 3 — Validação (17/10/2026) — CONCLUÍDA (local)

- [x] `eslint .` limpo; `tsc --noEmit` (worker) e `tsc -p tsconfig.client.json` limpos.
- [x] **107/107** testes em 9 spec files (D1 isolado por spec).
- [x] `vite build` + `wrangler deploy --dry-run` (bundle validado sem publicar).
- [x] `scripts/smoke.ps1` 11/11 — duas vezes: instalação existente e **reset de fábrica** (setup real).
- [x] Seeds: `npm run seed` (demo) e `npm run db:reset` testados no D1 local.
- [x] Playwright: desktop + mobile, 14 rotas sem overflow, drawer mobile, um fluxo E2E real
      (movimentação → saldo → painel → auditoria).

## FASE 4 — Correções do uso real (17/10/2026) — CONCLUÍDA

- [x] P-07: cliente de inventário chamava `/api/inventory` (worker monta `/api/inventories`) —
      10 chamadas corrigidas; fluxo criar/encerrar inventário verificado pela interface.
- [x] P-08: anexos existiam só no backend — implementado card Anexos no chamado (enviar, listar,
      baixar, remover) com verificação E2E real (upload → download 200 → remoção auditada).
- [x] Guard permanente `npm run check:api` (`scripts/check-api-paths.mjs`): 41 caminhos do cliente
      × 99 rotas do worker; teste negativo comprovou detecção.
- [x] Varredura de conteúdo: 14 rotas sem "Nao foi possivel carregar"/"Rota nao encontrada" e sem
      overflow (desktop e mobile); pipeline completo verde (**107/107**).

## Backlog (pendências abertas)

- [x] **P-12 (RESOLVIDO 17/10/2026):** painel vazava dados globais (tickets/OS/compras/estoque/
      inventário/movimentações) para quem só tem `dashboard.view` (ex.: solicitante) — risco LGPD.
      Corrigido com escopo por permissão no servidor + gating no cliente + teste novo. 109/109.
- [x] **F-12 (RESOLVIDO 17/10/2026):** cadastro rápido de produto no recebimento (apenas nome;
      `catalog_status = 'incomplete'`; alerta no painel + notificação para `catalog.manage` até
      completar o cadastro). Migration `0007`; teste de ponta a ponta em `07-purchases.spec.ts`.
- [x] **Revisão UX/UI completa (RESOLVIDO 17/10/2026):** acentuação pt-BR integral (código + dados
      demo), pluralização (~47 pontos), P-14 (links de notificação quebrados) corrigido, limpeza do
      rastro de smoke no D1. Relatório `memory/REVISAO-UX-2026-10-17.md`; capturas
      `ux-shots/v2-*.png`. Pipeline verde após tudo (109/109).
- [x] **P-15/P-16 (RESOLVIDO 17/10/2026, vídeo do usuário):** menu lateral fixo (rolagem interna do
      conteúdo; rodapé sempre visível — `layout.tsx`) e polimentos (setas fantasma nas abas; rótulos
      "De/Até" na Auditoria). Capturas `ux-shots/v3-*.png`; pipeline verde (109/109).
- [x] **F-17 (FEITO 17/10/2026):** Central de Suporte — `/suporte` público (redefinição de senha e
      ajuda geral, sem sessão; link na tela de login), acompanhamento por token com conversa e
      posição discreta na fila, `/ajuda` interno (central de ajuda, meus pedidos, fila de
      atendimento, conteúdo, e-mails; abas de gestão restritas ao perfil admin via
      `support.manage`), artigos/informativos, notificações internas e fila de e-mails. Migration
      `0008`; `10-support.spec.ts` (7 testes); capturas `ux-shots/v4-*.png`; pipeline verde
      (118/118).
- [x] **P-17 (RESOLVIDO 17/10/2026):** `partial()` do zod v4 reaplicava defaults em PATCH
      (categoria de chamado apagava tipo padrão/ordem; status do chamado rebaixava a prioridade;
      OS reaplicava prioridade/material) — schemas de atualização explícitos + 3 testes de
      regressão (`05-tickets`, `06-workorders`, `08-settings`). Pipeline verde (118/118).
- [x] **F-18 (FEITO E VERIFICADO 18/10/2026):** Configurações reorganizadas (grupo "Gestão" saiu da
      barra lateral; Catálogo, Estrutura, Relatórios, Auditoria e Usuários dentro de Configurações,
      URLs inalteradas; menu por seção) + **5 temas** (Clássico, Corporativo, Noturno, Violeta,
      Âmbar): padrão do sistema pelo admin (`settings['ui.theme']`, seção "Aparência") e escolha
      pessoal no perfil (`users.theme`; "Tema do sistema" = segue o admin). Migration `0009`;
      `11-preferences.spec.ts` (3 testes); verificação visual desktop/mobile; pipeline verde
      (121/121). Detalhes em D-17.
- [x] **Guard do typecheck (18/10/2026):** `npm run typecheck` era no-op (tsconfig raiz
      solution-style) — agora checa worker + cliente de verdade; 3 erros latentes do módulo de
      suporte corrigidos. Detalhes em D-19.
- [x] **F-13 (FEITO E ATIVADO 18/10/2026):** envio de e-mail para **qualquer destinatário** com
      custo zero, **duas vias**: provedor `relay` (Web App do Google Apps Script; guia
      `docs/email-relay-gmail.md`) e provedor `gmail` (**SMTP direto com senha de app** — sem
      script no Google; guia `docs/email-gmail-senha-app.md`). Migrations `0010_mail_relay` e
      `0011_gmail_smtp`; `12-mail-relay.spec.ts` (3) + `13-smtp.spec.ts` (4). **Via ativa na conta
      do usuário: `gmail`** — 4 e-mails reais entregues em 18/10 (1 de teste + os 3 do pedido
      SUP-2026-000002), status "Enviado" no banco. Pipeline verde (128/128). Detalhes em D-20 e
      D-21. Observação: `sent` = SMTP aceitou; devolução (bounce) chega depois na caixa do
      remetente — e-mails internos falsos (ex.: `admin@facil.local`) devem virar endereços reais
      no deploy.
- [x] **F-19 (FEITO E VERIFICADO 18/10/2026):** anexos no chat de suporte — solicitante (token) e
      staff enviam print/PDF/documento pelo chat; **binário no Cloudflare R2**
      (`facil-attachments`, binding `ATTACHMENTS`; simulado no dev/testes) com metadados no D1.
      Padrão **20 MB por arquivo** configurável (`attachments.max_bytes`, catálogo até 50 MB);
      token anônimo com teto próprio (5 MB, 3 arquivos, tipos reduzidos); 40 anexos por pedido.
      Download por sessão ou token; remoção só pelo staff com auditoria; BLOBs antigos do D1
      intactos. Migration `0012` (reconstrução da tabela `attachments` + novo padrão);
      `14-support-attachments.spec.ts` (6 testes); verificação visual real (SUP-2026-000003:
      print do solicitante + PDF do staff + remoção auditada); capturas `ux-shots/f19-*.png`;
      guia `docs/anexos-suporte.md`. Pipeline verde (134/134). Detalhes em D-18.
- [ ] **Captcha (decisão do usuário, 17/10/2026 — D-15):** implementar SOMENTE como camada final,
      depois de o processo de suporte/senha estar 100% validado em uso real; valerá também para os
      logins.
- [ ] **Dados de demonstração no D1 local:** pedido `SUP-2026-000001` (Carlos Pereira) deixado "Em
      atendimento" para o usuário conhecer o fluxo — marcar como resolvido ou remover quando não
      for mais útil. A linha da caixa de saída com erro "Relay respondeu 404…" é rastro explicado da
      verificação da F-13 (URL de teste); "Reenviar" resolve com o relay real configurado.
      **Depois da ativação do Gmail (18/10):** os 3 e-mails para `allanestq@gmail.com`
      (SUP-2026-000002) foram entregues de verdade; sobraram pendentes os avisos para endereços
      falsos (`admin@facil.local`, `qa.admin@demo.local`) — **não reenviar**: o Gmail aceita e devolve
      (bounce) para o remetente. **Verificação da F-19 (18/10):** pedido `SUP-2026-000003`
      ("Solicitante F-19") com 1 anexo real no R2 e 8 e-mails **pendentes** (o envio ficou desligado
      durante o teste) — reenviar só se quiser receber os e-mails de teste.
      **Verificação dos perfis (19/10):** `TCK-2026-000004` (liderança de limpeza), `TCK-2026-000005`
      (recepção) e `CON-2026-000002` (consumo da recepção, com baixa de 2 un de café do
      Almoxarifado Central) são conteúdo de demonstração — manter ou remover quando não forem mais
      úteis.
      **Verificação do F-01/F-02 (19/10):** `SC-2026-000004` (compra mista — água sanitária em
      cotação + café em compra direta; propostas `COT-2026-000001` HigieneMax e `COT-2026-000002`
      Construforte; pedido com preço herdado R$ 11,80) é conteúdo de demonstração — manter ou
      remover quando não for mais útil.
      **Verificação do F-03..F-06 (19/10):** o café da `SC-2026-000004` foi recebido em **uso
      direto** (`REC-2026-000004` — entrada + saída no livro-razão com a justificativa "Café
      entregue direto à copa…"), fechando os dados de demonstração da compra; pode ser removido
      junto com a solicitação quando não for mais útil.
- [ ] **Contas de verificação no D1 local:** `qa.admin@demo.local` (admin, senha `Demo@Facil2026`)
      criada em 18/10/2026; `recepcao.demo@demo.local` (recepção) e `limpeza.lider@demo.local`
      (liderança de limpeza), mesma senha, criadas na verificação da F-20 fase 2 — remover quando
      não forem mais úteis (o seed demo não as recria).
- [x] **F-20 fase 2 + F-16 (FEITOS 18/10/2026):** painéis e menus por perfil para comprador,
      estoquista, limpeza (líder e equipe) e recepção; `purchases.awaitingOrder`/`toReceive` no
      resumo com gate por permissão; seletores exibem `Local — Unidade` via helper
      `locationLabel`. Pipeline verde **146/146** (15 arquivos); capturas `ux-shots/f20-2-*.png`
      e `ux-shots/f16-local-unidade.png`; decisões em D-25..D-29.
- [x] **Ajustes dos perfis operacionais (19/10/2026):** liderança/equipe de limpeza e recepção
      abrem chamados de manutenção (teste de regressão no painel por perfil + verificação real
      `TCK-2026-000004`/`TCK-2026-000005`); **recepção lança consumo do posto** (migration `0015`,
      item "Consumo" no menu e ação/indicador no painel; `CON-2026-000002` real com baixa de
      estoque). Detalhes em D-30/H-15.
- [x] **F-01/F-02 (FEITOS 19/10/2026):** compras com **divisão item a item** (compra direta ×
      cotação, definida na análise do gestor) e **ciclo de cotação por propostas de fornecedor com
      valor por item** — status "Em cotação" → "Cotação retornada" → "Cotação aprovada", aprovação
      da vencedora pelo gestor (demais propostas "Não escolhida"), pedido vinculado ao fornecedor e
      com **preço herdado** da proposta aprovada; migration `0016_purchase_quotes`;
      `07-purchases.spec.ts` +2 cenários; pipeline verde **148/148** (15 arquivos); verificação
      visual real (`SC-2026-000004` + `COT-2026-000001`/`0002`) com capturas `ux-shots/f02-*.png`.
      Detalhes em D-31.
- [x] **F-03..F-06 (FEITOS 19/10/2026):** compras fechadas — **linha do tempo** derivada do
      `audit_log` (F-05), **uso direto no recebimento** com justificativa única e entrada+saída no
      mesmo lote (F-06), **fornecedor do pedido no relatório** (F-03) e **relatório de compras
      ampliado** com cotações por situação, pedidos por fornecedor e "Ciclo das solicitações" com
      filtro e exportação nova (F-04). `07-purchases.spec.ts` +2 e `09-reports.spec.ts` +2 cenários;
      pipeline verde **151/151** (15 arquivos); verificação visual real (linha do tempo da
      `SC-2026-000004`, `REC-2026-000004` com uso direto, relatório com o dia de hoje e filtro
      2/0/2) com capturas `ux-shots/f05-1-timeline.png`, `f06-1-recebimento-uso-direto.png` e
      `f03-f04-relatorios-compras.png`. Detalhes em D-32.
- [x] **F-07/F-08 (FEITOS 19/10/2026):** **foto somente por câmera na execução** — o checklist da OS
      abre o diálogo de câmera (`getUserMedia` + quadro para JPEG no canvas,
      `src/client/lib/camera.tsx`) e não tem mais seletor de arquivo; horário no nome do arquivo e no
      anexo. **Documento (PDF/planilha) em chamado/OS só pela gestão** — permissão nova
      `attachments.documents` (migration `0017`; admin e gerente) checada no servidor por tipo de
      arquivo (403 fora dela); imagem segue livre (evidência de campo); card de anexos do chamado vira
      "Anexar foto"/"Anexar arquivo" conforme a permissão; catálogo com 48 permissões.
      `05-tickets.spec.ts` +1 cenário (`01-auth` atualizado para 48); pipeline verde **152/152**
      (15 arquivos); verificação real com câmera simulada (`canvas.captureStream` — JPEG 640×480
      conferido) e as duas faces do card; capturas `ux-shots/f07-*.png` e `f08-*.png`. Detalhes em
      D-33.
- [x] **F-10 (FEITO 19/10/2026):** **OS filha** — `parent_work_order_id` (migration `0018`)
      definido na criação (pai inexistente → 404; pai cancelada → 409); árvore pai/filha na tela da
      OS (link para a pai, lista de filhas e "Abrir OS filha" com local herdado) **só para a visão
      de gestão** (servidor devolve neutro para os demais); evento de origem na linha do tempo e
      vínculo na auditoria. `06-workorders.spec.ts` +1 cenário; pipeline verde **153/153**;
      verificação real (OS-2026-000008 filha da OS-2026-000007); capturas `ux-shots/f10-*.png`.
      Detalhes em D-34.
- [x] **P-19 (RESOLVIDO 19/10/2026):** filtros de período com data do calendário escondiam o
      próprio dia (comparação de texto entre `YYYY-MM-DD` e instantes ISO) — normalização
      `normalizeRangeBound` no servidor (fuso da aplicação) e `dayRangeParams`/`toIsoDayBound` no
      cliente; relatórios, consumo e movimentações corrigidos; teste de regressão em
      `09-reports.spec.ts`. Detalhes em `PROBLEMAS.md`.
- [x] **F-14 (FEITO 19/10/2026):** **usabilidade da estrutura** — aba **Locais** com **árvore
      visual como visão padrão** (seletor Árvore|Tabela; expandir/recolher; ações no nó e
      "+ Sublocal" com pai pré-selecionado) e diálogo enxuto (Código/Observações sob "Mais opções");
      filtro "Todos os pais" removido por ser auto-referente. Sem mudança de API/banco; pipeline segue
      **153/153**; verificação real (Palco e Camarim criados pela tela em dois níveis); capturas
      `ux-shots/f14-*.png`. Detalhes em D-35 (pendente: aceite do usuário da nova UX).
- [x] **Fase de identidade visual — marca aplicada (19/10/2026 — D-36/D-37):** logo no menu e no login
      (variante clara no tema Noturno), papel de parede do login, favicon/Apple touch, tela de
      abertura e **capa no topo das homes por perfil** (desktop + mobile). Pipeline **153/153**;
      capturas `ux-shots/vi-*.png`. **D-37 (correção do logo):** as duas variantes foram
      **reconstruídas do original de alta resolução** (`branding/logo.png`) por extração
      geométrica em canvas — fundo transparente real, **ponto laranja preservado** e variante
      invertida para o tema escuro (`logo.webp` / `logo-dark.webp`); antes o logo **sumia** no
      Noturno e o claro vinham sem o ponto laranja. **Falta:** ícones internos, motion e aceite
      do usuário.
- [x] **Plano de complementos:** **fechado** (F-01 a F-20 resolvidos em
      `memory/PLANO-COMPLEMENTOS.md`);
      **feitos: F-09, F-11, F-12, F-13, F-14, F-15, F-16, F-18, F-19, F-20 (fases 1 e 2), F-01 a F-10**.
      **Concluído depois:** fase visual (D-40), chat (D-41), deploy (D-39) e fechamento da etapa 1
      na release **0.1.2** (20/10/2026).
- [x] **Fase de identidade visual (preparação 18/10/2026 → aplicada 19/10/2026):** depósito de
      imagens em `branding/` (com `README.md`) e plano em `memory/PLANO-IDENTIDADE-VISUAL.md`;
      decisões D-25 (fechar o funcional antes), D-28 (capas nos painéis iniciais + login) e
      D-36/D-37 (marca aplicada e logo reconstruído). **Concluída** — ver o item acima.
- [x] **Ícones internos + motion (20/10/2026 — D-40):** glifos `←`, `✕` e `▸/▾` trocados por
      `ArrowLeftIcon`, `CloseIcon` e `ChevronIcon`; tokens de movimento (120/180/260 ms) e animações
      de diálogo, gaveta, popover e toast; `prefers-reduced-motion` respeitado; validado no
      navegador real (1440×900 e 390×844). Falta só o **aceite visual do usuário**.
- [x] **P-03 (RESOLVIDO 17/10/2026):** predecessor arquivado por decisão do usuário como
      `D:\DEV\Opencode\_arquivo-facilities-management` (nada apagado; timestamp preservado).
- [x] **P-10 (RESOLVIDO 17/10/2026):** relatório `/api/reports/inventory-variances`
      corrigido — colunas SQL renomeadas; endpoint retorna 200. Verificado via API.
- [x] **P-11 (RESOLVIDO 17/10/2026):** UI de gestão de estrutura criada
      (`structure.tsx` com 3 abas: Unidades, Tipos de local, Locais). Rota `/estrutura`
      e link no menu adicionados. Build + typecheck + lint verdes.
- [x] `git init` + commits locais e **push para o GitHub privado** (20/10/2026):
      `Allanlugui/facil`, branch `main`, commit `4c878a8`; `.gitattributes` força LF para a
      verificação da assinatura funcionar em qualquer SO.
- [x] **Publicação Cloudflare (20/10/2026 — D-39):** `facil-db` real
      (`10365b4d-7ed0-4e8e-8aba-65ebf354cb25`, ENAM) com migrations 0001–0018; Worker `facil`
      publicado em **https://facil.cf-pilot-disposable.workers.dev**; release 0.1.0 assinado
      (Ed25519, 152 arquivos), `/api/health` com bloco `release` e cabeçalhos `X-Facil-*`.
      **R2 desligado** (binding comentado; anexos do suporte em 503 claro).
- [x] **Chat do suporte (20/10/2026 — D-41):** mensagem otimista nos fluxos público e interno
      (`useOptimisticChat` + dedupe por id), painel `ChatThread` (bolhas com avatar/horário,
      separadores de dia, rolagem própria) e composer com Enter/anexos; releitura a cada 20 s.
      Release 153 arquivos / tree `074474e0…`, Worker `e490f47e…`; Playwright com POST
      desacelerado provou bolha "enviando" antes da resposta e ausência de duplicata.
- [x] **Aceite visual (titular):** fase visual D-40, chat D-41 e correção do nome da empresa
      considerados aceitos no fechamento da etapa 1; melhorias futuras entram em nova versão.
- [x] **Instalação inicial (titular):** admin **Allan Lima** criado pelo titular na URL publicada;
      `needsSetup: false`. Sem e-mail pessoal, CPF ou outro dado do autor no sistema.
- [ ] (Opcional para o titular) Habilitar R2: painel Cloudflare → R2 → criar `facil-attachments`
      → descomentar o binding em `wrangler.jsonc` → `npm run types` → `npm run deploy`.
- [ ] (Opcional) Domínio próprio na Cloudflare para habilitar Cloudflare Access na frente do login.
- [x] **P-06 (RESOLVIDO 18/10/2026):** `@types/node` instalado (dev) e `npm run types` regenerou
      `worker-configuration.d.ts` — agora com o binding `ATTACHMENTS: R2Bucket` da F-19; sem
      avisos do wrangler.
- [ ] (Opcional) Anexos também em ordens de serviço (backend já suporta `entityType: work_order`).
- [ ] (Opcional, cosmético) remover o registro antigo `facilities-management` no dashboard do Serena.
- [ ] (Opcional, sem prioridade declarada) CI no GitHub Actions espelhando `npm run check`.

## Regras permanentes de execução

- Nunca declarar pronto sem: funcional + validado + limpo + rastreável + sem resíduos conhecidos.
- Toda pendência resolvida sai desta lista junto com a evidência (arquivo + execução + teste).
