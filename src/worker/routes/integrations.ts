import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { allRows, oneRow } from "../db";
import { conflict, notFound, parseBody } from "../errors";
import { nowIso } from "../util";
import { runOutboxConsumer } from "../outbox-consumer";

/**
 * Interface operacional do outbox de integração.
 *
 * O consumo real será feito por um worker/integrador autorizado (NetSuite,
 * ServiceNow ou middleware). Estas rotas permitem à administração inspecionar
 * pendências e marcar o resultado, sem chamar nenhum serviço pago neste
 * protótipo.
 */
const router = new Hono<AppEnv>();

router.use("*", requireAuth);

router.get("/outbox", requirePermission(PERMISSIONS.SETTINGS_VIEW), async (c) => {
  const status = c.req.query("status")?.trim();
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (status && ["pending", "processing", "sent", "failed"].includes(status)) {
    clauses.push("o.status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT o.id, o.event_type, o.aggregate_type, o.aggregate_id, o.idempotency_key,
            o.status, o.attempts, o.next_attempt_at, o.last_error, o.created_at, o.processed_at
       FROM integration_outbox o ${where}
      ORDER BY o.created_at DESC LIMIT ?`,
    [...params, limit],
  );
  const counts = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT status, COUNT(*) AS total FROM integration_outbox GROUP BY status`,
  );
  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      aggregateType: String(row.aggregate_type),
      aggregateId: String(row.aggregate_id),
      idempotencyKey: String(row.idempotency_key),
      status: String(row.status),
      attempts: Number(row.attempts ?? 0),
      nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: String(row.created_at),
      processedAt: row.processed_at ? String(row.processed_at) : null,
    })),
    counts: Object.fromEntries(counts.map((row) => [String(row.status), Number(row.total ?? 0)])),
  });
});

const ackBody = z.object({
  status: z.enum(["sent", "failed"]),
  externalId: z.string().trim().max(120).nullish(),
  externalStatus: z.string().trim().max(120).nullish(),
  error: z.string().trim().max(2000).nullish(),
});

router.post("/outbox/:id/ack", requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(c, ackBody);
  const row = await oneRow<{ id: string; status: string; attempts: number }>(
    c.env.DB,
    `SELECT id, status, attempts FROM integration_outbox WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Evento de integração não encontrado.");
  if (row.status === "sent") throw conflict("O evento já foi confirmado como enviado.");
  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE integration_outbox
            SET status = ?, attempts = attempts + 1, last_error = ?,
                processed_at = CASE WHEN ? = 'sent' THEN ? ELSE processed_at END,
                next_attempt_at = CASE WHEN ? = 'failed' THEN ? ELSE NULL END
          WHERE id = ?`,
      )
      .bind(
        body.status,
        body.error ?? null,
        body.status,
        ts,
        body.status,
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        id,
      ),
    c.env.DB
      .prepare(
        `UPDATE purchase_orders
            SET external_system = COALESCE(external_system, 'outbox'),
                external_id = COALESCE(?, external_id),
                external_status = COALESCE(?, external_status),
                sync_status = CASE WHEN ? = 'sent' THEN 'synced' ELSE 'error' END,
                sync_error = ?,
                updated_at = ?
          WHERE id = (SELECT aggregate_id FROM integration_outbox
                       WHERE id = ? AND aggregate_type = 'purchase_order')`,
      )
      .bind(
        body.externalId ?? null,
        body.externalStatus ?? null,
        body.status,
        body.error ?? null,
        ts,
        id,
      ),
  ]);
  return c.json({ ok: true, status: body.status });
});

router.post(
  "/outbox/process",
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  async (c) => {
    const result = await runOutboxConsumer(c.env as { DB: D1Database; TICKET_INTAKE_KEY?: string | null; SERVICENOW_INSTANCE_URL?: string | null });
    return c.json({ ok: true, ...result }, result.skipped > 0 ? 202 : 200);
  },
);

export default router;
