import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, oneRow } from "../db";
import { ApiError, parseBody } from "../errors";
import { notificationStatements, usersWithPermission } from "../notify";
import { outboxStatement } from "../outbox";
import { buildCode, nextCounter, nowIso, uuid } from "../util";
import { PERMISSIONS } from "@shared/permissions";

/**
 * Entrada externa de tickets (ServiceNow ou página pública futura).
 *
 * A rota não usa sessão de usuário: autentica por chave de serviço em
 * `TICKET_INTAKE_KEY`. O solicitante técnico é `user_intake`; o contato real
 * fica no próprio ticket para não expor usuários e senhas de terceiros.
 * `externalRef` é idempotente por fonte: o mesmo chamado do ServiceNow não
 * duplica o ticket no Facil.
 */
const router = new Hono<AppEnv>();

const intakeBody = z.object({
  source: z.enum(["api", "servicenow"]).optional().default("api"),
  externalRef: z.string().trim().min(1, "Informe externalRef para idempotência.").max(120),
  title: z.string().trim().min(5, "Título muito curto.").max(200),
  description: z.string().trim().max(5000).nullish(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal"),
  categoryCode: z.string().trim().max(60).nullish(),
  locationCode: z.string().trim().max(60).nullish(),
  requester: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(160).nullish(),
    phone: z.string().trim().max(40).nullish(),
  }),
});

function serviceKey(c: { env: AppEnv["Bindings"] }): string {
  return (c.env as unknown as { TICKET_INTAKE_KEY?: string }).TICKET_INTAKE_KEY?.trim() ?? "";
}

router.post("/tickets", async (c) => {
  const configuredKey = serviceKey(c);
  if (!configuredKey) {
    throw new ApiError(503, "INTAKE_DISABLED", "A entrada externa de tickets não está configurada.");
  }
  const provided =
    c.req.header("x-intake-key")?.trim() ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    "";
  if (provided !== configuredKey) {
    throw new ApiError(401, "UNAUTHORIZED", "Chave de integração inválida.");
  }

  const body = await parseBody(c, intakeBody);
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const ts = nowIso();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM ticket_intake_events WHERE ip = ? AND created_at >= ?`,
    [ip, since],
  );
  if (recent >= 30) {
    throw new ApiError(429, "RATE_LIMITED", "Muitas chamadas de integração. Tente novamente em alguns minutos.");
  }

  // Em banco novo o usuario tecnico nao existe ate o primeiro intake (a
  // migration nao pode cria-lo antes da instalacao inicial). Garantimos aqui,
  // antes da auditoria e do ticket, para respeitar a chave estrangeira.
  await c.env.DB
    .prepare(
      `INSERT OR IGNORE INTO users
         (id, name, email, password_hash, password_salt, password_iterations, role_id,
          unit_id, employee_code, phone, job_title, notes, is_active, must_change_password,
          last_login_at, created_at, updated_at)
       VALUES
         ('user_intake', 'Integracao externa', 'intake@local.invalid', NULL, NULL, NULL,
          'role_requester', NULL, NULL, NULL, 'Canal externo',
          'Solicitante tecnico dos tickets recebidos por API. Nao utilize para login.',
          1, 0, NULL, ?, ?)`,
    )
    .bind(ts, ts)
    .run();

  const existing = await oneRow<{ id: string; code: string }>(
    c.env.DB,
    `SELECT id, code FROM tickets WHERE source = ? AND external_ref = ?`,
    [body.source, body.externalRef],
  );
  if (existing) {
    await c.env.DB
      .prepare(
        `INSERT INTO ticket_intake_events (id, source, ip, external_ref, ticket_id, outcome, created_at)
         VALUES (?, ?, ?, ?, ?, 'duplicate', ?)`,
      )
      .bind(uuid(), body.source, ip, body.externalRef, existing.id, ts)
      .run();
    return c.json({ id: existing.id, code: existing.code, duplicate: true }, 200);
  }

  const category = body.categoryCode
    ? await oneRow<{ id: string }>(
        c.env.DB,
        `SELECT id FROM ticket_categories WHERE code = ? AND is_active = 1`,
        [body.categoryCode],
      )
    : null;
  const location = body.locationCode
    ? await oneRow<{ id: string }>(
        c.env.DB,
        `SELECT id FROM locations WHERE code = ? AND is_active = 1`,
        [body.locationCode],
      )
    : null;

  const id = uuid();
  const code = buildCode("TCK", await nextCounter(c.env.DB, "ticket"));
  const info = clientInfo(c);
  const contact = [
    body.requester.name,
    body.requester.email ?? null,
    body.requester.phone ?? null,
  ]
    .filter(Boolean)
    .join(" | ");
  const description = [body.description ?? null, `Contato externo: ${contact}`]
    .filter(Boolean)
    .join("\n\n");

  const assignees = await usersWithPermission(c.env.DB, PERMISSIONS.TICKETS_ASSIGN);
  const statements: D1PreparedStatement[] = [
    insertStatement(c.env.DB, "tickets", {
      id,
      code,
      title: body.title,
      description,
      category_id: category?.id ?? null,
      location_id: location?.id ?? null,
      priority: body.priority,
      status: "open",
      requester_id: "user_intake",
      assignee_id: null,
      source: body.source,
      external_ref: body.externalRef,
      intake_name: body.requester.name,
      intake_email: body.requester.email ?? null,
      intake_phone: body.requester.phone ?? null,
      created_at: ts,
      updated_at: ts,
    }),
    insertStatement(c.env.DB, "ticket_intake_events", {
      id: uuid(),
      source: body.source,
      ip,
      external_ref: body.externalRef,
      ticket_id: id,
      outcome: "accepted",
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: "user_intake", name: "Integração externa" },
      module: "tickets",
      action: "ticket.intake",
      entityType: "ticket",
      entityId: id,
      after: {
        code,
        source: body.source,
        externalRef: body.externalRef,
        title: body.title,
        requester: body.requester,
        categoryCode: body.categoryCode ?? null,
        locationCode: body.locationCode ?? null,
      },
      ...info,
    }),
    ...notificationStatements(c.env.DB, assignees, {
      type: "ticket_intake",
      title: `Novo chamado externo: ${body.title}`,
      body: `${body.source === "servicenow" ? "ServiceNow" : "API"} • ${contact}`,
      link: `/tickets/${id}`,
      entityType: "ticket",
      entityId: id,
      createdAt: ts,
    }),
    outboxStatement(c.env.DB, {
      eventType: "ticket.intake.received",
      aggregateType: "ticket",
      aggregateId: id,
      idempotencyKey: `ticket.intake.received:${body.source}:${body.externalRef}`,
      payload: {
        ticketId: id,
        code,
        source: body.source,
        externalRef: body.externalRef,
        title: body.title,
        priority: body.priority,
        categoryCode: body.categoryCode ?? null,
        locationCode: body.locationCode ?? null,
        requester: body.requester,
      },
      createdAt: ts,
    }),
  ];

  try {
    await c.env.DB.batch(statements);
  } catch (cause) {
    // Duas chamadas simultâneas com o mesmo `externalRef` podem passar pela
    // consulta acima. O índice único de `(source, external_ref)` decide qual
    // grava; a perdedora devolve o ticket existente em vez de um erro 500.
    const raced = await oneRow<{ id: string; code: string }>(
      c.env.DB,
      `SELECT id, code FROM tickets WHERE source = ? AND external_ref = ?`,
      [body.source, body.externalRef],
    );
    if (raced) {
      return c.json({ id: raced.id, code: raced.code, duplicate: true }, 200);
    }
    throw cause;
  }
  return c.json({ id, code, duplicate: false }, 201);
});

router.get("/events", async (c) => {
  const configuredKey = serviceKey(c);
  if (!configuredKey) {
    throw new ApiError(503, "INTAKE_DISABLED", "A entrada externa de tickets não está configurada.");
  }
  const provided = c.req.header("x-intake-key")?.trim() ?? "";
  if (provided !== configuredKey) {
    throw new ApiError(401, "UNAUTHORIZED", "Chave de integração inválida.");
  }
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT e.id, e.source, e.external_ref, e.ticket_id, e.outcome, e.created_at,
            t.code AS ticket_code
       FROM ticket_intake_events e
       LEFT JOIN tickets t ON t.id = e.ticket_id
      ORDER BY e.created_at DESC LIMIT 100`,
  );
  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      source: String(row.source),
      externalRef: row.external_ref ? String(row.external_ref) : null,
      ticketId: row.ticket_id ? String(row.ticket_id) : null,
      ticketCode: row.ticket_code ? String(row.ticket_code) : null,
      outcome: String(row.outcome),
      createdAt: String(row.created_at),
    })),
  });
});

export default router;
