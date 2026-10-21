# Integrações: NetSuite, ServiceNow e outbox

O Facil **prepara** a integração com o ERP e com a ferramenta de chamados, sem
depender de nenhum serviço pago e sem colocar chamadas externas no caminho
crítico da operação. Nesta versão, o Facil grava eventos e recebe chamados; o
consumidor externo ainda será construído.

## Princípios

1. **Outbox transacional.** O evento é gravado na mesma transação da operação
   de compra ou recebimento. Se a operação falhar, o evento não existe; se a
   operação existir, o evento também existe.
2. **Idempotência.** Cada evento tem `idempotency_key` única. Reenvios não
   duplicam efeitos no consumidor.
3. **Acoplamento fraco.** O Facil não chama NetSuite/ServiceNow durante a
   criação, aprovação, adjudicação ou recebimento.
4. **Auditoria.** Toda operação continua registrada em `audit_log`, mesmo que o
   integrador ainda não exista.
5. **Sem segredo no repositório.** Chaves de serviço são configuradas por
   `wrangler secret put`.

## Outbox

Tabela: `integration_outbox`.

| Campo | Função |
| --- | --- |
| `id` | UUID do evento |
| `event_type` | Nome estável do evento (ver tabela abaixo) |
| `aggregate_type` | `purchase_request`, `purchase_order`, `ticket`, etc. |
| `aggregate_id` | ID do agregado de origem |
| `idempotency_key` | Chave única para o consumidor deduplicar |
| `payload_json` | Carga útil em JSON |
| `status` | `pending`, `processing`, `sent`, `failed` |
| `attempts` | Contador de tentativas |
| `next_attempt_at` | Próxima tentativa sugerida |
| `last_error` | Último erro informado pelo consumidor |
| `created_at` / `processed_at` | Datas |

### Eventos publicados

| Evento | Quando é gerado | Agregado |
| --- | --- | --- |
| `purchase_request.manager_approved` | Gestor aprova a necessidade | Solicitação |
| `purchase_request.sent_to_direction` | Gestor envia à direção | Solicitação |
| `purchase_request.sent_to_purchasing` | Gestor envia direto a compras | Solicitação |
| `purchase_request.authorized` | Direção autoriza orçamento | Solicitação |
| `purchase_request.direct_authorized` | Compras autoriza compra direta | Solicitação |
| `purchase_request.rejected` | Etapa rejeita | Solicitação |
| `purchase_request.awarded` | Compras adjudica item a item | Solicitação |
| `purchase_order.created` | Pedido por fornecedor é emitido | Pedido |
| `purchase_request.ordered` | Todos os pedidos são emitidos | Solicitação |
| `goods_receipt.posted` | Recebimento é confirmado | Recebimento |
| `ticket.intake.received` | Chamado externo é aceito | Chamado |

O payload inclui IDs, códigos, valores em centavos, centro de custo, conta
contábil e dados necessários para rastrear a origem. O consumidor deve tratar o
payload como **fonte de verdade apenas para o evento**; antes de gravar no ERP,
pode reler a solicitação/pedido no Facil por API administrativa.

### Inspeção e confirmação

Rotas administrativas:

```text
GET  /api/integrations/outbox?status=pending&limit=50
POST /api/integrations/outbox/:id/ack
```

Ack aceita:

```json
{
  "status": "sent",
  "externalId": "NS-PO-12345",
  "externalStatus": "approved",
  "error": null
}
```

- `sent`: marca o evento como enviado e atualiza o pedido (`sync_status =
  synced`, `external_id`, `external_status`).
- `failed`: incrementa tentativas, grava o erro e agenda nova tentativa em
  cinco minutos. O pedido fica `sync_status = error`.
- Um evento já `sent` não pode ser confirmado de novo (409).
- A rota de leitura exige `settings.view`; a de confirmação exige
  `settings.manage`.

### Consumidor futuro (NetSuite)

Fluxo sugerido para um Worker/integrador separado:

1. Ler `GET /api/integrations/outbox?status=pending`.
2. Para `purchase_order.created`, montar o Purchase Order no NetSuite com:
   - fornecedor (`supplier_id` → vendor);
   - itens, quantidades e preço unitário em centavos;
   - centro de custo (`cost_center_id` → department/class);
   - conta contábil (`gl_account`);
   - moeda (`BRL`);
   - referência externa (`order_ref` / `code`).
3. Para `goods_receipt.posted`, montar o Item Receipt vinculado ao PO.
4. Confirmar com `POST /api/integrations/outbox/:id/ack`.
5. Em erro transitório, confirmar `failed` e tentar de novo com backoff.
6. Em erro definitivo (fornecedor inválido, período fechado), manter `failed`
   com mensagem clara e alertar a operação.

Mapeamentos que ainda precisam ser validados com a controladoria:

- plano de contas e centros de custo oficiais;
- impostos, frete e condições de pagamento;
- unidade de medida e arredondamento;
- aprovação por alçada no NetSuite;
- se o Pedido de Compra nasce no Facil ou no NetSuite.

O Facil não afirma que a integração NetSuite está concluída. O que existe hoje
é o contrato de saída, o estado de sincronização e a interface de confirmação.

## Intake ServiceNow

Rota pública autenticada por chave de serviço:

```text
POST /api/intake/tickets
GET  /api/intake/events
```

Cabeçalhos aceitos:

```text
x-intake-key: <TICKET_INTAKE_KEY>
Authorization: Bearer <TICKET_INTAKE_KEY>
```

Corpo:

```json
{
  "source": "servicenow",
  "externalRef": "INC0012345",
  "title": "Ar-condicionado da sala 101 não liga",
  "description": "Chamado aberto pelo portal.",
  "priority": "high",
  "categoryCode": "climatização",
  "locationCode": "SALA-101",
  "requester": {
    "name": "Maria Silva",
    "email": "maria.silva@empresa.test",
    "phone": "(11) 99999-0000"
  }
}
```

Regras:

- `externalRef` é obrigatório e idempotente por `source`.
- O mesmo `(source, externalRef)` devolve o ticket existente com
  `duplicate: true` e HTTP 200.
- O solicitante técnico é `user_intake`; o contato real fica em
  `intake_name`, `intake_email` e `intake_phone`.
- `categoryCode` e `locationCode` são códigos ativos; se não existirem, o
  chamado é criado sem categoria/local.
- Limite de 30 chamadas por IP a cada 10 minutos.
- Cada aceite gera auditoria, notificação para quem tem `tickets.assign` e o
  evento `ticket.intake.received`.
- A rota de eventos mostra os últimos 100 registros de intake.

### Configuração da chave

```bash
# gere uma chave longa e aleatória, fora do repositório
npx wrangler secret put TICKET_INTAKE_KEY
```

Sem a chave, as rotas respondem `503 INTAKE_DISABLED`. A chave **não** deve ser
colocada em `wrangler.jsonc`, `.dev.vars`, README, prints ou commits. Rotacione
a chave se houver suspeita de vazamento.

### Exemplo de chamada

```bash
curl -X POST https://SEU-DOMINIO/api/intake/tickets \
  -H "content-type: application/json" \
  -H "x-intake-key: $TICKET_INTAKE_KEY" \
  -d '{
    "source": "servicenow",
    "externalRef": "INC0012345",
    "title": "Ar-condicionado da sala 101 não liga",
    "requester": { "name": "Maria Silva", "email": "maria.silva@empresa.test" }
  }'
```

## Segurança e privacidade

- A chave de intake é comparada no Worker e nunca é devolvida pela API.
- O chamado externo não cria usuário de login; o contato fica no ticket.
- O outbox contém dados de compra e contato do solicitante; trate o banco D1 e
  os backups como dados internos.
- O e-mail e o CPF do autor do sistema não são armazenados nem exibidos. A
  autoria aparece apenas pelo nome.
- Nenhum segredo de produção fica no repositório ou no manifesto assinado.

## Limitações atuais

- Não há consumidor automático do outbox; a confirmação é manual/administrativa.
- Não há repetição automática de eventos `failed`; o campo
  `next_attempt_at` é uma instrução para o integrador.
- Não há integração de anexos com NetSuite/ServiceNow.
- Não há mapeamento fiscal homologado; ele depende da controladoria.
- O intake não consulta a ServiceNow de volta; é somente entrada.
