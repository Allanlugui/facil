import { uuid } from "./util";

/**
 * Evento de integração gravado na mesma transação da operação de negócio.
 *
 * O outbox é deliberadamente simples: o protótipo não chama NetSuite ou
 * ServiceNow no caminho crítico. Um integrador autorizado consome os eventos
 * pendentes por `idempotency_key`, grava o identificador externo e marca o
 * evento como `sent`. Retries são seguros porque a chave é única.
 */
export function outboxStatement(
  db: D1Database,
  input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    idempotencyKey?: string;
    payload: Record<string, unknown>;
    createdAt: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO integration_outbox
        (id, event_type, aggregate_type, aggregate_id, idempotency_key, payload_json,
         status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      uuid(),
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.idempotencyKey ?? `${input.eventType}:${input.aggregateId}`,
      JSON.stringify(input.payload),
      input.createdAt,
    );
}
