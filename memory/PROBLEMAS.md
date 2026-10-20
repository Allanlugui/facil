# Problemas e Limitações: Facil

## P-01 — Bootstrap `criar-projeto.bat` falhava no bloco DEPLOY.md (RESOLVIDO em 16/10/2026) — VALIDADO

- **Sintoma:** o bootstrap abortava em `[2/5]` com `. foi inesperado neste momento.` (cmd.exe);
  `DEPLOY.md`, o `AGENTS.md` da raiz, o conhecimento global e a linha no Subconsciente não eram
  gerados.
- **Causa raiz:** parênteses não escapados dentro do bloco `( ... ) > arquivo` na versão de
  14/10/2026 — linha 284 (`(build, check, URL, conteudo)`) e linha 287 (`(ex.: Vercel)`).
- **Evidência de resolução:** o `D:\DEV\criar-projeto.bat` foi reescrito às **22:17:53** de
  16/10/2026 e hoje contém `echo - Producao somente com evidencias reais ^(build, check, URL, conteudo^).`
  (linha 284) e `echo Projetos EXISTENTES preservam sua plataforma atual ^(ex.: Vercel^).` (linha 287).
  O bootstrap de `Facil` (22:36:22) gerou a estrutura completa — todos os 5 passos.
- **Status:** **RESOLVIDO pelo usuário.** Nenhuma ação pendente do agente.

## P-02 — `F:\DEV\memory` citado no prompt de inicialização (ABERTO — informativo, não bloqueante)

- **Descrição:** o prompt de inicialização manda ler a memória global em `F:\DEV\memory` e alerta que
  `D:\dev\memory` "não deve ser considerado correto automaticamente". A unidade `F:` não existe nesta
  máquina.
- **Origem investigada (16/10/2026):** a referência **não vem da infraestrutura**. Auditoria:
  - `D:\DEV\criar-projeto.bat` → `set "GLOBAL_ROOT=D:\dev\memory"` (correto);
  - `D:\DEV\backup-20261016-protocolos-universais\Primeiro prompt apos uso do arquivo bat.txt` →
    **0** ocorrências de `F:`; 10 de `D:\dev\memory`;
  - `D:\DEV\backup-20261016-protocolos-universais\PROMPT DE RETOMADA UNIVERSAL.txt` → **0**
    ocorrências de `F:`; 3 de `D:\dev\memory`;
  - `C:\Users\jalla\.config\opencode\AGENTS.md`, `opencode.json`, `SELECTIVE-ROUTING.md` e
    `C:\Users\jalla\.agents\` → **0** ocorrências de `F:`;
  - todo o `D:\DEV\memory` → as únicas ocorrências são as que **esta sessão** escreveu para documentar
    a divergência.
  - **Conclusão:** os artefatos de protocolo em disco estão corretos (`D:\dev\memory`). O `F:` surgiu
    no texto do prompt recebido nesta sessão. Não há configuração errada a corrigir.
- **Causa raiz CONFIRMADA:** em **14/10/2026** a unidade `F:\` foi integralmente migrada para `D:\`
  via ROBOCOPY (evidência: `C:\Users\jalla\AppData\Local\Temp\opencode\migracao-f-d-pass1.log` de
  14/10 17:14 e `migracao-f-d-final.log` de 14/10 18:55, ambos "Origem: F:\ / Destino: D:\"). Portanto
  `F:\DEV\memory` **existiu de verdade** antes da migração. O prompt desta sessão é um artefato
  **pré-migração**; o caminho correto depois da migração é `D:\DEV\memory`.
- **Risco:** um agente que siga a instrução literalmente pode tentar criar `F:\DEV\memory` e produzir
  uma árvore global paralela e vazia — exatamente o que o protocolo proíbe.
- **Mitigação aplicada:** divergência comprovada (D-01), caminho real `D:\DEV\memory` usado, nada
  criado em `F:`, nenhum artefato de protocolo alterado.
- **Ação necessária:** nenhuma no ambiente. Se o prompt for regenerado a partir de um modelo, corrigir
  `F:\DEV\memory` → `D:\DEV\memory` **na fonte do texto**. Os dois `.txt` de protocolo **não** devem
  ser editados — estão corretos.

## P-03 — Dois diretórios para o mesmo produto (RESOLVIDO em 17/10/2026 por decisão do usuário) — VALIDADO

- **Descrição:** `D:\DEV\Opencode\facilities-management` (bootstrap abortado às 22:01:51, concluído
  manualmente, com `.serena` registrado e memória mais rica) e `D:\DEV\Opencode\Facil` (bootstrap
  íntegro às 22:36:22) descrevem a **mesma** plataforma de Facilities.
- **Risco:** trabalho duplicado, memória divergente e ambiguidade sobre qual é o projeto oficial.
- **Mitigação aplicada:** `Facil` foi tratado como canônico (D-02); o conhecimento de valor do
  predecessor foi absorvido; **nada foi apagado, movido ou modificado** no predecessor.
- **Resolução (17/10/2026):** o usuário decidiu **arquivar**. O diretório foi renomeado para
  `D:\DEV\Opencode\_arquivo-facilities-management` (mesmo local; timestamp de criação preservado —
  16/10/2026 22:01:51). Nada foi apagado. O registro `facilities-management` no Serena segue
  apontando para o caminho antigo (a ferramenta `remove_project` não está exposta nesta sessão) —
  pode ser removido pelo dashboard do Serena quando conveniente; sem impacto funcional.

## P-04 — Bundler do wrangler não resolvia o alias `@shared/*` (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** `npx wrangler dev` falhava com `Build failed with 19 errors: Could not resolve
  "@shared/permissions"` (e `@shared/types`) em todos os módulos do Worker; o servidor ficava em
  loop de restart. `npx vitest run` e `tsc` funcionavam (Vite e tsc leem os `paths` dos tsconfigs).
- **Causa raiz:** o esbuild do wrangler descobre o `tsconfig.json` da **raiz**, que é "solution style"
  (`"files": []` + `references`) e na raiz **não havia `paths`** — os mapas existiam apenas em
  `tsconfig.worker.json` / `tsconfig.client.json`.
- **Tentativa que não resolve:** `"alias": { "@shared": "./src/shared" }` no `wrangler.jsonc` —
  o `alias` do esbuild casa o caminho **exato** do import, não o prefixo (`@shared/permissions`
  continuava sem resolução).
- **Correção aplicada:** adicionar `compilerOptions.paths` (`"@shared/*": ["src/shared/*"]`, com
  `baseUrl: "."`) ao `tsconfig.json` da raiz. Evidência: `wrangler deploy --dry-run` OK,
  `wrangler dev` OK, smoke 11/11.
- **Status:** RESOLVIDO. Nenhuma ação pendente.

## P-05 — Overflow horizontal no painel em telas de 390 px (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** no Playwright a 390×844 o painel rolava horizontalmente (`scrollWidth 528` ×
  `clientWidth 375`).
- **Causa raiz:** os cards inferiores do painel são itens de um grid de coluna única; o texto com
  `truncate` (`white-space: nowrap`) dentro de `li` flex define um min-content de ~516 px, e o track
  `auto` do grid cresceu além do container (o mínimo automático do item respeita `min-width: auto`).
- **Correção aplicada:** `min-w-0` nos dois itens do grid (`dashboard.tsx`); varredura posterior nas
  14 rotas com `scrollWidth === clientWidth` em 390 px.
- **Status:** RESOLVIDO. Regra preventiva registrada em `APRENDIZADOS.md` (A-06).

## P-06 — `wrangler types` avisa "types out of date" e `npm run types` exige `@types/node` (RESOLVIDO em 18/10/2026) — VALIDADO

- **Descrição:** com `nodejs_compat`, o comando `wrangler types` (que regenera
  `worker-configuration.d.ts`) pede `@types/node`, que não estava instalado. O arquivo versionado
  continuava válido para typecheck/build/runtime — o aviso era apenas de frescor do arquivo gerado.
- **Risco:** nenhum em runtime; risco baixo de dessincronia futura de tipos ao mudar bindings.
- **Resolução (18/10/2026):** durante a F-19 o binding R2 (`ATTACHMENTS: R2Bucket`) passou a ser
  exigido pelo typecheck — `npm i -D @types/node` + `npm run types` regeneraram
  `worker-configuration.d.ts` (agora com `ATTACHMENTS`), sem mais avisos do wrangler. O arquivo
  gerado foi versionado no repositório, como previsto.

## P-07 — Cliente de inventário chamava `/api/inventory` mas o worker monta `/api/inventories` (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** a tela Inventário exibia "Rota nao encontrada: /api/inventory" — todas as 10 chamadas
  da página (`src/client/pages/inventory.tsx`) usavam o singular; o worker monta `/api/inventories`
  (plural, consistente com `/api/purchases`, `/api/tickets` etc.) e os testes de API usam o plural.
- **Causa raiz:** divergência de caminho apenas no lado cliente; nenhuma camada de verificação cruzava
  chamadas do cliente com as rotas registradas no worker. Os testes de API chamam os caminhos
  corretos — por construção não pegam erro de digitação no cliente.
- **Como passou pela verificação visual (FACIL-S05):** a varredura anterior media **só** overflow
  horizontal (`scrollWidth === clientWidth`); o card de erro da página ainda cabia na largura, então
  o defeito era invisível para aquela métrica. **Bug encontrado pelo usuário em uso real.**
- **Correção aplicada:** 10 chamadas trocadas para `/api/inventories` **+ guard novo**
  `scripts/check-api-paths.mjs` (extrai todo literal `/api/...` do cliente e confere, segmento a
  segmento, contra os mounts de `index.ts` + `router.*` dos módulos do worker; roda em
  `npm run check:api`, dentro de `npm run check`). Teste negativo provou que o guard falha (exit 1)
  com o caminho antigo.
- **Verificação:** fluxo completo pela interface — criar inventário (POST), detalhe com snapshot de
  16 itens, fechamento com força + justificativa (permissão de exceção), lista mostrando "Encerrado";
  varredura das 14 rotas sem mensagem de erro visível.

## P-08 — Anexos existiam no backend mas não tinham interface (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** o worker tinha o módulo de anexos completo e testado (`/api/attachments`), mas nenhuma
  tela usava `apiUpload` — ou seja, o recurso não era acessível ao usuário, apesar de documentado
  como "chamados com anexos".
- **Causa raiz:** o módulo foi implementado e validado apenas pelo lado da API; a validação visual
  nunca checou presença/uso de recursos na UI, só renderização das 14 rotas.
- **Correção aplicada:** card **Anexos** no detalhe do chamado (`tickets.tsx`): listar (nome,
  tamanho, autor, data), enviar (multipart via `apiUpload`), baixar (link autenticado) e remover
  (dono ou `settings.manage`, com diálogo de confirmação). Backend não mudou.
- **Verificação E2E (Playwright):** upload real de arquivo → listado com metadados → download
  autenticado (`200`, `text/plain`, conteúdo correto) → remoção com confirmação → estado vazio;
  auditoria mostra `attachment.upload` e `attachment.delete`; layout mobile 390 px sem overflow.
- **Nota de escopo:** o backend suporta anexos também para ordens de serviço (`entityType:
  work_order`); a UI por ora expõe apenas em chamados (registrado no TODO como item opcional).

## P-10 — Relatório de divergências de inventário retorna 500 (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** `GET /api/reports/inventory-variances` retornava 500 com
  `D1_ERROR: no such column: inv.scheduled_for`. Afetava também a exportação CSV.
- **Causa raiz:** a query SQL em `reports.ts` referenciava colunas inexistentes:
  `inv.scheduled_for` (tabela `inventories` não tem essa coluna), `ii.qty_expected_milli`
  (a coluna é `system_qty_milli`) e `ii.qty_counted_milli` (a coluna é
  `counted_qty_milli`).
- **Correção aplicada:** substituídos os nomes de coluna no SELECT do endpoint JSON
  (linhas ~774-778) e do export CSV (linha ~1132), além do mapeamento de resposta
  (`scheduledFor` → `openedAt` mapeado de `inv.opened_at`).
- **Verificação:** `GET /api/reports/inventory-variances` retorna 200 com dados;
  pipeline `npm run check` verde (107/107 testes).
- **Arquivos:** `src/worker/routes/reports.ts`.

## P-11 — Sem UI de gestão da estrutura organizacional (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** não existia página no cliente para cadastrar/editar/inativar unidades,
  tipos de local ou locais.
- **Correção aplicada:** criada página `src/client/pages/structure.tsx` com 3 abas
  (Unidades, Tipos de local, Locais) com CRUD completo via `/api/structure/*`. Rota
  `/estrutura` registrada em `router.tsx` (condicionada a `structure.view`). Link
  "Estrutura" adicionado ao menu de gestão em `layout.tsx` (condicionado a
  `structure.view`).
- **Verificação:** build OK, typecheck OK, lint OK, check:api OK (42 caminhos).
- **Arquivos:** `src/client/pages/structure.tsx` (novo), `src/client/app/router.tsx`,
  `src/client/app/layout.tsx`.

## P-09 — Ícone de engrenagem deformado no menu lateral (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma (relatado pelo usuário):** o ícone de engrenagem do item "Configuracoes" no menu lateral
  aparecia deformado/cortado.
- **Causa raiz:** o `path` da engrenagem (`ui.tsx`, `GearIcon`) saía do viewBox 0–24 — vértices
  inferiores em `y=25` (1 unidade fora; o SVG corta em silêncio) e lateral esquerda em `x=0.3`;
  além disso misturava lineto **absoluto** (`L1.2 16`, `L2.3 7`, `L9.2 5`) com comandos relativos,
  produzindo dentes irregulares.
- **Correção aplicada:** path substituído pelo desenho padrão de engrenagem (mesmo estilo dos
  demais: traço 1.6, círculo central r=3). Geometria conferida por `getBBox()`: bbox final
  `x=3 y=2 w=18 h=20` — dentro do viewBox.
- **Verificação:** varredura automática de `getBBox()` em **todos** os elementos SVG das 14 rotas —
  zero elementos fora do viewBox; inspeção visual do ícone ampliado; build + tsc + lint verdes.
  Receita registrada no global (FACIL-S09).

## P-12 — Painel expunha dados globais para usuários operacionais (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma (relatado pelo usuário):** o painel mostrava números/alertas de **toda** a operação
  (tickets, OS, compras, estoque, consumo, últimos registros) para quem só tem `dashboard.view`
  (ex.: solicitante) — exposição indevida de informação (risco LGPD).
- **Causa raiz:** `/api/dashboard` e `/api/dashboard/alerts` montavam os blocos sem verificar
  permissões; o cliente renderizava tudo o que o servidor devolvia.
- **Correção aplicada (defesa em profundidade):** escopo por permissão no servidor — cada bloco
  exige a permissão `.view` correspondente (tickets respeitam `tickets.view_all` para escopo por
  solicitante/atribuído); alertas gated por `stock.view` / `workorders.view` / `tickets.view` /
  `purchases.approve` (novo: `catalog.manage`) — e gating por permissão no cliente
  (`dashboard.tsx`), que não renderiza o que o usuário não pode ver.
- **Verificação:** teste de regressão novo em `tests/09-reports.spec.ts`
  ("painel nao expoe dados de outras areas ao solicitante"); pipeline completo verde — 109/109.
- **Arquivos:** `src/worker/routes/dashboard.ts`, `src/client/pages/dashboard.tsx`,
  `tests/09-reports.spec.ts`.

## P-13 — Cadastro rápido de produto no recebimento (FEITO em 17/10/2026, era pedido de evolução)

- **Pedido do usuário:** ao receber produto fora do catálogo, cadastrar na hora (apenas o nome),
  restante pendente com alerta de cadastro incompleto e notificação até a correção.
- **Implementação:** migration `0007_product_catalog_status.sql` (`products.catalog_status`:
  `complete` | `incomplete`); recebimento aceita `newProduct { name, uomId? }` por item sem
  produto — cria o produto no mesmo lote atômico (`preStatements` novo em `stock.ts`), vincula ao
  item da solicitação, grava auditoria (`product.quick_register`) e notifica quem tem
  `catalog.manage`; alerta persistente no painel (`incompleteProductCount`) e banner/filtro no
  catálogo (`?tab=products&incomplete=true`); diálogo do produto marca **"cadastro completo"**.
- **Verificação:** teste de ponta a ponta em `tests/07-purchases.spec.ts` (recebimento → produto
  incompleto → alerta/notificação → conclusão zera o alerta); 109/109; local D1 migrado.
  **Smoke em runtime (17/10/2026):** fluxo completo executado contra o `wrangler dev` — criar
  solicitação com item sem produto → aprovar → pedido → receber com `newProduct` → produto
  `incomplete` + alerta no painel (0→1) → concluir cadastro → alerta volta a 0.
- **Arquivos:** `migrations/0007_product_catalog_status.sql`, `src/worker/stock.ts`,
  `src/worker/routes/purchases.ts`, `src/worker/routes/catalog.ts`,
  `src/worker/routes/dashboard.ts`, `src/client/pages/purchases.tsx`,
  `src/client/pages/catalog.tsx`, `src/client/pages/dashboard.tsx`.

## P-14 — Notificações levavam para rotas inexistentes (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** clicar numa notificação de chamado/OS navegava para `/tickets/:id` ou
  `/ordens-servico/:id` — caminhos que não existem no cliente (as rotas são `/chamados/:id` e
  `/ordens/:id`) — exibindo a tela "não encontrada".
- **Causa raiz:** o worker gravava o campo `link` com nomes de rota antigos; nenhuma verificação
  cruzava links de notificação com as rotas do `router.tsx` (o `check:api` cobre apenas chamadas
  `/api/*`).
- **Correção aplicada:** links corrigidos no worker (`routes/tickets.ts`, `routes/workorders.ts` —
  9 pontos) e nos dados já gravados (2 UPDATEs no D1 local). Encontrado na revisão UX/UI de
  17/10/2026.
- **Verificação:** `/api/notifications` só devolve links válidos (`/compras/...`,
  `/catalogo?tab=...`); pipeline completo verde (109/109).
- **Arquivos:** `src/worker/routes/tickets.ts`, `src/worker/routes/workorders.ts`.

## P-15 — Menu lateral desaparecia ao rolar tabelas longas (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma (vídeo do usuário, 17:27):** ao rolar páginas longas (estoque, catálogo, relatórios…), o
  menu lateral subia junto com o conteúdo e desaparecia; sobrava uma coluna branca vazia e o rodapé
  "CorpServices Group · America/Sao_Paulo" só aparecia no fim da página.
- **Causa raiz:** o shell (`layout.tsx`) usava rolagem de página (`min-h-full`); a `<aside>` rolava
  junto com o conteúdo — só o cabeçalho do topo era `sticky`.
- **Correção aplicada:** shell virou quadro fixo (`h-full overflow-hidden`); a rolagem passou para um
  contêiner interno do conteúdo (`flex-1 overflow-y-auto` com `min-h-0`); cabeçalho fixo
  (`shrink-0`, fundo sólido — também acabou o vazamento visual do conteúdo sob o topo translúcido);
  menu lateral e rodapé sempre visíveis (a navegação rola internamente se faltar altura); troca de
  rota volta a rolagem ao topo.
- **Verificação:** medições via Playwright (1600×900) — com o conteúdo rolado: `aside.top = 0`,
  `aside.bottom = 900`, rodapé visível, `window.scrollY = 0`; reset de rolagem ao navegar; mobile
  390×844 sem overflow horizontal; capturas `ux-shots/v3-01..06*.png`; pipeline verde (109/109).
- **Arquivos:** `src/client/app/layout.tsx`.

## P-16 — Polimentos do vídeo: setas de rolagem fantasma nas abas e datas sem rótulo na Auditoria (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** (a) em toda página com abas aparecia um mini scrollbar vertical com setas ▲▼ no canto
  direito da barra de abas (Estoque, Catálogo, Usuários, Relatórios); (b) os dois filtros de data da
  Auditoria exibiam só "mm/dd/yyyy", sem rótulo visível ("De"/"Até").
- **Causa raiz:** (a) o contêiner de abas (`overflow-x-auto`) transbordava 1px na vertical por causa
  de `-mb-px` nos botões (computed `overflow-y: auto` → barra fantasma); (b) inputs sem `Field`/label
  visível (apenas `aria-label`).
- **Correção aplicada:** `pb-px` no contêiner de abas (absorve o 1px; medido
  `scrollHeight == clientHeight == 38`); datas da Auditoria ganharam rótulos visíveis "De"/"Até"
  (`Field` + `htmlFor`), com a barra de filtros alinhada por baixo (`items-end`).
- **Verificação:** medições via Playwright + capturas `ux-shots/v3-01.png` e `ux-shots/v3-04.png`;
  pipeline verde (109/109).
- **Arquivos:** `src/client/lib/ui.tsx` (Tabs), `src/client/pages/audit.tsx`.
- **Nota:** o formato exibido no campo de data (`dd/mm/aaaa` × `mm/dd/yyyy`) segue o idioma do
  navegador do usuário (comportamento nativo de `<input type="date">`); os rótulos agora deixam a
  intenção clara em qualquer idioma.

## P-17 — `partial()` do zod v4 reaplicava defaults em PATCH e apagava campos não enviados (RESOLVIDO em 17/10/2026) — VALIDADO

- **Sintoma:** descoberto durante a Central de Suporte e confirmado com teste empírico (`zod@4`):
  em PATCH que usa `schema.partial()`, campos com `.default()` chegam preenchidos com o default
  mesmo quando o cliente não os enviou. Efeitos reais encontrados:
  (a) alternar uma categoria de chamado apagava `defaultKind`/`sortOrder` (só `{ isActive }` era
  enviado) e renomear uma categoria inativa a reativava; (b) PATCH de status do chamado rebaixava a
  prioridade para "normal"; (c) edição parcial de OS reaplicava `priority`/`requiresMaterial`.
- **Causa raiz:** no zod v4, `ZodOptional` em torno de `ZodDefault` **não** curto-circuita
  `undefined` — o default é reaplicado. Os handlers gravam tudo que veio definido
  (`body.x !== undefined`), então o default injetado virava gravação.
- **Correção aplicada:** schemas de atualização explícitos (sem `.partial()`) em
  `settings.ts` (categorias de ticket), `tickets.ts` e `workorders.ts`; a Central de Suporte já
  nasceu com schema de atualização próprio. Auditoria dos demais usos de `.partial()` (catálogo,
  estrutura, usuários/roles): schemas sem defaults — sem o mesmo defeito.
- **Verificação:** 3 testes de regressão novos (`05-tickets`: prioridade preservada ao mover status;
  `06-workorders`: edição só de notas preserva prioridade/data; `08-settings`: categoria alterna
  situação e renomeia inativa sem perder tipo padrão/ordem) + suite completa **118/118**.
- **Arquivos:** `src/worker/routes/settings.ts`, `src/worker/routes/tickets.ts`,
  `src/worker/routes/workorders.ts`, `tests/05-tickets.spec.ts`, `tests/06-workorders.spec.ts`,
  `tests/08-settings.spec.ts`.

## P-18 — Pílulas de status quebravam o texto em várias linhas (RESOLVIDO em 18/10/2026) — VALIDADO

- **Sintoma (uso real):** na tabela Movimentações (`/estoque?tab=movements`) as pílulas da coluna
  "Tipo" apareciam como ovais esticadas na vertical, com o rótulo quebrado em 2–3 linhas
  ("Entrada por recebimento de compra", "Consumo em manutenção", "Consumo operacional").
- **Causa raiz:** o componente único `Badge` (`src/client/lib/ui.tsx`) não tinha `whitespace-nowrap`
  nem largura por conteúdo — como `inline-flex` dentro de `<td>` sem largura mínima, o texto era
  quebrado para caber na coluna (e o padding era o mais apertado do produto, `px-2 py-0.5`).
- **Abrangência (auditoria pedida pelo usuário):** o defeito atingia **todas** as ocorrências de
  `Badge` no cliente — ~60 chamadas em 17 arquivos: `stock.tsx` (Tipo das movimentações),
  `tickets.tsx`, `workorders.tsx`, `purchases.tsx`, `inventory.tsx`, `consumption.tsx`,
  `reports.tsx`, `settings.tsx`, `catalog.tsx`, `users.tsx`, `structure.tsx`, `audit.tsx`,
  `support.tsx`, `support-public.tsx`, `profile.tsx`. Não existe outro renderizador de pílula
  (o contador de abas em `ui.tsx` é só numérico e já era `whitespace-nowrap`).
- **Correção aplicada (ponto único):** `Badge` passou a
  `inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full
  px-2.5 py-1 text-xs font-medium leading-4 ring-1 ring-inset`. Nenhuma estrutura, classe ou lógica
  das tabelas/componentes foi alterada — nenhuma chamada de `Badge` precisou mudar.
- **Verificação:** pipeline completa verde (**134/134** em 14 arquivos, typecheck worker+cliente,
  `eslint`, `check:api` 50×113, build); no navegador real (Playwright) a medição de pílulas em 14
  rotas deu **0 quebradas**, desktop 1440×900 e mobile 390×844, e `getComputedStyle` confirma
  `white-space: nowrap`, `padding: 4px 10px`, cantos totalmente arredondados,
  `align-items/justify-content: center`, `font-size: 12px` / `font-weight: 500`. Em telas estreitas
  a tabela rola na horizontal (comportamento já existente do `.table-scroll`).
- **Capturas:** `ux-shots/pill-mov-desktop.png`, `pill-mov-desktop-final.png`, `pill-mov-mobile.png`,
  `pill-estoque-desktop.png`.
- **Arquivos:** `src/client/lib/ui.tsx` (componente `Badge`).

## P-19 — Filtros de período com data do calendário escondiam o próprio dia (RESOLVIDO em 19/10/2026) — VALIDADO

- **Sintoma (encontrado na verificação do F-04):** com o filtro padrão dos relatórios ("De" 30 dias
  atrás, "Até" hoje), nada do dia de hoje aparecia — a solicitação `SC-2026-000004` e o recebimento
  `REC-2026-000004`, criados no mesmo dia, ficavam fora da lista e das somas.
- **Causa raiz:** os campos `<input type="date">` enviavam só a data (`2026-10-19`); o servidor
  comparava esse valor **como texto** com os instantes ISO gravados (`2026-10-19T04:24:00.000Z`).
  Como `"...T04:24..." > "2026-10-19"` na ordenação lexicográfica, qualquer registro do próprio dia
  "Até" era excluído — em todos os relatórios com intervalo (movimentações, consumo, chamados, OS,
  compras) e também nas listas de consumo e de movimentações de estoque. (A Auditoria já convertia
  com `fromLocalInput` e escapava do defeito.)
- **Correção aplicada (duas pontas):**
  - **Servidor:** `normalizeRangeBound(value, endOfDay)` em `src/worker/util.ts` — uma data do
    calendário vira o início/fim daquele dia **no fuso da aplicação** (`APP_TIMEZONE`), com duas
    passagens de offset para viradas de horário de verão; instante ISO completo passa como está.
    Usado em `reports.ts` (`parseRange`), `consumption.ts` (`periodFrom/To`) e `stock.ts`
    (`dateFrom/To` — este montava `T00:00:00.000Z`/`T23:59:59.999Z` na mão e quebraria com ISO).
  - **Cliente:** `toIsoDayBound(date, endOfDay)` e `dayRangeParams(from, to)` em
    `src/client/lib/format.ts` (conversão no fuso configurado, `activeTimeZone`) — aplicados nos
    5 relatórios com datas, no consumo e nas movimentações de estoque.
- **Verificação:** teste de regressão em `09-reports.spec.ts` (data do calendário passa a incluir o
  próprio dia) + verificação real no navegador: relatório de Compras passou a mostrar 2 solicitações,
  2 recebimentos e R$ 84.237,20 (antes: 1/1/R$ 84.190,00), filtro de situação 2/0/2, e o relatório
  de Movimentações mostra a entrada e a saída do uso direto de hoje. Pipeline **151/151**;
  `check:api` 50×119.
- **Arquivos:** `src/worker/util.ts`, `src/worker/routes/reports.ts`,
  `src/worker/routes/consumption.ts`, `src/worker/routes/stock.ts`, `src/client/lib/format.ts`,
  `src/client/pages/reports.tsx`, `src/client/pages/consumption.tsx`, `src/client/pages/stock.tsx`.

## P-20 — Auditoria de segurança e autorização (20/10/2026) — RESOLVIDO

- **Achados:** 12 falhas de autorização/escopo em usuários, relatórios, OS, chamados, compras,
  inventário, anexos, estoque, consumo, movimentação e local; todas corrigidas com revalidação no
  servidor e regressões em `tests/16-security.spec.ts` / `tests/17-authorization.spec.ts`.
- **Endurecimento:** SVG/HTML bloqueados, download forçado para não visuais, limites de JSON e
  anexos, segredos mascarados/redigidos, CSP/HSTS/COOP/frame-options/`no-store`, Origin guard e
  throttle do suporte público.
- **Verificação:** pipeline **162/162 em 17 arquivos**, `npm audit` 0, produção 0.1.2 com
  `/api/health` e cabeçalhos corretos; D1 de produção sem segredo histórico ou SVG armazenado.
- **Relatório:** `docs/SEGURANCA-AUDITORIA-2026-10-20.md`; decisão D-42.
- **Residual aceito:** R2 desligado (anexos do suporte em 503), sem domínio próprio/Access, sem WAF
  global, auditoria append-only por convenção e anexos sem antivírus.
