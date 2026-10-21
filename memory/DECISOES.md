# Decisões Arquiteturais: Facil

## D-01 — Caminhos canônicos em `D:\DEV`; `F:\DEV\memory` não existe (16/10/2026) — VALIDADO

- **Contexto:** o protocolo de inicialização afirma que a memória global fica em `F:\DEV\memory` e
  alerta que `D:\dev\memory` "não deve ser considerado correto automaticamente".
- **Verificação:** `Test-Path 'F:\DEV\memory'` → `False`. A máquina possui apenas as unidades `C:`,
  `D:` e `E:`. `Test-Path 'D:\DEV\memory'` → `True`. `D:\dev\memory` e `D:\DEV\memory` resolvem para
  o **mesmo** diretório (o Windows é case-insensitive). O `D:\DEV\criar-projeto.bat` define
  `set "GLOBAL_ROOT=D:\dev\memory"`, confirmando o caminho realmente configurado.
- **Decisão:** a raiz canônica do ecossistema é `D:\DEV`. A memória global reside em `D:\DEV\memory`
  e o conhecimento global deste projeto em `D:\DEV\memory\Facil\`. A referência a `F:\DEV\memory` no
  prompt de inicialização é **stale** e foi descartada.
- **Auditoria complementar:** a referência `F:` **não existe em nenhum artefato do ambiente** —
  `criar-projeto.bat`, os dois `.txt` de protocolo (`Primeiro prompt...`, `PROMPT DE RETOMADA
  UNIVERSAL`), `~/.config/opencode/*` e `~/.agents/` usam `D:\dev\memory` ou não citam caminho algum.
  Ou seja: a infraestrutura está consistente; o `F:` veio apenas no texto do prompt desta sessão.
- **Impacto:** nenhum arquivo global foi criado, movido ou alterado para "compensar" o caminho
  incorreto; nenhum artefato de protocolo foi editado; nenhum cérebro paralelo foi criado.
- **Causa raiz da referência:** em 14/10/2026 a unidade `F:\` foi migrada para `D:\` (ROBOCOPY;
  logs em `%TEMP%\opencode\migracao-f-d-*.log`). O `F:` do prompt é texto **pré-migração**, não uma
  configuração atual. Após a migração, o caminho válido é `D:\DEV\memory`.

## D-02 — `Facil` é o projeto canônico desta iniciativa (16/10/2026) — VALIDADO

- **Contexto:** existem dois diretórios descrevendo o mesmo produto (Plataforma Unificada de Gestão
  de Facilities):
  - `D:\DEV\Opencode\facilities-management` — bootstrap de **22:01:51**, abortado em `[2/5]` pelo bug
    do `.bat` (parênteses não escapados), concluído manualmente depois;
  - `D:\DEV\Opencode\Facil` — bootstrap de **22:36:22**, executado de `[1/5]` a `[5/5]` com sucesso,
    **depois** de o usuário corrigir o `.bat` (arquivo reescrito às 22:17:53, com `^(` e `^)` nas
    linhas 284 e 287).
- **Decisão:** `Facil` é o projeto canônico — é o diretório declarado oficialmente pelo usuário, o
  único com bootstrap íntegro e o único no `working directory` da sessão ativa.
  `facilities-management` é um **predecessor superado**, mantido intacto (nada apagado ou movido).
- **Migração de conhecimento:** o conhecimento de valor do predecessor foi absorvido neste projeto
  (D-01 acima, P-01 em `PROBLEMAS.md`, P-03, A-03 em `APRENDIZADOS.md`). Nenhum arquivo do
  predecessor foi copiado em massa.
- **Pendência:** o destino do predecessor (arquivar ou remover) depende de decisão do usuário (P-03).

## D-03 — Estratégia de deploy decidida somente após o PROMPT MESTRE (16/10/2026) — PLANEJADO

- **Contexto:** projeto novo; regra global = Cloudflare Workers + Workers Builds; nada existe (sem
  Git, sem `wrangler.toml`, sem integração Cloudflare, sem URL).
- **Decisão:** não criar infraestrutura de deploy antes de conhecer os requisitos. A stack (runtime,
  framework, banco, autenticação, tarefas em segundo plano) será decidida na FASE 1 e, apenas se for
  compatível, o deploy seguirá Cloudflare Workers + Workers Builds. Cloudflare Pages não substitui
  Workers sem justificativa técnica documentada. Nada será publicado sem validação e autorização
  explícita.
- **Impacto:** detalhamento em `DEPLOY.md`.

## D-04 — Stack: Workers + Hono + D1 + React (SPA Vite) (17/10/2026) — VALIDADO

- **Contexto:** PROMPT MESTRE exige aplicação web pt-BR, banco relacional, autorização no backend,
  operação em campo (mobile) e custo zero de serviços pagos.
- **Decisão:** Cloudflare Workers + Hono 4 (API) + D1/SQLite (banco) + React 19 + Vite 7 +
  Tailwind v4 + React Router 7 + Zod 4 (cliente), com testes em vitest 5 + `@cloudflare/vitest-plugin`
  (D1 isolado por spec).
- **Evidência:** 107/107 testes; typecheck limpo (worker e cliente); build; `wrangler deploy --dry-run`;
  smoke 11/11; verificação visual desktop/mobile.
- **Motivo:** um único runtime para API e assets (Workers), SQL relacional com integridade por trigger,
  deploy no padrão global do ecossistema sem serviço pago novo.

## D-05 — Rejeições documentadas: Next.js/OpenNext e Supabase (17/10/2026) — VALIDADO

- **Next.js via OpenNext:** adiciona camada de adaptação e peso ao passo de build sem requisito do
  produto; a SPA com Vite cobre o caso (o produto é um painel operacional autenticado, sem SEO).
- **Supabase (ou outro BaaS pago):** o PROMPT MESTRE proíbe novo serviço pago sem autorização e o
  projeto exige regras de negócio transacionais (motor de estoque) — mantidas no Worker + D1.
- **Divergências do `padroes-codigo.md`** (Next.js, ORM, multi-tenant) ficam registradas aqui em vez de
  silenciadas; as regras globais continuam sendo a referência geral.

## D-06 — Modelo de dados operacional (17/10/2026) — VALIDADO

- **Quantidades** em milésimos inteiros (`*_milli`); a API traduz para decimal no limite HTTP.
- **Dinheiro** em centavos inteiros (`*_cents`); nunca ponto flutuante.
- **Datas** TEXT ISO-8601 **UTC geradas pelo backend**; conversão para `America/Sao_Paulo` só na
  apresentação (helper `format.ts` lê `company.timezone`).
- **`db.batch()` é a primitiva de atomicidade** (D1 não tem transação interativa): gravação de
  movimento + saldo + auditoria acontece em um único batch.
- **Saldo é derivado:** `stock` é materialização; `movements` é a fonte de verdade; correção só por
  reversão (histórico nunca é editado/apagado).
- **Integridade no banco:** triggers impedem saldo negativo quando `stock.allow_negative=false`; o app
  faz pré-checagem apenas para mensagem amigável e delega a decisão ao banco.

## D-07 — Autenticação e autorização (17/10/2026) — VALIDADO

- **Senhas:** PBKDF2-SHA256 via WebCrypto, 100 000 iterações, salt 16 bytes, 256 bits, base64 em
  colunas separadas (`password_hash`, `password_salt`, `password_iterations`).
- **Sessão:** token opaco aleatório (não JWT) persistido em D1, entregue em cookie `HttpOnly` +
  `SameSite=Lax`; logout e troca de senha revogam sessões; throttle de login (10 falhas/15 min).
- **Autorização:** matriz `role_permissions` aplicada por rota no servidor (`requirePermission`);
  `default deny`; ninguém concede privilégio que não possui; telas escondem ações por UX, mas o
  servidor decide de novo (403 real testado).
- **"Assinatura eletrônica"** = autoria autenticada + trilha de auditoria (nunca apresentada como
  ICP-Brasil).

## D-08 — Idempotência contra envio duplicado (17/10/2026) — VALIDADO

- Toda submissão crítica aceita `request_key` único (UNIQUE no banco). Duplicata → falha de UNIQUE →
  rollback; se **todas** as chaves já existem, o servidor responde com `idempotentReplay: true` e o
  resultado anterior, em vez de duplicar o efeito.
- O cliente gera chaves `ui-<fluxo>-<uuid>` por tentativa de diálogo (cons, ticket-mat, wo-mat,
  receipt, movimento).

## D-09 — Arquitetura do cliente (17/10/2026) — VALIDADO

- SPA React Router com `createBrowserRouter`; **code-splitting por rota** (`React.lazy` + Suspense):
  login/setup não baixam o sistema inteiro (bundle principal 362 kB / 114 kB gzip).
- Guardas (`RequireSession`, `RequireAnonymous`, `PermissionGate`, `AppShell`) são **UX**: escondem
  telas impossíveis e melhoram a navegação; a autoridade continua no servidor.
- Um único design system (`lib/ui.tsx`): Button, Field/Input/Select/Textarea, Card, Stat, Table,
  Tabs, Dialog, Badge, Dot, Alert, Toast, EmptyState, LoadingBlock, ErrorBlock, PageHeader.

## D-10 — Deploy permanece PLANEJADO (17/10/2026) — NÃO VALIDADO

- `wrangler.jsonc` está pronto (name `facil`, assets `dist/client` com `run_worker_first: ["/api/*"]`,
  binding D1 `DB`, `migrations_dir`), validado por `wrangler deploy --dry-run`.
- **Nada foi publicado:** não há repositório Git, conta Cloudflare, `database_id` real nem
  autorização explícita. Publicar exige: git init + commit, `wrangler d1 create facil-db`,
  substituir o placeholder, aplicar migrations remotas e conectar Workers Builds.

## D-11 — Seeds: demo e reset de fábrica (17/10/2026) — VALIDADO

- `seeds/demo.sql` insere apenas dados-mestres (estrutura, catálogo, fornecedores, 6 usuários demo com
  senha pública `Demo@Facil2026`), é idempotente (`INSERT OR IGNORE`) e **não** lança saldo/movimento —
  entradas devem passar pelo motor real (compras/recebimento/ajuste) para manter movimento, saldo e
  auditoria coerentes.
- `seeds/reset.sql` apaga dados operacionais em ordem de FK e preserva referência das migrations
  (Ums, tipos, categorias, permissões, perfis de sistema, settings) e zera `counters`.
- Ambos testados no D1 local: reset → smoke (setup real) → seed → contagens conferidas.

## D-12 — Predecessor arquivado por decisão do usuário (17/10/2026) — VALIDADO

- **Contexto:** P-03 (dois diretórios do mesmo produto). O usuário decidiu **arquivar**.
- **Ação executada:** `D:\DEV\Opencode\facilities-management` → `D:\DEV\Opencode\_arquivo-facilities-management`
  (rename; conteúdo e timestamp de criação preservados — 16/10/2026 22:01:51). Nada foi apagado.
- **Pendência cosmética:** o registro `facilities-management` no Serena ainda aponta para o caminho
  antigo (ferramenta `remove_project` não exposta nesta sessão); remover pelo dashboard quando
  conveniente.

## D-13 — Guard de rotas cliente↔worker no pipeline (17/10/2026) — VALIDADO

- **Contexto:** P-07 (cliente chamava `/api/inventory`; o worker monta `/api/inventories`) escapou de
  107 testes verdes e da varredura visual porque os testes de API chamam os caminhos corretos por
  construção e a varredura media só layout (overflow).
- **Decisão:** `scripts/check-api-paths.mjs` (`npm run check:api`, encadeado dentro de
  `npm run check`) cruza todo literal `/api/...` do cliente com os mounts + `router.*` do worker;
  qualquer divergência falha com exit 1. Teste negativo comprovou a detecção.
- **Convenções associadas:** página nova exige fluxo real pela UI (abrir → agir → conferir efeito),
  e a varredura visual passou a checar mensagem de erro visível além de overflow (A-09/A-10).

## D-14 — Central de Suporte: canais público/interno, token e fila (17/10/2026) — VALIDADO

- **Contexto:** pedido do usuário (17/10/2026): redefinição de senha acessível da tela de login
  (nome, setor, matrícula + justificativa), resposta do administrador com fila; página de suporte
  estilo blog (dicas de segurança, informativos, FAQ) para logados; não logados usam a página
  pública + formulário de ajuda; cada mensagem também vira e-mail.
- **Decisão:** dois canais sobre o mesmo modelo (`support_requests` + `support_messages`): público
  sem sessão (`/suporte`, `/suporte/acompanhar/:token`) e interno (`/ajuda`). O **token é a
  credencial** do solicitante anônimo — só o hash fica no banco; o token em claro é devolvido uma
  única vez na criação. Fila FIFO com posição **discreta** (badge só enquanto `queued`). Permissão
  nova `support.manage` concedida **apenas ao perfil admin** (suporte = administrador/TI).
- **Anti-abuso pré-captcha:** no máximo 3 pedidos abertos por e-mail e 80 mensagens por pedido;
  pedidos resolvidos bloqueiam novas mensagens (abrir novo pedido).
- **E-mails:** pedido, mensagem e mudança de status entram em `email_outbox` (fila com entrega
  idempotente e adaptadores Resend/Brevo); sem provedor configurado ficam `pending`, visíveis e
  reenviáveis na aba E-mails. Staff→solicitante não inclui o link de acompanhamento (só há hash).
- **Notificações internas:** para quem tem `support.manage` em pedido/mensagem nova e para o
  solicitante logado quando o staff responde (links para rotas válidas — lição P-14).
- **Evidência:** migration `0008_support.sql`; `tests/10-support.spec.ts` (7 testes); fluxo real no
  Playwright (anônimo → pedido → acompanhamento → resposta do staff → mudança de status → e-mails
  pendentes); pipeline verde (118/118); capturas `ux-shots/v4-*.png`. **Nada publicado.**

## D-15 — Captcha fica para a camada final, após validar o processo (17/10/2026) — VALIDADO

- **Contexto:** decisão explícita do usuário nesta sessão: o captcha só entra **depois** de o
  processo de suporte/redefinição de senha estar 100% validado — é a última camada de segurança e
  valerá também para os logins.
- **Decisão:** não implementar captcha agora. Enquanto isso, a proteção é contenção no servidor
  (limite de pedidos abertos por e-mail, limite de mensagens por pedido, nada exposto sem token).
- **Impacto:** reavaliar quando o usuário validar o fluxo em uso real; a implementação futura entra
  como camada isolada (sem tocar no modelo de dados).

## D-16 — Envio de e-mail por outbox + adaptador; provedor segue pendente (F-13) (17/10/2026) — VALIDADO (outbox) / SUPERADO em D-20 e D-21

- **Decisão:** e-mails nunca são enviados "soltos" pelas rotas — tudo passa por `email_outbox`
  (pending/sent/failed) com entrega idempotente (`deliverOutbox`) e adaptadores já implementados
  para Resend e Brevo; configuração em Configurações (`mail.enabled`, `mail.provider`,
  `mail.api_key`, `mail.from`). Sem provedor configurado nada quebra: os e-mails ficam registrados
  e reenviáveis.
- **Pendência do usuário (F-13):** ~~escolher provedor/domínio~~ **RESOLVIDO em 18/10/2026:** o
  provedor escolhido foi o Gmail da própria conta (`relay` em D-20 e, na ativação real, `gmail`
  por senha de app em D-21). O desenho da outbox deste registro permanece o vigente.

## D-17 — Temas (5 presets) e reorganização de Configurações (F-18) (18/10/2026) — VALIDADO

- **Contexto:** pedido do usuário (18/10/2026): o grupo "Gestão" da barra lateral confundia —
  Catálogo, Estrutura, Relatórios, Auditoria e Usuários passam a viver dentro de Configurações,
  agrupados por área; e o sistema ganha **5 temas** com padrão definido pelo admin e escolha
  individual no perfil.
- **Navegação:** a barra lateral fica com "Operação" + "Configurações"; **nenhuma URL muda**
  (`/catalogo`, `/estrutura`, `/relatorios`, `/auditoria`, `/usuarios` continuam válidas — só saem
  do menu lateral). Configurações ganha menu por seção (`/configuracoes/<secao>`: inicio, aparencia,
  geral, estoque, consumo, compras, suporte, anexos, categorias, administracao); o acesso continua
  por permissão (`anyOf` das permissões de destino).
- **Modelo de tema:** `settings['ui.theme']` = padrão do sistema (admin, seção "Aparência");
  `users.theme` = escolha pessoal (**NULL = seguir o sistema** — opção "Tema do sistema" no perfil).
  Lista fixa em `src/shared/themes.ts`: `classico, corporativo, escuro, violeta, ambar`.
- **Implementação:** cada tema é um bloco `[data-theme=...]` de variáveis CSS em `styles.css`
  (paleta, fonte, cantos/raio, superfícies — `--color-surface`/`--color-overlay` substituem
  `bg-white`/overlays fixos); fontes via CDN do Google Fonts com fallback de sistema; o traço dos
  ícones muda por regra escopada em `svg.theme-icon` (classe aplicada pelo helper `icon()`), para
  não achatar ícones com traço deliberado (ex.: Spinner). Pré-pintura via `localStorage
  ['facil.theme']` evita "piscar" o tema errado no carregamento; o efeito da sessão sempre reaplica
  o valor efetivo vindo do servidor. Vale para o sistema inteiro, incluindo login e páginas públicas.
- **Evidência:** migration `0009_themes.sql` (`users.theme` + seed `ui.theme = 'classico'`);
  `PATCH /api/auth/preferences` (auditoria módulo `profile`, ação `theme_update`, antes/depois;
  `theme: null` limpa o override); `tests/11-preferences.spec.ts` (3 testes); verificação visual
  desktop 1440×900 e mobile 390×844 (login, sistema, prévias dos 5 temas, escuro e corporativo
  aplicados ao vivo, seções, somente-leitura); pipeline verde **121/121**.

## D-18 — Anexos grandes do suporte em Cloudflare R2 (F-19) (18/10/2026) — VALIDADO

- **Decisão do usuário:** armazenar os anexos das conversas de suporte (screenshot/PDF/documento,
  inclusive grandes) em **Cloudflare R2** (free tier aceito), com **metadados em D1**
  (`attachments`); anexos antigos gravados como BLOB no D1 continuam legíveis e baixáveis.
- **Requisitos:** solicitante e administrador enviam arquivos pelo chat; padrão de **20 MB por
  arquivo, configurável** (`attachments.max_bytes` no catálogo de Configurações — o limite antigo de
  400 KB existia por causa do D1); uploads **anônimos por token** seguem regras mais restritas
  (tamanho/tipo). Sem serviço pago novo; binding R2 funciona simulado no `wrangler dev`; nada é
  publicado sem autorização (D-10).
- **Implementação (migration `0012_support_attachments.sql`):** a tabela `attachments` foi
  reconstruída (SQLite não afrouxa `NOT NULL` por `ALTER`) para: `content BLOB` opcional,
  `uploaded_by` opcional (solicitante anônimo não tem conta; `author_name` preserva quem enviou),
  colunas novas `storage` (`d1`/`r2`) e `r2_key`, com `CHECK (content IS NOT NULL OR r2_key IS NOT
  NULL)`. Linhas antigas continuam `storage='d1'` com o BLOB no banco.
- **Regras do upload:** sessão (staff ou solicitante logado) — até 10 arquivos por mensagem, teto de
  `attachments.max_bytes` por arquivo e por mensagem (padrão 20 MB; catálogo permite 10 KB a 50 MB);
  token (sem sessão) — até 3 arquivos e teto de **5 MB** por arquivo/mensagem, tipos reduzidos a
  imagem/PDF/texto. Teto de 40 anexos por pedido (anti-abuso). O binário sobe para o R2 **antes** do
  batch do D1; se o batch falhar, os objetos recém-gravados são removidos (sem órfãos).
- **Leitura:** `GET /api/support/attachments/:id` (sessão, exige acesso ao pedido) e
  `GET /api/support/track/:token/attachments/:id` (token) fazem streaming do R2 (ou do BLOB legado);
  a remoção (`DELETE /api/support/attachments/:id`, só staff) apaga o objeto e a linha com auditoria
  `support.attachment.delete`. As rotas genéricas de anexo **recusam** `support_message` (passam a
  negar também qualquer tipo fora do mapa — antes o tipo desconhecido pulava a checagem de
  permissão na leitura).
- **Evidência:** `tests/14-support-attachments.spec.ts` (6 testes: fluxo dos dois lados, regras do
  anônimo, acesso/remoção, teto configurável, legado D1); verificação real no navegador (pedido
  SUP-2026-000003: solicitante anexou print por token, staff respondeu com PDF, remoção auditada,
  bucket local com 1 blob restante); capturas `ux-shots/f19-*.png`; pipeline verde **134/134**
  (14 arquivos), `check:api` 50×113, `wrangler deploy --dry-run` OK.

## D-19 — `typecheck` deixa de ser no-op; guard real dos dois projetos (18/10/2026) — VALIDADO

- **Contexto:** o `tsconfig.json` raiz é solution-style (`files: []` + references); `tsc --noEmit`
  não checava arquivo algum. Rodando os projetos diretamente apareceram 3 erros latentes do módulo
  de suporte (tabela de artigos usando `PublicArticle` sem `published`; token possivelmente
  `undefined` em `support-public.tsx`).
- **Decisão:** `npm run typecheck` passa a rodar `tsc -p tsconfig.worker.json --noEmit` e
  `tsc -p tsconfig.client.json --noEmit`; os erros latentes foram corrigidos (`published: boolean`
  na interface `PublicArticle`, que a API sempre devolve; `match?.[1] ?? value` no link de
  acompanhamento).
- **Pendência opcional:** `tests/**` fica fora de ambos os projetos (hoje coberto pelo eslint);
  um `tsconfig.tests.json` pode entrar depois.

## D-20 — Envio para qualquer e-mail via relay no Gmail, custo zero (F-13) (18/10/2026) — VALIDADO

- **Decisão do usuário:** sem provedor pago e sem domínio próprio. O Resend grátis sem domínio só
  entrega no e-mail do dono da conta, então a saída zero-custo escolhida foi usar a **própria conta
  Gmail como remetente real** através de um **Web App do Google Apps Script** (relay HTTPS que chama
  `MailApp`). Guia passo a passo + código do script: `docs/email-relay-gmail.md`.
- **Implementação:** novo provedor `relay` na fila `email_outbox` (que já era o caminho único de
  envio). Configurações novas na seção "Suporte e e-mail": `mail.relay_url` (só HTTPS — validado na
  gravação) e `mail.relay_secret`; ambos aceitam vazio (canal desligado), como `mail.api_key`.
  O adaptador faz POST JSON `{ secret, to, subject, text, name }` e **só marca `sent` com HTTP 2xx
  + `{"ok": true}`** — qualquer outra resposta vira `failed` com o motivo (nunca registra envio não
  confirmado; ex.: página de login HTML do Google = falha, não sucesso silencioso).
- **Limites declarados:** Gmail comum ~100 destinatários/dia (Workspace ~1.500/dia); o remetente
  exibido é `company.name` + a conta Google. Resend/Brevo continuam disponíveis (trocar
  `mail.provider`) para quando houver domínio próprio, sem mudança de código.
- **Evidência:** migration `0010_mail_relay.sql` (2 chaves novas); `src/worker/mailer.ts`;
  catálogo/validação em `routes/settings.ts` (`assertHttpsUrl`); rótulos e avisos no cliente
  (`settings.tsx`, `support.tsx`); `tests/12-mail-relay.spec.ts` (3 testes: payload/entrega,
  envio imediato com relay configurado, falhas + recuperação no reenvio). Verificação real no
  navegador: configuração pela UI, aviso "Enviando via relay", reenvio disparando chamada de saída
  real ao Google → `Relay respondeu 404` registrado na coluna Erro; configurações restauradas ao
  padrão. Pipeline verde **124/124** (12 arquivos).

## D-21 — Segunda via de envio zero-custo: `gmail` por SMTP com senha de app (F-13) (18/10/2026) — VALIDADO

- **Contexto/decisão:** o usuário ativou uma **senha de app** da própria conta Gmail e pediu para
  usar essa via em vez do Apps Script. O Worker passa a falar **SMTP direto** com
  `smtp.gmail.com:465` (TLS implícito via `cloudflare:sockets`), autenticado com `mail.from` +
  `mail.gmail_app_password` — sem script do lado do Google. O provedor `relay` (D-20) permanece
  como alternativa; trocar `mail.provider` muda a via sem tocar no restante do sistema.
- **Implementação:** `src/worker/smtp.ts` (cliente SMTP mínimo: EHLO, AUTH PLAIN com fallback 334,
  MAIL FROM/RCPT TO/DATA/QUIT; mensagem RFC 5322 com cabeçalhos acentuados em `=?UTF-8?B?…?=` e
  corpo base64; timeout de 20 s; erro com o motivo do servidor — ex.: `535 Username and Password
  not accepted`); adaptador `gmail` em `mailer.ts`; chave nova `mail.gmail_app_password`
  (migration `0011_gmail_smtp`; aceita vazio = canal desligado; espaços colados são ignorados).
  Guia: `docs/email-gmail-senha-app.md` (criar senha de app; ~500 destinatários/dia no Gmail comum).
- **Semântica de `sent`:** igual à do relay — `sent` = servidor SMTP aceitou a mensagem (250 no fim
  do DATA). **Devoluções (bounce) acontecem depois e chegam na caixa do remetente**: o Gmail aceita
  até domínios inexistentes (observado com `admin@facil.local`) e devolve o aviso ao remetente. Em
  uso real, usuários internos precisam de **e-mail de verdade** para não gerar devoluções.
- **Evidência:** sonda local (Node, temporária) autenticou 235 antes da implementação;
  `tests/13-smtp.spec.ts` (4 testes de diálogo com socket simulado: sucesso completo, AUTH 535,
  queda do servidor, fallback 334); `08-settings.spec.ts` atualizado (nova chave; gmail
  aceito/limpo). Pipeline verde **128/128** (13 arquivos). Verificação real: configuração pela UI →
  4 e-mails **entregues de verdade** para `lima.atecnica@gmail.com` (1 de teste + os 3 do pedido
  real SUP-2026-000002); status "Enviado" confirmado no banco (`sent_at` preenchido, sem erro).
  Capturas `ux-shots/f13b-gmail-config.png` e `ux-shots/f13b-gmail-outbox.png`.
- **Segurança:** a senha de app fica na tabela `settings` em texto (mesma superfície de
  `mail.api_key`) e foi informada pelo usuário via chat — rotacionável a qualquer momento em
  `myaccount.google.com` → Senhas de app (basta atualizar `mail.gmail_app_password`).

## D-22 — Checklist de execução na OS: permissão, fotos e rastro (F-09) (18/10/2026) — VALIDADO

- **Contexto:** pedido original do usuário — o técnico cria o próprio checklist na OS designada a
  ele, marca as atividades conforme executa e anexa fotos das etapas; o gestor de facilities também
  cria itens. Era o item F-09 do `PLANO-COMPLEMENTOS.md`.
- **Quem edita:** `workorders.execute` (técnico, gestor e admin). **Nenhuma permissão nova** foi
  criada: o checklist é parte da execução da OS. Quem só tem `workorders.view` vê, não edita — o
  servidor responde 403 (ocultar botão não é controle de acesso). OS **cancelada** recusa item novo;
  a OS **concluída não congela** o checklist, para permitir marcar etapas feitas antes de fechar.
- **Fotos:** reaproveitam o módulo de anexos existente com
  `entity_type = 'work_order_checklist_item'` (D1, teto `attachments.max_bytes`) em vez de
  armazenamento próprio ou R2 — o volume é pequeno e a leitura segue a regra da OS. Remover a etapa
  apaga as fotos dela no mesmo lote (sem órfão); remover apenas a foto continua exigindo ser quem
  enviou (ou admin), como no resto do sistema.
- **Rastro:** cada item criado/concluído/reaberto/removido grava evento na linha do tempo da OS
  (`work_order_events.type = 'checklist'`) e auditoria `work_order.checklist_*` com antes/depois; o
  detalhe da OS já devolve as fotos por item (uma requisição só, sem N+1).
- **Aviso:** adicionar item na OS de outra pessoa notifica o responsável; o próprio técnico não é
  notificado das próprias ações.
- **Alternativas descartadas:** tabela de anexos própria (duplicaria download/permissão/remoção);
  R2 para as fotos (complexidade sem ganho — fotos de celular comprimidas cabem no teto do D1).
- **Evidência:** migration `0013_work_order_checklist.sql` (tabela + tipo de evento `checklist`);
  `POST/PATCH/DELETE /api/workorders/:id/checklist` em `workorders.ts`; card no detalhe da OS;
  `06-workorders.spec.ts` +7 testes; pipeline verde **141/141**; uso real no navegador (técnico
  Diego Rocha e gestora Ana Souza); capturas `ux-shots/checklist-*.png`.
- **Obrigatório (decisão do usuário, 18/10/2026):** se o checklist for criado pelo **gerente de
  facilities** (somente esse papel), o preenchimento é obrigatório — a `POST /:id/close` **bloqueia a
  conclusão** enquanto houver item do gerente pendente (409 com a lista de rótulos no `details`).
  Etapas do próprio técnico ou de admin continuam **opcionais** e não bloqueiam. O cliente mostra
  badge "Obrigatório", aviso no card e o diálogo de conclusão desabilita o botão com a lista de
  pendências (UX adiantada; o servidor é a barreira). O detalhe da OS retorna `createdByManager`
  por item (papel do criador via JOIN com `roles`).

## D-23 — Interfaces por perfil: painel inicial e menu próprios (F-20, fase 1) (18/10/2026) — VALIDADO

- **Decisão do usuário (18/10/2026):** cada perfil de acesso deve ter sua própria interface.
  Escolhas registradas: (1) **painel inicial + menu por perfil** — sem identidade visual por perfil
  nesta fase (cores/selos ficam como opção futura); (2) **fase 1** = técnico de manutenção,
  gerente de facilities, solicitante e administrador; comprador, estoquista, limpeza e recepção
  entram na fase 2 reaproveitando os mesmos componentes.
- **Arquitetura:** nada de aplicativos separados nem endpoints por perfil. O painel inicial é um
  recorte do **mesmo** `GET /api/dashboard/summary`, com blocos adicionais estritamente escopados
  por permissão/identidade (herança direta do P-12): `tickets.mine` é sempre "em que eu participo"
  (nunca a fila global, mesmo com `view_all`), o recorte pessoal da OS exige `workorders.view` e
  filtra por `assignee_id`, a fila de aprovação exige `purchases.approve` e as ordens travadas por
  checklist só aparecem para gestão/admin (`roleCode` já existente na sessão — sem
  denormalização).
- **Cliente:** `dashboard.tsx` dividiu-se em `TechHome`, `RequesterHome` e `OverviewHome` (visão
  geral + extras de gestão + atalhos do admin); `layout.tsx` ganhou `navForRole` com seções
  renomeadas ("Meu dia", "Meus serviços") e ordem própria por perfil; `/chamados?novo=1` abre o
  formulário direto (atalho do solicitante) e limpa o parâmetro da URL.
- **Alternativas descartadas:** telas totalmente separadas por perfil (custo alto de construção e
  manutenção — avaliado com o usuário na decisão); denormalizar o papel do criador de item de
  checklist (já resolvido por JOIN em D-22 — o painel segue a mesma regra); um endpoint novo por
  perfil (duplicaria contagens e o escopo de segurança).
- **Evidência:** `dashboard.ts` (blocos novos + guardas), `dashboard.tsx` (3 visões), `layout.tsx`
  (`navForRole`), `tickets.tsx` (`?novo=1`); `09-reports.spec.ts` estendido (141/141 em 14
  arquivos); verificação visual real com os 4 perfis (capturas `ux-shots/perfil-*.png`); dados de
  teste removidos do D1 ao final.

## D-24 — Busca aproximada na seleção de produto e estoque só para os perfis responsáveis (F-11) (18/10/2026) — VALIDADO

- **Decisão do usuário (18/10/2026):** (1) todos os campos de seleção de produto passam a usar
  **busca com filtro enquanto digita** (aproximada — trecho do nome/SKU, sem acento, em qualquer
  ordem), porque o estoque terá centenas de itens e menu suspenso não escala; (2) o **controle de
  estoque** (menu, rota e API) fica visível só para **administração, gerente de facilities e
  estoquista**; os demais perfis têm apenas o que é necessário (consumo, ordens/chamados) — sem
  exibir informação além do necessário por perfil.
- **Busca em SQLite sem extensão:** nada de coluna denormalizada nem migração. A normalização (sem
  acentos, minúsculas) acontece dos dois lados do `LIKE`: em TS para o termo digitado e em SQL para
  a coluna, via cadeia de `replace()` gerada pelo **mesmo mapa de acentos** (`src/worker/search.ts`).
  Detalhe que importa: `lower()` do SQLite só dobra A-Z — o mapa cobre acentos maiúsculos e
  minúsculos explicitamente; e cada termo vira um `AND` independente (ordem das palavras não
  importa), com ordenação por `instr()` do primeiro termo. A alternativa (coluna `search_text`
  mantida por código) foi descartada: exigiria migração + backfill sem `unaccent` e qualquer
  caminho de escrita esquecido deixaria o produto "invisível" na busca — falha silenciosa pior que
  a expressão mais pesada (irrelevante para centenas de linhas).
- **Seleção única no cliente:** um componente (`ProductPicker`) substitui os 7 menus suspensos de
  produto (consumo, movimentações, material de OS e de chamado, itens de compra, filtros dos
  relatórios de movimentações e consumo), com `activeOnly` (movimentações/relatórios aceitam itens
  desativados; consumo/compra só ativos) e pré-preenchimento da unidade na compra. O `Esc` fecha a
  lista **antes** do diálogo (stopPropagation), Enter escolhe o destacado e a busca é debounced
  (250ms) com descarte de resposta obsoleta.
- **Escopo por permissão, nunca por botão escondido:** migration `0014_stock_profile_scope.sql`
  remove `stock.view`/`stock.replenish` de comprador, técnico, líder de limpeza, colaborador da
  limpeza e recepção; o menu e a rota `/estoque` somem sozinhos (guarda de permissão) e a API
  responde 403 para chamadas diretas. O técnico registra material pela OS
  (`workorders.material`, já existente) — o atalho do painel virou "Lançar material na ordem" —, o
  líder de limpeza mantém inventário e consumo, e a recepção mantém os chamados.
- **Alternativas descartadas:** esconder o item do menu sem mexer nas permissões (aparência, não
  segurança); manter `stock.view` para o comprador (não é responsável pelo módulo na definição do
  usuário; a fila de compras e o catálogo bastam); autocomplete só no cliente sobre a lista
  completa (não escala e perde o acesso desativado/ordenação).
- **Evidência:** `src/worker/search.ts`, `catalog.ts` (busca por termos + ordenação),
  `product-picker.tsx`, `0014_stock_profile_scope.sql`; +2 testes em `02-stock.spec.ts` e
  `01-auth.spec.ts` reforçado (143/143); verificação visual real (admin, comprador, técnico,
  mobile 390px) com capturas `ux-shots/produto-busca-*.png` e
  `ux-shots/perfil-tecnico-sem-estoque.png`.

## D-25 — Escopo aprovado: fechar toda a funcionalidade antes da identidade visual (18/10/2026) — VALIDADO

- **Decisão do usuário (18/10/2026):** "fechar tudo" — concluir o backlog funcional planejado
  (compras F-01..F-06; OS F-07/F-08/F-10; estrutura F-14; rápidas F-16 + F-20 fase 2) antes de
  iniciar a fase de identidade visual. Estimativa combinada: 5–7 sessões de trabalho.
- **Por quê:** a identidade visual mexe em todas as telas; fazê-la antes de fechar as telas
  pendentes obrigaria a refazer peças visuais. Fechar o funcional primeiro deixa a identidade
  como última camada, aplicada uma vez.
- **Regras mantidas:** imagens do usuário em `branding/` (o agente copia/renomeia/otimiza);
  pt-BR em toda a interface; nenhum serviço pago novo; **nada publicado** sem autorização (D-10).

## D-26 — Cotação com propostas de fornecedor, item a item (F-02) (18/10/2026) — DECIDIDO

- **Decisão do usuário (18/10/2026):** a cotação registra **propostas de fornecedores com valor
  por item** (mínimo 1 proposta), o gestor **compara e aprova**, e o pedido nasce da proposta
  aprovada. Não basta sinalizar itens para cotar e devolver com observações.
- **Consequências técnicas:** tabelas próprias de cotação/proposta e itens (fornecedor + preço
  unitário por item, moeda em centavos), telas de registro/comparação no detalhe da compra,
  transição para "cotação retornada / aguardando aprovação" e depois pedido (`/order` já existe).
- **Impacto nos complementos:** F-03 (fornecedor na trilha) e F-04 (relatório ampliado) passam a
  incluir a cotação; F-05 (linha do tempo) ganha eventos de proposta/aprovação.
- **Alternativa descartada:** apenas marcar itens para cotar e devolver com observações — não dá
  base de comparação nem histórico de preço, que é o motivo do pedido.

## D-27 — "Assinatura digital": manter a trilha de auditoria atual (F-15) (18/10/2026) — DECIDIDO

- **Decisão do usuário (18/10/2026):** manter a trilha atual — ator, data/hora, antes/depois por
  registro, linha do tempo por entidade e exportação CSV. **Sem** hash encadeado por registro.
- **Por quê:** cobre a necessidade real (quem fez o quê, quando e com qual estado) sem o custo de
  integridade criptográfica encadeada. Reavaliar apenas se alguma auditoria externa exigir.

## D-28 — Identidade visual: capas no topo dos painéis iniciais e no login (18/10/2026) — DECIDIDO

- **Decisão do usuário (18/10/2026):** usar imagens de capa **no topo dos painéis iniciais** (home
  de cada perfil) e **na tela de login** (papel de parede). Telas internas ficam limpas, sem capa.
- **Escopo da fase (D-25 + `PLANO-IDENTIDADE-VISUAL.md`):** logotipo, fundo, imagens de
  inicialização (splash), papel de parede do login, ícones, transições e animações — sempre
  preservando os 5 temas (F-18) e respeitando `prefers-reduced-motion`.
- **Pendência:** o usuário deposita as imagens em `branding/`; o plano mapeia cada slot (1–6).

## D-29 — F-20 fase 2 + F-16: painéis por perfil restantes e rótulo de local (18/10/2026) — VALIDADO

- **Painéis (F-20 fase 2):** dispatch por `roleCode` em `dashboard.tsx` — comprador (fila de
  aprovação/andamento/a receber + dois cartões de rotina: pedidos para registrar e pedidos a
  receber + alerta de produto com cadastro incompleto), estoquista (saldos, abaixo do mínimo,
  consumo e inventários + movimentações e itens críticos + ações), limpeza/liderança (consumo da
  equipe, chamados, inventários só para o líder + ações) e recepção (meus chamados, mesma base do
  solicitante). Blocos extraídos e reaproveitados (`RecentMovementsCard`, `LowStockCard`,
  `MineTicketsList`, `PurchaseListCard`) para não duplicar markup entre perfis.
- **Servidor:** `/api/dashboard/summary` ganhou `purchases.awaitingOrder` (gate
  `PURCHASES_ORDER`; aprovadas/em cotação/em compra) e `purchases.toReceive` (gate
  `PURCHASES_RECEIVE`; pedido realizado/parcialmente recebido), listas curtas (6) — o resumo não
  muda de rota nem de permissão de bloco.
- **Menu (F-20):** `BUYER_NAV`, `STOCK_NAV`, `CLEANING_NAV` e `RECEPTION_NAV` em `layout.tsx`,
  com títulos "Compras", "Estoque e suprimentos", "Limpeza" e "Recepção"; itens filtrados por
  permissão como sempre (limpeza só vê Inventário no perfil de liderança).
- **F-16:** helper único `locationLabel({ path, unitName })` em `src/shared/locations.ts` →
  `"${path} — ${unitName}"` (caminho do local não inclui a unidade; `unitName` vem do
  `mapLocation`). Aplicado em 17 seletores/filtros de 8 páginas + filtro compartilhado dos
  relatórios; `unitName` vazio/nulo mantém só o caminho.
- **Atalho de rotina:** `/compras?novo=1` abre o diálogo de solicitação e limpa o parâmetro,
  igual ao `/chamados?novo=1` — o botão de ação do painel leva direto ao formulário.
- **Evidência:** pipeline **146/146** em 15 arquivos (novo `15-locations.spec.ts` e teste de
  perfil fase 2 em `09-reports.spec.ts`), `check:api` 50×115; verificação visual dos 5 perfis
  (comprador, estoquista, limpeza, liderança e recepção, além da visão geral da gestão) com
  capturas `ux-shots/f20-2-*.png`, `ux-shots/f16-local-unidade.png` e mobile 390px.

## D-30 — Recepção também lança o consumo do posto; limpeza e recepção abrem chamados de manutenção (19/10/2026) — VALIDADO

- **Pedido do usuário (19/10/2026):** (a) "é muito importante que a líder de limpeza e a recepção
  consigam abrir chamados de manutenção"; (b) "a recepção consome itens do estoque também e a
  recepção precisa lançar os itens utilizados".
- **Chamados (a):** `role_clean_lead`, `role_clean` e `role_reception` **já possuíam**
  `tickets.create` — nenhuma mudança de código; o requisito virou teste de regressão (líder e
  equipe criam chamado pela API no cenário de painel por perfil) e verificação real
  (TCK-2026-000004 pela liderança; TCK-2026-000005 pela recepção).
- **Consumo (b):** migration `0015_reception_consumption.sql` — `role_reception` recebe
  `consumption.view` + `consumption.create` (mesmas condições da limpeza); o **controle de estoque
  segue restrito** a administração/gestão/estoquista (D-24/`0014`). A baixa de estoque no
  lançamento é opcional e não exige `stock.view` — a recepção lança o consumo com ou sem baixa.
- **Cliente:** `RECEPTION_NAV` ganhou o item "Consumo" (gate `CONSUMPTION_VIEW`);
  `MyTicketsHome` ganhou o parâmetro `showConsumption` — a recepção vê "Registrar consumo" e o
  indicador "Consumo (30 dias)" no painel; o solicitante permanece igual.
- **Evidência:** `09-reports.spec.ts` (perfil fase 2) cobre consumo da recepção (201 + resumo com
  `recordCount`/`qtyMilli`) e chamados de limpeza; verificação visual real com lançamento
  `CON-2026-000002` (Café 500g, 2 un — Recepção Térreo, "copa e balcão da recepção"; baixa do
  Almoxarifado Central: saldo 26 → 24 un, movimento `consumption` de 2 un) e capturas
  `ux-shots/d30-recepcao-*.png` (desktop + mobile 390px).

## D-31 — Compras com divisão direta/cotação, propostas por item e pedido vinculado (F-01/F-02) (19/10/2026) — VALIDADO

- **Contexto:** F-01/F-02 do `PLANO-COMPLEMENTOS.md`, com a decisão D-26 (cotação = propostas de
  fornecedor com valor por item), implementados sobre o fluxo existente
  (`draft → pending_approval → approved → ordered → …`).
- **Divisão item a item (F-01):** a análise do gestor marca cada item como `direct` (compra direta)
  ou `quote` (cotação) — coluna `purchase_request_items.purchase_mode` (migration
  `0016_purchase_quotes.sql`); aprovada com qualquer item em cotação, a solicitação segue para
  **`quoting`** ("Em cotação") em vez de `approved`; o detalhe mostra o selo "Compra direta" /
  "Cotação" por item; a decisão "Em cotação" sem payload também marca os itens como cotação.
- **Ciclo da cotação (F-02):** novas tabelas `purchase_quotes` (código COT-AAAA-NNNNNN; status
  registered/approved/rejected) e `purchase_quote_items` (valor por item; única por proposta+item);
  o comprador registra propostas (`POST /:id/quotes`; repetir o mesmo fornecedor **atualiza** a
  proposta em vez de duplicar) e devolve (`/quotes/return` → `quote_returned`); o gestor aprova
  (`/quotes/:quoteId/approve` → `quote_approved`; as demais propostas viram "Não escolhida") ou
  recusa (`/quotes/:quoteId/reject` → volta para `quoting`); proposta nova depois da devolução
  volta a solicitação para `quoting`.
- **Pedido (`/order`):** aceito em `approved`/`purchasing`/`quote_approved`; com proposta aprovada
  o pedido **exige o fornecedor da proposta** e **herda o preço cotado** por item quando o valor
  não é informado; ordenar durante `quoting`/`quote_returned` é bloqueado (409).
- **Notificações:** `purchase_quote_returned` (para quem aprova), `purchase_quote_approved`
  (solicitante + compradores) e `purchase_quote_rejected` (compradores).
- **Migration:** `0016` reconstrói `purchase_requests` (o CHECK do status é imutável no SQLite) com
  backup das três filhas e derrubada filha→mãe (cascade) — dados preservados, FK íntegras
  (`PRAGMA foreign_key_check` vazio); padrão reutilizável em `FACIL-DR11`.
- **Evidência:** `07-purchases.spec.ts` +2 cenários (fluxo completo com 2 propostas, fornecedor
  vinculado e herança de preço; recusa da proposta e fluxo 100% direto) — pipeline **148/148**
  (15 arquivos), `check:api` 50×119, typecheck/lint/build; verificação visual real (SC-2026-000004:
  análise com mix direto/cotação → propostas `COT-2026-000001`/`0002` → devolução → aprovação da
  Construforte → pedido com preço herdado R$ 11,80) e capturas `ux-shots/f02-*.png`.

## D-32 — Compras restantes: linha do tempo, uso direto no recebimento e relatório ampliado (F-03..F-06) (19/10/2026) — VALIDADO

- **Contexto:** últimos itens do Grupo 1 do `PLANO-COMPLEMENTOS.md` (F-03 a F-06), implementados
  sobre o ciclo F-01/F-02 (D-31). Fecham o módulo de compras sem tabela nova e sem serviço pago.
- **F-05 — Linha do tempo da solicitação:** derivada do `audit_log` (sem tabela nova): o detalhe
  (`GET /api/purchases/:id`) devolve `timeline` com os eventos `purchase_request.*`,
  `purchase_quote.*` e `purchase_receipt.confirm` da solicitação, das suas propostas e dos seus
  recebimentos (LIMIT 200, ordem cronológica); o `after_json` é decodificado para mostrar código
  (COT-/REC-), fornecedor, referência do pedido e nota. Rótulos em `PURCHASE_EVENT_LABEL`
  (`src/shared/types.ts`).
- **F-06 — Uso direto no recebimento (formato decidido):** checkbox "Uso direto" **por item** +
  **uma justificativa** para o lote (mínimo 5 caracteres, validado no servidor — 400 sem ela). O
  material **entra e sai no mesmo lote**: movimento de entrada (`purchase_receipt`) seguido de
  saída (`consumption`, `from = local do recebimento`) no livro-razão, com a justificativa na razão
  ("Uso direto no recebimento REC-…: …") e `requestKey` próprio (`…#u{índice}`) — reenvio continua
  idempotente. **Não cria registro de consumo** (`consumption_records`): a baixa vive no livro de
  movimentos (o relatório de Movimentações a mostra; o de Consumo lista os registros formais). O
  recebimento exibe o selo "Uso direto" e a contagem (`directUseCount`) no detalhe.
- **F-03 — Fornecedor do pedido visível:** o relatório de compras ganhou `ordersBySupplier`
  (pedidos do período por fornecedor: itens, quantidade e valor comprometido) e a exportação CSV
  ganhou as colunas Modo, Cotação aprovada, Referência do pedido, Valor total e Último recebimento.
- **F-04 — Relatório de compras ampliado:** `quotes` (total + por situação), `ordersBySupplier` e
  `requests` (ciclo por solicitação: situação, solicitante, itens, itens cotados, propostas,
  fornecedores, valor pedido, previsto/recebido, recebimentos; até 100; filtro `status` validado)
  na API e na tela ("Cotações no período", "Pedidos por fornecedor" e "Ciclo das solicitações" com
  seletor de situação).
- **P-19 (defeito encontrado e corrigido junto):** filtros de período que enviavam só a data
  (`YYYY-MM-DD`) comparavam como texto com os instantes ISO gravados — o filtro padrão "até hoje"
  **escondia todo o próprio dia**. Corrigido nas duas pontas: `normalizeRangeBound` no worker
  (`src/worker/util.ts`, data do calendário vale o dia inteiro no fuso da aplicação, usado por
  relatórios/consumo/movimentações) e `toIsoDayBound`/`dayRangeParams` no cliente
  (`src/client/lib/format.ts`, converte no fuso configurado antes de enviar).
- **Evidência:** `07-purchases.spec.ts` +2 cenários (linha do tempo do ciclo completo com propostas
  e recusa; uso direto com justificativa, entrada+saída, `directUseCount`, recusa sem motivo e
  reenvio idempotente) e `09-reports.spec.ts` +2 (cotações/pedidos por fornecedor/ciclo, filtro de
  situação, exportação com as colunas novas e recusa do filtro inválido; data do calendário
  incluindo o próprio dia) — pipeline **151/151** (15 arquivos), `check:api` 50×119,
  typecheck/lint/build; verificação real no navegador: linha do tempo da `SC-2026-000004`
  (criação → aprovação → 2 propostas → devolução → escolha → pedido → recebimento), recebimento
  `REC-2026-000004` com o café em uso direto (entrada + saída no mesmo lote, validação de
  justificativa visível na UI) e relatório mostrando o dia de hoje (2 solicitações, 2
  recebimentos, R$ 84.237,20) com filtro de situação; capturas `ux-shots/f05-1-timeline.png`,
  `ux-shots/f06-1-recebimento-uso-direto.png` e `ux-shots/f03-f04-relatorios-compras.png`.

## D-33 — Evidência por câmera na execução (F-07) e documento em chamado/OS restrito à gestão (F-08) (19/10/2026) — VALIDADO

- **Contexto:** itens F-07/F-08 do `PLANO-COMPLEMENTOS.md` (grupo Chamados/OS): "foto somente por
  câmera na execução" (o técnico registra a evidência na hora, sem escolher arquivo do aparelho) e
  "anexos auxiliares (PDF/planilha) somente para superiores".
- **F-07 — captura por câmera no checklist da OS:** novo componente `CameraCaptureDialog`
  (`src/client/lib/camera.tsx`): abre `navigator.mediaDevices.getUserMedia` (câmera traseira
  preferida), mostra o vídeo ao vivo, converte o quadro em JPEG pelo canvas e entrega o arquivo ao
  fluxo existente de anexos por etapa (`work_order_checklist_item`). O seletor de arquivo foi
  **removido** desse fluxo; sem suporte/permissão negada/ausente há orientação clara e nenhum
  caminho alternativo na interface (o navegador não garante criptograficamente a origem — a UI
  bloqueia o fluxo alternativo, como registra o plano). **Metadados:** horário da captura no nome do
  arquivo (`foto-<ISO>.jpg`) e, no registro do anexo, autor/hora + etapa de origem.
- **F-08 — documento restrito por permissão própria:** nova permissão `attachments.documents`
  ("Anexar documentos (PDF, planilha ou texto) a chamados e ordens de serviço", migration `0017`,
  concedida a `role_admin` e `role_manager`). O servidor (`POST /api/attachments`) recusa (403)
  **documento** (mime que não é `image/`) em `ticket`, `work_order` e `work_order_checklist_item`
  para quem não tem a permissão; **imagem continua livre** para quem enxerga a entidade — é a
  evidência de campo (câmera). No cliente, o card de anexos do chamado vira "Anexar foto"
  (aceita só imagem, com a dica de que documentos são anexados pela gestão) para quem não tem a
  permissão, e segue "Anexar arquivo" para a gestão. O catálogo ficou com **48 permissões**.
- **Evidência:** `05-tickets.spec.ts` +1 cenário (PDF do técnico → 403 com a mensagem; foto do
  técnico → 201; PDF da gestão → 201; contagem de anexos) e `01-auth.spec.ts` atualizado (48);
  pipeline **152/152** (15 arquivos), `check:api` 50×119, typecheck/lint/build; verificação real no
  navegador — como Diego Rocha (técnico), o checklist capturou a foto pela câmera simulada
  (`canvas.captureStream`) e o arquivo gravado foi conferido byte a byte (JPEG 640×480 com os
  pixels do quadro); o card de anexos mostrou "Anexar foto" (técnico) e "Anexar arquivo" (admin);
  capturas `ux-shots/f07-1-camera-dialog.png`, `f07-2-foto-capturada.png`,
  `f08-1-tecnico-anexo-foto.png` e `f08-2-admin-anexo-arquivo.png`.

## D-34 — OS filha: vínculo pai/filho definido na criação, árvore de gestão só para gestores (F-10) (19/10/2026) — VALIDADO

- **Contexto:** item F-10 do `PLANO-COMPLEMENTOS.md`: "abrir OS vinculada à OS pai
  (`parent_work_order_id`), árvore pai/filha na tela da OS; informações de gestão visíveis só a
  gestores".
- **Banco:** migration `0018_work_order_parent.sql` — `parent_work_order_id TEXT REFERENCES
  work_orders(id)` (auto-referência, nullable; SQLite/D1 aceita `ALTER TABLE ADD COLUMN` com
  `REFERENCES` sem default) + índice. O vínculo é **definido na criação e não muda depois** — como o
  id da OS filha é novo, não existe ciclo possível (não foi preciso checar ancestralidade).
- **Regra de criação** (`POST /api/workorders` com `parentWorkOrderId`): OS pai precisa existir
  (404) e não estar cancelada (409); concluída continua aceitando filha (trabalho de
  acompanhamento). O evento de criação registra `Ordem de serviço criada como filha de <código>.` e
  a auditoria guarda `parentWorkOrderId` no `after_json`.
- **Visibilidade (a "informação de gestão"):** o detalhe (`GET /api/workorders/:id`) devolve os
  resumos `parent`/`children` **apenas para `facilities_manager`/`admin`** — mesmo critério de
  `isManagerView` já usado no painel (`src/worker/routes/dashboard.ts`); os demais perfis recebem
  `parent: null`/`children: []` (o servidor nem consulta). No cliente, o card "OS relacionadas"
  (link para a OS pai, lista de filhas com situação/responsável e o botão **Abrir OS filha**) só
  aparece para a mesma visão de gestão. O técnico continua vendo a OS normalmente e a linha do tempo
  registra a origem, mas a árvore não aparece.
- **UI:** "Abrir OS filha" abre o próprio diálogo de OS já com o vínculo (título "Nova OS filha",
  aviso "Será criada como OS filha de …", local herdado da OS pai) e, ao criar, navega para a filha;
  o pai passa a listar a filha na mesma tela.
- **Evidência:** `06-workorders.spec.ts` +1 cenário (criação da filha, árvore simétrica, evento e
  auditoria com o vínculo, técnico sem árvore, pai inexistente → 404, pai cancelada → 409);
  pipeline **153/153** (15 arquivos), `check:api` 50×119, typecheck/lint/build; verificação real no
  navegador — OS-2026-000008 criada a partir da OS-2026-000007 pela tela (local herdado "Banheiro
  Térreo", evento de origem, pai listando a filha), técnico sem o card; capturas
  `ux-shots/f10-1-dialogo-os-filha.png`, `f10-2-os-filha-com-pai.png`,
  `f10-3-os-pai-com-filha.png` e `f10-4-tecnico-sem-arvore.png`.

## D-35 — Estrutura: árvore visual dos locais (padrão) e diálogo enxuto (F-14) (19/10/2026) — VALIDADO

- **Contexto:** item F-14 do `PLANO-COMPLEMENTOS.md`: "revisar usabilidade da gestão de estrutura
  (usuário achou confuso). Estudar simplificação (árvore visual, menos campos por tela) sem remover
  funções."
- **Árvore visual:** a aba **Locais** ganhou o seletor **Árvore | Tabela** (padrão: árvore). A árvore
  é montada no cliente a partir da lista da unidade (`parentId` + `path`), com recuo por nível,
  chevron de expandir/recolher, tipo/código (e unidade quando "todas as unidades"), contagem de
  sublocais, selo "Inativo" e as mesmas ações da tabela (**Editar**, **+ Sublocal**, **Desativar**).
  Locais cujo pai não está na lista filtrada viram raiz (nunca somem).
- **"+ Sublocal" no nó:** abre o diálogo de local já com **pai e unidade pré-selecionados** — antes
  o usuário escolhia o superior numa lista plana de caminhos.
- **Diálogo enxuto:** **Código** e **Observações** foram para dentro de um bloco recolhível
  **"Mais opções"** (aberto por padrão só na edição quando já há valor); a tela principal mostra
  Unidade, Tipo, Local superior e Nome.
- **Filtro removido com justificativa:** o seletor "Todos os pais" era auto-referente (suas opções
  vinham da própria lista já filtrada, que com `parentId` só devolve filhos diretos) e perdeu a
  função para a navegação visual; nenhuma função foi removida (filtro por unidade, tabela completa,
  edição, desativação e criação seguem).
- **Evidência:** verificação real no navegador — **Palco** criado como filho de **Auditório** e
  **Camarim** como filho de **Palco** pela própria tela (dois níveis, diálogo com o superior
  pré-selecionado); expandir/recolher esconde os descendentes; "Mais opções" abre Código/Observações;
  a Tabela continua igual. Sem mudança de API/banco (nenhum teste novo; pipeline segue **153/153**,
  `check:api` 50×119, typecheck/lint/build). Capturas `ux-shots/f14-1-arvore-nivel.png`,
  `f14-2-arvore-2-niveis.png` e `f14-3-dialogo-mais-opcoes.png`.
- **Pendente:** aceite do usuário da nova UX (o item pedia "estudar simplificação").

## D-36 — Identidade visual aplicada: logo, login, favicon, splash e capas no topo dos painéis (19/10/2026) — VALIDADO

- **Contexto:** D-25/D-28 — o funcional foi fechado (F-01..F-20) e o usuário depositou a marca em
  `branding/` (8 arquivos). Escopo combinado: **capas só no topo dos painéis iniciais (home de cada
  perfil) e no login**; telas internas limpas; nada publicado sem autorização.
- **O que chegou (e o que cada arquivo é de verdade):** `logo.png` e `logo-escuro.png` são **JPEG**
  (2752×1536, sem alpha) — o claro tem fundo branco, o escuro fundo cinza (#2c2c2c); `marca.png` é um
  JPEG quadrado (2048²) com o símbolo sobre cinza (#252525); `splash.png` é vertical (1536×2752);
  `capa.jpg` e `login-fundo.jpg` são 2752×1536; `logo.svg` é um SVG que **embute um raster 194×94
  RGBA** (logo escuro com transparência); `image.webp` é 485×463 (composto quadrado com foto + marca).
- **Processamento (ffmpeg — não há ImageMagick/Python na máquina):** chave de cor
  (`colorkey=0x2c2c2c:0.18:0.12`) para tirar o fundo do logo escuro; fotos convertidas em **WebP**
  (1920 px, q80), total ~310 KB; a **capa foi pré-cortada** em faixa (2752×520 a partir de y=410)
  **com a logo centralizada** — sem isso o `object-fit: cover` corta a logo em telas largas (o centro
  da foto passa a ser o corte útil); favicon/Apple touch saem da marca em 64/180 px **com fundo** (a
  versão transparente some em aba clara).
- **Assets finais em `src/client/public/branding/`:** `logo.webp` (1200×580, alpha) = **marca
  padrão** (círculo preto, "Corp" branco, ponto laranja + "Services"); `logo-dark.webp` = **variante
  invertida** (círculo branco, "Corp" preto) prevista para fundo escuro; `favicon.png`,
  `apple-touch-icon.png`, `login-bg.webp`, `cover.webp`, `cover-mobile.webp`, `splash.webp`. Os
  originais continuam intactos em `branding/` (fonte, nunca editados). **A extração do logo foi
  refeita no D-37** (a chave de cor deste item não serve para texto branco sobre shape escuro).
- **Integrações:** `index.html` (favicon, Apple touch e **tela de abertura** antes do primeiro JS);
  **login** com o papel de parede (`login-bg.webp`) + véu escuro + cartão branco com o logo;
  **menu lateral** com o logo no lugar do "F"; tela de carregamento das rotas com o logo; **capa no
  topo de todas as homes por perfil** (`cover.webp` no desktop, `cover-mobile.webp` no mobile via
  `<picture>`).
- **Regra de variante:** o logo acompanha o **tema efetivo** (`resolveTheme(user.theme, app.theme)`)
  — no Noturno (superfícies escuras) entra o logo de texto claro. A decisão mora num hook único
  (`useDarkSurface`), usado no menu, no login e no carregamento.
- **Evidência:** verificação real no navegador (login com papel de parede, home no desktop com a
  capa, home em 390 px com a capa mobile, tema Noturno com o logo claro); pipeline verde **153/153**
  (15 arquivos), `check:api` 50×119, typecheck/lint/build; capturas `ux-shots/vi-1-login.png`,
  `vi-2-home-cover.png` e `vi-3-home-mobile.png`.
- **Restante da fase:** ícones internos e motion (transições de página, abertura de diálogos,
  microinterações) ainda não tratados; aceite do usuário sobre o resultado visual.
- **Correção posterior:** o logo em si foi reconstruído no **D-37** (o material do D-36 sumia no
  tema Noturno e perdera o ponto laranja); as capturas acima foram refeitas com a marca final.

## D-37 — Logo reconstruída do original de alta resolução (fundo transparente real + variante invertida para o tema escuro) (19/10/2026) — VALIDADO

- **Problema encontrado na verificação:** o logo do tema Noturno **desaparecia**. A variante escura do
  D-36 vinha de `logo-escuro.png` (círculo **preto** sobre fundo cinza-escuro) → sobre a superfície
  escura do menu o círculo virava um borrão ilegível. Além disso, o logo claro era o `logo.svg` do
  usuário (raster 194×94, **sem o ponto laranja**), ou seja, a marca do menu e a do favicon
  (que tem o ponto) eram **diferentes**.
- **Decisão:** reconstruir **as duas variantes a partir do original de maior resolução**
  (`branding/logo.png`, 2752×1536, fundo branco), em vez de remendar arquivo por arquivo.
- **Como foi feito (sem ImageMagick/Python na máquina):** a geometria do círculo foi medida no
  original (topo y=108, base y=1392, centro x=706 → raio 642) e o processamento rodou **em canvas no
  navegador** (Playwright), pixel a pixel:
  - dentro do círculo → pixel intacto (círculo preto + "Corp" em branco + **ponto laranja**);
  - fora do círculo → branco vira **transparente**, cinza-escuro ("Services") é preservado, laranja
    é preservado; a borda recebeu alfa suave (rampa 150→200) para não ser serrilhado;
  - variante escura = **inversão** do RGB fora do laranja (círculo branco, "Corp" preto, "Services"
    cinza-claro, **ponto laranja intacto**).
  Saída: 1200×580 → `logo.webp` e `logo-dark.webp` (28 KB cada, `libwebp` q92, alfa preservado).
- **Código:** `src/client/lib/brand.tsx` passou a usar `/branding/logo.webp` (claro) e
  `/branding/logo-dark.webp` (escuro); o `logo.svg` saiu de `src/client/public/branding/` (o
  original do usuário continua em `branding/`). O hook `useDarkSurface` (mesmo tema efetivo de
  D-36) decide a variante no menu, no login e na tela de carregamento.
- **Evidência:** verificação real no navegador — login com a marca completa (círculo + "Corp" +
  ponto laranja + "Services"), home com a capa, home em 390 px, e **tema Noturno com o logo
  invertido legível** (antes invisível). Pipeline verde **153/153** (15 arquivos), `check:api`
  50×119, typecheck/lint/build. Capturas `ux-shots/vi-1-login.png`, `vi-2-home-cover.png`,
  `vi-3-home-mobile.png`, `vi-4-sidebar-escuro.png` e `vi-5-logo-escuro-detalhe.png`.
- **Lição (reutilizável):** marca com fundo chapado e **texto branco sobre shape escuro** não pode
  ser extraída por chave de cor (a chave leva junto as letras). A extração correta é
  **geométrica** (máscara do shape) ou vetorial — nunca `colorkey` no miolo.

## D-38 — Logo sem a bolinha laranja: o mestre vetorial não tem o ponto (19/10/2026) — VALIDADO

- **Problema apontado pelo usuário:** "você adicionou uma bolinha laranja que não existe na logo
  original". Conferido **pixel a pixel**: o mestre `branding/logo.svg` (que embute um raster 194×94
  RGBA) **não tem nenhum pixel laranja** — é o círculo preto + "Corp" branco + "Services" cinza.
  O ponto laranja existia só nos **exports/mockups** (`logo.png`, `logo-escuro.png`, `marca.png`,
  todos JPEG) e na arte da capa (`capa.jpg`) — e foi ele que entrou no logo do sistema.
- **Correção (processamento em canvas, no navegador):** logo reconstruído a partir de
  `branding/logo.png` (2752×1536) com a **geometria do círculo medida** (centro 706,750; raio 642):
  o disco do ponto (bbox x 1008..1335, y 1066..1392) foi **reconstruído** — dentro do círculo →
  preto, fora → transparente — o que apaga também o **anel fantasma** deixado pelo ringing do JPEG
  (pintar só os pixels laranja não bastava). Variante escura = **inversão do RGB** (círculo branco,
  "Corp" preto). Favicon e Apple touch refeitos a partir da variante invertida sobre `#252525`
  (o favicon transparente sumia em aba clara).
- **Capa:** o disco do ponto foi preenchido com amostragem do fundo local (fora do círculo) e preto
  (dentro do círculo); o resultado some no tamanho de exibição. **Tela de abertura:** deixou de usar
  a arte vertical do usuário (que tinha a bolinha embutida) e passou a ser **HTML** — logo + spinner +
  "Carregando...", com `prefers-reduced-motion` respeitado.
- **Princípio:** antes de extrair uma marca, **comparar com o mestre vetorial** (o SVG). O original
  do usuário nunca é editado; todo processamento vai para `src/client/public/branding/`.
  Assets finais: `logo.webp`, `logo-dark.webp`, `favicon.png`, `apple-touch-icon.png`,
  `login-bg.webp`, `cover.webp`, `cover-mobile.webp` (7 arquivos, ~300 KB).
- **Evidência:** verificação real no navegador (login, home desktop, home no tema Noturno) —
  nenhuma bolinha laranja em menu, login, capa ou favicon; capturas `ux-shots/vi-1-login.png`,
  `vi-3-home-mobile.png`, `vi-6-home-desktop.png` e `vi-7-home-noturno.png` (as capturas antigas
  que mostravam o ponto foram descartadas).

## D-39 — Publicação 0.1.0: GitHub privado, Cloudflare Workers/D1 e assinatura sem dados pessoais (20/10/2026) — VALIDADO

- **Identidade e privacidade:** o autor é **Allan Luiz Silveira Lima**; **CPF e e-mail não são
  gravados no projeto nem exibidos no sistema** (LGPD). A prova de autoria é a chave **Ed25519**
  (fingerprint `65:BE:89:…:98:50`), o manifesto SHA-256 de 152 arquivos e a data/hora de cada
  release. O nome aparece no `/build-info.json`, nos cabeçalhos `X-Facil-*`, no rodapé do login e
  em `<meta name="author">`; o Git registra o nome completo como autor.
- **Repositório:** privado `Allanlugui/facil`, branch `main`, commit `4c878a8`; `.gitattributes`
  força **LF** para o SHA-256 do manifesto bater em qualquer SO (Windows incluído).
- **Infra:** Worker `facil` + D1 `facil-db` (`10365b4d-7ed0-4e8e-8aba-65ebf354cb25`, ENAM) com as
  migrations 0001–0018 e **0 usuários**. URL `https://facil.cf-pilot-disposable.workers.dev`;
  sem domínio próprio → sem Cloudflare Access (o login do app protege o acesso).
- **R2:** o bucket não existe (erro 10042 — R2 exige ativação no painel). Para não bloquear o
  deploy, o binding ficou **comentado** em `wrangler.jsonc`, `attachmentsBucket()` responde
  **503 `R2_UNAVAILABLE`** e os testes usam `r2Buckets: ["ATTACHMENTS"]` no Miniflare. Ativar:
  painel → R2 → criar `facil-attachments` → descomentar → `npm run types` → `npm run deploy`.
- **Release:** `npm run release` (sign + typecheck + lint + check:api + 153 testes + build) verde;
  `npm run verify` confere 152 arquivos. `wrangler deploy` publica Worker + assets; `/api/health`
  expõe o bloco `release` (versão, autor, empresa, data, tree hash, fingerprint).
- **Setup pendente de propósito:** `POST /api/auth/setup` não foi executado para não criar login com
  e-mail pessoal sem consentimento; a tela `/setup` está disponível uma única vez (`needsSetup: true`).
- **Evidência:** `/api/health` 200 + cabeçalhos, `/build-info.json`, `/` 200 com `<meta author>`,
  `/setup` renderizado (captura `ux-shots/deploy-login.png`), D1 remoto `users=0`,
  `d1_migrations=18`.

## D-40 — Fase visual concluída: ícones consistentes e movimento curto (20/10/2026) — VALIDADO

- **Ícones:** o conjunto interno já era único (`ui.tsx`, traço 1.6, viewBox 24, 20 px, classe
  `theme-icon` que respeita o tema). Faltavam três pontos: `←` e `✕` literais (suporte e anexos) e
  `▸/▾` na árvore de estrutura. Entraram `ArrowLeftIcon`, `CloseIcon` e `ChevronIcon` (com
  `rotate-90` animado); não sobrou glifo de ícone nas telas.
- **Movimento:** tokens em `styles.css` (`--motion-fast 120ms`, `--motion-base 180ms`,
  `--motion-slow 260ms`, `cubic-bezier(0.22, 1, 0.36, 1)`), keyframes de fade, diálogo, gaveta,
  popover e toast. Diálogo entra com elevação + escala (260 ms) e véu em fade (180 ms); gaveta
  desliza (260 ms); menus de usuário/notificações em pop (120 ms); toast entra/sai (180/120 ms) com
  remoção após a saída; botões, abas e linhas com `transition-colors` 150 ms.
  `prefers-reduced-motion` zera animações e transições.
- **Validação real (Playwright, 1440×900 e 390×844):** `getComputedStyle` confirmou
  `facil-pop-in` 0,12 s, `facil-dialog-in` 0,26 s + `facil-fade-in` 0,18 s, `facil-drawer-in`
  0,26 s, `facil-toast-in` 0,18 s e remoção após 4,5 s; com `reducedMotion: reduce` a duração cai
  para 0,00001 s. Capturas `ux-shots/motion-1-menu.png` … `motion-4-toast.png`.
- **Bug encontrado no caminho:** o hash demo do `seeds/demo.sql` tinha o último caractere em
  minúscula (`…X0a=`), então a senha documentada `Demo@Facil2026` **não funcionava em banco novo**;
  corrigido para `…X0A=` (6 usuários) e revalidado por login real (200).
- **Sem mudança de API/banco** (exceto o seed). `typecheck`, `lint`, 153 testes e build verdes;
  release assinado e publicado — tree `6dae4bc38fcf3eb5629dd749651af0b577240b5dbaaf7a02dfd36702dbdb2713`,
  152 arquivos, 19/10/2026 23:28:49 −03:00. O par `AGENTS.md`/`structure.tsx` foi normalizado para
  LF antes da assinatura (CRLF quebrava o verify em clone novo) e um `.ics` que caiu em `branding/`
  foi movido para fora do repo.

## D-41 — Chat do suporte: mensagem otimista e painel de conversa (20/10/2026) — VALIDADO

- **Problema:** os dois fluxos (acompanhamento público por token e atendimento interno) só
  mostravam a mensagem depois de `POST /messages` + `GET` completo (`state.reload()`), com o
  composer travado durante o envio. Em conexão lenta parecia que a mensagem "sumia".
- **Solução (otimista):** `useOptimisticChat` (novo `src/client/lib/chat.tsx`) insere a mensagem
  localmente com id temporário e `sending: true` **antes** do POST. A resposta `{ id }` troca o id
  temporário pelo definitivo; quando a leitura seguinte contém esse id, a cópia local é descartada
  (dedupe por id, sem bolha duplicada). Em erro, a bolha provisória sai e o texto/anexos continuam
  no composer para nova tentativa.
- **Painel (`ChatThread`):** área rolável própria (`clamp(320px,52vh,480px)`), mensagens ancoradas
  no fim, separadores de dia (Hoje/Ontem/data), avatar com iniciais, agrupamento de mensagens do
  mesmo autor em até 5 min, horário `HH:mm`, estado "enviando" com spinner, anexos como miniatura
  (imagem) ou cartão com extensão/tamanho. Rolagem automática só quando o leitor está no fim (ou
  ao enviar); `prefers-reduced-motion` usa salto instantâneo.
- **Composer:** anexo com contador de limites, `Enter` envia e `Shift+Enter` quebra linha no desktop
  (no toque, `Enter` quebra linha), contador de caracteres a partir de 1800 e erro mantendo o texto.
- **Tempo real possível sem WebSocket:** acompanhamento público e atendimento interno releem a
  conversa a cada 20 s; o otimista cobre o intervalo do envio. `useAsync.reload()` continua `void`.
- **Validação real (Playwright):** com `fetch` desacelerado em 1,5 s, a bolha apareceu com
  "enviando" e o textarea ainda preenchido; depois do POST o texto limpou, o estado virou horário e
  **não houve duplicata** (2 mensagens → 3). Testado nos dois fluxos (público e staff) e em
  390×844. Capturas `ux-shots/chat-1-enviando.png` … `chat-7-mobile.png`.
- **Release:** 153 arquivos (entrou `chat.tsx`), tree
  `074474e0ef5e499bdc83b85fda4d197eb960ccca26ad4581e5e28442ea4f5b5c`, assinado
  2026-10-19T23:59:22−03:00, Worker version `e490f47e-ba20-4ff6-bcad-da2f9def888e`;
  typecheck, lint, 153 testes e build verdes. Sem mudança de API/banco.
- **Correção após o primeiro aceite (20/10/2026):** na grade do atendimento o card do chat esticava
  até a altura da coluna lateral (e-mails), deixando uma área branca grande abaixo do composer.
  `self-start` no `section` resolve (o card passa a ter a altura do conteúdo); medido no navegador:
  `blankBelowComposer = 1 px`. Re-assinado: tree
  `343524605e9828df48466a59cf1a808122ed1b442ac1e5b14d4c441747794b4e`, 00:09:48 −03:00, Worker
  version `e94bbf0b-b4d2-4c76-b015-15a2b29cd685`; captura `ux-shots/chat-8-sem-espaco-vazio.png`.
- **Segunda correção (20/10/2026):** a lista “E-mails do pedido” crescia sem limite na coluna
  lateral (um e-mail por destinatário/mensagem). Ganhou teto de `16rem` com rolagem própria,
  contador no cabeçalho e ordem do mais recente primeiro; medido: 11 itens, lista 256 px visível /
  718 px de conteúdo. Novo tree
  `e9f9c44c14e1b3d709605bb126511ee03ae3626694446c3195a05ae5f55131aa`, 00:15:08 −03:00, Worker
  version `76aa6993-47a7-40a4-ab7e-12c5037b1715`; captura `ux-shots/chat-9-emails-limitados.png`.

## D-42 — Auditoria de autorização e segurança (20/10/2026) — CONCLUÍDA

- **Escopo:** revisão rota a rota do Worker, matriz de permissões, escopo por local, anexos,
  configurações secretas, uploads, limites de entrada e cabeçalhos; consulta somente leitura ao D1
  de produção.
- **Resultado:** **12 achados corrigidos** — auto-remoção de escopo, edição de admin/autoridade
  superior, relatórios, OS (escopo/responsável/`done`/cancelamento), PATCH e ações de chamado,
  compras, inventário, anexos por entidade, estoque por local, consumo/movimentação/local. Nenhum
  crítico/alto aberto.
- **Endurecimento:** SVG/HTML bloqueados, disposição segura, 1 MB de JSON, limites multipart,
  segredos mascarados/redigidos com limpeza explícita, CSP/HSTS/COOP/frame-options/`no-store`,
  Origin guard, limite de senha e throttle de 10 pedidos públicos/hora/IP.
- **Evidência:** `tests/16-security.spec.ts`, `tests/17-authorization.spec.ts`, pipeline
  **162/162 em 17 arquivos**, `npm audit` 0, `docs/SEGURANCA-AUDITORIA-2026-10-20.md`.
- **Dados históricos:** 0 `settings.update`, 0 anexos e chaves `mail.*` vazias no D1 de produção;
  sem segredo histórico em auditoria e sem SVG armazenado.

## D-43 — Versionamento contínuo e fechamento da etapa 1 (20/10/2026) — ATIVO

- **Política:** SemVer adaptado; patch para correção/segurança/interface/documentação assinada,
  minor para funcionalidade ou mudança relevante, major no 1.0. Toda alteração em arquivo assinado
  sobe a versão; release publicada não é reescrita. Detalhes em `docs/VERSIONAMENTO.md`.
- **Fluxo:** editar → atualizar `CHANGELOG.md` → `npm version patch` → `npm run deploy` (assina,
  valida, compila, publica) → verificar `/api/health` e cabeçalhos → `npm run verify` → commit, tag
  e push.
- **Fechamento:** release **0.1.2** (160 arquivos, tree
  `7e4433f6448566ae5bf6f0df97d03ec0d0fe14fbbc839e9f332745609d1ae13c`, 01:31:40 −03:00, Worker
  `14b4a87b-ec15-4b70-8175-f55ef6943a6f`). A 0.1.1 foi release intermediária, substituída pela
  0.1.2 e não tagueada; tags `v0.1.0` e `v0.1.2`.
- **Marca:** login e metadados de assinatura passaram a exibir **CorpServices Group** (sem espaço),
  alinhados ao nome configurado pelo titular.

## D-44 — Fluxo corporativo de compras v2 convive com o fluxo legado (20/10/2026) — VALIDADO

- **Decisão:** a versão 2 é usada por novas solicitações; solicitações antigas permanecem em
  `workflow_version = 1` e continuam funcionando no fluxo anterior. Não houve migração destrutiva.
- **Etapas v2:** solicitante → gestor do setor → direção (necessidade/orçamento) → compras →
  comprador cota → superior adjudica item a item → comprador emite pedido por fornecedor →
  recebimento vinculado ao pedido.
- **Caminho alternativo:** gestor pode enviar direto a compras; a triagem pode devolver à direção
  (cotação) ou autorizar compra direta sem cotação. O destino padrão é **cotação**; compra direta é
  escolha explícita.
- **Evidência:** `tests/18-purchase-workflow.spec.ts`, migration `0019_purchase_workflow.sql`,
  `docs/COMPRAS.md`, `npm run check` 168/168.

## D-45 — Permissões separadas e novos papéis de compras (20/10/2026) — VALIDADO

- **Permissões:** `purchases.view_all` (visão global), `purchases.authorize` (direção),
  `purchases.award` (adjudicação), `purchases.direct` (compra direta); `purchases.order` e
  `purchases.receive` deixaram de ser exclusivas do gestor.
- **Papéis:** `operations_director` e `purchasing_manager`; matriz de 48 → 52 permissões.
- **Regra:** o solicitante não decide a própria compra; a direção não pode ser a mesma pessoa que
  aprovou como gestor (salvo administrador com `settings.manage`).
- **Efeito:** a UI consulta `/api/auth/me` no foco e a cada minuto; o servidor reavalia a permissão
  em cada requisição.

## D-46 — Centro de custo, orçamento e adjudicação item a item (20/10/2026) — VALIDADO

- **Dados:** `purchase_requests` ganhou centro de custo, conta contábil, observações e situação
  orçamentária/financeira; `purchase_request_items` ganhou modo de compra, quantidade aprovada,
  pedida e recebida.
- **Adjudicação:** `purchase_awards` liga item → proposta → fornecedor, com quantidade e preço;
  uma solicitação pode gerar vários `purchase_orders` (um por fornecedor).
- **Pedido:** usa o preço da proposta adjudicada e recusa preço divergente; grava centro de custo e
  conta contábil da solicitação no próprio pedido.
- **Recebimento:** `purchase_receipts` e `purchase_receipt_items` vinculam pedido e item, atualizam
  quantidades e geram movimentação de estoque sem entrada dupla.

## D-47 — Integrações por outbox transacional e intake idempotente (20/10/2026) — VALIDADO

- **Outbox:** `integration_outbox` é gravado no mesmo `batch` D1 da operação, com
  `idempotency_key` única; eventos `purchase_request.created`, `.submitted`, `.ordered` e
  `purchase_order.created`/`goods_receipt.posted` ficam pendentes para um integrador.
- **Inspeção:** `/api/integrations/outbox` e `ack` permitem listar e confirmar eventos; não há
  chamada síncrona a NetSuite/ServiceNow no caminho crítico.
- **Intake:** `POST /api/intake/tickets` exige `TICKET_INTAKE_KEY`, usa `externalRef` idempotente por
  fonte, limita 30 chamadas/10 min por IP e cria/usa o usuário técnico `user_intake`.
- **Segurança:** a chave não fica no repositório; sem segredo configurado, o endpoint responde
  `503 INTAKE_DISABLED`.

## D-48 — Release 0.2.0 e limite de escopo comercial (20/10/2026) — VALIDADO

- **Versão:** `0.2.0` (minor por funcionalidade nova), assinada com Ed25519; toda alteração futura
  eleva a versão. Chave privada fora do repositório, em `%USERPROFILE%\.facil-signing\`.
- **Publicação:** tree `c19025940127c05cbb4bf172a706868a306e983694df7a5d183034a6a4e121f7`,
  20/10/2026 21:47:54 −03:00, Worker `ab266118-20a8-4fc5-a0bd-c245a79c9462`.
- **Custo:** nenhum serviço pago novo; D1 e Worker no plano atual, anexos R2 desativados, sem domínio
  customizado/Access e sem CI dedicada.
- **Documentação:** propósito, função, contexto e proposta no relatório externo
  `C:\Users\jalla\OneDrive\Desktop\Facil - Relatorio Executivo 0.2.0.md`; handoff no `README.md` e
  em `docs/COMPRAS.md`/`docs/INTEGRACOES.md`, sem afirmar construção por IA.
