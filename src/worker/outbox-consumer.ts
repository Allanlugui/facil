/**
 * Consumidor do `integration_outbox`.
 *
 * Lê eventos pendentes e os envia para o sistema de integração externo
 * (ServiceNow / NetSuite / middleware), autenticado por `TICKET_INTAKE_KEY`
 * (configurado como secret do Worker via `wrangler secret put`).
 *
 * Garantias:
 *   - idempotência: `idempotency_key` viaja no envio para evitar duplicar o
 *     mesmo evento em retries;
 *   - exactly-once de processamento: o evento é marcado `processing` antes de
 *     ser enviado, de modo que um segundo consumidor concorrente não o pega;
 *   - retry com backoff exponencial; após o limite de tentativas vira `failed`;
 *   - se a chave de integração não estiver configurada, o consumidor pula
 *     silenciosamente (não trava o Worker).
 */
import { allRows, oneRow } from "./db";
import { nowIso } from "./util";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

/**
 * Monta o corpo que será enviado para o sistema externo. O `payload_json`
 * gravado no outbox já contém os dados do evento; repassamos com a chave de
 * idempotência para o destino não duplicar em caso de retry.
 */
function buildOutbound(event: Record<string, unknown>): unknown {
  let payload: unknown;
  try {
    payload = JSON.parse(String(event.payload_json ?? "{}"));
  } catch {
    payload = {};
  }
  return {
    idempotency_key: event.idempotency_key,
    event_type: event.event_type,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    payload,
  };
}

/** Backoff exponencial em segundos: 1min, 5min, 30min, 2h, 8h. */
function nextAttemptAt(attempts: number): string {
  const delays = [1, 5, 30, 120, 480];
  const minutes = delays[Math.min(attempts, delays.length - 1)] ?? 480;
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export interface OutboxConsumerResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export async function runOutboxConsumer(env: {
  DB: D1Database;
  TICKET_INTAKE_KEY?: string | null;
  SERVICENOW_INSTANCE_URL?: string | null;
}): Promise<OutboxConsumerResult> {
  const errors: string[] = [];
  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const now = nowIso();

  const rows = await allRows<{
    id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    idempotency_key: string;
    payload_json: string;
    attempts: number;
  }>(
    env.DB,
    `SELECT id, event_type, aggregate_type, aggregate_id, idempotency_key,
            payload_json, attempts
       FROM integration_outbox
      WHERE status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?`,
    [now, BATCH_SIZE],
  );

  if (!env.TICKET_INTAKE_KEY || !env.SERVICENOW_INSTANCE_URL) {
    // Chave não configurada: não processa nada, apenas avisa nos logs.
    skipped = rows.length;
    return { processed: 0, sent: 0, failed: 0, skipped, errors: ["TICKET_INTAKE_KEY ou SERVICENOW_INSTANCE_URL não configurados"] };
  }

  for (const row of rows) {
    processed++;
    // Marca como processing para evitar execução duplicada por outro consumidor.
    const claimed = await oneRow<{ id: string }>(
      env.DB,
      `UPDATE integration_outbox
          SET status = 'processing', attempts = attempts + 1, next_attempt_at = ?
        WHERE id = ? AND status = 'pending'
        RETURNING id`,
      [nextAttemptAt(row.attempts), row.id],
    );
    if (!claimed) continue; // outro consumidor já pegou

    try {
      const body = JSON.stringify(buildOutbound(row));
      const response = await fetch(`${env.SERVICENOW_INSTANCE_URL}/api/now/table/import_set`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.TICKET_INTAKE_KEY}`,
          "Content-Type": "application/json",
        },
        body,
      });

      if (response.ok) {
        await env.DB.prepare(
          `UPDATE integration_outbox
              SET status = 'sent', processed_at = ?, next_attempt_at = NULL
            WHERE id = ?`,
        ).bind(now, row.id);
        sent++;
      } else {
        const text = await response.text();
        await markFailed(env, row.id, `HTTP ${response.status}: ${text.slice(0, 500)}`, now);
        failed++;
        errors.push(`${row.id}: HTTP ${response.status}`);
      }
    } catch (error) {
      await markFailed(env, row.id, String(error), now);
      failed++;
      errors.push(`${row.id}: ${String(error)}`);
    }
  }

  return { processed, sent, failed, skipped, errors };
}

async function markFailed(
  env: { DB: D1Database },
  id: string,
  error: string,
  now: string,
): Promise<void> {
  const row = await oneRow<{ attempts: number }>(
    env.DB,
    `SELECT attempts FROM integration_outbox WHERE id = ?`,
    [id],
  );
  const attempts = row?.attempts ?? 0;
  if (attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare(
      `UPDATE integration_outbox
          SET status = 'failed', processed_at = ?, last_error = ?, next_attempt_at = NULL
        WHERE id = ?`,
    ).bind(now, error.slice(0, 1000), id);
  } else {
    await env.DB.prepare(
      `UPDATE integration_outbox
          SET status = 'pending', last_error = ?, next_attempt_at = ?
        WHERE id = ?`,
    ).bind(error.slice(0, 1000), nextAttemptAt(attempts), id);
  }
}
