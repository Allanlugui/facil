# Status do Projeto: Facil

- **Criado em:** 16/10/2026 22:36:22 pelo bootstrap global (`D:\DEV\criar-projeto.bat`).
- **Diretório oficial:** `D:\DEV\Opencode\Facil`
- **Conhecimento global:** `D:\DEV\memory\Facil\`
- **Fluxo de compras v3 completo (21/10/2026):** versão **0.6.0**. Ordem nova:
  **solicitação → triagem do comprador → aprovação/refinamento do gestor de Compras →
  comprador → recebimento**. Triagem (`approval_stage = purchasing` com
  `triage_completed_at IS NULL`, derivada como `triage` na API) permite editar itens,
  vincular/cadastrar produto e recusar ou encaminhar; o solicitante não tria a própria
  solicitação. O gestor de Compras edita itens/quantidades, define modo, pagamento, centro
  de custo e GL, e pode **solicitar alinhamento** (`request_alignment`, observação ≥5
  caracteres, permanece na etapa, notifica solicitante/triagem). O destino dos itens
  acompanha o modo escolhido e preserva ajustes por item. No recebimento, item fora do
  catálogo pode ser vinculado a produto existente ou cadastrado na hora com unidade; o
  vínculo é permanente e gera movimentação de estoque. Migration `0021_purchase_triage.sql`
  aplicada no D1 local; v1/v2 preservados. `npm run check` **180/180 em 20 arquivos**,
  typecheck, lint, contrato de API; `npm run build`; verificação Playwright ponta a ponta
  (lote, triagem, alinhamento, compra direta, pedido com preços e recebimento com
  normalização). Corrigido o aninhamento inválido de `<div>` em `<p>` no `PageHeader`.
- **Publicado em 22/10/2026:** Worker `facil` em
  https://facil.cf-pilot-disposable.workers.dev, versão **0.6.0** confirmada no
  `build-info.json`, migration `0021` aplicada no D1 remoto, release assinada
  (Ed25519) e version id `6e313fa2-f7ba-47a3-8369-8bc795b4df12`.
- **Melhorias de usabilidade em Compras (21/10/2026):** versão **0.5.0** entregue. Formulário
  do solicitante v3 simplificado (Local, Data desejada, Prioridade, Justificativa obrigatória,
  Observações e itens; setor automático pelo login). Entrada de itens em lote com processamento de
  texto, tabela editável de quantidade/unidade, vínculo automático ao catálogo e selo "Fora do
  catálogo" sem bloquear o envio. Criação v3 ignora campos administrativos; `purchaseMode` e
  `paymentMethodId` são gravados na autorização do responsável de Compras. Detalhe da solicitação
  com identificador, solicitante e data antes dos badges de status/setor/etapa/prioridade; grade
  lateral só a partir de `2xl`, colunas `min-w-0` e tabela densa, sem rolagem horizontal de
  1280 a 1536. Datas puras passaram a ser formatadas em UTC (não recuam um dia).
  `npm run check` **175/175 em 20 arquivos**, typecheck, lint e contrato de API; verificação visual
  em 1440×900 e 390×844 do formulário, do lote e do detalhe, além de criação/envio ponta a ponta.
- **Etapa 4 concluída (21/10/2026):** release **0.4.0** assinada (Ed25519, **172 arquivos**, tree
  `709ac6a2d36cf8eddcb84010caf993eacebe7f24b7a36ab99f01c962bfdbc9e6`, 21/10/2026 06:48:25 −03:00,
  Worker `f0d3af42-bdfd-45f8-b7fe-39b739c8ef42`). Entrega: **compras v3 por setor** — gestor do
  setor cria/envia; responsável de Compras autoriza (cotação/orçamento/compra direta); comprador
  cota e devolve para aprovação; responsável de Compras aprova e adjudica; comprador emite pedido;
  responsável pelo estoque confere e lança nota fiscal. Setores (`departments`,
  `department_managers`, `users.department_id`), formas de pagamento (`payment_methods` com
  `requires_authorization`/`requires_quote`), compra direta respeitando a forma, recebimento com NF
  e notificações internas/e-mail em `email_outbox` na mesma transação. **Chat de suporte em tempo
  real**: Durable Object `SupportRoom` (WebSocket, digitação, presença) com fallback de polling de
  60s em `/ajuda/:id` e `/suporte/acompanhar/:token`; mensagens persistidas no D1. Migration
  `0020_organization_purchases.sql` aplicada no D1 local e remoto. `npm run check` **175/175 em 20
  arquivos**; `npm run build`; verificação visual ponta a ponta do fluxo (gestor → Compras → 2
  propostas → aprovação → pedido → recebimento com NF) e do chat. Docs `README.md`,
  `CHANGELOG.md`, `docs/COMPRAS.md` atualizados. Limitações conhecidas inalteradas (R2, domínio,
  `TICKET_INTAKE_KEY`, outbox sem consumidor, sem CI).
- **Etapa 3 concluída (20/10/2026):** release **0.3.0** assinada (Ed25519, **168 arquivos**, tree
  `8757a04ed013ff3425f69837af402007b1a9c1f27a0c07154dde64dfc85a9c10`, 20/10/2026 23:04:14 −03:00,
  Worker `cf468e3f-7a2f-4b06-96c2-948e6b38243e`). Entrega: solicitação de **item fora do catálogo**
  por descrição livre, com aviso de cadastro durante o processo ou no recebimento, atalho na busca
  sem resultado, badge no detalhe e cadastro rápido já existente no recebimento. `npm run check`
  **169/169 em 18 arquivos**, typecheck, lint, contrato de API, build e verificação de assinatura.
- **Etapa 2 concluída (20/10/2026):** release **0.2.0** assinada (Ed25519, **168 arquivos**, tree
  `c19025940127c05cbb4bf172a706868a306e983694df7a5d183034a6a4e121f7`, 20/10/2026 21:47:54 −03:00,
  Worker `ab266118-20a8-4fc5-a0bd-c245a79c9462`). Entrega: fluxo corporativo de compras v2
  (gestor → direção → compras → cotação → adjudicação item a item → pedido por fornecedor →
  recebimento), caminho direto a compras com devolução à direção ou compra direta, centros de custo,
  orçamento e conta contábil, perfis `operations_director`/`purchasing_manager`, permissões de 48
  para 52, outbox transacional idempotente e intake ServiceNow autenticado. Migration `0019`
  aplicada no D1 local e remoto (backup lógico e bookmark registrados). `npm run check`
  **168/168 em 18 arquivos**. UI com fila por perfil, progresso e identidade CorpServices Group.
  Docs `docs/COMPRAS.md`, `docs/INTEGRACOES.md` e README de handoff. Limitações conhecidas: R2
  desativado, sem domínio/Access, `TICKET_INTAKE_KEY` ausente em produção, outbox sem consumidor
  NetSuite/ServiceNow e sem CI dedicada.
- **Etapa 1 encerrada (20/10/2026):** release **0.1.2** assinado (Ed25519, **160 arquivos**, tree
  `7e4433f6448566ae5bf6f0df97d03ec0d0fe14fbbc839e9f332745609d1ae13c`, 01:31:40 −03:00, Worker
  `14b4a87b-ec15-4b70-8175-f55ef6943a6f`). Auditoria completa de bugs, falhas e vulnerabilidades:
  **12 achados corrigidos**, nenhum crítico/alto aberto; `npm run check` **162/162 em 17 arquivos**;
  `npm audit` 0; produção com CSP/HSTS/Origin guard e login exibindo **CorpServices Group**.
  Relatório em `docs/SEGURANCA-AUDITORIA-2026-10-20.md`; política em `docs/VERSIONAMENTO.md`;
  histórico em `CHANGELOG.md`. **Toda alteração futura sobe a versão.**
- **Histórico (18/10/2026):** **FASES 1–4 concluídas** — especificação transformada em plano,
  plataforma implementada por completo, **validada localmente ponta a ponta** e com os defeitos do
  primeiro uso real corrigidos e reverificados (P-07 rota do inventário; P-08 interface de anexos).
  Auditoria de aderência ao PROMPT MESTRE concluída — relatório em `memory/AUDITORIA-2026-10-17.md`.
  2 itens P1 encontrados e **resolvidos** (P-10 relatório inventory-variances 500; P-11 sem UI de
  gestão de estrutura). **Pós-entrega (17/10/2026, uso real):** P-12 corrigido — painel vazava
  dados globais para usuários operacionais (LGPD); **P-13 feito** — cadastro rápido de produto no
  recebimento com alerta de cadastro incompleto; **P-15/P-16 resolvidos** — menu lateral fixo e
  polimentos do vídeo do usuário (2ª rodada); **P-17 resolvido** — `partial()` do zod v4 reaplicava
  defaults em PATCH (categorias de chamado, prioridade de chamado/OS), com 3 regressões cobertas.
  **F-17 FEITO (17/10/2026):** Central de Suporte — canal público `/suporte` (redefinição de senha +
  ajuda, sem sessão, com link na tela de login), acompanhamento por token (conversa + posição
  discreta na fila), `/ajuda` interno (central de ajuda, meus pedidos, fila, conteúdo, e-mails),
  artigos/informativos, notificações internas e fila de e-mails (provedor pendente — F-13; resolvido
  depois em D-20/D-21);
  migration `0008`. **F-18 FEITO (18/10/2026):** Configurações reorganizadas (o grupo "Gestão" saiu
  da barra lateral; Catálogo, Estrutura, Relatórios, Auditoria e Usuários agora dentro de
  Configurações, com URLs preservadas e menu por seção) + **5 temas** (Clássico, Corporativo,
  Noturno, Violeta, Âmbar) com padrão do sistema (`settings['ui.theme']`, seção "Aparência") e
  escolha pessoal (`users.theme`, "Meu perfil"; "Tema do sistema" = sem override); migration `0009`.
  Complementos restantes em `memory/PLANO-COMPLEMENTOS.md` (F-01..F-19). Pipeline completo verde
  (typecheck real, lint, check:api 50×113, **134/134 testes**, build) à época do F-13.
  **F-13 ATIVADO (18/10/2026):** envio de e-mail real pelo provedor `gmail` (SMTP
   direto com senha de app; D-21) — 4 e-mails entregues de verdade na conta do usuário.
   **F-19 FEITO (18/10/2026):** anexos no chat de suporte (print/PDF/documento) via **Cloudflare R2**
   (binding `ATTACHMENTS`) com metadados no D1 — padrão 20 MB por arquivo configurável, token anônimo
   com regras restritas (5 MB/3 arquivos), download por sessão ou token, remoção com auditoria e
   BLOBs antigos do D1 intactos; migration `0012`; `14-support-attachments.spec.ts` (6 testes);
   verificação visual real; capturas `ux-shots/f19-*.png`; pipeline verde **134/134** (14 arquivos).
   **F-09 FEITO (18/10/2026):** checklist de execução na OS — técnico e gestor criam as etapas,
   marcam/desmarcam, anexam **foto por etapa** e removem o que não usam mais; rastro na linha do
   tempo (`work_order_events.type = 'checklist'`) e na auditoria; migration `0013`;
   `06-workorders.spec.ts` +7 testes; pipeline verde **141/141**; verificação visual real (técnico
   Diego Rocha e gestora Ana Souza); capturas `ux-shots/checklist-*.png`; decisão em D-22.
   **Regra de obrigatoriedade (decisão do usuário, 18/10/2026):** checklist criado pelo gerente de
   facilities bloqueia a conclusão da OS até ser totalmente preenchido (etapas do próprio técnico
   ou de admin continuam opcionais) — validado no servidor (409) e antecipado na UI; teste de
   aceite no navegador re-executado em 18/10 (`ux-shots/aceite-*.png`).
   **F-20 fase 1 FEITO (18/10/2026):** interfaces por perfil — painel inicial e menu próprios para o
   técnico ("Meu dia": suas ordens com pendências obrigatórias em destaque, meus chamados, ações
   rápidas), o solicitante ("Meus serviços": meus chamados + "Abrir chamado" direto), o gestor
   (visão geral + fila de aprovação de compras + ordens travadas pelo checklist do gestor) e o
   admin (visão geral + atalhos do sistema); tudo na mesma API do painel com escopo por
   permissão/identidade (herança do P-12); fase 2 (comprador/estoquista/limpeza/recepção) pendente;
   decisão em D-23; pipeline verde 141/141; capturas `ux-shots/perfil-*.png`.
   **F-11 FEITO (18/10/2026):** busca aproximada de produto em **todos** os pontos de seleção
   (consumo, movimentações de estoque, material de OS/chamado, itens de compra e filtros dos
   relatórios) — filtra enquanto digita, entende trecho do nome/SKU, **sem acento** e com termos em
   qualquer ordem (`ProductPicker` + `src/worker/search.ts`, sem coluna nova); junto, o **módulo de
   estoque ficou restrito a admin/gerente/estoquista** (migration `0014` remove
   `stock.view`/`stock.replenish` de comprador/técnico/limpeza/recepção; menu e rota somem por
   permissão; técnico lança material pela OS); decisão em D-24; pipeline verde **143/143**;
   verificação visual (admin, comprador, técnico e mobile); capturas `ux-shots/produto-busca-*.png`.
   **F-20 fase 2 + F-16 FEITOS (18/10/2026):** painéis e menus por perfil para **comprador**
   (fila de aprovação/andamento/a receber + cartões "Pedidos para registrar" e "Pedidos a
   receber" + alerta de cadastro incompleto), **estoquista** (saldos, mínimo, consumo e
   inventários + movimentações e itens críticos), **limpeza/liderança** (consumo, chamados;
   inventário só para o líder) e **recepção** (meus chamados); menus próprios em `layout.tsx` e
   `purchases.awaitingOrder`/`toReceive` no resumo, com gate por permissão. Junto: **F-16** —
   seletores exibem `Local — Unidade` via helper `locationLabel` (`src/shared/locations.ts`, sem
   coluna nova). Pipeline verde **146/146** (15 arquivos, incluindo `15-locations.spec.ts` e o
   teste de perfil fase 2); `check:api` 50×115; verificação visual dos 5 perfis + mobile;
   capturas `ux-shots/f20-2-*.png` e `ux-shots/f16-local-unidade.png`; decisões em D-25..D-29.
   **Ajustes dos perfis operacionais (19/10/2026):** liderança/equipe de limpeza e recepção
   **abrem chamados de manutenção** (já tinham `tickets.create` — requisito coberto por teste de
   regressão e verificação real: `TCK-2026-000004` pela liderança e `TCK-2026-000005` pela
   recepção) e a **recepção passou a lançar o consumo do posto** (migration `0015`:
   `consumption.view`/`consumption.create` para `role_reception`, estoque segue restrito; item
   "Consumo" no menu, ação "Registrar consumo" e indicador "Consumo (30 dias)" no painel;
   lançamento real `CON-2026-000002` com baixa de estoque); decisão em D-30.
   **F-01/F-02 FEITOS (19/10/2026 — D-31):** compras com **divisão item a item** (compra direta ×
   cotação, definida na análise do gestor — coluna `purchase_mode`, migration `0016`) e **ciclo de
   cotação por propostas de fornecedor com valor por item** (tabelas `purchase_quotes`/
   `purchase_quote_items`; status novos "Em cotação" → "Cotação retornada" → "Cotação aprovada");
   o comprador registra/atualiza propostas e devolve, o gestor aprova a vencedora (demais viram
   "Não escolhida") ou recusa, e o **pedido nasce com o fornecedor da proposta aprovada e o preço
   cotado herdado**; ordenar durante a cotação é bloqueado. Pipeline verde **148/148** (15 arquivos),
   `check:api` 50×119; verificação visual real (`SC-2026-000004` com `COT-2026-000001`/`0002` e
   pedido a R$ 11,80 herdado); capturas `ux-shots/f02-*.png`.
   **F-03..F-06 FEITOS (19/10/2026 — D-32):** compras fechadas — **linha do tempo** da solicitação
   derivada do `audit_log` (sem tabela nova; eventos de solicitação, propostas e recebimentos com
   código/fornecedor/nota), **uso direto no recebimento** (checkbox por item + justificativa única
   ≥5 caracteres; entrada **e** saída no mesmo lote no livro-razão, idempotente, sem criar registro
   de consumo formal), **relatório de compras ampliado** (cotações por situação, pedidos por
   fornecedor e "Ciclo das solicitações" com filtro de situação; exportação com modo, cotação
   aprovada, referência, valor total e último recebimento). Junto: **P-19** corrigido — filtros de
   período com data do calendário escondiam o próprio dia (normalização no servidor por
   `normalizeRangeBound` + conversão no cliente por `dayRangeParams`). Pipeline verde **151/151**
   (15 arquivos; +3 cenários), `check:api` 50×119; verificação real no navegador (linha do tempo da
   `SC-2026-000004`, recebimento `REC-2026-000004` com café em uso direto e validação visível,
   relatório mostrando o dia de hoje com filtro 2/0/2); capturas `ux-shots/f05-1-timeline.png`,
   `f06-1-recebimento-uso-direto.png` e `f03-f04-relatorios-compras.png`.
    **F-07/F-08 FEITOS (19/10/2026 — D-33):** **foto por câmera na execução** — o checklist da OS
    ganhou o diálogo de câmera (`getUserMedia` + quadro para JPEG no canvas,
    `src/client/lib/camera.tsx`) e perdeu o seletor de arquivo; horário da captura no nome do arquivo
    e no registro do anexo; permissão negada/sem câmera mostram orientação clara. **Documento em
    chamado/OS restrito à gestão** — nova permissão `attachments.documents` (migration `0017`; admin
    e gerente): o servidor recusa (403) anexo não-imagem em `ticket`/`work_order`/
    `work_order_checklist_item` para os demais, imagem continua livre (evidência de campo); o card de
    anexos do chamado mostra "Anexar foto" (técnico) ou "Anexar arquivo" (gestão); catálogo com
    **48 permissões**. Pipeline verde **152/152** (15 arquivos; +1 cenário), `check:api` 50×119;
    verificação real (câmera simulada com `canvas.captureStream`: JPEG 640×480 gravado e conferido;
    as duas faces do card de anexos); capturas `ux-shots/f07-*.png` e `f08-*.png`.
   **F-10 FEITO (19/10/2026 — D-34):** **OS filha** — vínculo `parent_work_order_id` (migration
   `0018`) definido na criação (pai inexistente → 404, pai cancelada → 409); árvore pai/filha na
   tela da OS (link para a pai, lista de filhas com situação/responsável e "Abrir OS filha" com
   local herdado) **só para a visão de gestão** (`facilities_manager`/`admin`, mesmo critério do
   painel — o servidor devolve os campos neutros para os demais); linha do tempo registra a origem
   e a auditoria guarda o vínculo. Pipeline verde **153/153** (15 arquivos; +1 cenário),
   `check:api` 50×119; verificação real (OS-2026-000008 criada a partir da OS-2026-000007; técnico
   sem o card); capturas `ux-shots/f10-*.png`.
   **F-14 FEITO (19/10/2026 — D-35):** **usabilidade da estrutura** — a aba **Locais** ganhou
   **árvore visual como visão padrão** (seletor Árvore|Tabela; expandir/recolher; ações no nó com
   "+ Sublocal" e pai pré-selecionado) e o diálogo de local ficou enxuto (Código/Observações sob
   "Mais opções"); o filtro "Todos os pais" (auto-referente) foi removido — as funções seguem
   (filtro por unidade, tabela completa, edição, desativação, criação). Sem mudança de API/banco
   (nenhum teste novo; pipeline segue **153/153**, `check:api` 50×119); verificação real (Palco e
   Camarim criados pela tela em dois níveis; collapse/expand; "Mais opções"); capturas
   `ux-shots/f14-*.png`. Pendente: aceite do usuário da nova UX.
    **Plano de complementos fechado** (F-01 a F-20 resolvidos).
    **FASE DE IDENTIDADE VISUAL APLICADA (19/10/2026 — D-36/D-37/D-38):** a marca do cliente foi processada e
    aplicada — **logo** no menu lateral e no cartão do login (variante clara no tema Noturno, por um
    hook único de tema efetivo), **papel de parede** do login (foto da operação + véu escuro),
    **favicon/Apple touch**, **tela de abertura** (HTML: logo + spinner, com `prefers-reduced-motion`)
    e **capa no topo de todas as homes por perfil** (desktop + variante mobile via `<picture>`).
    **D-37 (correção do logo):** o logo foi **reconstruído do original de alta resolução**
    (`branding/logo.png`, 2752×1536) por extração **geométrica** em canvas (fundo transparente real);
    o anterior **sumia no tema Noturno** (círculo preto sobre superfície escura). **D-38 (correção do
    usuário):** a **bolinha laranja foi removida** — ela não existe no mestre vetorial
    (`branding/logo.svg`, verificado pixel a pixel) e só aparecia nos exports/mockups e na arte da
    capa; o logo, o favicon e a capa foram refeitos sem o acento. Assets finais: `logo.webp` (claro) e
    `logo-dark.webp` (invertido: círculo branco, "Corp" preto), 32 KB cada, mais favicon,
    Apple touch, `login-bg.webp`, `cover.webp` e `cover-mobile.webp` (7 arquivos, ~300 KB); o
    `logo.svg` saiu do build (o original segue em `branding/`). Pipeline verde **153/153** (15
    arquivos), `check:api` 50×119, typecheck/lint/build; verificação real no navegador (login, home
    desktop, home em 390 px, tema Noturno com o logo legível); capturas `ux-shots/vi-*.png`.
    **Falta:** ~~refinar ícones internos, motion~~ **FEITO (20/10/2026 — D-40):** ícones literais
    (`←`, `✕`, `▸/▾`) substituídos pelo conjunto interno; movimento curto em diálogo, gaveta,
    menus e toasts, com `prefers-reduced-motion`; validado no navegador real. Aceite visual considerado no fechamento da etapa 1 (20/10/2026).
   **Chat (20/10/2026 — D-41):** mensagem otimista nos dois fluxos (bolha aparece antes do POST,
   com "enviando", e é reconciliada por id), painel `ChatThread` com bolhas/avatar/horário,
   separadores de dia, rolagem própria e composer com Enter/anexos; releitura a cada 20 s nos dois
   lados. Validado no Playwright com POST desacelerado em 1,5 s (sem duplicata) e em 390×844.
   Aceite visual do chat considerado no fechamento da etapa 1.
   **PUBLICADO (20/10/2026 — D-39):** repositório **privado** `Allanlugui/facil` no GitHub
   (branch `main`, commit `4c878a8`, 3 commits, push sincronizado), Worker `facil` no Cloudflare e
   D1 remoto `facil-db` (`10365b4d-7ed0-4e8e-8aba-65ebf354cb25`, ENAM) com as **18 migrations** e
   instalação inicial concluída. URL: **https://facil.cf-pilot-disposable.workers.dev** (`workers.dev`; sem
   domínio próprio ainda). Release **0.1.2** assinado (Ed25519, **160 arquivos**, tree
   `7e4433f6448566ae5bf6f0df97d03ec0d0fe14fbbc839e9f332745609d1ae13c`, 20/10/2026 01:31:40 −03:00 —
   fechamento da etapa 1 com auditoria de autorização, anexos e endurecimento; Worker version
   `14b4a87b-ec15-4b70-8175-f55ef6943a6f`); `/api/health` devolve o bloco `release`,
   `/build-info.json` é público e os cabeçalhos `X-Facil-Author/Release/Signed-At/Tree-Sha256`
   carregam a assinatura. **R2 não habilitado** na conta: o binding ficou comentado em
   `wrangler.jsonc`, os anexos do suporte respondem **503 `R2_UNAVAILABLE`** (chamados/OS usam D1)
   e os testes usam bucket simulado no Miniflare. **Instalação inicial concluída**
   (`needsSetup: false`): o admin **Allan Lima** foi criado pelo titular; o sistema não expõe CPF
   nem e-mail do autor.
   Deploy: **EXECUTADO** (D-10 concluída); o guia da TI está em `docs/IMPLANTACAO.md`.

## Stack em execução (VALIDADO)

| Camada | Escolha | Evidência |
|---|---|---|
| Runtime | Cloudflare Workers (`compatibility_date 2026-10-01`, `nodejs_compat`) | `wrangler dev` + `wrangler deploy --dry-run` |
| API | Hono 4 + Zod 4 | `npx tsc --noEmit` limpo; 162 testes |
| Banco | D1 (SQLite) + migrations `0001`–`0018` | `wrangler d1 execute` local |
| Cliente | React 19 + Vite 7 + Tailwind v4 + React Router 7 | `vite build` (chunks por página) |
| Auth | PBKDF2-SHA256 (WebCrypto, 100k) + token opaco em D1 + cookie HttpOnly | testes 01-auth + smoke |
| Testes | vitest 5.0.5 + `@cloudflare/vitest-plugin` (D1 isolado por spec) | 17 arquivos, 162/162 |

## O que existe hoje (verificado em 17/10/2026)

| Item | Estado real |
|---|---|
| Código-fonte | `src/worker` (17 módulos de rota), `src/shared`, `src/client` (24 rotas) |
| Banco | migrations `0001_schema` → `0018_work_order_parent` aplicadas no D1 local (+ bucket R2 `facil-attachments` simulado) |
| Testes | **162/162** em 17 spec files (última execução 20/10/2026; ~145 s) |
| Lint / typecheck | `eslint .` limpo; `tsc` **nos dois projetos** (script corrigido em 18/10 — antes era no-op; D-19) |
| Guard de rotas | `npm run check:api` — 50 caminhos do cliente × 119 rotas do worker (P-07) |
| Build | `vite build` conclui; asset principal 367 kB (116 kB gzip) + chunks por página |
| Smoke HTTP | `scripts/smoke.ps1` **11/11** em dois cenários: instalação existente e reset de fábrica |
| UI | Playwright desktop 1440×900 e mobile 390×844: **14 rotas sem overflow** e **sem mensagem de erro visível** (varredura de conteúdo após P-07) |
| Fluxo E2E real | movimentação pela interface → saldo/painel/auditoria; inventário criado e encerrado; anexo enviado → baixado (200) → removido |
| Seeds | `seeds/demo.sql` (catálogo + 6 usuários demo) e `seeds/reset.sql` (reset de fábrica) — ambos testados |
| Repositório Git | **PRIVADO no GitHub** (`Allanlugui/facil`, branch `main`, 3 commits, push sincronizado em 20/10/2026) — `node_modules/`, `dist/`, `.wrangler/` fora |
| Deploy | **PUBLICADO em 20/10/2026** - `https://facil.cf-pilot-disposable.workers.dev` (Worker `facil`, D1 remoto `facil-db`, release 0.1.2 assinado; instalação concluída, `needsSetup: false`) |
| Serena | projeto `Facil` ativo; onboarding completo (`core`, `tech_stack`, `suggested_commands`, `conventions`, `task_completion`) |

## Módulos implementados (todos com rota de API + tela + testes)

1. **Base:** setup inicial, login/logout, sessão com cookie, troca de senha obrigatória, perfil,
   usuários/perfis/permissões (com escopo por local), estrutura (unidades e locais hierárquicos),
   configurações (catálogo tipado com efeito real) e auditoria (somente leitura).
2. **Estoque:** catálogo (produtos, categorias, UMs, fornecedores), posição de saldo, lançamento e
   reversão de movimentações (motor único; saldo é derivado), inventário cíclico.
3. **Operação:** consumo (com reposição de água que não duplica dedução), chamados com anexos,
   ordens de serviço com materiais (motor compartilhado) e **checklist de execução do técnico
   (itens + foto por etapa — F-09)**, compras (requisição → aprovação com **divisão compra
   direta/cotação por item — F-01** → **propostas de fornecedor com valor por item e aprovação da
   vencedora — F-02** → pedido vinculado à proposta → recebimento com entrada de estoque),
   notificações e painel.
4. **Leitura:** relatórios (7 visões + exportação CSV) e exportação com BOM/`;` para Excel pt-BR.
5. **Suporte:** central de ajuda com artigos/informativos (também públicos), canal de redefinição
   de senha/ajuda com fila FIFO e conversa por token (público), **anexos nas conversas (print, PDF,
   documento) até 20 MB por arquivo via R2 — token anônimo com teto menor (F-19)**, atendimento
   interno com gestão de conteúdo, fila de e-mails (`support.manage` — perfil admin) e envio com
   provedor configurável — Resend, Brevo, **relay no Gmail via Apps Script** ou **Gmail por SMTP com
   senha de app** (custo zero, qualquer destinatário; D-20/D-21; guias em `docs/email-relay-gmail.md`
   e `docs/email-gmail-senha-app.md`; anexos em `docs/anexos-suporte.md`).

## Garantias estruturais validadas por teste

- Movimentos são a fonte de verdade; saldo só muda por movimentação; histórico imutável (reversão).
- Estoque negativo bloqueado por trigger de banco; permissões checadas no servidor (menor privilégio;
  ninguém concede privilégio que não possui).
- Idempotência: `request_key` único + replay explícito (`idempotentReplay`) contra envio duplicado.
- Consumo/recebimento/OS gravam tudo em `db.batch` (atômico); auditoria registra antes/depois.
- Fuso: timestamps gerados no backend; exibição em `America/Sao_Paulo` no cliente.

## Honestidade de estado

- **Deploy remoto: EXECUTADO (20/10/2026).** Worker `facil` publicado em
  `https://facil.cf-pilot-disposable.workers.dev`, D1 remoto com 19 migrations e admin
  **Allan Lima** (`needsSetup: false`), release **0.3.0** assinada. Limitações reais: URL
  `workers.dev` (sem domínio próprio nem Cloudflare Access), **R2 desligado** (anexos do suporte
  em 503 claro; D1 atende chamados/OS) e **sem CI** (deploy por `npm run deploy`; Workers Builds
  é opcional).
- **Dados históricos (20/10/2026):** consulta somente leitura ao D1 de produção encontrou
  **0 linhas `settings.update`**, **0 anexos** e chaves `mail.*` vazias — não havia segredo
  histórico exposto em auditoria nem SVG armazenado. A rotação de credenciais de e-mail segue
  recomendada ao titular antes de configurar o envio real.
- _"Assinatura eletrônica"_ no produto significa autoria autenticada + trilha de auditoria; **não** é
  assinatura digital ICP-Brasil e nenhuma tela a apresenta como tal.
- ~~Aviso do wrangler "types out of date"~~ **Resolvido (18/10/2026):** `@types/node` instalado
  (dev) e `npm run types` regenerou `worker-configuration.d.ts` — agora com o binding
  `ATTACHMENTS: R2Bucket` — sem avisos; P-06 fechado.
- `package.json` não tem CI configurado; o deploy oficial é `npm run deploy` (sign + check + build +
  `wrangler deploy`); Workers Builds é opcional e está documentado em `docs/IMPLANTACAO.md`.

## Pendências

- ✅ **Auditoria de segurança (20/10/2026):** 12 achados corrigidos (escopo por local, autoridade
  de usuários, anexos por entidade, ações de chamado/OS, segredos, uploads e cabeçalhos), sem
  achado crítico/alto aberto. Relatório em `docs/SEGURANCA-AUDITORIA-2026-10-20.md`; regressões em
  `tests/16-security.spec.ts` e `tests/17-authorization.spec.ts`; pipeline **162/162**.
- ✅ **Etapa 1 encerrada (20/10/2026):** release **0.1.2**, commit `062ea85`, tags `v0.1.0`
  (histórica) e `v0.1.2`; política de versionamento em `docs/VERSIONAMENTO.md` e histórico em
  `CHANGELOG.md`. Toda alteração futura sobe a versão.
- ⬜ **Opcionais do titular:** habilitar R2 para anexos do suporte, domínio próprio/Cloudflare
  Access, CI no GitHub Actions e aceite visual de melhorias futuras.
- ✅ **P-03, P-07, P-08, P-10, P-11 e P-12 resolvidos** (detalhes em `PROBLEMAS.md`): predecessor
  arquivado; rota do inventário corrigida + guard `npm run check:api`; anexos com interface
  completa; relatório de divergências; UI de estrutura; painel sem vazamento (LGPD).
- ✅ **P-13 feito:** cadastro rápido de produto no recebimento (nome apenas; alerta/notificação até
  completar o cadastro) — migration `0007`.
- ✅ **P-18 resolvido (18/10/2026):** pílulas de status padronizadas em todo o produto — o componente
  único `Badge` (`src/client/lib/ui.tsx`) recebeu `whitespace-nowrap`, largura por conteúdo,
  `py-1 px-2.5` e centralização interna; valia para as ~60 pílulas de 17 páginas (tabelas de
  movimentações, chamados, OS, compras, inventário, relatórios, configurações, catálogo, usuários,
  estrutura, auditoria, suporte). Verificação no navegador em desktop e mobile: 0 pílulas quebradas;
  capturas `ux-shots/pill-*.png`; pipeline verde **134/134**.
- ✅ **Revisão UX/UI completa (17/10/2026):** acentuação pt-BR em todo o produto (código, seeds,
  migrations e dados do banco demo), pluralização automática (~47 pontos), corretivas da revisão
  (P-14 links de notificação; "Olá"; "Desejada para" formatada; nome da empresa no settings) e
  limpeza do rastro de smoke no D1. Relatório: `memory/REVISAO-UX-2026-10-17.md`; capturas:
  `ux-shots/v2-*.png`. Pipeline verde após tudo (109/109).
- ✅ **Pós-revisão (vídeo do usuário, 2ª rodada, 17/10/2026):** **P-15** menu lateral fixo (shell com
  rolagem interna; rodapé "empresa · fuso" sempre visível) e **P-16** setas de rolagem fantasma nas
  abas + rótulos "De/Até" na Auditoria. Capturas `ux-shots/v3-*.png`; pipeline verde (109/109).
- ✅ **F-09 (FEITO 18/10/2026 — D-22):** checklist de execução na OS — o técnico (e o gestor) cria
  as etapas, marca/desmarca e anexa foto por etapa; fotos pelo módulo de anexos
  (`work_order_checklist_item`), rastro na linha do tempo + auditoria, aviso ao responsável quando
  outra pessoa adiciona item; migration `0013`; `06-workorders.spec.ts` +7 testes; pipeline
  **141/141**; capturas `ux-shots/checklist-*.png`. **Regra do usuário (18/10):** checklist criado
  pelo gerente de facilities é obrigatório — a conclusão da OS fica bloqueada (409) até marcar todas
  as etapas dele; etapas do próprio técnico ou de admin continuam opcionais.
- ✅ **Plano de complementos fechado (19/10/2026)** — F-01..F-20 resolvidos em `memory/PLANO-COMPLEMENTOS.md`
  (compras completas, foto por câmera, anexos por gestores, OS filha, árvore de estrutura, trilha
  mantida como assinatura). Último item funcional: **F-14 (D-35)**. As 3 decisões antigas do plano
  estão resolvidas: cotação (D-26), assinatura (D-27, manter trilha) e captcha (D-15, camada final).
  **Concluído depois:** fase visual (D-40), chat (D-41), deploy (D-39) e auditoria/fechamento da
  etapa 1 na release **0.1.2** (20/10/2026).
- ✅ **F-13 (FEITO E ATIVADO 18/10/2026 — D-20 relay / D-21 gmail):** envio para qualquer e-mail sem
  custo e sem domínio. Duas vias: Web App do Apps Script (`docs/email-relay-gmail.md`;
  `tests/12-mail-relay`) e **SMTP direto com senha de app** (`docs/email-gmail-senha-app.md`;
  `tests/13-smtp`). **Via ativa na conta do usuário: `gmail`** — 4 e-mails reais entregues em
  18/10 (teste + SUP-2026-000002); status "Enviado" confirmado no banco. Observações: `sent` =
  servidor aceitou (devolução chega depois na caixa do remetente); avisos internos para endereços
  falsos (`admin@facil.local`) precisam virar e-mails reais no deploy; senha de app rotacionável em
  `myaccount.google.com` (atualizar `mail.gmail_app_password`).
- ✅ **F-19 (FEITO 18/10/2026 — D-18):** anexos no chat de suporte (print/PDF/documento) até **20 MB
  por arquivo configurável** (`attachments.max_bytes`, catálogo agora até 50 MB), **binário no R2**
  (`facil-attachments`, binding `ATTACHMENTS`; simulado no dev/testes) e metadados no D1; upload por
  token anônimo com teto próprio (5 MB / 3 arquivos / tipos reduzidos); download por sessão ou token;
  remoção só pelo staff com auditoria; BLOBs antigos do D1 intactos; migration `0012`;
  `14-support-attachments.spec.ts` (6 testes); capturas `ux-shots/f19-*.png`; guia
  `docs/anexos-suporte.md`. Pipeline verde **134/134** (14 arquivos).
- 🧪 **Nota local (18/10/2026):** conta de verificação `qa.admin@demo.local` (admin, senha
  `Demo@Facil2026`) criada só no D1 local para a verificação visual da F-18 — removível a qualquer
  momento. A senha de `admin@facil.local` foi alterada em uso real (não corresponde mais a
  `FacilDev#2026`). A linha "Relay respondeu 404…" na caixa de saída do demo é rastro explicado da
  verificação da F-13 (URL de teste inexistente). Linhas pendentes para `qa.admin@demo.local` /
  `admin@facil.local` depois da ativação do Gmail: **não reenviar** (endereços sem caixa postal;
  o Gmail aceita e devolve). **Verificação da F-19:** pedido de teste `SUP-2026-000003`
  ("Solicitante F-19") criado no D1 local com 1 anexo real no R2; os 8 e-mails dele ficaram
  **pendentes** (o envio foi desligado durante o teste e religado depois) — reenviar só se quiser
  receber os e-mails de teste.
- Git init + Worker Builds + `wrangler d1 create` + migrations remotas — aguarda credenciais/autorização.
- ~~P-06: instalar `@types/node`~~ **RESOLVIDO (18/10/2026)** — `@types/node` instalado (dev),
  `worker-configuration.d.ts` regenerado com `ATTACHMENTS: R2Bucket`.
- (Opcionais) anexos em ordens de serviço; remover registro antigo no Serena; CI no GitHub Actions.
