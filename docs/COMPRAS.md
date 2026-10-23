# Fluxo corporativo de compras (v3)

Este documento descreve o fluxo de compras **v3** (por setor), introduzido na
versão **0.4.0**, refinado na **0.6.0** com triagem, aprovação/refinamento do
gestor de Compras e normalização de itens no recebimento, e na **0.7.0** com a
devolução da solicitação ao solicitante para ajuste e reenvio. Mantém o
detalhamento dos fluxos v2 (0.2.0/0.3.0) e v1 (legado), que continuam disponíveis
para solicitações antigas e para integrações que declarem `workflowVersion: 1`
ou `2`.

## Fluxo v3 — por setor

O v3 é o padrão para solicitações novas. Na criação, o solicitante informa
apenas **local de destino**, **data desejada**, **prioridade**, **justificativa**
e **itens**; o setor vem do login e o **modo** (`quote`, `budget` ou `direct`) e a
**forma de pagamento** são definidos pelo responsável de Compras na autorização.

```text
Solicitante
  └─ cria e envia
       └─ Triagem de Compras (comprador/analista)
            ├─ ajusta itens, cadastra ou vincula produtos fora do catálogo
            ├─ recusa → encerra
            └─ encaminha ao gestor de Compras
                 └─ Aprovação/refinamento do gestor de Compras
                      ├─ devolve ao solicitante → ajusta e reenvia → volta ao gestor
                      ├─ solicita alinhamento → solicitante responde, etapa continua
                      ├─ recusa → encerra
                      └─ autoriza (cotação, orçamento ou compra direta)
                           ├─ cotação/orçamento → comprador registra propostas
                           │    → gestor de Compras aprova → adjudica por item
                           └─ compra direta → segue direto ao comprador
                                └─ Comprador emite pedido por fornecedor
                                     └─ Estoque confere, lança a NF e normaliza itens
```

### Triagem de Compras

A primeira etapa depois do envio é a **triagem**, feita por quem tem
`purchases.order` ou `purchases.authorize`. O solicitante não pode triar a
própria solicitação. O triador pode:

- corrigir nome, descrição, quantidade e unidade dos itens;
- vincular um item fora do catálogo a um produto existente pelo `ProductPicker`;
- cadastrar um produto novo (o cadastro nasce `catalog_status = incomplete`);
- remover itens, desde que reste ao menos um;
- encaminhar ao gestor de Compras (`forward`) ou recusar (`rejected`).

No banco, a triagem é representada por `approval_stage = 'purchasing'` com
`triage_completed_at IS NULL`; a API deriva `approvalStage: "triage"` para o
cliente. O encaminhamento grava `triage_completed_at` e
`triage_completed_by`.

### Aprovação e refinamento do gestor de Compras

O gestor ou diretor de Compras revisa a necessidade e pode:

- editar itens, quantidades, unidades e observações;
- definir o destino de cada item (cotação ou compra direta);
- escolher o modo da solicitação (cotação, orçamento ou compra direta);
- informar forma de pagamento, condições, centro de custo e conta contábil (GL);
- **solicitar alinhamento** ao solicitante, com observação de pelo menos 5
  caracteres, sem sair da etapa e sem perder a fila de aprovação;
- **devolver ao solicitante para ajuste** (ver abaixo);
- autorizar a compra ou recusar.

#### Devolução para ajuste

A devolução para ajuste é diferente de “solicitar alinhamento”: ela tira a
solicitação da fila do gestor até o solicitante agir. O gestor escolhe
`return_to_requester` e informa um motivo (mínimo 5 caracteres). No banco:

- `purchase_requests.status` continua `pending_approval` (o CHECK existente não
  muda) e `approval_stage` continua `purchasing`;
- `returned_at`, `returned_by` e `returned_reason` são preenchidos;
- a API deriva `returned: true` e `displayStatus: "returned"`;
- a solicitação sai das filas `triage`/`purchasing` e entra em
  `queues.returned` (`stage=returned`).

O solicitante vê o aviso na tela e no painel, abre **Ajustar e reenviar** e pode
alterar local, data desejada, prioridade, justificativa, observações e itens
(produto, quantidade e unidade). O ajuste usa `PUT /api/purchases/:id/items`,
permitido apenas em rascunho ou devolvida, e depois `PATCH /:id` para o
cabeçalho. Ao reenviar (`POST /:id/submit`), os campos `returned_*` são limpos e,
como a triagem já foi concluída (`triage_completed_at` preenchido), a solicitação
volta **direto para a fila do gestor de Compras** — sem repetir a triagem.

```text
Etapa derivada    Status típico                          Quem age                 Ação
triage            pending_approval                       comprador/analista       forward, rejected
purchasing        pending_approval                       gestor/diretor Compras   approved, request_alignment, return_to_requester, rejected
returned          pending_approval (returned_at != null) solicitante              ajustar itens/cabeçalho e reenviar
buyer             approved/quoting/quote_returned/...    comprador                cotação, pedido
receipt           ordered/partially_received             estoque/comprador        recebimento + NF
completed         received/rejected/cancelled            —                        fim
```

Ao trocar o modo da solicitação, o destino dos itens acompanha a escolha
(cotação/orçamento → `quote`; compra direta → `direct`); o gestor ainda pode
ajustar item a item depois. A autorização preserva modos já definidos por item
(`COALESCE(purchase_mode, ...)`).


### Solicitação simplificada e entrada em lote

- O formulário do solicitante mostra somente Local de destino, Data desejada,
  Prioridade, Justificativa (obrigatória para enviar), Observações e itens.
- A **entrada em lote** aceita uma lista colada (uma linha por item) no formato
  `quantidade descrição unidade`; o processamento extrai quantidade e unidade,
  associa ao catálogo por nome/palavras-chave/SKU e abre uma tabela editável
  antes de confirmar.
- Itens sem correspondência no catálogo entram como **texto livre**, recebem o
  selo "Fora do catálogo" e **não bloqueiam** o envio; o cadastro pode ser feito
  durante o processo de compra ou no recebimento.

### Setores, gestores e visibilidade

- `departments` marca o setor de Compras com `is_purchasing`.
- `department_managers` permite que **um gestor responda por vários setores**.
- `users.department_id` vincula o usuário ao setor.
- O gestor só decide em solicitações dos setores que gerencia.
- A equipe do setor de Compras vê a fila inteira.
- Quem tem `purchases.view_all` (direção, administração e perfis operacionais)
  também vê tudo.

### Formas de pagamento

`payment_methods` define `requires_authorization` e `requires_quote`:

- `requires_quote = 1` **bloqueia compra direta** e exige propostas;
- `requires_authorization = 1` obriga autorização do responsável de Compras
  antes de o comprador avançar;
- a regra vale para cotação e orçamento.

### Autorização e aprovação de Compras

- Na autorização, o responsável de Compras confirma o modo (cotação, orçamento
  ou compra direta) e a forma de pagamento.
- A cotação exige **pelo menos 2 propostas registradas**; o orçamento aceita 1.
- A aprovação da proposta cria automaticamente a **adjudicação de todos os
  itens** e envia a solicitação ao comprador.
- A ação `request_alignment` registra a observação, mantém a solicitação em
  `pending_approval`/`purchasing`, notifica solicitante e responsável pela
  triagem e grava auditoria, outbox e evento na linha do tempo.
- Quem não tem a permissão recebe erro nomeado: “Você não tem permissão para
  realizar esta ação. Solicite a [nome], responsável por [ação].”
- No v3 atual não existe aprovação separada do gestor do setor nem etapa de
  direção: o solicitante envia direto para a triagem e a aprovação é feita pelo
  gestor de Compras. As etapas antigas permanecem para solicitações v1/v2.


### Recebimento com nota fiscal

`POST /api/purchases/:id/receipts` (v3) exige número e data da nota fiscal e o
local de entrega; série e total são opcionais. O lançamento atualiza a
solicitação, o pedido e as linhas do pedido, gera a movimentação de estoque e
conclui a solicitação quando tudo foi recebido.

Itens que ainda estão como texto livre podem ser **normalizados no recebimento**:

- vincular a um produto existente (`productId`), herdando a unidade do produto;
- cadastrar um produto novo (`newProduct.name` + `uomId` opcional), que nasce
  com `catalog_status = incomplete`;
- o vínculo é gravado permanentemente em
  `purchase_request_items.product_id` e `uom_id`, e o recebimento passa a
  movimentar o produto normalizado.

```json
{
  "locationId": "loc-almoxarifado",
  "invoiceNumber": "NF-9001",
  "invoiceDate": "2026-10-21",
  "items": [
    {
      "requestItemId": "item-cabo",
      "receivedQty": 2,
      "unitPrice": 12.5,
      "productId": "produto-existente"
    },
    {
      "requestItemId": "item-caixa",
      "receivedQty": 4,
      "unitPrice": 3.2,
      "newProduct": { "name": "Caixa de papelão 30x30", "uomId": "uom_un" }
    }
  ]
}
```


## Princípios

1. **Nada do fluxo antigo foi removido.** Solicitações existentes permanecem
   na versão 1 e continuam usando aprovação única, cotação e pedido legado.
2. **Solicitações novas nascem na versão 3**, salvo quando o cliente declara
   explicitamente `workflowVersion: 1` ou `2`. A versão é registrada em
   `workflow_version` + `flow_revision`.
3. **Separação de funções.** Quem solicita não aprova; quem aprova a necessidade
   não adjudica; quem adjudica não recebe; o recebimento é uma confirmação
   física e financeira.
4. **Rastreabilidade.** Cada decisão grava auditoria, notificação e evento no
   outbox de integração na mesma transação da operação.
5. **Valores em centavos.** Preços e totais usam inteiros (`*_cents`), evitando
   arredondamento de ponto flutuante.

## Itens fora do catálogo

Nem todo item comprado já existe no catálogo. O formulário de nova solicitação
oferece duas formas de identificar o item:

- **Produto do catálogo:** busca por nome ou SKU, com unidade e vínculo ao
  produto existente;
- **Item fora do catálogo:** o solicitante descreve o produto, informa quantidade
  e unidade. A interface avisa que o item será cadastrado durante o processo ou
  no recebimento, e a solicitação segue normalmente.

No banco, o item aceita `product_id = NULL` desde que tenha `description`
preenchida. A descrição acompanha cotação, adjudicação e pedido. Na **triagem**,
o comprador pode vincular o item a um produto existente ou cadastrar um produto
novo; no **recebimento**, o mesmo vínculo pode ser feito (`productId`) ou o
cadastro rápido pode criar o produto (`newProduct`) com unidade de medida.

A normalização é permanente: o item da solicitação passa a apontar para o
produto e a unidade escolhidos. Produtos criados na triagem ou no recebimento
nascem `catalog_status = incomplete` e podem ser completados depois no catálogo.
O recebimento de um item normalizado gera movimentação de estoque para o
produto vinculado, como qualquer item de catálogo.

## Papéis e permissões

| Permissão | Para que serve | Perfis de fábrica |
| --- | --- | --- |
| `purchases.view` | Ver as próprias solicitações | Solicitante, liderança de limpeza, comprador |
| `purchases.view_all` | Ver a fila inteira | Gestor do setor, direção, compras, administração |
| `purchases.approve_department` | Aprovar solicitações dos setores gerenciados (histórico v2; a ordem v3 atual usa a aprovação de Compras) | Gestor do setor, administração |
| `purchases.create` | Criar e editar rascunhos | Solicitante, comprador, administração |
| `purchases.approve` | Aprovar a necessidade como gestor do setor (v2/histórico) | Gestor do setor, administração |
| `purchases.authorize` | Autorizar e refinar compras na etapa de aprovação de Compras; também habilita a triagem | Gestor de Compras, direção, administração |
| `purchases.award` | Adjudicar a cotação item a item | Gestor de compras, administração |
| `purchases.direct` | Autorizar compra direta sem cotação | Gestor de compras, administração |
| `purchases.order` | Fazer a triagem e registrar cotação/pedido | Comprador, gestor de compras, administração |
| `purchases.receive` | Confirmar recebimento e lançar nota fiscal | Comprador, gestor de compras, responsável pelo estoque, administração |
| `purchases.cancel` | Cancelar solicitação | Direção, compras, administração |

Perfis novos:

- `operations_director` — **Diretor de Operações**: visão executiva, autoriza
  orçamento e pode cancelar; não compra, não adjudica e não recebe.
- `purchasing_manager` — **Gestor de Compras**: recebe envio direto, autoriza
  compra direta, adjudica por item, emite pedido e recebe.

O perfil `manager` (gestor do setor) perdeu `purchases.order` e
`purchases.receive` de propósito: a aprovação da necessidade não deve se
confundir com a execução da compra.

## Fluxo corporativo v2 (legado)

As seções a seguir descrevem o fluxo v2, mantido para solicitações antigas e
integrações que declaram `workflowVersion: 2`. A ordem v3 atual está descrita no
início deste documento.

## Caminho principal

```text
Solicitante
  └─ cria e envia
       └─ Gestor do setor aprova a necessidade
            └─ Direção analisa orçamento e autoriza
                 └─ Compras registra propostas
                      └─ Comprador devolve a cotação
                           └─ Compras adjudica item a item
                                └─ Comprador emite pedido por fornecedor
                                     └─ Compras/comprador recebe e conclui
```

### Etapas e estados

| Etapa (`approval_stage`) | Status típico | Quem age | Ação |
| --- | --- | --- | --- |
| `manager` | `pending_approval` | Gestor do setor | `approved`, `send_to_purchasing` ou `rejected` |
| `direction` | `pending_approval` | Direção | `approved` ou `rejected` |
| `purchasing` | `pending_approval` | Compras | `send_to_direction`, `authorize_direct` ou `rejected` |
| `buyer` | `quoting` | Comprador | Registrar proposta e devolver cotação |
| `award` | `quote_returned` | Compras | Adjudicar todos os itens cotados |
| `buyer` | `quote_approved` | Comprador | Emitir pedidos por fornecedor |
| `receipt` | `ordered` / `partially_received` | Comprador/Compras | Confirmar recebimento |
| `completed` | `received` / `rejected` / `cancelled` | — | Fim |

### Decisão do gestor

- `approved`: segue para a direção.
- `send_to_purchasing`: **caminho alternativo**. O gestor entende que a compra
  é recorrente ou urgente e envia direto para a triagem de compras, sem passar
  pela direção. O roteamento fica `direct_to_purchasing`.
- `rejected`: encerra a solicitação.

O gestor pode aprovar, reduzir ou rejeitar item a item. Itens sem decisão
individual herdam a decisão coletiva.

### Decisão da direção

- `approved`: libera a cotação (`status = quoting`, etapa `buyer`), grava
  `budget_status = approved` e o aprovador.
- `rejected`: encerra.

A direção vê necessidade, justificativa, centro de custo, conta contábil,
observações de orçamento e valor estimado. A aprovação é registrada em
`direction_approved_by` / `direction_approved_at`.

### Triagem de compras e compra direta

No caminho `send_to_purchasing`, a etapa fica em `purchasing`. O gestor de
compras pode:

- `send_to_direction`: devolve a solicitação à direção para análise de
  necessidade e orçamento. O roteamento volta para `standard` e o fluxo segue
  pelo caminho normal de cotação.
- `authorize_direct`: autoriza a compra sem cotação. Todos os itens ativos são
  marcados como `purchase_mode = direct`, o orçamento fica aprovado e a
  solicitação segue para o comprador emitir o pedido.
- `rejected`: encerra.

A compra direta é a válvula de escape para compras de baixo valor, contratos
vigentes ou emergências. A autorização fica registrada com autor e data, e o
envio à direção é o padrão sugerido na interface.

### Cotação e adjudicação

1. O comprador registra uma ou mais propostas, cada uma com fornecedor, itens,
   quantidade e preço unitário.
2. O comprador devolve a cotação (`quotes/return`), mudando o status para
   `quote_returned` e a etapa para `award`.
3. Compras adjudica **todos os itens que estavam em cotação**, escolhendo uma
   proposta vencedora por item. Itens de compra direta não entram na
   adjudicação.
4. A adjudicação grava `purchase_awards` (um vencedor por item) e libera a
   emissão de pedidos.

Regras aplicadas pelo backend:

- não é possível adjudicar item de outra solicitação;
- não é possível adjudicar duas vezes o mesmo item;
- a proposta vencedora precisa conter o item e o fornecedor corretos;
- a quantidade adjudicada não pode exceder a aprovada;
- a adjudicação incompleta é recusada com `BAD_REQUEST`;
- o mesmo fornecedor pode ganhar vários itens, e fornecedores diferentes podem
  ganhar itens da mesma solicitação.

### Pedidos por fornecedor

`POST /api/purchases/:id/orders` recebe uma lista de pedidos. Cada fornecedor
aparece em **um único pedido**. O backend:

- exige todos os itens aprovados incluídos em algum pedido;
- impede o mesmo item em dois pedidos;
- valida fornecedor ativo;
- respeita a adjudicação: se o item foi adjudicado ao fornecedor A, não pode
  ser pedido ao fornecedor B nem com preço diferente do adjudicado;
- calcula o total em centavos;
- grava `purchase_orders` e `purchase_order_items`;
- copia centro de custo e conta contábil da solicitação;
- gera um evento `purchase_order.created` por pedido;
- muda a solicitação para `ordered`, etapa `receipt`, `finance_status =
  committed`.

O fluxo legado continua usando `POST /api/purchases/:id/order` (pedido único).

### Recebimento

`POST /api/purchases/:id/receipts` aceita `purchaseOrderId` opcional. Quando
informado, o recebimento é vinculado ao pedido e às linhas do pedido. O backend:

- valida local, itens, quantidades e saldo;
- atualiza `received_qty_milli` no item da solicitação e na linha do pedido;
- recalcula o status de cada pedido (`partially_received` ou `received`);
- recalcula a solicitação (`partially_received` ou `received`);
- quando tudo foi recebido, conclui a etapa (`completed`) e marca
  `finance_status = received`;
- gera `goods_receipt.posted` no outbox.

É possível receber pedidos de fornecedores diferentes em momentos diferentes.
O recebimento parcial mantém a etapa em `receipt`.

## Compatibilidade com o fluxo legado (v1)

- `workflowVersion` é opcional e o padrão é `2`.
- Testes e integrações antigas declaram `workflowVersion: 1`.
- No v1, a aprovação única continua valendo e as rotas antigas de cotação,
  pedido e recebimento continuam ativas.
- As colunas novas têm default seguro para linhas antigas:
  `workflow_version = 1`, `approval_stage` derivado do status,
  `budget_status = not_required`.
- A migration 0019 não remove dados nem tabelas.

## API resumida

| Método | Rota | Permissão | Função |
| --- | --- | --- | --- |
| GET | `/api/purchases` | `purchases.view` | Lista com filtro de visibilidade |
| GET | `/api/purchases/overview` | `purchases.view` | Fila, contadores, centros de custo |
| GET | `/api/purchases/cost-centers` | `purchases.view` | Centros ativos |
| POST | `/api/purchases` | `purchases.create` | Cria rascunho ou envia |
| PATCH | `/api/purchases/:id` | `purchases.create` | Edita rascunho ou cabeçalho devolvido |
| PUT | `/api/purchases/:id/items` | `purchases.create` | Substitui itens de rascunho ou devolvida |
| POST | `/api/purchases/:id/submit` | `purchases.create` | Envia rascunho ou reenvia devolvida |
| POST | `/api/purchases/:id/decide` | `purchases.approve` / `purchases.authorize` / `purchases.direct` | Decide a etapa atual |
| POST | `/api/purchases/:id/quotes` | `purchases.order` | Registra proposta |
| POST | `/api/purchases/:id/quotes/return` | `purchases.order` | Devolve cotação |
| POST | `/api/purchases/:id/award` | `purchases.award` | Adjudica por item |
| POST | `/api/purchases/:id/orders` | `purchases.order` | Emite pedidos v2 |
| POST | `/api/purchases/:id/order` | `purchases.order` | Emite pedido legado |
| POST | `/api/purchases/:id/receipts` | `purchases.receive` | Confirma recebimento |
| POST | `/api/purchases/:id/cancel` | `purchases.cancel` | Cancela |

## Exemplo de item fora do catálogo

```json
{
  "workflowVersion": 2,
  "justification": "Equipamento novo para a copa",
  "items": [
    {
      "description": "Cafeteira industrial 20 litros",
      "qty": 1,
      "uomId": null
    }
  ]
}
```

## Exemplo de decisão do gestor

```json
{
  "decision": "approved",
  "notes": "Necessidade confirmada para o trimestre.",
  "items": [
    {
      "itemId": "uuid-do-item",
      "status": "approved",
      "qtyApproved": 10,
      "purchaseMode": "quote"
    }
  ]
}
```

## Exemplo de adjudicação

```json
{
  "notes": "Melhor preço e prazo.",
  "awards": [
    { "itemId": "uuid-item-1", "quoteId": "uuid-proposta-b" },
    { "itemId": "uuid-item-2", "quoteId": "uuid-proposta-a" }
  ]
}
```

## Erros de domínio comuns

| Código HTTP | Código | Situação |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Adjudicação incompleta, quantidade acima do aprovado, item repetido |
| 403 | `FORBIDDEN` | Falta de permissão ou solicitação fora do escopo |
| 404 | `NOT_FOUND` | Solicitação, item, proposta ou fornecedor inexistente |
| 409 | `CONFLICT` | Etapa errada, autoaprovação, item já recebido, fornecedor divergente |

## Cobertura de testes

- `tests/07-purchases.spec.ts` — fluxo legado explícito (`workflowVersion: 1`).
- `tests/18-purchase-workflow.spec.ts` — caminho completo v2, adjudicação
  dividida por fornecedor, recebimento parcial por pedido, envio direto,
  compra direta, visibilidade e intake externo.
- `tests/19-purchases-v3.spec.ts` — triagem, aprovação/refinamento do gestor de
  Compras, pedido de alinhamento, compra direta, cotação/orçamento, pedido e
  recebimento com normalização de item fora do catálogo.
- `tests/21-control.spec.ts` — devolução para ajuste, reenvio direto ao gestor,
  fila `stage=returned`, unidade herdada do produto, exclusão segura com
  preservação de histórico e múltiplos administradores.
- `tests/09-reports.spec.ts` — relatórios e painel com solicitações legadas.

## O que ainda não está implementado

- Interface administrativa para editar centros de custo (os quatro centros
  iniciais vêm da migration; a API já lista os ativos).
- Aprovação por alçada de valor (hoje a etapa é definida pelo fluxo, não pelo
  valor).
- Anexo de proposta do fornecedor no item de cotação.
- Sincronização real com NetSuite; o outbox está pronto, o consumidor não.
- Devolução/estorno de recebimento; hoje o recebimento é definitivo.
