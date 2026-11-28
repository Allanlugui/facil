# Changelog

Todas as alterações relevantes do Facil são registradas aqui. O projeto segue o
versionamento descrito em `docs/VERSIONAMENTO.md`.

## [0.11.5] — 2026-11-28

**Símbolo puro no modo colapsado**

- Container da brand colapsada `32px` → `28px` (igual à altura do logo): o recorte mostra só o círculo "Corp", sem fiapo do texto "Services".
- Sem mudança de API/banco.

## [0.11.4] — 2026-11-28

**Nova coreografia da sidebar: fechar esconde tudo, ícones voltam em cascata**

- **Fechar**: tudo some junto (150ms) → barra recolhe (350ms) → ícones reaparecem em cascata de cima para baixo na barra já fechada (200ms cada, 60ms por posição), já clicáveis (link só arma junto com o próprio ícone).
- **Abrir**: inalterado — barra expande (350ms), depois palavras entram em cascata (250ms cada, 80ms por posição).
- **Ordem**: Configurações continua a numeração do menu principal (`--nav-order`) — entra por último nos dois sentidos (antes o `nth-child` a colocava primeiro).
- Sem mudança de API/banco.

## [0.11.3] — 2026-11-28

**Logo da sidebar sem distorção (proporção preservada)**

- **Causa**: `.brand-logo img` forçava `36×36` quadrado numa logo horizontal `1200×580` — esmagava a marca no modo expandido.
- **Expandido**: altura fixa `32px`, largura automática, `max-width 180px`, `object-contain` alinhado à esquerda — logo horizontal exibida por inteiro.
- **Colapsado**: container `32px` com `overflow hidden` mostra só o símbolo (círculo "Corp"), sem esticar; `28px` de altura.
- **Brand**: `Logo` usa `h-8 w-auto max-w-full object-left`; drawer mobile herda o modo expandido. Sem mudança de API/banco.

## [0.11.2] — 2026-11-28

**Ajuste fino da Brand colapsada: só logo, tamanho de ícone**

- **Brand no modo colapsado**: mantém **apenas o logotipo**, sem nome do sistema ("Facil") nem subtítulo ("Gestão de Facilities"). Logo reduzida ao tamanho dos ícones do menu (24px / `size-6`), centralizada na barra de 88px com padding simétrico. Sem espremer, deformar ou cortar (`object-contain`, `flex-shrink-0`, aspect-ratio preservado).
- **Modo expandido**: inalterado (logo 36px + "Facil" + "Gestão de Facilities").
- **Transição**: logo anima suavemente entre 36px ↔ 24px junto com a barra (350ms, mesma curva), sem alterar tempos/delays do fechar/abrir já aprovados.
- **Acessibilidade**: `alt`/`title` da logo mantidos; `prefers-reduced-motion` respeitado; mobile inalterado.

## [0.11.1] — 2026-11-28

**Sidebar colapsável: fechar espelha abrir + Brand/footer colapsados**

- **Fechamento da sidebar (desktop)**: espelha a abertura aprovada — **Fase 1**: labels somem em cascata reversa (último some primeiro) com fade + slide leve (250ms, gap 60ms), ícones **permanecem visíveis** o tempo todo; **Fase 2**: barra recolhe para 88px (350ms) só DEPOIS dos labels. Nav continua clicável no modo só-ícones (title nativo para tooltip). Sem `opacity: 0` brusco no nav inteiro, sem `display: none` seco nos labels.
- **Brand colapsada**: logo centralizado (h-9 w-9, `object-contain`, `flex-shrink-0`) sem deformação; textos (nome + subtítulo) somem com fade rápido; padding ajustado.
- **Cabeçalho da seção** ("Operação"/"Meu dia"): esconde com fade no colapsado.
- **Footer colapsado**: esconde company/timezone; mantém versão curta centralizada.
- **Velocidade**: fechar total ~1.4s (labels ~1s + barra 350ms), sutil e rápido — não demorado.
- **Abertura inalterada**: barra 350ms + labels cascata 250ms/80ms gap (~1.8s total).

## [0.11.0] — 2026-11-28

**Navegação consistente + sidebar colapsável desktop**

- **Botão "Voltar" universal** (`PageHeader.backTo` + `BackButton`): todas as rotas de detalhe (`:id`) e subseções (`/configuracoes/<secao>`, `/controle`, `/catalogo`, `/estrutura`, `/usuarios`, `/relatorios`, `/auditoria`, `/perfil`, `/ajuda/:id`, `/patrimonio/:id`, módulos LGPD) ganham botão de volta acessível (ícone `ArrowLeftIcon`, `aria-label`, fallback `history.back()` → `/`). Páginas-nível-topo do sidebar (`/`, `/estoque`, `/consumo`, `/inventario`, `/chamados`, `/ordens`, `/compras`, `/patrimonio`, `/ajuda`) não recebem Voltar (navegação via sidebar).
- **Sidebar desktop retrátil** (lg+): botão seta (`ChevronIcon`) colapsa/expande (256 px → 72 px, só ícones, labels com tooltip), motion 180–220 ms `ease-out-soft`, itens em cascata sutil (stagger ~30 ms, translate 6 px + fade), estado persistido em `localStorage.facil.sidebarCollapsed` (default expandido). Mobile drawer inalterado.
- **Motion reutilizado**: tokens `--motion-fast/base/slow`, `--ease-out-soft`, classes `facil-sidebar`, `facil-sidebar-nav`, `facil-sidebar-nav-item` — sem nova biblioteca, respeita `prefers-reduced-motion` (sem delay/stagger).
- **Acessibilidade**: foco visível, `aria-expanded`/`aria-label` no toggle, alvo ≥44 px, navegação por teclado funciona colapsado.
- **Nenhuma rota logada prende o usuário**: validação em 100% das rotas do router.tsx.

## [0.10.5] — 2026-11-28

Correção raiz de dialogs cortados no mobile (P-28): as animações usavam
`fill-mode: both`, que mantém `transform` no contêiner da rota e quebra todo
`position: fixed` dentro dele (diálogos abriam com o topo fora da tela). Troca
para `backwards` em todas as animações — visual idêntico, sem `transform`
retido. Sem mudança de API/banco.

## [0.10.4] — 2026-11-28

Painel de notificações responsivo (P-27): no mobile o dropdown da campainha
passa a ocupar a largura da tela (`fixed inset-x-3`) em vez de ancorar 352 px
à direita do ícone e sair pela borda esquerda; no desktop continua igual.
Sem mudança de API/banco.

## [0.10.3] — 2026-11-28

Cascata de entrada no conteúdo (D-67): cartões, stats, filtros e tabelas entram
um após o outro (8 px, 45 ms por item, teto no 8º) em todas as rotas do sistema
— mesmo gesto do login, mais discreto. Só CSS (`opacity` + `transform`), sem
biblioteca, sem mudança de API/banco. `prefers-reduced-motion` respeitado.

## [0.10.2] — 2026-11-28

Correção de responsividade mobile (P-26/D-66): 25 pontos em 9 arquivos sem
mudança de API/banco. Módulos LGPD empilham no mobile (`flex-col`/`grid-cols-1`,
tabs com scroll, footers com wrap), 4 tabelas de compras rolam dentro do diálogo
(`overflow-x-auto` + `min-w`), header do suporte e footers da estrutura ajustados,
`Pagination` empilha no mobile. `Dialog wide` mantido (já é bottom-sheet no mobile).

## [0.10.1] — 2026-11-28

Versão visível no produto (decisão D-65): o rodapé do login e o rodapé do
sistema mostram `· vX.Y.Z` lendo o `/build-info.json` público do build em
execução (hook `useAppVersion`, falha silenciosa). Sem mudança de banco.

## [0.10.0] — 2026-11-28

Motion de verdade no produto (decisão D-64): entrada animada da página de login
(cartão 420 ms + stagger de 70 ms por campo + logo com pop), transição curta
entre rotas (200 ms, só opacidade + subida) e `prefers-reduced-motion` sem
atrasos de stagger. Sem biblioteca nova: só CSS (`transform` + `opacity`).
Sem mudança de banco.

## [0.9.0] — 2026-10-24

Módulo **LGPD** completo (Lei 13.709/2018) para empresas de contabilidade:
registro próprio de bases legais, operações de tratamento, titulares de dados,
consentimentos, direitos do titular, encarregado (DPO), medidas de segurança e
incidentes. Seis migrations aditivas (`0024` a `0029`), nenhuma destrutiva;
sem tabelas existentes alteradas; não publicado ainda (pendente da decisão do
titular).

### Adicionado

- **LGPD — Base legal (Art. 7º)** (`src/worker/legal.ts`, `routes/legal.ts`,
  `client/pages/legal.tsx`): catálogo de bases legais (consentimento, contrato,
  obrigação legal, interesse legítimo etc.) e operações de tratamento vinculadas
  a exatamente uma base legal ativa, com finalidade, categorias de dados e
  titulares, prazo de guarda e controlador. Permissões `legal.view` /
  `legal.manage`. Migração `0024_legal_basis.sql`.
- **LGPD — Consentimento (Art. 8º)** (`src/worker/consents.ts`,
  `routes/consents.ts`, `client/pages/consents.tsx`): titulares de dados e
  consentimentos vinculados a uma operação e base legal 'Consentimento', com
  meio, versão do texto, cláusula destacada quando escrito, ônus da prova do
  controlador e revogação a qualquer momento (nunca apagado). Permissões
  `consent.view` / `consent.manage`. Migração `0025_consents.sql`.
- **LGPD — Encarregado (DPO) (Art. 41)** (`src/worker/dpo.ts`,
  `routes/dpo.ts`, `client/pages/dpo.tsx`): cadastro do encarregado com nome,
  contato, departamento, período de vigência e ativo/inativo; apenas um
  encarregado ativo por vez, desativação preserva o histórico. Permissões
  `dpo.view` / `dpo.manage`. Migração `0026_dpo.sql`.
- **LGPD — Direitos do titular (Arts. 18/19)** (`src/worker/data_subject_requests.ts`,
  `routes/dsr.ts`, `client/pages/data-subject-requests.tsx`): solicitações de
  acesso, correção, eliminação, portabilidade, revogação, informação e
  consequências, com prazo de 15 dias calculado automaticamente, status e
  resposta. Permissões `dsr.view` / `dsr.manage`. Migração
  `0027_data_subject_requests.sql`.
- **LGPD — Medidas de segurança (Arts. 46/49)** (`src/worker/security_measures.ts`,
  `routes/sec.ts`, `client/pages/security-measures.tsx`): inventário de medidas
  técnicas e administrativas com tipo, categoria, status de implementação,
  responsável, periodicidade de revisão e evidência; nunca apagadas, apenas
  desativadas com motivo. Permissões `sec.view` / `sec.manage`. Migração
  `0028_security_measures.sql`.
- **LGPD — Incidentes de segurança (Art. 48)** (`src/worker/security_incidents.ts`,
  `routes/incident.ts`, `client/pages/security-incidents.tsx`): registro de
  incidentes com os seis elementos da comunicação obrigatória (natureza dos
  dados afetados, titulares envolvidos, medidas de proteção, riscos, motivo da
  demora e medidas de reversão/mitigação), comunicação à ANPD e aos titulares,
  gravidade e status. Permissões `incident.view` / `incident.manage`. Migração
  `0029_security_incidents.sql`.
- **Rotas da API**: `/api/legal`, `/api/consent`, `/api/dpo`, `/api/dsr`,
  `/api/sec`, `/api/incident` com validação Zod e `requirePermission`; contrato
  de API confere 69 caminhos do cliente contra 178 rotas do worker
  (`check:api` OK).
- **Qualidade**: `npm run check` verde (typecheck, lint, `check:api`,
  69×178 rotas); `npm run build` verde; testes de unidade do D1 falham por erro
  pré-existing de FOREIGN KEY no setup de teste (não relacionado a estas
  migrations).

### Alterado

- `package.json`, `package-lock.json`: versão `0.8.0` → `0.9.0`.
- `src/shared/permissions.ts`: 12 novas permissões (`legal`, `consent`, `dpo`,
  `dsr`, `sec`, `incident` × view/manage); catálogo sobe para 60 permissões.
- `src/shared/types.ts`: novos tipos TypeScript para todas as entidades LGPD.
- `src/client/app/router.tsx`: novas rotas `/legal`, `/consent`, `/dpo`, `/dsr`,
  `/seguranca`, `/incidentes` com guarda de permissão.

## [0.8.0] — 2026-10-24

Módulo **Patrimônio** completo (a fundação com migration `0023` entrou na 0.7.1):
API `/api/assets`, telas `/patrimonio` e `/patrimonio/:id`, integração com a
Central de Controle e testes de integração. Ativos têm código sequencial
(`PAT-2026-000001`), etiqueta, categoria, local, responsável, aquisição, garantia,
fornecedor e dados técnicos; toda operação vira uma movimentação no histórico
com auditoria. Ativos **nunca são excluídos**: `baixado`/`descartado` são
terminais, exigem `assets.manage` e preservam o histórico. Categorias são criadas
e editadas em `/patrimonio`; a exclusão com prévia de impacto fica na aba
**Categorias de patrimônio** da Central de Controle (`asset_category`).

### Adicionado

- **API de patrimônio** (`src/worker/routes/assets.ts`): listagem com busca,
  filtros (categoria, situação, condição, criticidade, local, responsável),
  paginação e resumo; detalhe; criação/edição; opções para seletores; CRUD de
  categorias; transferência de local, atribuição de responsável, mudança de
  situação/condição, manutenção e conferência de inventário.
- **Escopo e permissões**: `assets.view`, `assets.manage` e `assets.move`, com
  restrição por local quando o usuário tem escopo; movimentações exigem
  `assets.move`, cadastro/edição e baixa exigem `assets.manage`.
- **Histórico auditável**: cada operação grava `asset_movements` e auditoria na
  mesma transação, com autor, motivo e resumo da mudança.
- **Interface** (`src/client/pages/assets.tsx`): lista com indicadores e
  filtros, detalhe com identificação, aquisição/garantia, histórico e anexos,
  formulário de ativo, diálogos de movimentação, gestão de categorias e card
  **Ações do ativo**.
- **Anexos de ativo**: entidade `asset` no módulo genérico
  `/api/attachments` (nota fiscal, termo, fotos e laudos).
- **Central de Controle**: entidade `asset_category` com prévia de impacto;
  categoria com ativos é arquivada, sem apagar o histórico.
- **Testes**: `tests/22-assets.spec.ts` (10 testes), total **204 testes em 24
  arquivos**.

### Corrigido

- Datas sem hora em movimentações são normalizadas para meio-dia UTC, evitando
  exibir o dia anterior no fuso do Brasil (UTC-3).
- Histórico e tabela de categorias ajustados para telas pequenas, sem rolagem
  horizontal nem ações cortadas no celular.

## [0.7.5] — 2026-10-23

Captcha como camada final (D-15): validação de Turnstile no login e na abertura
de chamados públicos (`/suporte`), desligado por padrão. O administrador ativa
em Configurações com `captcha.enabled` e as chaves `captcha.site_key` /
`captcha.secret_key`; sem elas, nada muda no fluxo atual.

### Adicionado

- **Validação de captcha no login** (`POST /api/auth/login`): quando habilitado,
  exige token válido antes de qualquer tentativa de autenticação; falha registra
  auditoria (`login_captcha_failed`).
- **Validação de captcha na abertura de chamado público** (`POST
  /api/support/requests`): quando habilitado e o solicitante não tem sessão,
  exige token válido; falha registra auditoria (`support.request.captcha_failed`).
- **Configurações**: `captcha.enabled` (boolean), `captcha.site_key` (string),
  `captcha.secret_key` (string secreta, não exposta na API).
- **Módulo de validação** (`src/worker/captcha.ts`): verifica o token junto ao
  provedor (Cloudflare Turnstile por padrão) com fallback seguro em caso de
  indisponibilidade.

### Configuração pendente (titular)

No painel de Configurações do sistema: `captcha.enabled = true`,
`captcha.site_key` (site key do Turnstile) e `captcha.secret_key` (secret key,
não exibida após gravada). Sem essas três, o captcha permanece desligado.

## [0.7.4] — 2026-10-23

Consumidor do `integration_outbox` (Fase 3 do plano de melhorias): um trigger
cron a cada 5 minutos processa os eventos pendentes (`pending`) e os envia para
o sistema de integração externo (ServiceNow/NetSuite/middleware), autenticado
por `TICKET_INTAKE_KEY` (secret do Worker). Endpoint `POST
/api/integrations/outbox/process` permite disparo manual pelo administrador.
Inclui idempotência (`idempotency_key`), marcação `processing` para evitar
execução duplicada, retry com backoff exponencial e `failed` após o limite de
tentativas. Como as chaves de integração ainda não foram informadas pelo
titular, o consumidor pula silenciosamente sem elas (não trava o Worker).

### Adicionado

- **Consumidor do outbox** (`src/worker/outbox-consumer.ts`, cron `*/5 * * * *`):
  lê eventos pendentes, envia com a chave de integração, confirma (`sent`) ou
  reagenda/falha (`failed`) com backoff.
- **Endpoint de disparo manual** (`POST /api/integrations/outbox/process`):
  admin pode forçar o processamento fora do ciclo do cron.
- **Testes:** `tests/16-outbox-consumer.spec.ts` (2 testes: sem chave pula sem
  processar; não altera o banco quando pula).

### Configuração pendente (titular)

Configurar no Cloudflare (Worker → Settings → Secrets/variáveis de ambiente):
`TICKET_INTAKE_KEY` (chave de autenticação do destino) e
`SERVICENOW_INSTANCE_URL` (URL base da instância). Sem elas, o outbox segue
gravando eventos mas ninguém os consome — mesmo comportamento de antes, sem
quebra.

## [0.7.3] — 2026-10-23

Anexos também em ordens de serviço (Fase 5 do plano de melhorias): a tela da OS
ganhou o card de anexos (upload/download/remoção) reutilizando o módulo genérico
`/api/attachments`, com controle de entidade, limite configurável
(`attachments.max_bytes`, padrão 20 MB), restrição de documentos
(`attachments.documents` para não-imagem) e auditoria de upload/remoção. Não
houve mudança de banco: a tabela `attachments` já suporta `entity_type =
work_order` desde o módulo original de anexos.

### Adicionado

- **Card de anexos na tela da OS:** upload de arquivo (imagem livre; documento
  exige `attachments.documents`), listagem, download e remoção com diálogo de
  confirmação, espelhando o card de chamados.
- **Testes:** `tests/15-workorder-attachments.spec.ts` (5 testes: upload de
  imagem e documento pelo gestor, imagem liberada/documento bloqueado para o
  técnico, remoção com auditoria, download exige permissão, gravação no D1).

## [0.7.2] — 2026-10-23

CI no GitHub Actions: cada push ou PR na `main` roda o pipeline completo de
qualidade antes de qualquer deploy manual.

### Adicionado

- **Workflow de CI (`.github/workflows/ci.yml`):** `npm ci`, `npm run check`
  (typecheck worker+cliente, ESLint, contrato de rotas da API e a suíte de
  testes com Miniflare) e `npm run build`, em Node 24 com cache de dependências,
  `permissions: contents: read` e limite de 20 minutos por execução. O deploy
  permanece manual (`npm run deploy`, com assinatura) — o CI é o gate de
  qualidade, não o publicador.

## [0.7.1] — 2026-10-23

Infraestrutura de anexos habilitada em produção e fundação do módulo de
Patrimônio. Única mudança visível para o usuário final: anexos do chat de
suporte deixam de responder 503 e passam a gravar/ler do R2.

### Adicionado

- **R2 em produção:** bucket `facil-attachments` criado e binding `ATTACHMENTS`
  habilitado no `wrangler.jsonc` (tipos regenerados com `npm run types`).
  Verificado ponta a ponta na URL publicada: criação do pedido de suporte,
  upload de anexo, listagem e download com conteúdo íntegro.
- **Fundação do Patrimônio (migration 0023):** categorias de patrimônio com 9
  padrões, tabela `assets`, histórico `asset_movements` e permissões
  `assets.view`/`assets.manage`/`assets.move` (admin e gerente de facilities),
  exibidas no catálogo de permissões. Constantes compartilhadas em
  `src/shared/assets.ts`. Rotas e interface do módulo ficam para release
  futura; nenhum código referencia as tabelas ainda.

### Corrigido

- Contagem de permissões do admin no teste de autenticação atualizada de 53
  para 56, acompanhando o catálogo com o grupo Patrimônio.

## [0.7.0] — 2026-10-22

Controle do sistema com exclusão segura e devolução da compra para ajuste do
solicitante. Administradores ganham uma tela única para excluir cadastros com
prévia de impacto; o histórico nunca é apagado. O gestor de Compras pode
devolver a solicitação ao solicitante, que corrige os dados e reenvia para a
mesma fila de aprovação.

### Adicionado

- **Controle do sistema (`/controle`):** tela administrativa com abas para
  locais, unidades, tipos de local, setores, categorias de produto, unidades de
  medida, fornecedores, produtos, centros de custo, formas de pagamento,
  categorias de chamado e usuários. Busca, filtro de excluídos e prévia de
  impacto antes de confirmar.
- **Exclusão segura:** o servidor recalcula o impacto e decide entre exclusão
  física (sem referências) e arquivamento (`deleted_at`/`deleted_by`) quando há
  histórico. Registros arquivados saem das listas e seletores, mas chamados, OS,
  compras e movimentações continuam exibindo o nome original com `(excluído)`.
- **Bloqueios e avisos:** saldo de estoque e registros filhos ativos impedem a
  exclusão; cada ação grava auditoria, motivo opcional e notifica os demais
  administradores ativos.
- **Múltiplos administradores:** o perfil Administrador do sistema pode ser
  atribuído pela tela de usuários; o sistema impede remover/rebaixar o último
  administrador e impede a autoexclusão.
- **Devolução para ajuste:** o gestor de Compras devolve a solicitação ao
  solicitante com motivo (mínimo 5 caracteres). A solicitação sai das filas, o
  solicitante vê o aviso, corrige cabeçalho/itens e reenvia; ela volta direto à
  fila do gestor, sem repetir a triagem.
- **Fila “Devolvidas para ajuste”** no painel e na tela de compras, com filtro
  `stage=returned` na API.
- **Ajuste do solicitante:** diálogo para editar local, data, prioridade,
  justificativa, observações e itens (produto, quantidade e unidade), com
  `PUT /api/purchases/:id/items` restrito a rascunho ou devolvida.
- **Migration 0022:** colunas de devolução e de arquivamento nos cadastros
  mestres, com índices para listas e impacto.

### Alterado

- Listas de estrutura, catálogo, usuários e setores ignoram registros
  arquivados; o histórico resolve o nome original e sinaliza a exclusão.
- Itens de compra sem `uom_id` explícito herdam a unidade do produto, inclusive
  no ajuste pós-devolução.
- O diálogo de decisão do gestor ganhou a opção **Devolver ao solicitante para
  ajuste**; o envio simples fica oculto enquanto a solicitação está devolvida.
- Contadores de fila excluem devolvidas; o painel do gestor mostra apenas o que
  realmente aguarda decisão.

### Corrigido

- Cabeçalho da solicitação devolvida agora exibe o selo **Devolvida ao
  solicitante** em vez de “Pendente de aprovação”, e a “Próxima etapa” não
  aponta para o gestor enquanto o solicitante precisa agir.
- Rótulos e acentuação do controle do sistema; contagem de referências exibida
  sem concordância incorreta (“1 chamados”).
- Botão de arquivamento usa a ação primária; vermelho fica reservado à exclusão
  definitiva.

### Testes

- `tests/21-control.spec.ts`: 7 cenários cobrindo múltiplos administradores e
  proteção do último admin, exclusão física versus arquivamento, preservação do
  histórico com `locationDeleted`, bloqueio por estoque, notificação aos
  administradores, devolução → ajuste → reenvio → fila do gestor, motivo
  obrigatório, filtro `stage=returned` e unidade resolvida no item.
- Suíte completa: **187 testes em 21 arquivos**.

## [0.6.0] — 2026-10-21

Fluxo de compras v3 completo: triagem do comprador, aprovação/refinamento do
gestor de Compras, execução pelo comprador e recebimento com normalização de
itens fora do catálogo.

### Adicionado

- **Triagem de Compras:** nova etapa entre o envio do solicitante e a aprovação
  do gestor de Compras. O comprador/analista ajusta nome, descrição, quantidade
  e unidade, vincula itens fora do catálogo a um produto existente, cadastra um
  produto novo ou remove itens. A solicitação só segue com ao menos um item.
- **Aprovação e refinamento do gestor de Compras:** o gestor revisa a
  necessidade, edita itens e quantidades, define o destino de cada item
  (cotação/compra direta), a forma de pagamento, o centro de custo e a conta
  contábil antes de liberar o comprador.
- **Solicitar alinhamento:** o gestor pode devolver a solicitação ao solicitante
  com uma observação (mínimo 5 caracteres) sem sair da etapa `purchasing`. A
  ação notifica solicitante e responsável pela triagem, registra auditoria,
  outbox e evento na linha do tempo, e a solicitação continua na fila de
  aprovação.
- **Normalização no recebimento:** itens de texto livre podem ser vinculados a
  um produto existente ou cadastrados na hora, com unidade de medida. O vínculo
  (`product_id` + `uom_id`) é permanente no item da solicitação e o recebimento
  gera movimentação de estoque para o produto normalizado.
- **Migration 0021:** colunas de triagem (`triage_completed_at`,
  `triage_completed_by`) e índice da fila; solicitações em voo no estágio
  `manager` são encaminhadas para a triagem.

### Alterado

- **Ordem do fluxo v3:** `submit → triage → purchasing → buyer → receipt`. A
  aprovação do gestor do setor e a etapa de direção deixam de existir no v3;
  solicitações v1/v2 continuam no fluxo anterior.
- **Modo de compra por item:** ao escolher cotação, orçamento ou compra direta,
  o destino dos itens acompanha a escolha; o gestor ainda pode ajustar item a
  item depois. Aprovações novas ficam consistentes entre o modo da solicitação
  e o dos itens.
- **Formulário do solicitante:** quantidade aceita vírgula decimal; itens
  manuais sem produto recebem o selo "Fora do catálogo"; o envio mostra a
  mensagem "enviada para Compras".
- **Detalhe da solicitação:** cabeçalho com badges de status, setor, etapa,
  prioridade, modo e pagamento; tabela densa em largura total, sem rolagem
  horizontal; ficha e linha do tempo preservadas.

### Corrigido

- `PageHeader` não envolve mais conteúdo rico em `<p>`, eliminando o aviso de
  hidratação `<div> cannot be a descendant of <p>` no detalhe de compras.
- Datas puras continuam formatadas em UTC; a data desejada não recua um dia.
- Edição de itens no recebimento não perde o produto/unidade selecionados ao
  alternar entre produto existente e cadastro novo.

### Validação

- `npm run check` verde: **180/180 testes em 20 arquivos**, typecheck, lint e
  contrato de API (53 caminhos do cliente × 135 rotas do worker).
- `npm run build` verde.
- Verificação Playwright ponta a ponta: criação com entrada em lote e itens
  fora do catálogo, triagem, pedido de alinhamento, aprovação com compra direta,
  pedido por fornecedor e recebimento com vínculo a produto existente e cadastro
  rápido com unidade, incluindo conferência de estoque e linha do tempo.

## [0.5.0] — 2026-10-21

Usabilidade de Compras: formulário do solicitante simplificado, entrada de itens
em lote e detalhe da solicitação sem rolagem horizontal.

### Adicionado

- **Entrada de itens em lote:** cole a lista completa, clique em "Processar lista"
  e revise quantidade/unidade em uma tabela editável antes de confirmar.
- **Vínculo automático com o catálogo:** cada linha é associada ao produto por
  nome, palavras-chave ou SKU; itens sem correspondência viram texto livre com o
  selo "Fora do catálogo" e seguem no fluxo normalmente.
- **Seleção de produto por linha:** o `ProductPicker` permite trocar ou limpar o
  produto associado sem perder a descrição da linha.

### Alterado

- **Formulário do solicitante (v3):** mostra apenas Local de destino, Data
  desejada, Prioridade, Justificativa (obrigatória), Observações e itens. Setor,
  forma de pagamento, modo de compra, centro de custo, conta contábil e
  observação de orçamento saem da criação — o setor vem do login e os demais
  campos são definidos por Compras na autorização.
- **Criação v3:** `purchaseMode` e `paymentMethodId` ficam nulos até a
  autorização do responsável de Compras; campos administrativos enviados por
  engano são ignorados nesse fluxo, preservando v1/v2.
- **Detalhe da solicitação:** cabeçalho com identificador, solicitante e data,
  seguido de badges de status, setor, etapa e prioridade; justificativa em
  destaque na faixa "Próxima etapa", acima dos itens. Grade lateral apenas a
  partir de `2xl`, colunas `min-w-0` e tabela densa para eliminar a rolagem
  lateral entre 1280 e 1536.
- **Justificativa** passou a usar área de texto e continua obrigatória no envio
  (rascunho pode ser salvo sem ela).

### Corrigido

- Datas puras (`YYYY-MM-DD`), como a data desejada, eram formatadas no fuso local
  e podiam recuar um dia; agora usam UTC na exibição.
- Itens de texto livre duplicavam o campo de descrição no formulário.

### Validação

- `npm run check` verde: **175/175 testes em 20 arquivos**, typecheck, lint e
  contrato de API (53 caminhos do cliente × 135 rotas do worker).
- Verificação visual em 1440×900 e 390×844: formulário simplificado, entrada em
  lote com itens de catálogo e texto livre, detalhe sem rolagem horizontal e
  fluxo ponta a ponta de criação/envio.

## [0.4.0] — 2026-10-21

Compras por setor (v3) com autorização de Compras e chat de suporte em tempo real.

### Adicionado

- **Compras v3 por setor:** o gestor do setor cria e envia; o responsável de
  Compras autoriza antes de qualquer cotação; o comprador monta, envia para
  aprovação e acompanha o pedido; o estoque confere e lança a nota fiscal.
- **Setores e gestores:** `departments` e `department_managers` permitem que um
  gestor responda por vários setores. A visibilidade é por setor, e a equipe de
  Compras vê a fila inteira.
- **Formas de pagamento:** `payment_methods` com `requires_authorization` e
  `requires_quote`; a forma bloqueia compra direta quando exige cotação.
- **Cotação e orçamento:** cotação exige pelo menos 2 propostas; orçamento
  aceita fornecedor único em fluxo separado. A aprovação da cotação v3 cria a
  adjudicação dos itens e envia ao comprador.
- **Compra direta v3:** o responsável de Compras autoriza sem cotação e envia
  direto ao comprador, respeitando a forma de pagamento.
- **Recebimento com nota fiscal:** número, série, data, total e local de entrega;
  o lançamento atualiza solicitação, pedido e itens.
- **Chat de suporte em tempo real:** Durable Object `SupportRoom` com
  WebSocket, indicador de digitação, presença e fallback de polling de 60s nas
  páginas de suporte interno e acompanhamento público (`/ajuda/:id` e
  `/suporte/acompanhar/:token`). As mensagens continuam persistidas no D1.
- **Próxima etapa explícita:** o detalhe da solicitação mostra a etapa, o
  responsável e a ação esperada.
- Permissões novas: `purchases.approve_department` (gestor/admin) e
  `purchases.receive` para o perfil de estoque.

### Alterado

- O fluxo v3 é o padrão; v1 e v2 continuam disponíveis por
  `workflow_version` + `flow_revision`.
- E-mails e notificações internas são gravados em `email_outbox` na mesma
  transação D1 e entregues após o commit.
- A ficha da solicitação v3 mostra “Aprovação de Compras” em vez do status
  corrente, evitando confundir a última decisão com o pedido.

### Validação

- `npm run check`: typecheck, lint, contrato de API e **175/175 testes** em 20
  arquivos (incluindo o fluxo v3 completo com gestor multi-setor e estoque, e o
  broadcast de mensagem/digitação do WebSocket).
- `npm run build` e `npm run verify` antes da publicação.
- Verificação visual no navegador do fluxo completo: gestor → Compras →
  2 propostas → aprovação → pedido → recebimento com nota fiscal.

## [0.3.0] — 2026-10-20

Solicitação de itens que ainda não existem no catálogo, sem bloquear a compra.

### Adicionado

- Alternativa **Item fora do catálogo** no formulário de nova solicitação, com
  descrição obrigatória, quantidade e unidade.
- Aviso explícito de que o item será cadastrado durante o processo de compra ou
  no recebimento.
- A busca de produto sem resultado oferece **Solicitar este item fora do
  catálogo**, aproveitando o texto digitado.
- Teste do fluxo v2 para solicitação apenas com descrição.

### Alterado

- Itens sem `product_id` seguem cotação, adjudicação e pedido usando a descrição
  informada; o recebimento cria o produto e o vincula ao item.

### Validação

- `npm run check`: typecheck, lint, contrato de API e **169/169 testes** em 18
  arquivos.
- `npm run build` e `npm run verify` antes da publicação.

## [0.2.0] — 2026-10-20

Fluxo corporativo de compras, preparação de ERP/chamados e identidade visual da
CorpServices Group.

### Adicionado

- Fluxo de compras **v2**: solicitante → gestor do setor → direção (necessidade
  e orçamento) → compras → comprador → recebimento.
- Caminho alternativo de envio direto do gestor para a triagem de compras.
- A triagem de compras pode devolver a solicitação à direção ou autorizar a
  compra direta.
- Autorização de **compra direta** sem cotação pelo gestor de compras.
- Centro de custo, conta contábil, observações de orçamento e situação
  financeira na solicitação.
- Adjudicação **item a item**, com fornecedores diferentes na mesma solicitação.
- Pedidos por fornecedor (`purchase_orders` / `purchase_order_items`) com total
  em centavos, centro de custo e conta contábil.
- Recebimento vinculado ao pedido, com atualização de saldo, status do pedido e
  conclusão automática da solicitação.
- Novos perfis `operations_director` (Diretor de Operações) e
  `purchasing_manager` (Gestor de Compras).
- Novas permissões: `purchases.view_all`, `purchases.authorize`,
  `purchases.award` e `purchases.direct`.
- Painel “Sua fila de compras” por permissão e atualização de permissões da
  sessão ao recuperar foco e a cada 60 segundos.
- Outbox transacional e idempotente (`integration_outbox`) para NetSuite,
  ServiceNow e integradores futuros.
- Interface administrativa do outbox (`/api/integrations/outbox` e ack).
- Intake externo de chamados (`/api/intake/tickets`) com chave de serviço,
  idempotência por `source + externalRef`, limite por IP e evento de outbox.
- Documentação `docs/COMPRAS.md`, `docs/INTEGRACOES.md` e README de handoff.
- Identidade visual CorpServices Group: logos, favicon, capa da home e papel de
  parede do login com as mídias fornecidas.

### Alterado

- Solicitações novas usam `workflowVersion: 2` por padrão; o fluxo v1 continua
  disponível com `workflowVersion: 1`.
- O perfil `manager` deixou de ter `purchases.order` e `purchases.receive`:
  aprovação de necessidade não se confunde com execução da compra.
- O catálogo de permissões passou de 48 para **52**.
- A instalação inicial ignora o usuário técnico `user_intake`, que não é conta
  de login e pode existir antes do primeiro administrador.
- A limpeza do banco de testes preserva a ordem das chaves estrangeiras das
  novas tabelas de compras e integrações.
- Cobertura de testes passou a incluir o fluxo v2 e o intake externo.

### Corrigido

- A autorização de compra direta agora força todos os itens ativos para
  `purchase_mode = 'direct'`, evitando item em cotação sem cotação.
- Decisões de gestor e direção sem detalhamento de item usam **cotação** como
  destino padrão; compra direta passa a ser uma escolha explícita.
- O pedido usa o preço da proposta adjudicada e recusa preço divergente.
- O centro de custo e a conta contábil da solicitação agora são gravados também
  no pedido, como o outbox e a exportação ao ERP esperam.
- O envio do gestor para a direção restaura o roteamento padrão.
- O intake trata chamadas concorrentes com o mesmo `externalRef` como duplicata,
  em vez de erro 500.
- Testes legados de relatórios e compras declaram explicitamente o fluxo v1.
- O reset de testes remove pedidos, recebimentos, adjudicações, outbox e eventos
  de intake na ordem correta.

### Validação

- `npm run check`: typecheck, lint, contrato de API e **168/168 testes** em
  **18 arquivos**.
- Migration `0019_purchase_workflow.sql` aplicada no D1 local e no D1 remoto
  `facil-db` (4 centros de custo, 52 permissões, 2 perfis novos).
- Backup lógico do D1 remoto gerado antes da migration.
- `npm run build` e release assinada com Ed25519.

### Limitações conhecidas

- R2 desativado: anexos do chat de suporte retornam `503 R2_UNAVAILABLE`.
- Sem domínio próprio e sem Cloudflare Access; URL `*.workers.dev`.
- `TICKET_INTAKE_KEY` não configurada em produção: intake retorna
  `503 INTAKE_DISABLED` até o segredo ser criado.
- Outbox sem consumidor automático; a confirmação é administrativa.
- Sem integração NetSuite homologada e sem mapeamento fiscal.
- Sem CI: o deploy oficial é `npm run deploy` (assina, valida, compila e publica).

## [0.1.2] — 2026-10-20

### Corrigido

- Rodapé do login passa a usar o nome configurado da empresa, em vez de um
  texto fixo. Com a configuração atual, exibe **CorpServices Group**.
- Metadados de autoria e documentação alinhados ao nome **CorpServices Group**.

## [0.1.1] — 2026-10-20

Auditoria completa de bugs, falhas e vulnerabilidades.

### Segurança

- Escopo de local aplicado de forma consistente em chamados, ordens de serviço,
  compras, inventário, consumo, movimentações, estrutura e relatórios.
- Gestores não podem mais remover o próprio escopo, alterar administradores ou
  conceder autoridade superior à sua.
- Anexos passam a validar a entidade de origem, e não apenas a permissão do
  módulo: conhecer o UUID de um chamado/OS alheio não permite listar ou baixar
  arquivos.
- Ações de chamado (`assign`, `resolve`, `cancel`, `convert`, materiais) e de
  ordem de serviço (edição, status, reatribuição, checklist, materiais,
  conclusão) revalidam visibilidade, escopo e responsável.
- Alteração de situação de chamado via `PATCH` exige a permissão do fluxo
  (`tickets.resolve`/`tickets.cancel`), não apenas leitura ampla.
- Conclusão de OS não pode mais ser feita pelo atalho genérico de status; usa a
  ação de conclusão com resultado e checklist. Cancelamento exige
  `workorders.cancel`.
- Uploads SVG/HTML bloqueados; anexos não visuais forçados a download;
  `Content-Type` normalizado; limites de tamanho no JSON, multipart e anexos.
- Credenciais de configuração mascaradas nas respostas e redigidas na auditoria;
  a interface usa ação explícita "Limpar credencial".
- Cabeçalhos de segurança e CSP no Worker e nos arquivos estáticos
  (`_headers`), HSTS, proteção contra enquadramento, `no-store` na API e
  verificação de mesma origem para escritas.
- Limite de senha no login e limitação de pedidos públicos de suporte
  (10 por hora por IP).

### Corrigido

- Escopo de local em relatórios, detalhes de compra, inventário, consumo,
  movimentação e local.
- Exibição de estoque por local no catálogo respeita o escopo do usuário.
- Transições de status da OS no cliente não oferecem mais `done` nem
  cancelamento sem permissão.
- Ajustes de testes de segurança, anexos e configurações.

### Validação

- `npm run check`: typecheck, lint, verificação de caminhos da API e
  **162/162 testes** em 17 arquivos.
- Auditoria de autorização com 12 achados corrigidos; relatório em
  `docs/SEGURANCA-AUDITORIA-2026-10-20.md`.
- Verificação de dados históricos no D1 de produção: nenhuma linha de
  `settings.update`, nenhum anexo armazenado e chaves de segredo vazias.
- `npm audit`: 0 vulnerabilidades.

### Limitações conhecidas

- R2 desativado: anexos do chat de suporte retornam `503 R2_UNAVAILABLE`.
- Sem domínio próprio e sem Cloudflare Access; URL `*.workers.dev`.
- Sem CI: o deploy oficial é `npm run deploy` (assina, valida, compila e
  publica).
- Proteção de força bruta é localizada (login e suporte público), não um WAF
  global.
