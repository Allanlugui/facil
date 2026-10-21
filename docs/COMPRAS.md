# Fluxo corporativo de compras (v2)

Este documento descreve o fluxo de compras introduzido na versão **0.2.0** e
ampliado na **0.3.0** com itens fora do catálogo. Ele convive com o fluxo legado
(v1), que continua disponível para solicitações antigas e para integrações que
declarem `workflowVersion: 1`.

## Princípios

1. **Nada do fluxo antigo foi removido.** Solicitações existentes permanecem
   na versão 1 e continuam usando aprovação única, cotação e pedido legado.
2. **Solicitações novas nascem na versão 2**, salvo quando o cliente declara
   explicitamente `workflowVersion: 1`.
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
preenchida. A descrição acompanha cotação, adjudicação e pedido. No recebimento,
o cadastro rápido cria o produto com o nome informado e o vincula ao item; o
cadastro pode ser completado depois no catálogo.

## Papéis e permissões

| Permissão | Para que serve | Perfis de fábrica |
| --- | --- | --- |
| `purchases.view` | Ver as próprias solicitações | Solicitante, liderança de limpeza, comprador |
| `purchases.view_all` | Ver a fila inteira | Gestor do setor, direção, compras, administração |
| `purchases.create` | Criar e editar rascunhos | Solicitante, comprador, administração |
| `purchases.approve` | Aprovar a necessidade como gestor do setor | Gestor do setor, administração |
| `purchases.authorize` | Autorizar necessidade e orçamento na direção | Diretor de operações, administração |
| `purchases.award` | Adjudicar a cotação item a item | Gestor de compras, administração |
| `purchases.direct` | Autorizar compra direta sem cotação | Gestor de compras, administração |
| `purchases.order` | Registrar cotação e emitir pedido | Comprador, gestor de compras, administração |
| `purchases.receive` | Confirmar recebimento | Comprador, gestor de compras, administração |
| `purchases.cancel` | Cancelar solicitação | Direção, compras, administração |

Perfis novos:

- `operations_director` — **Diretor de Operações**: visão executiva, autoriza
  orçamento e pode cancelar; não compra, não adjudica e não recebe.
- `purchasing_manager` — **Gestor de Compras**: recebe envio direto, autoriza
  compra direta, adjudica por item, emite pedido e recebe.

O perfil `manager` (gestor do setor) perdeu `purchases.order` e
`purchases.receive` de propósito: a aprovação da necessidade não deve se
confundir com a execução da compra.

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
| PATCH | `/api/purchases/:id` | `purchases.create` | Edita rascunho |
| POST | `/api/purchases/:id/submit` | `purchases.create` | Envia rascunho |
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
- `tests/09-reports.spec.ts` — relatórios e painel com solicitações legadas.

## O que ainda não está implementado

- Interface administrativa para editar centros de custo (os quatro centros
  iniciais vêm da migration; a API já lista os ativos).
- Aprovação por alçada de valor (hoje a etapa é definida pelo fluxo, não pelo
  valor).
- Anexo de proposta do fornecedor no item de cotação.
- Sincronização real com NetSuite; o outbox está pronto, o consumidor não.
- Devolução/estorno de recebimento; hoje o recebimento é definitivo.
