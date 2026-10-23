# Histórico: Facil

## H-00 — Criação do projeto (16/10/2026 22:36:22)

- Projeto criado pelo bootstrap global `D:\DEV\criar-projeto.bat` (todos os 5 passos concluídos).
- Gerados: `AGENTS.md` na raiz, `memory/` com 12 arquivos e `D:\DEV\memory\Facil\` com 10 arquivos de
  conhecimento global, além da linha `Facil` no `SUBCONSCIENTE.md`.

## H-01 — FASE 0: preparação e inicialização (16/10/2026)

Ordem dos trabalhos e o que foi comprovado:

1. **Reconhecimento do ambiente.** `D:\DEV\Opencode\Facil` contém apenas `AGENTS.md` + `memory/`.
   Sem Git, sem código, sem `package.json`, sem `.serena`.
2. **Localização da memória global.** `F:` não existe; `D:\DEV\memory` confirmado como raiz real
   (`D:\dev\memory` é o mesmo diretório). Auditoria da origem do `F:`: **zero** ocorrências em
   `criar-projeto.bat`, nos dois `.txt` de protocolo, em `~/.config/opencode/*` e em `~/.agents/` —
   a referência veio apenas no texto do prompt desta sessão. Registrado em D-01 / P-02.
3. **Leitura global obrigatória.** `regras-agente.md` (32 seções), `padroes-codigo.md` (62 seções) e
   `SUBCONSCIENTE.md` lidos integralmente. **Nenhum arquivo global foi alterado.**
4. **Leitura da memória local.** Os 12 arquivos de `memory/` foram inspecionados — eram stubs do
   template, sem conteúdo a preservar além dos marcadores.
5. **Conhecimento global do projeto.** `D:\DEV\memory\Facil\` já existia (10 arquivos, todos stubs).
6. **Inconsistência encontrada.** `D:\DEV\Opencode\facilities-management`: mesmo produto, bootstrap de
   22:01:51 abortado pelo bug P-01. Absorvido como predecessor superado (D-02 / P-03).
7. **Causa do P-01 confirmada.** O `.bat` foi corrigido pelo usuário às 22:17:53 (`^(` / `^)`), entre
   os dois bootstraps. Nada a corrigir.
8. **Serena.** `Facil` não estava registrado. Criado e ativado via `activate_project` (Serena 2.0.0),
   seguido da escrita da memória `core` ponte. Onboarding completo permanece pendente (sem stack).
9. **Memória atualizada.** `STATUS.md`, `TODO.md`, `DECISOES.md`, `PROBLEMAS.md`, `HISTORICO.md`,
   `ARCHITECTURE.md`, `DESIGN-UX.md`, `DEPLOY.md` e `APRENDIZADOS.md` refletem o estado real verificado.
10. **Conhecimento global alimentado.** `SOLUCOES.md`, `PROBLEMAS_RESOLVIDOS.md`,
    `APRENDIZADOS_REUTILIZAVEIS.md` e `README.md` em `D:\DEV\memory\Facil\`; uma linha acrescentada ao
    `SUBCONSCIENTE.md` (append, sem reescrever o índice).

**Estado ao final desta entrada:** FASE 0 concluída. **Nenhuma linha de código escrita.**
Aguardando o **PROMPT MESTRE** (especificação funcional oficial).

## H-02 — FASE 1: planejamento oficial (17/10/2026)

1. **PROMPT MESTRE lido integralmente** (22 seções) e convertido em plano de execução por módulo.
2. **Stack decidida** (D-04): Cloudflare Workers + Hono + D1 + React 19 + Vite 7 + Tailwind v4 +
   React Router 7 + Zod 4. Rejeições documentadas (D-05): Next.js/OpenNext e Supabase.
3. **Modelo de dados fixado** (D-06): quantidades em milésimos, dinheiro em centavos, datas ISO-8601
   UTC geradas no backend, `db.batch` como atomicidade, movimentos como fonte de verdade do saldo.
4. **Segurança planejada** (D-07): PBKDF2 WebCrypto, sessão opaca em cookie HttpOnly, autorização por
   permissão no servidor, `default deny`.
5. **Idempotência planejada** (D-08): `request_key` UNIQUE + replay explícito de duplicatas exatas.
6. **Deploy mantido como PLANEJADO** (D-10): sem credenciais nem autorização, nada é publicado.

**Estado ao final desta entrada:** plano fechado; nenhum código ainda.

## H-03 — FASE 2: implementação completa (17/10/2026)

1. **Esqueleto:** `package.json`, wrangler config, tsconfigs (worker/cliente/raiz), ESLint, vitest com
   plugin D1.
2. **Migrations `0001`–`0006`:** schema completo (estrutura, usuários/perfis/permissões/escopos,
   catálogo, estoque com triggers anti-negativo, consumo, inventário, chamados, ordens, compras,
   recebimento, configurações/counters, auditoria, notificações, anexos, sessões/throttle).
3. **Worker (16 módulos de rota + health):** auth, structure, users, catalog, stock, consumption,
   inventory, tickets, workorders, purchases, dashboard, reports, settings, audit, attachments,
   notifications — com `requirePermission` por rota, erros padronizados e auditoria transacional.
4. **Cliente (20 rotas):** libs `api`/`format`/`session`/`hooks`/`ui`/`lookups`; shell com navegação
   filtrada por permissão e drawer mobile; todas as páginas operacionais e de leitura; SPA com
   code-splitting por rota.
5. **Seeds:** `seeds/demo.sql` (dados-mestres + 6 usuários demo) e `seeds/reset.sql` (reset de fábrica
   preservando referência das migrations).

**Estado ao final desta entrada:** plataforma funcional de ponta a ponta; primeira execução de
typecheck/lint/build/testes aconteceu na fase seguinte (validação).

## H-04 — FASE 3: validação local completa (17/10/2026)

1. **Typecheck** primeiro na história do projeto: 5 erros no cliente (tipos de status e guardas de
   settings) + limpeza de imports; depois worker **e** cliente limpos.
2. **Lint:** 17 erros corrigidos (imports não usados, `exhaustive-deps` sem plugin, `ts` morto);
   `eslint .` limpo.
3. **Bundling:** diagnóstico e correção do alias `@shared/*` no esbuild do wrangler (P-04) via
   `paths` no `tsconfig.json` da raiz; `--dry-run` validado; loop de restart do dev server resolvido.
4. **Testes:** **107/107** em 9 spec files (auth, estrutura/usuários, catálogo, estoque, consumo,
   inventário, chamados/ordens, compras, relatórios) — D1 isolado por spec.
5. **Smoke HTTP (`scripts/smoke.ps1`):** 11/11 em instalação existente **e** após `reset.sql`
   (incluindo o fluxo real de setup do zero, que cria o administrador).
6. **Seeds:** demo aplicado e conferido (16 produtos, 4 fornecedores, 9 locais, usuários demo);
   reset concluído e reaplicado o seed; login demo verificado por API (Ana Souza, 45 permissões).
7. **Playwright (desktop 1440×900 + mobile 390×844):** login real, painel, estoque, catálogo,
   relatórios, usuários e configurações; drawer mobile; varredura das 14 rotas sem overflow
   horizontal (após correção P-05); **fluxo E2E real**: movimentação registrada pela interface →
   saldo zerado→24 UN, painel e auditoria atualizados.
8. **Build:** `vite build` com chunks por página (principal 362 kB / 114 kB gzip);
   `wrangler deploy --dry-run` OK.

**Estado ao final desta entrada:** FASES 1–3 concluídas e validadas localmente. **Produção: não
publicada** (sem Git, sem credenciais Cloudflare, sem autorização). Pendência humana: P-03.

## H-05 — FASE 4: correções do uso real + guard de rotas (17/10/2026)

1. **Bug encontrado pelo usuário em uso real:** a tela Inventário mostrava
   "Rota nao encontrada: /api/inventory" — o cliente usava o singular, o worker monta
   `/api/inventories` (P-07). Corrigidas as 10 chamadas de `inventory.tsx`.
2. **Varredura completa cliente↔worker:** todos os 109 pontos de chamada do cliente foram comparados
   com as rotas do worker; além do inventário, nenhuma outra divergência de caminho.
3. **Lacuna real encontrada na varredura:** anexos tinham backend completo e testado, mas **nenhuma
   UI** (P-08) — implementado card Anexos no detalhe do chamado (listar, enviar, baixar, remover).
4. **Guard permanente:** `scripts/check-api-paths.mjs` (`npm run check:api`, dentro de
   `npm run check`) cruza cada literal `/api/...` do cliente com os 99 caminhos registrados no
   worker; teste negativo confirmou detecção (41 caminhos do cliente conferidos no estado atual).
5. **Verificação pela interface (Playwright):** inventário criado e ciclo fechado com exceção
   registrada; anexos com upload real → download autenticado 200 → remoção auditada; varredura das
   14 rotas sem mensagem de erro visível e sem overflow (desktop e mobile 390 px).
6. **Pipeline completo verde:** typecheck (worker+cliente), `eslint .`, `check:api` e **107/107**
   testes; build e `wrangler deploy --dry-run` OK.
7. **Ícone de Configurações quebrado (P-09, relatado pelo usuário):** o path do `GearIcon` saía do
   viewBox (y=25) e misturava coordenadas absolutas/relativas — substituído por path padrão e
   verificado por varredura `getBBox()` de todos os SVGs das 14 rotas (zero fora do viewBox).

**Estado ao final desta entrada:** defeitos do uso real corrigidos e verificados; pipeline verde com
o guard novo. **Produção: continua não publicada** — aguarda autorização + credenciais.

## H-06 — F-17: Central de Suporte + P-17 (17/10/2026)

1. **Pedido do usuário:** redefinição de senha acessível da tela de login (nome, setor, matrícula +
   justificativa), resposta do administrador com fila, página de suporte estilo blog (informativos,
   segurança, FAQ) para logados, página pública + formulário de ajuda para não logados e e-mail a
   cada mensagem. Captcha deliberadamente adiado para o final, após validar o processo (D-15).
2. **Backend:** migration `0008_support.sql` (pedidos, mensagens, artigos, caixa de saída,
   permissão `support.manage` só para o admin, configurações `mail.*`, contador e 3 artigos
   iniciais); `routes/support.ts` com canais público (token) e interno; `mailer.ts` com fila
   idempotente e adaptadores Resend/Brevo — sem provedor configurado os e-mails ficam `pending` e
   reenviáveis pela aba E-mails.
3. **Cliente:** `/suporte` público ("Esqueceu a senha? Clique aqui" no login abre o formulário
   direto via `?tipo=senha`), `/suporte/acompanhar/:token` (conversa + posição discreta na fila,
   atualização a cada 20 s), `/ajuda` interno (central de ajuda e meus pedidos para todos; fila,
   conteúdo e e-mails só com `support.manage`) e item "Suporte" no menu.
4. **P-17 descoberto e corrigido no caminho:** `partial()` do zod v4 reaplica defaults — PATCH de
   isActive apagava tipo padrão/ordem da categoria de chamado (e renomear inativa a reativava);
   PATCH de status rebaixava a prioridade do chamado; edição parcial de OS reaplicava
   prioridade/material. Schemas de atualização explícitos nos 3 módulos + 3 testes de regressão.
5. **Verificação real (Playwright):** anônimo abriu o pedido SUP-2026-000001 (posição 1º), recebeu
   o link, conversou; admin respondeu e marcou "Em atendimento"; solicitante viu a resposta;
   e-mails pendentes visíveis; artigos gerenciados; notificações internas; mobile 390 px sem
   overflow. Capturas `ux-shots/v4-*.png` (14).
6. **Pipeline verde:** typecheck, `eslint .`, `check:api` (48 caminhos × 110 rotas), **118/118**
   testes e build. Migration `0008` aplicada no D1 local.

**Estado ao final desta entrada:** Central de Suporte entregue e validada localmente. Pendências
ligadas: provedor de e-mail (F-13) e captcha como camada final (D-15). **Produção: continua não
publicada.**

## H-07 — F-18: Configurações reorganizadas + 5 temas (18/10/2026) — (registro retroativo)

1. **Pedido do usuário:** o grupo "Gestão" na barra lateral confundia; Catálogo, Estrutura,
   Relatórios, Auditoria e Usuários deveriam morar dentro de Configurações — **sem quebrar URLs** —
   e o produto pediu variedade de aparência (temas).
2. **Implementação:** Configurações virou área única com seções e menu lateral interno
   (`/configuracoes/:section?`), URLs antigas preservadas; **5 temas** (Clássico, Corporativo,
   Noturno, Violeta, Âmbar) com padrão do sistema pelo admin (`settings['ui.theme']`, seção
   "Aparência") e escolha pessoal no perfil (`users.theme`; "Tema do sistema" = sem override).
   Migration `0009_themes.sql`; `11-preferences.spec.ts` (3 testes).
3. **Verificação:** visual desktop/mobile (capturas `ux-shots/f18-*.png`), inclui estado somente
   leitura para quem não pode editar; pipeline verde **121/121**. Detalhes em D-17.
4. **Nota de execução:** registraram-se cliques "fantasma" durante a verificação — investigados
   por instrumentação; era interação externa no navegador de teste, não bug.

**Estado ao final desta entrada:** F-18 entregue e verificada; produção continua não publicada.

## H-08 — F-13: e-mail para qualquer endereço, sem custo — relay e Gmail (18/10/2026) — (registro retroativo)

1. **Pedido do usuário:** disparo de e-mail para **qualquer endereço** sem provedor pago e sem
   domínio próprio; sem conhecer/assinar Brevo; Resend grátis só entrega para o dono da conta.
2. **Solução (duas vias):** provedor `relay` — Web App do Google Apps Script na própria conta
   Gmail (migration `0010`, guia `docs/email-relay-gmail.md`, `tests/12-mail-relay`), com contrato
   de confirmação positiva (2xx + `{"ok": true}`; A-12); e, na ativação real, provedor `gmail` —
   **SMTP direto** com senha de app via `cloudflare:sockets` (`src/worker/smtp.ts`), sem script no
   Google (migration `0011`, guia `docs/email-gmail-senha-app.md`, `tests/13-smtp.spec.ts`).
3. **Ativação real:** credencial validada por sonda local (235); configuração pela UI (provider
   Gmail, remetente `lima.atecnica@gmail.com`); **4 e-mails entregues de verdade** (1 de teste +
   os 3 do pedido real SUP-2026-000002); status "Enviado" no banco; capturas
   `ux-shots/f13b-gmail-*.png`. Aprendizado: `sent` = SMTP aceitou; bounce volta para o remetente.
4. **Pipeline verde:** typecheck, `eslint .`, `check:api` 49×111, **128/128** testes (13 arquivos),
   build e `wrangler deploy --dry-run` OK. Decisões D-20 e D-21.

**Estado ao final desta entrada:** e-mail em produção de verdade pela conta do usuário (no D1
local; deploy remoto segue não publicado).

## H-09 — F-19: anexos no chat de suporte via Cloudflare R2 (18/10/2026)

1. **Pedido do usuário:** enviar anexos (screenshot/PDF/documento) no chat de suporte dos dois
   lados — solicitante e atendimento — com tamanho de arquivo na casa de **15–20 MB**, algo
   impossível no BLOB do D1. Decisão: **Cloudflare R2** (free tier), metadados no D1; BLOBs
   antigos continuam funcionando (D-18).
2. **Backend:** migration `0012_support_attachments.sql` reconstrói `attachments` (SQLite não
   afrouxa `NOT NULL`): `content` opcional, `uploaded_by` opcional (anônimo), `storage`
   (`d1`/`r2`) e `r2_key` com CHECK; novo padrão `attachments.max_bytes` = 20 MB (catálogo até
   50 MB). `routes/support.ts` aceita mensagem com arquivos (multipart), valida por contexto —
   sessão: 10 arquivos/mensagem, teto por arquivo e por mensagem; token: 3 arquivos, 5 MB, tipos
   reduzidos — sobe para o R2 **antes** do batch do D1 e remove os objetos se o batch falhar;
   download por sessão (`/api/support/attachments/:id`) e por token
   (`/api/support/track/:token/attachments/:id`); remoção só pelo staff com auditoria
   (`support.attachment.delete`). Rotas genéricas de anexo passaram a **recusar** tipos fora do
   mapa (incl. `support_message`) — antes um tipo desconhecido pulava a checagem de permissão na
   leitura.
3. **Cliente:** compositor das duas telas com "Anexar" (chips, remover antes de enviar, limite
   efetivo exibido), bolhas renderizam imagem com mini­atura ou cartão com tipo/nome/tamanho;
   mensagens antigas com anexo D1 seguem abrindo.
4. **Verificação real:** pedido `SUP-2026-000003` no D1 local — solicitante (link token) anexou
   print (~2 KB, ficou no R2 com `uploaded_by` nulo), staff respondeu com PDF, remoção do PDF pelo
   staff sumiu da conversa e **apagou o objeto** (bucket local ficou com 1 blob), auditoria com
   `support.message` (attachments: 1) e `support.attachment.delete`; capturas
   `ux-shots/f19-*.png`. Durante o teste o envio de e-mail ficou desligado e foi **religado** ao
   fim (os e-mails do pedido de teste ficaram pendentes de propósito).
5. **Pipeline verde:** typecheck (worker + cliente), `eslint`, `check:api` **50×113**, **134/134**
   testes (14 arquivos — novo `14-support-attachments.spec.ts` com 6), build e
   `wrangler deploy --dry-run`. **P-06 resolvido:** `@types/node` instalado e
   `worker-configuration.d.ts` regenerado com `ATTACHMENTS: R2Bucket`.
6. **Produção:** criar o bucket uma vez (`npx wrangler r2 bucket create facil-attachments`);
   guia do usuário em `docs/anexos-suporte.md`; passo adicionado ao `memory/DEPLOY.md`.

**Estado ao final desta entrada:** F-19 entregue e verificada (D-18 VALIDADO); deploy remoto
segue não publicado; próximo sugerido: Grupo 1 do plano de complementos (compras — F-01/F-02),
após a decisão do usuário sobre cotação.

## H-10 — P-18: padronização das pílulas de status (badges) em todo o produto (18/10/2026)

1. **Pedido do usuário (captura do uso real):** as tags/badges de status das listagens deveriam ser
   pílulas clássicas, em linha única, com dimensões padronizadas — sem reescrever a tabela ou o
   componente.
2. **Diagnóstico:** o defeito era de um único componente compartilhado (`Badge` em
   `src/client/lib/ui.tsx`): sem `whitespace-nowrap`/largura por conteúdo, o rótulo quebrava dentro
   da célula. Auditoria pedida pelo usuário confirmou que **todas** as pílulas do cliente
   (~60 chamadas, 17 arquivos) sofriam o mesmo problema.
3. **Correção:** `inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap
   rounded-full px-2.5 py-1 text-xs font-medium leading-4 ring-1 ring-inset` — mudança de uma linha,
   sem tocar em nenhuma estrutura, classe ou lógica das tabelas.
4. **Verificação:** pipeline verde (**134/134** testes, typecheck, `eslint`, `check:api` 50×113,
   build) e medição no navegador em 14 rotas (desktop 1440×900 e mobile 390×844): **0 pílulas
   quebradas**; estilos computados conferem com a especificação pedida. Capturas
   `ux-shots/pill-*.png`.
5. **Registro:** P-18 em `PROBLEMAS.md`.

**Estado ao final desta entrada:** F-19 e P-18 entregues e verificados; deploy remoto segue não
publicado; nada bloqueado por bug.

## H-11 — F-09: checklist de execução do técnico na ordem de serviço (18/10/2026)

1. **Pedido do usuário (retomado do prompt original):** o técnico precisava criar o próprio
   checklist dentro da OS designada a ele, marcar as atividades conforme executa e anexar fotos das
   etapas; o gestor de facilities também cria itens. Não estava implementado (item F-09 do
   `PLANO-COMPLEMENTOS.md`).
2. **Modelo:** tabela `work_order_checklist_items` (rótulo, observação, ordem, `is_done`/`done_at`/
   `done_by`, autoria) ligada a `work_orders`; a migration `0013` também reconstruiu
   `work_order_events` para aceitar o tipo `checklist` (mesmo padrão da 0012).
3. **API:** `POST/PATCH/DELETE /api/workorders/:id/checklist[/:itemId]` sob `workorders.execute`
   (técnico, gestor e admin), recusadas na OS cancelada; o detalhe da OS devolve a checklist com as
   fotos de cada etapa. As fotos reaproveitam o módulo de anexos com
   `entity_type = 'work_order_checklist_item'` (nenhum armazenamento novo); remover a etapa apaga as
   fotos dela no mesmo lote.
4. **Rastro:** cada ação grava evento na linha do tempo ("Etapa adicionada/concluída/reaberta/
   removida") e auditoria `work_order.checklist_*` com antes/depois. Quem adiciona item na OS de
   outra pessoa notifica o responsável; o próprio técnico não recebe aviso das próprias ações.
   De quebra, o rótulo dos eventos no cliente foi corrigido (`assignment`/`material_use` estavam
   mapeados como `assign`/`material` e apareciam crus na linha do tempo).
5. **UI:** card "Checklist de execução (n/m)" com barra de progresso, checkbox por etapa, autoria/
   conclusão com data e hora, miniatura das fotos (remoção pelo dono ou admin) e formulário inline
   de nova etapa; em telas estreitas os botões descem para a própria linha.
6. **Verificação:** 5 testes novos em `06-workorders.spec.ts` (criação/conclusão/reabertura/remoção
   com auditoria; fotos + remoção em cascata; permissão negada a quem só acompanha; notificação ao
   responsável; OS cancelada recusa item); pipeline verde **139/139**; verificação visual real com o
   técnico Diego Rocha (criação, conclusão, foto, mobile) e com a gestora Ana Souza (item criado por
   ela + notificação gerada). Capturas `ux-shots/checklist-*.png`.
7. **Regra de obrigatoriedade (decisão do usuário, 18/10/2026):** checklist criado pelo **gerente
   de facilities** é obrigatório — a conclusão da OS fica bloqueada (409) enquanto houver etapa do
   gerente pendente; etapas do próprio técnico ou de admin continuam opcionais. O detalhe da OS
   retorna `createdByManager` por item; o card mostra badge "Obrigatório" + aviso âmbar e o diálogo
   de conclusão desabilita o botão com a lista de pendências. +2 testes (bloqueio/liberação e
   não-bloqueio por admin); pipeline **141/141**; verificação visual completa (Ana cria → Diego vê
   o bloqueio → marca → conclui). Teste de aceite re-executado no navegador a pedido do usuário
   (mesma data): bypass direto pela API recusado (409 com a lista de pendências), cenário opcional
   confirmado (item do próprio técnico não bloqueia a conclusão) e dados de teste removidos do D1
   ao final; capturas `ux-shots/aceite-*.png`.

**Estado ao final desta entrada:** F-09 entregue e verificado (incluindo a regra de obrigatoriedade
do checklist do gerente — D-22); deploy remoto segue não publicado; nada bloqueado por bug.

## H-12 — F-20: interfaces por perfil de acesso — fase 1 (18/10/2026)

1. **Pedido do usuário (18/10/2026):** cada perfil de acesso deve ter a própria interface do
   sistema, atendendo à sua rotina — personalização como diferencial do produto. Decisões do
   usuário no mesmo dia: **painel inicial + menu por perfil** (sem identidade visual por perfil
   nesta fase) e **fase 1** cobrindo técnico, gestor, solicitante e admin.
2. **Servidor:** `GET /api/dashboard/summary` ganhou blocos por perfil, sempre com escopo por
   permissão/identidade (regra herdada do P-12): `tickets.mine` (chamados em que o usuário
   participa — nunca a fila global), recorte pessoal das ordens (`workOrders.mine` com números e
   `mineOpen` com o progresso do checklist por ordem), `workOrders.managerChecklistPending`
   (ordens travadas por etapa do gerente — só gestão/admin) e `purchases.pendingApproval` (fila de
   decisão — só quem aprova). O papel do usuário já vinha da sessão (`roleCode`), sem
   denormalizar nada.
3. **Cliente:** o painel agora roteia por perfil — `TechHome` (suas ordens, etapas obrigatórias
   pendentes com aviso âmbar, meus chamados, ações rápidas), `RequesterHome` (meus chamados +
   botão "Abrir chamado" que abre o formulário direto em `/chamados?novo=1`), `OverviewHome`
   (visão geral + extras de gestão: fila de aprovação e ordens travadas) e atalhos do
   administrador (Configurações, Usuários, Auditoria, Catálogo, Estrutura, Suporte). Perfis da
   fase 2 seguem na visão geral.
4. **Menu lateral por perfil:** técnico → seção "Meu dia" (painel, chamados, ordens, estoque,
   consumo, suporte); solicitante → "Meus serviços" (início, "Meus chamados", suporte); demais →
   "Operação" como antes. A guarda de permissão continua valendo em todos os itens.
5. **Testes:** `09-reports.spec.ts` estendido (2 cenários) — técnico vê o recorte pessoal com a
   contagem de etapas obrigatórias e **não** enxerga a fila de compras/gestão; gestor e admin veem
   aprovações e ordens travadas; solicitante recebe apenas o próprio chamado e nenhum bloco de
   outra área. Pipeline completo verde (**141/141**, typecheck, lint, check:api 50×115, build).
6. **Verificação visual real (4 perfis):** admin (visão geral + atalhos), gestora Ana (fila de
   aprovação com uma solicitação criada na hora + ordem travada pelo item que ela criou),
   solicitante Fabio (estado vazio → "Abrir chamado" abriu o formulário via `?novo=1` → chamado
   criado aparece na lista) e técnico Diego (alerta âmbar, contagem de etapas obrigatórias, OS com
   badge "etapa obrigatória", "Meus chamados" e ações rápidas), mais mobile 390px sem overflow;
   capturas `ux-shots/perfil-*.png`. Dados de teste removidos do D1 ao final (somente as entidades
   criadas nesta verificação; as etapas "teste 1..4" do usuário na OS-2026-000007 foram
   preservadas).

**Estado ao final desta entrada:** F-20 fase 1 entregue e verificada (D-23); fase 2 (comprador,
estoquista, limpeza e recepção) pendente no plano; deploy remoto segue não publicado; nada
bloqueado por bug.

## H-13 — F-11: busca aproximada de produto e escopo do módulo de estoque (18/10/2026)

1. **Pedido do usuário (18/10/2026):** (a) trocar **todos** os menus suspensos de seleção de
   produto por uma **barra de busca que filtra enquanto se digita** (busca aproximada, sem exigir o
   nome exato — "pro" traz os produtos relacionados), porque o estoque terá centenas de itens; e
   (b) **esconder o controle de estoque** de quem não é responsável por ele — só administração,
   gerente de facilities e estoquista; os demais perfis ficam apenas com o consumo. O usuário
   levantou a dúvida do técnico ("não sei como aplicar"); a resposta adotada: o técnico registra
   material **pela ordem de serviço** (`workorders.material`, fluxo que já existe) e o atalho do
   painel virou "Lançar material na ordem".
2. **Busca aproximada (servidor):** novo helper `src/worker/search.ts` — normalização em TS
   (minúsculas, sem acentos via NFD, espaços colapsados, máx. 5 termos, cura `%`/`_`) e a mesma
   normalização **em SQL** via cadeia de `replace()` (o SQLite do D1 não tem `unaccent`; `lower()`
   não dobra acentos maiúsculos — o mapa cobre as duas caixas). A lista `GET /api/catalog/products`
   agora exige **todos os termos** (nome + SKU + descrição, em qualquer ordem) e ordena por
   `instr(...)` (quem casa mais cedo no texto vem primeiro). Sem migração nem coluna nova.
3. **Busca aproximada (cliente):** componente novo `src/client/lib/product-picker.tsx`
   (combobox com debounce de 250ms, setas + Enter + Esc, limpar seleção, spinner, "nenhum produto
   encontrado", `activeOnly` configurável e busca do rótulo por id quando o valor vem de fora) e
   substituição em **7 pontos**: consumo, movimentações de estoque, material da OS, material do
   chamado, itens da solicitação de compra (que agora também **pré-preenche a unidade** do
   cadastro), e os filtros de produto dos relatórios de movimentações e de consumo. A lista grande
   `useProducts()` saiu de cena (código morto removido).
4. **Escopo do estoque:** migration `0014_stock_profile_scope.sql` remove `stock.view` e
   `stock.replenish` de comprador, técnico, líder de limpeza, colaborador da limpeza e
   recepcionista — o menu "Estoque" e a rota `/estoque` somem por permissão (não por esconder
   botão) e a API recusa chamadas diretas. Inventário do líder de limpeza e consumo seguem
   intactos; técnico/limpeza continuam com consumo; material de OS/chamado continua por
   `workorders.material`.
5. **Testes:** +2 cenários em `02-stock.spec.ts` (busca: sem acento, termos invertidos, trecho no
   meio, maiúsculas e ordenação; restrição: leitura/movimentação negadas para técnico e recepção,
   consumo do técnico ainda funciona, estoquista mantém acesso) e `01-auth.spec.ts` reforçado
   (reposição e leitura de estoque também FORBIDDEN para a recepção). Pipeline completo verde
   (**143/143**, typecheck, lint, check:api 50×115, build).
6. **Verificação visual real:** admin (busca "agua" acha "Água Sanitária 1L"; "acu" acha "Açúcar
   Refinado 1kg"; Enter seleciona), comprador Bruno (menu sem Estoque; "papel hig" acha o papel
   higiênico e a unidade "UN" veio preenchida), técnico Diego (menu "Meu dia" sem Estoque,
   `/estoque` responde "Acesso restrito", atalho novo para `/ordens`, consumo com busca "alcool"
   achando "Álcool 70% 1L") e mobile 390px no diálogo de consumo; capturas
   `ux-shots/produto-busca-estoque.png`, `ux-shots/produto-busca-mobile-390.png` e
   `ux-shots/perfil-tecnico-sem-estoque.png`. Nenhum dado de teste criado no D1 (só navegação; os
   diálogos foram fechados sem registrar).

**Estado ao final desta entrada:** F-11 entregue e verificado (D-24); módulo de estoque restrito
a admin/gerente/estoquista; F-20 fase 2 segue pendente; deploy remoto segue não publicado; nada
bloqueado por bug.

## H-14 — F-20 fase 2 e F-16: painéis por perfil restantes e locais desambiguados (18/10/2026)

1. **Pedido do usuário (18/10/2026):** fechar todo o funcional antes da identidade visual (D-25) e
   responder às decisões de escopo: cotação por **propostas de fornecedor com valor por item**
   (D-26), assinatura pela **trilha de auditoria atual** (D-27) e capas **no topo dos painéis
   iniciais + login** (D-28). Primeiro bloco executado: **F-20 fase 2 + F-16**.
2. **Servidor:** `/api/dashboard/summary` ganhou duas listas curtas (6) para a rotina do comprador —
   `purchases.awaitingOrder` (gate `PURCHASES_ORDER`: aprovadas, em cotação e em compra) e
   `purchases.toReceive` (gate `PURCHASES_RECEIVE`: pedido realizado e parcialmente recebido),
   mapeadas em camelCase. Nenhuma rota nova; o escopo por permissão do P-12 foi preservado.
3. **Cliente:** blocos extraídos para reuso (`RecentMovementsCard`, `LowStockCard`,
   `MineTicketsList`, `PurchaseListCard`) e quatro painéis novos — **comprador** (aguardando
   aprovação, em andamento e a receber; cartões "Pedidos para registrar" e "Pedidos a receber";
   alerta de produto com cadastro incompleto; ações), **estoquista** (saldos, abaixo do mínimo,
   consumo e inventários; movimentações e itens críticos; ações), **limpeza** (consumo da equipe,
   chamados e inventários para o líder) e **recepção** (mesma base do solicitante, com texto
   próprio). `RequesterHome` virou `MyTicketsHome` parametrizado. Menus próprios em `layout.tsx`
   (`BUYER_NAV`, `STOCK_NAV`, `CLEANING_NAV`, `RECEPTION_NAV`) com títulos por área. O mapa
   `PURCHASE_STATUS_TONE` saiu de `purchases.tsx` para `format.ts` (evita import página→página).
   O atalho `/compras?novo=1` abre o diálogo e limpa o parâmetro (mesmo padrão de
   `/chamados?novo=1`).
4. **F-16:** helper `locationLabel({ path, unitName })` em `src/shared/locations.ts` →
   `Local — Unidade` (o caminho do local não repete a unidade), aplicado em 17 seletores/filtros
   de 8 páginas + filtro compartilhado dos relatórios (`unitName` incluído no tipo da prop).
5. **Testes:** `09-reports.spec.ts` ganhou o cenário "painel por perfil da fase 2" (comprador cria
   → envia → gestor aprova → comprador registra pedido; confere `awaitingOrder`, `toReceive` e
   ausência de dados de estoque para comprador/limpeza/recepção; recepção abre chamado e vê só o
   próprio) e `15-locations.spec.ts` cobre o helper (com e sem unidade). Pipeline completo verde:
   **146/146** em 15 arquivos, typecheck, lint, `check:api` 50×115 e build.
6. **Verificação visual real:** comprador Bruno (painel novo + diálogo aberto por `?novo=1` com os
   rótulos "— Edifício Sede (Demonstração)"), estoquista Carla (desktop e **mobile 390px**),
   limpeza Elisa, **liderança de limpeza** (vê Inventário) e **recepção** — estas duas últimas com
   contas de verificação criadas no D1 local (`limpeza.lider@demo.local` e
   `recepcao.demo@demo.local`, senha `Demo@Facil2026`, removíveis como a `qa.admin`), além da
   visão geral da gestão (Ana) para checar regressão dos blocos extraídos. Capturas
   `ux-shots/f20-2-*.png` e `ux-shots/f16-local-unidade.png`.

**Estado ao final desta entrada:** F-20 (fases 1 e 2) e F-16 entregues e verificados (D-29);
próximo bloco é o **Grupo 1 de compras** (F-01 decisão item a item + F-02 cotação por propostas,
D-26); identidade visual aguarda as imagens em `branding/`; deploy remoto segue não publicado;
nada bloqueado por bug.

## H-15 — Perfis operacionais: chamados de manutenção e consumo da recepção (19/10/2026)

1. **Pedido do usuário (19/10/2026):** (a) "é muito importante que a líder de limpeza e a recepção
   consigam abrir chamados de manutenção"; (b) "a recepção consome itens do estoque também e a
   recepção precisa lançar os itens utilizados".
2. **Chamados de manutenção (a):** verificação de ponta a ponta comprovou que `role_clean_lead`,
   `role_clean` e `role_reception` já tinham `tickets.create` — botão, diálogo e API funcionam.
   Nenhuma mudança de código; o requisito virou **teste de regressão** no cenário de painel por
   perfil (`09-reports.spec.ts`: líder e equipe de limpeza criam chamado pela API e o veem em
   "Meus chamados") e verificação visual real: **TCK-2026-000004** (liderança de limpeza, elétrica)
   e **TCK-2026-000005** (recepção, mobiliário) abertos pelo navegador e visíveis no painel.
3. **Consumo da recepção (b):** migration `0015_reception_consumption.sql` — `role_reception` ganha
   `consumption.view`/`consumption.create` (paridade com a limpeza; estoque segue restrito à
   administração/gestão/estoquista, D-24). Cliente: item "Consumo" no menu da recepção
   (`RECEPTION_NAV`) e `MyTicketsHome` com `showConsumption` — ação "Registrar consumo" + indicador
   "Consumo (30 dias)" no painel (o solicitante segue sem).
4. **Testes:** cenário de painel por perfil estendido — recepção lança consumo (`201`) e o resumo
   traz `consumption.recordCount`/`qtyMilli`; líder + equipe de limpeza criam chamados de
   manutenção. `09-reports.spec.ts` 13/13 verde.
5. **Verificação visual real (19/10/2026):** menu "Consumo" visível para a recepção; lançamento real
   **CON-2026-000002** (Café 500g, 2 un — Recepção Térreo, "copa e balcão da recepção"; baixa do
   Almoxarifado Central: saldo 26 → 24 un, movimento `consumption` de 2 un) e indicador
   "3 · 2 lançamentos do posto" no painel; desktop + mobile 390px. Capturas
   `ux-shots/d30-recepcao-*.png`.

**Estado ao final desta entrada:** requisitos dos perfis operacionais atendidos e verificados
(D-30); o backlog funcional segue com o **Grupo 1 de compras** como próximo bloco; nada publicado
em produção.

## 20/10/2026 — Publicação, auditoria e fechamento da etapa 1 (release 0.1.2)

- **Publicação:** Worker `facil` em `https://facil.cf-pilot-disposable.workers.dev`, D1 remoto
  `facil-db` (18 migrations, ENAM) e instalação inicial concluída pelo titular (`needsSetup: false`).
- **Auditoria:** 12 achados de autorização/escopo corrigidos; endurecimento de uploads, segredos,
  CSP/HSTS/COOP, Origin guard e limites de entrada. Relatório em
  `docs/SEGURANCA-AUDITORIA-2026-10-20.md`; decisão D-42.
- **Validação:** `npm run check` **162/162 em 17 arquivos**, typecheck, lint, `check:api` 50×119,
  `npm audit` 0; produção conferida em `/api/health`, cabeçalhos estáticos/API, cache de assets e
  login desktop/mobile.
- **Release:** 0.1.2, 160 arquivos, tree
  `7e4433f6448566ae5bf6f0df97d03ec0d0fe14fbbc839e9f332745609d1ae13c`, assinada em
  20/10/2026 01:31:40 −03:00; Worker `14b4a87b-ec15-4b70-8175-f55ef6943a6f`.
- **Encerramento:** etapa 1 fechada; política de versionamento em `docs/VERSIONAMENTO.md` e
  histórico em `CHANGELOG.md`. Toda alteração futura sobe a versão.

## 20/10/2026 — Fluxo corporativo de compras v2 e release 0.2.0

- **Backend:** `purchases.ts` ganhou visão global, `/overview`, centros de custo, decisão em duas
  etapas, envio direto a compras, devolução à direção, compra direta, adjudicação item a item,
  pedidos por fornecedor e recebimentos vinculados; `workflow_version = 2` convive com o legado.
- **Permissões:** `purchases.view_all`, `purchases.authorize`, `purchases.award` e
  `purchases.direct`; papéis `operations_director` e `purchasing_manager`; 48 → 52 permissões.
- **Integrações:** outbox transacional idempotente, intake ServiceNow com `TICKET_INTAKE_KEY`,
  tratamento de corrida por `externalRef`, painel `/api/integrations` e usuário técnico
  `user_intake`. Consumo NetSuite/ServiceNow permanece para o integrador.
- **Correções do fechamento:** destino padrão de cotação quando a decisão não detalha itens;
  preço do pedido travado na adjudicação; centro de custo/conta contábil gravados no pedido na mesma
  transação; endpoint legado `/order` bloqueado para v2.
- **Banco:** migration `0019_purchase_workflow.sql` aplicada no D1 local e remoto; backup lógico
  remoto em `C:\Users\jalla\AppData\Local\Temp\opencode\facil-backup-pre-0019.sql`; bookmark anterior
  `00000011-00000090-0000510a-ba793e01dc2ec2619602b91251860101`.
- **Validação:** `npm run check` **168/168 em 18 arquivos**, typecheck, lint, contrato de API e
  `npm run build`; produção conferida em `/api/health`, `/build-info.json`, login e cabeçalhos.
- **Identidade:** logos, capas, favicon e login da CorpServices Group; capas restritas à home/login.
- **Release:** 0.2.0, 168 arquivos, tree
  `c19025940127c05cbb4bf172a706868a306e983694df7a5d183034a6a4e121f7`, 20/10/2026 21:47:54 −03:00,
  Worker `ab266118-20a8-4fc5-a0bd-c245a79c9462`.
- **Pendências:** R2 desativado, sem domínio/Access, `TICKET_INTAKE_KEY` ausente em produção,
  outbox sem consumidor e sem CI dedicada.

## 20/10/2026 — Itens fora do catálogo e release 0.3.0

- **Produto:** nova solicitação aceita item **fora do catálogo** com descrição livre, quantidade e
  unidade; o formulário avisa que o cadastro será feito durante o processo ou no recebimento.
- **Descoberta:** a busca de produto sem resultado mostra “Solicitar este item fora do catálogo” e
  leva o texto digitado para o modo de descrição; o detalhe marca o item com “Fora do catálogo”.
- **Backend:** o fluxo v2 já aceitava `product_id = NULL` com `description`; o teste de regressão
  cobre a criação e a leitura. O recebimento mantém o cadastro rápido do produto e o vínculo ao item.
- **Validação:** `npm run check` **169/169 em 18 arquivos**, typecheck, lint, contrato de API e
  `npm run build`; verificação visual em desktop e mobile (formulário, aviso, atalho e detalhe).
- **Release:** 0.3.0, 168 arquivos, tree
  `8757a04ed013ff3425f69837af402007b1a9c1f27a0c07154dde64dfc85a9c10`, 20/10/2026 23:04:14 −03:00,
  Worker `cf468e3f-7a2f-4b06-96c2-948e6b38243e`.
- **Pendências:** as mesmas da etapa 2 (R2, domínio/Access, intake, consumidor do outbox e CI).

## 23/10/2026 — R2 em produção, fundação do Patrimônio e release 0.7.1

- **Contexto:** plano de 5 melhorias aprovado pelo titular (R2, CI, consumidor do
  `integration_outbox`, captcha D-15 e anexos em OS); a Fase 1 (R2) foi executada e
  publicada neste dia.
- **R2:** bucket `facil-attachments` criado via wrangler, binding `ATTACHMENTS`
  descomentado no `wrangler.jsonc`, `worker-configuration.d.ts` regenerado com
  `npm run types`. Fim do 503 `R2_UNAVAILABLE` nos anexos do chat de suporte.
- **Verificação em produção:** pedido `SUP-2026-000003` criado pela API pública, anexo
  `teste-r2.txt` (50 B) enviado por multipart na conversa por token, listado no
  acompanhamento e baixado com round-trip idêntico. Script temporário
  `test-r2.mjs` (fora do repo). O pedido ficou na fila como descartável — resolver
  no `/ajuda` quando quiser.
- **Fundação do Patrimônio:** WIP órfão de sessão anterior (migration `0023_assets.sql`,
  `src/shared/assets.ts`, grupo Patrimônio em `permissions.ts`) foi incluído na release
  em vez de reescrever a 0.7.1 publicada; migration aplicada no D1 remoto; teste de
  permissões do admin corrigido de 53 para 56. Decisão e alternativas em **D-56**.
- **Validação:** `npm run check` **187/187 em 21 arquivos**, typecheck, lint, contrato de
  API (55×140), `npm run build` e `npm run verify` (manifesto de 180 arquivos íntegro).
- **Release:** 0.7.1, 180 arquivos, tree
  `355cf2663be6a87595a90dc577fd3c4c87590c10276682b209152fe8d65b16bc`,
  23/10/2026 01:03:28 −03:00, Worker `aa9c4ca9-202b-4632-8e6d-45df137fd839`, commit
  `6d6b410`, tag `v0.7.1` enviada ao GitHub.
- **Pendências do plano:** Fase 2 (CI), Fase 3 (consumidor do outbox), Fase 4 (captcha)
  e Fase 5 (anexos em OS); domínio próprio e `TICKET_INTAKE_KEY` seguem com o titular.
  Patrimônio (rotas/UI) registrado como item futuro no TODO.

## 23/10/2026 — Plano de melhorias concluído (5 releases: 0.7.1 a 0.7.5)

- **Contexto:** plano de 5 melhorias aprovado pelo titular (R2, CI, consumidor do
  `integration_outbox`, captcha D-15, anexos em OS). Todas executadas e publicadas
  neste dia, uma release por fase, cada uma com `npm run check` verde, deploy
  assinado (Ed25519), verify e tag no GitHub.
- **0.7.1 (R2):** bucket `facil-attachments` criado, binding `ATTACHMENTS` ativo,
  verificação ponta a ponta em produção (`SUP-2026-000003`: upload e download
  íntegros no chat de suporte, fim do 503). Também publicou a fundação do
  Patrimônio (migration `0023`, categorias padrão, permissões, D1 remoto atualizado);
  rotas/UI do módulo ficam para release futura. Commit `6d6b410`, tag `v0.7.1`.
- **0.7.2 (CI):** workflow `.github/workflows/ci.yml` publicado e ativo. Execuções
  bloqueadas na conta GitHub (`startup_failure`, sem jobs) — diagnóstico via 4
  branches de bisect descartáveis; repo público da conta executou workflow em
  03/10, apontando para limite de Actions minutes/spending limit em repos privados.
  Pendência de billing do titular (`github.com/settings/billing`). Commit `8b62533`,
  tag `v0.7.2`.
- **0.7.3 (anexos em OS):** card de anexos na tela da OS reutilizando o módulo
  genérico `/api/attachments` (upload/download/remoção, `attachments.documents`,
  auditoria). Testes `15-workorder-attachments.spec.ts` (5 testes). Commit `ff68d1a`,
  tag `v0.7.3`.
- **0.7.4 (consumidor do outbox):** trigger cron `*/5 * * * *` processa
  `integration_outbox`; endpoint `POST /api/integrations/outbox/process` para
  disparo manual. Idempotência, `processing`, retry com backoff, `failed` após
  limite. Pulando silenciosamente sem `TICKET_INTAKE_KEY`/`SERVICENOW_INSTANCE_URL`
  (titular configura as secrets do Worker). Commit `8658045`, tag `v0.7.4`.
- **0.7.5 (captcha D-15):** Turnstile no login e na abertura de chamados públicos,
  desligado por padrão. Titular ativa em Configurações (`captcha.enabled`,
  `captcha.site_key`, `captcha.secret_key`). Commit `c8f7fe0`, tag `v0.7.5`.
- **Qualidade final:** `npm run check` **194/194 em 23 arquivos**, typecheck, lint,
  contrato de API (55×140), build, `npm run verify` (manifesto íntegro), todos os
  deploys com release assinada.
- **Pendências dependentes do titular:** (a) desbloquear billing do GitHub para o
  CI rodar; (b) configurar `TICKET_INTAKE_KEY`/`SERVICENOW_INSTANCE_URL` para o
  outbox enviar ao destino; (c) configurar `captcha.enabled` + chaves para ativar
  o captcha; (d) domínio próprio/Cloudflare Access, se desejar.
- **Item futuro (não é das 5 fases):** Patrimônio — rotas e interface (migration
  `0023` já publicada; falta API `/api/assets`, telas, aba no `/controle`, testes).

