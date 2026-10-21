# Changelog

Todas as alterações relevantes do Facil são registradas aqui. O projeto segue o
versionamento descrito em `docs/VERSIONAMENTO.md`.

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
