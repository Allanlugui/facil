# Changelog

Todas as alterações relevantes do Facil são registradas aqui. O projeto segue o
versionamento descrito em `docs/VERSIONAMENTO.md`.

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
