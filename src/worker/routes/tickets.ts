import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import { TICKET_STATUS, TICKET_TRANSITIONS, type TicketStatus } from "@shared/types";
import type { AppEnv, AuthUser } from "../types";
import { assertLocationAllowed, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow, updateStatement } from "../db";
import { badRequest, conflict, forbidden, notFound, parseBody } from "../errors";
import { listMaterialUse, recordMaterialUse } from "../materials";
import { notificationStatement } from "../notify";
import { buildCode, nextCounter, nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const statusSchema = z.enum(TICKET_STATUS);

const ticketBody = z.object({
  title: z.string().trim().min(4, "Descreva o assunto em poucas palavras.").max(160),
  description: z.string().trim().max(4000).nullish(),
  categoryId: z.string().trim().min(1).nullish(),
  locationId: z.string().trim().min(1, "Selecione o local.").nullish(),
  priority: prioritySchema.optional().default("normal"),
  notes: z.string().trim().max(1000).nullish(),
});

/**
 * Atualização parcial de chamado. Sem `.partial()` de propósito: o partial do
 * zod reaplicaria o default de `priority` e uma mudança de status sozinha
 * rebaixaria o chamado para prioridade "normal".
 */
const ticketPatchBody = z.object({
  title: z.string().trim().min(4, "Descreva o assunto em poucas palavras.").max(160).optional(),
  description: z.string().trim().max(4000).nullish(),
  categoryId: z.string().trim().min(1).nullish(),
  locationId: z.string().trim().min(1, "Selecione o local.").nullish(),
  priority: prioritySchema.optional(),
  notes: z.string().trim().max(1000).nullish(),
  status: statusSchema.optional(),
});

const commentBody = z.object({
  body: z.string().trim().min(1, "Escreva um comentário.").max(2000),
  isInternal: z.boolean().optional().default(false),
});

const assignBody = z.object({
  assigneeId: z.string().trim().min(1, "Selecione o responsável.").nullish(),
});

const resolveBody = z.object({
  resolution: z.string().trim().min(5, "Descreva o que foi feito (mínimo 5 caracteres).").max(2000),
  status: z.enum(["resolved", "waiting_material", "in_progress"]).optional().default("resolved"),
});

const convertBody = z.object({
  title: z.string().trim().min(4).max(160).optional(),
  description: z.string().trim().max(4000).nullish(),
  assigneeId: z.string().trim().min(1).nullish(),
  priority: prioritySchema.optional(),
  plannedAt: z.string().trim().max(40).nullish(),
  requiresMaterial: z.boolean().optional().default(false),
});

const cancelBody = z.object({
  reason: z.string().trim().min(5, "Explique o motivo do cancelamento.").max(500),
});

const materialsBody = z.object({
  requestKey: z.string().trim().min(8).max(120),
  fromLocationId: z.string().trim().min(1, "Informe o local de onde o material foi retirado."),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        qty: z.number().finite().positive("Informe uma quantidade maior que zero."),
        notes: z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, "Informe ao menos um material.")
    .max(100),
});

/* -------------------------------------------------------------------------- */
/* Visibilidade                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Um usuário sem `tickets.view_all` enxerga apenas os tickets que abriu ou que
 * lhe foram atribuídos. O filtro é aplicado no backend, nunca no frontend.
 */
function visibilityClause(user: AuthUser): { clause: string; params: string[] } {
  if (user.permissions.has(PERMISSIONS.TICKETS_VIEW_ALL)) return { clause: "", params: [] };
  if (!user.permissions.has(PERMISSIONS.TICKETS_VIEW)) {
    throw forbidden("Você não tem permissão para consultar tickets.");
  }
  return { clause: "(t.requester_id = ? OR t.assignee_id = ?)", params: [user.id, user.id] };
}

function assertTicketVisible(
  user: AuthUser,
  ticket: { requester_id: string; assignee_id: string | null; location_id?: string | null },
): void {
  const seesAll = user.permissions.has(PERMISSIONS.TICKETS_VIEW_ALL);
  if (!seesAll && ticket.requester_id !== user.id && ticket.assignee_id !== user.id) {
    throw forbidden("Você só pode acessar os tickets que abriu ou que lhe foram atribuídos.");
  }
  // view_all não ignora escopo de local: quem enxerga tudo continua limitado
  // aos locais que administra.
  if (ticket.location_id) assertLocationAllowed(user, ticket.location_id);
}

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

const TICKET_SELECT = `
  SELECT t.id, t.code, t.title, t.description, t.category_id, t.location_id, t.priority,
         t.status, t.requester_id, t.assignee_id, t.resolution, t.resolved_at, t.resolved_by,
         t.cancel_reason, t.created_at, t.updated_at,
         c.name AS category_name,
         l.name AS location_name, l.path AS location_path,
         rq.name AS requester_name,
         asg.name AS assignee_name,
         wo.id AS work_order_id, wo.code AS work_order_code, wo.status AS work_order_status,
         (SELECT COUNT(*) FROM ticket_comments tc WHERE tc.ticket_id = t.id) AS comment_count
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN locations l ON l.id = t.location_id
    JOIN users rq ON rq.id = t.requester_id
    LEFT JOIN users asg ON asg.id = t.assignee_id
    LEFT JOIN work_orders wo ON wo.ticket_id = t.id`;

router.get("/", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const visibility = visibilityClause(user);
  if (visibility.clause) {
    clauses.push(visibility.clause);
    params.push(...visibility.params);
  }

  const status = url.searchParams.get("status")?.trim();
  const priority = url.searchParams.get("priority")?.trim();
  const categoryId = url.searchParams.get("categoryId")?.trim();
  const locationId = url.searchParams.get("locationId")?.trim();
  const assigneeId = url.searchParams.get("assigneeId")?.trim();
  const requesterId = url.searchParams.get("requesterId")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const open = url.searchParams.get("open") === "true";

  if (status) {
    clauses.push("t.status = ?");
    params.push(status);
  }
  if (open) clauses.push("t.status IN ('open','in_progress','waiting_material')");
  if (priority) {
    clauses.push("t.priority = ?");
    params.push(priority);
  }
  if (categoryId) {
    clauses.push("t.category_id = ?");
    params.push(categoryId);
  }
  if (locationId) {
    clauses.push("t.location_id = ?");
    params.push(locationId);
  }
  if (assigneeId) {
    clauses.push("t.assignee_id = ?");
    params.push(assigneeId);
  }
  if (requesterId) {
    clauses.push("t.requester_id = ?");
    params.push(requesterId);
  }
  if (search) {
    clauses.push("(t.title LIKE ? OR t.code LIKE ? OR COALESCE(t.description,'') LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (user.locationScope.length > 0) {
    clauses.push(`(t.location_id IS NULL OR t.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
    params.push(...user.locationScope);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM tickets t ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${TICKET_SELECT} ${where}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting_material' THEN 2 ELSE 3 END,
               t.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({ items: rows.map(mapTicket), total, page: page.page, pageSize: page.pageSize });
});

router.get("/categories", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, code, default_kind, description, sort_order, is_active
       FROM ticket_categories ORDER BY is_active DESC, sort_order, name`,
  );
  return c.json({
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      code: r.code ? String(r.code) : null,
      defaultKind: String(r.default_kind),
      description: r.description ? String(r.description) : null,
      sortOrder: Number(r.sort_order),
      isActive: Number(r.is_active) === 1,
    })),
  });
});

router.get("/:id", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${TICKET_SELECT} WHERE t.id = ?`, [id]);
  if (!row) throw notFound("Ticket não encontrado.");
  assertTicketVisible(user, {
    requester_id: String(row.requester_id),
    assignee_id: row.assignee_id ? String(row.assignee_id) : null,
    location_id: row.location_id ? String(row.location_id) : null,
  });

  const comments = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT tc.id, tc.body, tc.is_internal, tc.user_id, tc.created_at, u.name AS user_name
       FROM ticket_comments tc JOIN users u ON u.id = tc.user_id
      WHERE tc.ticket_id = ? ORDER BY tc.created_at`,
    [id],
  );

  const materials = await listMaterialUse(c.env.DB, "ticket", id);

  const history = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.action, a.actor_name, a.after_json, a.created_at
       FROM audit_log a
      WHERE a.entity_type = 'ticket' AND a.entity_id = ?
      ORDER BY a.created_at`,
    [id],
  );

  return c.json({
    ticket: mapTicket(row),
    comments: comments
      .filter((cm) => Number(cm.is_internal) === 0 || user.permissions.has(PERMISSIONS.TICKETS_VIEW_ALL))
      .map((cm) => ({
        id: String(cm.id),
        body: String(cm.body),
        isInternal: Number(cm.is_internal) === 1,
        userId: String(cm.user_id),
        userName: String(cm.user_name),
        createdAt: String(cm.created_at),
      })),
    materials,
    history: history.map((h) => ({
      id: String(h.id),
      action: String(h.action),
      actorName: String(h.actor_name),
      detail: h.after_json ? safeParse(h.after_json) : null,
      createdAt: String(h.created_at),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission(PERMISSIONS.TICKETS_CREATE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, ticketBody);

  assertLocationAllowed(user, body.locationId ?? null);
  if (body.categoryId) await assertCategoryActive(c.env.DB, body.categoryId);
  if (body.locationId) await assertLocationActive(c.env.DB, body.locationId);

  const id = uuid();
  const ts = nowIso();
  const code = buildCode("TCK", await nextCounter(c.env.DB, "ticket"));
  const info = clientInfo(c);

  await c.env.DB.batch([
    insertStatement(c.env.DB, "tickets", {
      id,
      code,
      title: body.title,
      description: body.description ?? null,
      category_id: body.categoryId ?? null,
      location_id: body.locationId ?? null,
      priority: body.priority,
      status: "open",
      requester_id: user.id,
      assignee_id: null,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.create",
      entityType: "ticket",
      entityId: id,
      after: { code, title: body.title, priority: body.priority, locationId: body.locationId ?? null },
      ...info,
    }),
  ]);

  return c.json({ id, code }, 201);
});

router.patch("/:id", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, ticketPatchBody);

  const before = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, requester_id, assignee_id, status, title, description, category_id, location_id, priority
       FROM tickets WHERE id = ?`,
    [id],
  );
  if (!before) throw notFound("Ticket não encontrado.");
  assertTicketVisible(user, {
    requester_id: String(before.requester_id),
    assignee_id: before.assignee_id ? String(before.assignee_id) : null,
  });

  const isOwner = String(before.requester_id) === user.id;
  const canManage = user.permissions.has(PERMISSIONS.TICKETS_VIEW_ALL);
  if (!isOwner && !canManage) throw forbidden("Você não pode editar este ticket.");

  if (body.status && body.status !== before.status) {
    // O PATCH é de edição; mudança de estado exige a permissão do fluxo, não
    // apenas view_all (que é leitura ampla).
    const required =
      body.status === "cancelled" ? PERMISSIONS.TICKETS_CANCEL : PERMISSIONS.TICKETS_RESOLVE;
    if (!user.permissions.has(required)) {
      throw forbidden(
        body.status === "cancelled"
          ? "Permissão necessária para cancelar: tickets.cancel."
          : "Permissão necessária para movimentar o atendimento: tickets.resolve.",
      );
    }
    assertTransition(String(before.status) as TicketStatus, body.status);
  }
  if (body.categoryId) await assertCategoryActive(c.env.DB, body.categoryId);
  if (body.locationId) {
    assertLocationAllowed(user, body.locationId);
    await assertLocationActive(c.env.DB, body.locationId);
  }

  const ts = nowIso();
  const updated = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.categoryId !== undefined ? { category_id: body.categoryId ?? null } : {}),
    ...(body.locationId !== undefined ? { location_id: body.locationId ?? null } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "tickets", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.update",
      entityType: "ticket",
      entityId: id,
      before: { status: before.status, priority: before.priority, title: before.title },
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

router.post("/:id/comments", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, commentBody);

  const ticket = await requireTicket(c.env.DB, id);
  assertTicketVisible(user, ticket);

  const commentId = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "ticket_comments", {
      id: commentId,
      ticket_id: id,
      body: body.body,
      is_internal: body.isInternal ? 1 : 0,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.comment",
      entityType: "ticket",
      entityId: id,
      after: { commentId, isInternal: body.isInternal },
      ...info,
    }),
  ]);

  return c.json({ id: commentId }, 201);
});

router.post("/:id/assign", requirePermission(PERMISSIONS.TICKETS_ASSIGN), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, assignBody);

  const ticket = await requireTicket(c.env.DB, id);
  assertTicketVisible(user, ticket);
  if (["resolved", "cancelled", "converted"].includes(ticket.status)) {
    throw conflict(`Um ticket ${ticket.status} não pode ser reatribuido.`);
  }

  if (body.assigneeId) {
    const assignee = await oneRow<{ id: string; is_active: number; name: string }>(
      c.env.DB,
      `SELECT id, is_active, name FROM users WHERE id = ?`,
      [body.assigneeId],
    );
    if (!assignee) throw notFound("Responsável não encontrado.");
    if (assignee.is_active !== 1) throw badRequest("O responsável informado esta inativo.");
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "tickets", id, {
      assignee_id: body.assigneeId ?? null,
      status: ticket.status === "open" && body.assigneeId ? "in_progress" : ticket.status,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.assign",
      entityType: "ticket",
      entityId: id,
      before: { assigneeId: ticket.assignee_id },
      after: { assigneeId: body.assigneeId ?? null },
      ...info,
    }),
  ];

  if (body.assigneeId && body.assigneeId !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: body.assigneeId,
        type: "ticket_assigned",
        title: `Ticket ${ticket.code} atribuído a você`,
        body: ticket.title,
        link: `/chamados/${id}`,
        entityType: "ticket",
        entityId: id,
        createdAt: ts,
      }),
    );
  }
  if (body.assigneeId && ticket.requester_id !== body.assigneeId && ticket.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: ticket.requester_id,
        type: "ticket_assigned",
        title: `Ticket ${ticket.code} em atendimento`,
        body: "Um responsável foi designado para o seu chamado.",
        link: `/chamados/${id}`,
        entityType: "ticket",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Caminho A: resolução imediata                                              */
/* -------------------------------------------------------------------------- */

/**
 * Resolve o ticket diretamente, sem ordem de serviço.
 * A ausência de material é permitida: nenhum atendimento que não exigiu
 * insumos pode ser bloqueado por isso.
 */
router.post("/:id/resolve", requirePermission(PERMISSIONS.TICKETS_RESOLVE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, resolveBody);

  const ticket = await requireTicket(c.env.DB, id);
  assertTicketVisible(user, ticket);
  if (["resolved", "cancelled", "converted"].includes(ticket.status)) {
    throw conflict(`Este ticket já está ${ticket.status} e não pode ser resolvido novamente.`);
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const resolvedAt = body.status === "resolved" ? ts : null;

  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "tickets", id, {
      status: body.status,
      resolution: body.resolution,
      resolved_at: resolvedAt,
      resolved_by: body.status === "resolved" ? user.id : null,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.resolve",
      entityType: "ticket",
      entityId: id,
      before: { status: ticket.status },
      after: { status: body.status, resolution: body.resolution },
      ...info,
    }),
  ];

  if (ticket.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: ticket.requester_id,
        type: "ticket_resolved",
        title: `Ticket ${ticket.code} ${body.status === "resolved" ? "resolvido" : "atualizado"}`,
        body: body.resolution,
        link: `/chamados/${id}`,
        entityType: "ticket",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true, status: body.status });
});

router.post("/:id/cancel", requirePermission(PERMISSIONS.TICKETS_CANCEL), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, cancelBody);

  const ticket = await requireTicket(c.env.DB, id);
  assertTicketVisible(user, ticket);
  if (["resolved", "cancelled", "converted"].includes(ticket.status)) {
    throw conflict(`Este ticket já está ${ticket.status}.`);
  }

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "tickets", id, {
      status: "cancelled",
      cancel_reason: body.reason,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.cancel",
      entityType: "ticket",
      entityId: id,
      before: { status: ticket.status },
      after: { status: "cancelled" },
      reason: body.reason,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Caminho B: conversão em ordem de serviço                                   */
/* -------------------------------------------------------------------------- */

/**
 * Converte o ticket em ordem de serviço.
 *
 * O vínculo e garantido por `work_orders.ticket_id UNIQUE`: uma segunda
 * tentativa de conversão do mesmo ticket falha no banco e devolve a OS já
 * existente, em vez de criar uma ordem duplicada.
 */
router.post("/:id/convert", requirePermission(PERMISSIONS.WORKORDERS_CREATE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, convertBody);

  const ticket = await requireTicket(c.env.DB, id);
  assertTicketVisible(user, ticket);
  if (ticket.status === "cancelled") throw conflict("Um ticket cancelado não pode ser convertido.");
  if (ticket.status === "converted") {
    const existing = await oneRow<{ id: string; code: string; status: string }>(
      c.env.DB,
      `SELECT id, code, status FROM work_orders WHERE ticket_id = ?`,
      [id],
    );
    if (existing) return c.json({ workOrder: existing, idempotentReplay: true }, 200);
  }
  if (ticket.status === "resolved") throw conflict("Este ticket já foi resolvido diretamente.");

  if (body.assigneeId) {
    const assignee = await oneRow<{ is_active: number }>(c.env.DB, `SELECT is_active FROM users WHERE id = ?`, [
      body.assigneeId,
    ]);
    if (!assignee) throw notFound("Responsável não encontrado.");
    if (assignee.is_active !== 1) throw badRequest("O responsável informado esta inativo.");
  }

  const workOrderId = uuid();
  const ts = nowIso();
  const code = buildCode("OS", await nextCounter(c.env.DB, "work_order"));
  const info = clientInfo(c);

  const statements = [
    c.env.DB
      .prepare(
        `INSERT INTO work_orders
           (id, code, ticket_id, title, description, category_id, location_id, assignee_id, priority,
            status, requires_material, planned_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?, 'open', ?, ?, ?, ?, ?)`,
      )
      .bind(
        workOrderId,
        code,
        id,
        body.title ?? ticket.title,
        body.description ?? ticket.description ?? null,
        ticket.category_id,
        ticket.location_id,
        body.assigneeId ?? ticket.assignee_id ?? null,
        body.priority ?? ticket.priority,
        body.requiresMaterial ? 1 : 0,
        body.plannedAt ?? null,
        user.id,
        ts,
        ts,
      ),
    c.env.DB.prepare(`UPDATE tickets SET status = 'converted', updated_at = ? WHERE id = ?`).bind(ts, id),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: workOrderId,
      type: "created",
      from_status: null,
      to_status: "open",
      body: `Ordem de serviço criada a partir do ticket ${ticket.code}.`,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "tickets",
      action: "ticket.convert",
      entityType: "ticket",
      entityId: id,
      after: { workOrderId, workOrderCode: code },
      ...info,
    }),
  ];

  const workOrderAssignee = body.assigneeId ?? ticket.assignee_id ?? null;
  if (workOrderAssignee && workOrderAssignee !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: workOrderAssignee,
        type: "work_order_assigned",
        title: `Ordem de serviço ${code} atribuída a você`,
        body: `${ticket.code}: ${body.title ?? ticket.title}`,
        link: `/ordens/${workOrderId}`,
        entityType: "work_order",
        entityId: workOrderId,
        createdAt: ts,
      }),
    );
  }
  if (ticket.requester_id !== user.id && ticket.requester_id !== workOrderAssignee) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: ticket.requester_id,
        type: "ticket_converted",
        title: `Ticket ${ticket.code} virou ordem de serviço`,
        body: `Ordem ${code} criada para atender o seu chamado.`,
        link: `/chamados/${id}`,
        entityType: "ticket",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed: work_orders\.ticket_id/.test(message)) {
      const existing = await oneRow<{ id: string; code: string; status: string }>(
        c.env.DB,
        `SELECT id, code, status FROM work_orders WHERE ticket_id = ?`,
        [id],
      );
      if (existing) return c.json({ workOrder: existing, idempotentReplay: true }, 200);
    }
    throw error;
  }

  return c.json({ workOrder: { id: workOrderId, code, status: "open" }, idempotentReplay: false }, 201);
});

/* -------------------------------------------------------------------------- */
/* Material utilizado no atendimento                                          */
/* -------------------------------------------------------------------------- */

router.get("/:id/materials", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const user = currentUser(c);
  const ticket = await requireTicket(c.env.DB, c.req.param("id"));
  assertTicketVisible(user, ticket);
  return c.json({ items: await listMaterialUse(c.env.DB, "ticket", ticket.id) });
});

router.post("/:id/materials", requirePermission(PERMISSIONS.WORKORDERS_MATERIAL), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, materialsBody);

  const ticket = await requireTicket(c.env.DB, id);
  assertTicketVisible(user, ticket);
  if (["cancelled"].includes(ticket.status)) throw conflict("Ticket cancelado não recebe material.");
  if (ticket.status === "converted") {
    throw conflict("Este ticket foi convertido em ordem de serviço. Registre o material na ordem de serviço.");
  }
  assertLocationAllowed(user, body.fromLocationId);

  const info = clientInfo(c);
  const results = await recordMaterialUse(
    c.env.DB,
    user,
    {
      refType: "ticket",
      refId: id,
      fromLocationId: body.fromLocationId,
      requestKey: body.requestKey,
      items: body.items,
    },
    (recorded) => [
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "tickets",
        action: "ticket.material_use",
        entityType: "ticket",
        entityId: id,
        after: {
          fromLocationId: body.fromLocationId,
          items: body.items.map((i) => ({ productId: i.productId, qty: i.qty })),
          movementIds: recorded.map((r) => r.id),
        },
        ...info,
      }),
    ],
  );

  return c.json({ movements: results, idempotentReplay: results.every((r) => r.idempotentReplay) }, 201);
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

interface TicketRow {
  id: string;
  code: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  category_id: string | null;
  location_id: string | null;
  requester_id: string;
  assignee_id: string | null;
  resolution: string | null;
}

async function requireTicket(db: D1Database, id: string | undefined): Promise<TicketRow> {
  if (!id) throw badRequest("Ticket não informado.");
  const row = await oneRow<TicketRow>(
    db,
    `SELECT id, code, status, priority, title, description, category_id, location_id,
            requester_id, assignee_id, resolution
       FROM tickets WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Ticket não encontrado.");
  return row;
}

function assertTransition(from: TicketStatus, to: TicketStatus): void {
  const allowed = TICKET_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw conflict(`Transição de status inválida: de "${from}" para "${to}".`);
  }
}

async function assertCategoryActive(db: D1Database, categoryId: string): Promise<void> {
  const category = await oneRow<{ is_active: number }>(
    db,
    `SELECT is_active FROM ticket_categories WHERE id = ?`,
    [categoryId],
  );
  if (!category) throw notFound("Categoria de atendimento não encontrada.");
  if (category.is_active !== 1) throw badRequest("Esta categoria de atendimento esta inativa.");
}

async function assertLocationActive(db: D1Database, locationId: string): Promise<void> {
  const location = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM locations WHERE id = ?`, [
    locationId,
  ]);
  if (!location) throw notFound("Local não encontrado.");
  if (location.is_active !== 1) throw badRequest("Este local esta inativo.");
}

function safeParse(value: unknown): unknown {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

export function mapTicket(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: row.category_name ? String(row.category_name) : null,
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    locationPath: row.location_path ? String(row.location_path) : null,
    priority: String(row.priority),
    status: String(row.status),
    requesterId: String(row.requester_id),
    requesterName: String(row.requester_name),
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    assigneeName: row.assignee_name ? String(row.assignee_name) : null,
    resolution: row.resolution ? String(row.resolution) : null,
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    resolvedBy: row.resolved_by ? String(row.resolved_by) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    commentCount: Number(row.comment_count ?? 0),
    workOrderId: row.work_order_id ? String(row.work_order_id) : null,
    workOrderCode: row.work_order_code ? String(row.work_order_code) : null,
    workOrderStatus: row.work_order_status ? String(row.work_order_status) : null,
  };
}

export default router;
