import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import {
  WORK_ORDER_STATUS,
  WORK_ORDER_TRANSITIONS,
  type WorkOrderStatus,
} from "@shared/types";
import type { AppEnv } from "../types";
import { assertLocationAllowed, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow, updateStatement } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { listMaterialUse, recordMaterialUse } from "../materials";
import { notificationStatement } from "../notify";
import { buildCode, nextCounter, nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
const statusSchema = z.enum(WORK_ORDER_STATUS);

const createBody = z.object({
  title: z.string().trim().min(4, "Descreva o serviço em poucas palavras.").max(160),
  description: z.string().trim().max(4000).nullish(),
  ticketId: z.string().trim().min(1).nullish(),
  // F-10: OS filha — vínculo definido na criação (não muda depois).
  parentWorkOrderId: z.string().trim().min(1).nullish(),
  categoryId: z.string().trim().min(1).nullish(),
  locationId: z.string().trim().min(1).nullish(),
  assigneeId: z.string().trim().min(1).nullish(),
  priority: prioritySchema.optional().default("normal"),
  requiresMaterial: z.boolean().optional().default(false),
  plannedAt: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

/**
 * Atualização parcial. Sem `.partial()` de propósito: o partial do zod
 * reaplicaria os defaults de `priority` e `requiresMaterial`, apagando o que
 * não foi enviado (ex.: editar só as notas rebaixaria a prioridade).
 */
const updateBody = z.object({
  title: z.string().trim().min(4, "Descreva o serviço em poucas palavras.").max(160).optional(),
  description: z.string().trim().max(4000).nullish(),
  categoryId: z.string().trim().min(1).nullish(),
  locationId: z.string().trim().min(1).nullish(),
  assigneeId: z.string().trim().min(1).nullish(),
  priority: prioritySchema.optional(),
  requiresMaterial: z.boolean().optional(),
  plannedAt: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const statusBody = z.object({
  status: statusSchema,
  body: z.string().trim().max(1000).nullish(),
});

const assignBody = z.object({
  assigneeId: z.string().trim().min(1, "Selecione o responsável.").nullish(),
});

const commentBody = z.object({
  body: z.string().trim().min(1, "Escreva um comentário.").max(2000),
});

const checklistCreateBody = z.object({
  label: z.string().trim().min(3, "Descreva a etapa em poucas palavras.").max(160),
  notes: z.string().trim().max(1000).nullish(),
});

/**
 * Atualização parcial do item (rótulo, observação e conclusão). Sem
 * `.partial()` de propósito, pelo mesmo motivo do `updateBody`: os defaults
 * seriam reaplicados e apagariam o que não foi enviado.
 */
const checklistUpdateBody = z.object({
  label: z.string().trim().min(3, "Descreva a etapa em poucas palavras.").max(160).optional(),
  notes: z.string().trim().max(1000).nullish(),
  done: z.boolean().optional(),
});

const materialBody = z.object({
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
  /** Marca a OS como aguardando material quando o estoque não cobrir o pedido. */
  markWaitingOnFailure: z.boolean().optional().default(false),
});

const closeBody = z.object({
  result: z.string().trim().min(5, "Descreva o resultado do serviço (mínimo 5 caracteres).").max(2000),
  notes: z.string().trim().max(1000).nullish(),
});

const cancelBody = z.object({
  reason: z.string().trim().min(5, "Explique o motivo do cancelamento.").max(500),
});

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

const WORK_ORDER_SELECT = `
  SELECT w.id, w.code, w.ticket_id, w.parent_work_order_id, w.title, w.description, w.category_id, w.location_id,
         w.assignee_id, w.priority, w.status, w.requires_material, w.planned_at,
         w.started_at, w.finished_at, w.result, w.cancel_reason, w.notes,
         w.created_by, w.created_at, w.updated_at,
         c.name AS category_name,
         l.name AS location_name, l.path AS location_path,
         asg.name AS assignee_name,
         cb.name AS created_by_name,
         t.code AS ticket_code, t.status AS ticket_status, t.title AS ticket_title,
         (SELECT COUNT(*) FROM work_order_events e WHERE e.work_order_id = w.id) AS event_count,
         (SELECT COUNT(*) FROM work_order_checklist_items ci
           WHERE ci.work_order_id = w.id) AS checklist_count,
         (SELECT COUNT(*) FROM work_order_checklist_items ci
           WHERE ci.work_order_id = w.id AND ci.is_done = 1) AS checklist_done_count,
         (SELECT COALESCE(SUM(m.qty_milli), 0) FROM movements m
           WHERE m.ref_type = 'work_order' AND m.ref_id = w.id AND m.type = 'maintenance_use') AS material_qty_milli,
         (SELECT COUNT(*) FROM movements m
           WHERE m.ref_type = 'work_order' AND m.ref_id = w.id AND m.type = 'maintenance_use') AS material_item_count
    FROM work_orders w
    LEFT JOIN ticket_categories c ON c.id = w.category_id
    LEFT JOIN locations l ON l.id = w.location_id
    LEFT JOIN users asg ON asg.id = w.assignee_id
    JOIN users cb ON cb.id = w.created_by
    LEFT JOIN tickets t ON t.id = w.ticket_id`;

router.get("/", requirePermission(PERMISSIONS.WORKORDERS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const status = url.searchParams.get("status")?.trim();
  const priority = url.searchParams.get("priority")?.trim();
  const assigneeId = url.searchParams.get("assigneeId")?.trim();
  const locationId = url.searchParams.get("locationId")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const openOnly = url.searchParams.get("open") === "true";
  const mineOnly = url.searchParams.get("mine") === "true";

  if (status) {
    clauses.push("w.status = ?");
    params.push(status);
  }
  if (openOnly) clauses.push("w.status IN ('open','planned','in_progress','waiting_material')");
  if (mineOnly) {
    clauses.push("w.assignee_id = ?");
    params.push(user.id);
  }
  if (priority) {
    clauses.push("w.priority = ?");
    params.push(priority);
  }
  if (assigneeId) {
    clauses.push("w.assignee_id = ?");
    params.push(assigneeId);
  }
  if (locationId) {
    clauses.push("w.location_id = ?");
    params.push(locationId);
  }
  if (search) {
    clauses.push("(w.title LIKE ? OR w.code LIKE ? OR COALESCE(w.description,'') LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (user.locationScope.length > 0) {
    clauses.push(`(w.location_id IS NULL OR w.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
    params.push(...user.locationScope);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM work_orders w ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${WORK_ORDER_SELECT} ${where}
      ORDER BY CASE w.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 WHEN 'planned' THEN 2
                             WHEN 'waiting_material' THEN 3 ELSE 4 END,
               CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               w.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({ items: rows.map(mapWorkOrder), total, page: page.page, pageSize: page.pageSize });
});

router.get("/:id", requirePermission(PERMISSIONS.WORKORDERS_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${WORK_ORDER_SELECT} WHERE w.id = ?`, [id]);
  if (!row) throw notFound("Ordem de serviço não encontrada.");

  const events = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT e.id, e.type, e.from_status, e.to_status, e.body, e.user_id, e.created_at, u.name AS user_name
       FROM work_order_events e JOIN users u ON u.id = e.user_id
      WHERE e.work_order_id = ? ORDER BY e.created_at, e.id`,
    [id],
  );

  // F-10: árvore pai/filha — resumo da OS pai (se houver) e das OS filhas.
  // É informação de gestão: same critério do painel (gerente de facilities e
  // administração); para os demais perfis, os campos saem neutros.
  const managerView = user.roleCode === "facilities_manager" || user.roleCode === "admin";
  const parent =
    managerView && row.parent_work_order_id
      ? await oneRow<Record<string, unknown>>(
          c.env.DB,
          `SELECT w.id, w.code, w.title, w.status, w.priority, u.name AS assignee_name
             FROM work_orders w LEFT JOIN users u ON u.id = w.assignee_id
            WHERE w.id = ?`,
          [String(row.parent_work_order_id)],
        )
      : null;
  const children = managerView
    ? await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT w.id, w.code, w.title, w.status, w.priority, u.name AS assignee_name
           FROM work_orders w LEFT JOIN users u ON u.id = w.assignee_id
          WHERE w.parent_work_order_id = ?
          ORDER BY w.created_at, w.id`,
        [id],
      )
    : [];

  return c.json({
    workOrder: mapWorkOrder(row),
    events: events.map((e) => ({
      id: String(e.id),
      type: String(e.type),
      fromStatus: e.from_status ? String(e.from_status) : null,
      toStatus: e.to_status ? String(e.to_status) : null,
      body: e.body ? String(e.body) : null,
      userId: String(e.user_id),
      userName: String(e.user_name),
      createdAt: String(e.created_at),
    })),
    checklist: await listChecklist(c.env.DB, id),
    materials: await listMaterialUse(c.env.DB, "work_order", id),
    parent: parent ? mapRelatedWorkOrder(parent) : null,
    children: children.map(mapRelatedWorkOrder),
  });
});

/* -------------------------------------------------------------------------- */
/* Criação e edição                                                           */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission(PERMISSIONS.WORKORDERS_CREATE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, createBody);

  let ticketId: string | null = null;
  if (body.ticketId) {
    const ticket = await oneRow<{ id: string; status: string; code: string }>(
      c.env.DB,
      `SELECT id, status, code FROM tickets WHERE id = ?`,
      [body.ticketId],
    );
    if (!ticket) throw notFound("Ticket de origem não encontrado.");
    if (ticket.status === "cancelled" || ticket.status === "resolved") {
      throw conflict(`Não é possível abrir OS para um ticket ${ticket.status}.`);
    }
    if (ticket.status === "converted") {
      // Reenvio da mesma criação (ou retry após timeout): devolve a ordem que
      // já existe para o chamado, em vez de abrir uma segunda ordem.
      const existing = await oneRow<{ id: string; code: string; status: string }>(
        c.env.DB,
        `SELECT id, code, status FROM work_orders WHERE ticket_id = ?`,
        [ticket.id],
      );
      if (existing) return c.json({ workOrder: existing, idempotentReplay: true }, 200);
      throw conflict("Este ticket já possui uma ordem de serviço vinculada.");
    }
    ticketId = ticket.id;
  }

  // F-10: OS filha — a OS pai precisa existir e não estar cancelada. O vínculo
  // só é definido aqui (não há como mudar depois), então não há ciclo possível.
  let parent: { id: string; code: string; status: string } | null = null;
  if (body.parentWorkOrderId) {
    parent = await oneRow<{ id: string; code: string; status: string }>(
      c.env.DB,
      `SELECT id, code, status FROM work_orders WHERE id = ?`,
      [body.parentWorkOrderId],
    );
    if (!parent) throw notFound("Ordem de serviço pai não encontrada.");
    if (parent.status === "cancelled") {
      throw conflict(`Não é possível vincular uma OS filha à ${parent.code}, que está cancelada.`);
    }
  }

  assertLocationAllowed(user, body.locationId ?? null);
  if (body.locationId) await assertLocationActive(c.env.DB, body.locationId);
  if (body.categoryId) await assertCategoryActive(c.env.DB, body.categoryId);
  if (body.assigneeId) await assertUserActive(c.env.DB, body.assigneeId);

  const id = uuid();
  const ts = nowIso();
  const code = buildCode("OS", await nextCounter(c.env.DB, "work_order"));
  const info = clientInfo(c);

  const statements: D1PreparedStatement[] = [
    insertStatement(c.env.DB, "work_orders", {
      id,
      code,
      ticket_id: ticketId,
      parent_work_order_id: parent?.id ?? null,
      title: body.title,
      description: body.description ?? null,
      category_id: body.categoryId ?? null,
      location_id: body.locationId ?? null,
      assignee_id: body.assigneeId ?? null,
      priority: body.priority,
      status: "open",
      requires_material: body.requiresMaterial ? 1 : 0,
      planned_at: body.plannedAt ?? null,
      notes: body.notes ?? null,
      created_by: user.id,
      created_at: ts,
      updated_at: ts,
    }),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "created",
      from_status: null,
      to_status: "open",
      body: parent
        ? `Ordem de serviço criada como filha de ${parent.code}.`
        : ticketId
          ? "Ordem de serviço criada a partir de um ticket."
          : "Ordem de serviço criada manualmente.",
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.create",
      entityType: "work_order",
      entityId: id,
      after: {
        code,
        title: body.title,
        ticketId,
        parentWorkOrderId: parent?.id ?? null,
        priority: body.priority,
        requiresMaterial: body.requiresMaterial,
      },
      ...info,
    }),
  ];

  if (ticketId) {
    statements.push(
      c.env.DB.prepare(`UPDATE tickets SET status = 'converted', updated_at = ? WHERE id = ?`).bind(ts, ticketId),
    );
  }

  if (body.assigneeId && body.assigneeId !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: body.assigneeId,
        type: "work_order_assigned",
        title: `Ordem de serviço ${code} atribuída a você`,
        body: body.title,
        link: `/ordens/${id}`,
        entityType: "work_order",
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
        [ticketId],
      );
      if (existing) return c.json({ workOrder: existing, idempotentReplay: true }, 200);
    }
    throw error;
  }

  return c.json({ id, code }, 201);
});

router.patch("/:id", requirePermission(PERMISSIONS.WORKORDERS_EXECUTE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, updateBody);

  const before = await requireWorkOrder(c.env.DB, id);
  if (["done", "cancelled"].includes(before.status)) {
    throw conflict(`Uma ordem ${before.status} não pode ser editada.`);
  }

  assertLocationAllowed(user, body.locationId ?? null);
  if (body.locationId) await assertLocationActive(c.env.DB, body.locationId);
  if (body.categoryId) await assertCategoryActive(c.env.DB, body.categoryId);
  if (body.assigneeId) await assertUserActive(c.env.DB, body.assigneeId);

  const ts = nowIso();
  const updated = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.categoryId !== undefined ? { category_id: body.categoryId ?? null } : {}),
    ...(body.locationId !== undefined ? { location_id: body.locationId ?? null } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.requiresMaterial !== undefined ? { requires_material: body.requiresMaterial ? 1 : 0 } : {}),
    ...(body.plannedAt !== undefined ? { planned_at: body.plannedAt ?? null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.assigneeId !== undefined ? { assignee_id: body.assigneeId ?? null } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "work_orders", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.update",
      entityType: "work_order",
      entityId: id,
      before: { title: before.title, priority: before.priority, locationId: before.location_id },
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Fluxo de status                                                            */
/* -------------------------------------------------------------------------- */

const STATUS_TIMESTAMP_COLUMN: Partial<Record<WorkOrderStatus, string>> = {
  in_progress: "started_at",
  done: "finished_at",
};

router.post("/:id/status", requirePermission(PERMISSIONS.WORKORDERS_EXECUTE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, statusBody);

  const before = await requireWorkOrder(c.env.DB, id);
  if (before.status === body.status) {
    return c.json({ ok: true, status: before.status, unchanged: true });
  }

  const allowed = WORK_ORDER_TRANSITIONS[before.status as WorkOrderStatus] ?? [];
  if (!allowed.includes(body.status)) {
    const labels = allowed.length ? allowed.join(", ") : "nenhuma (estado final)";
    throw conflict(
      `Transição inválida: de "${before.status}" não é possível ir para "${body.status}". Transições permitidas: ${labels}.`,
    );
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const update: Record<string, unknown> = { status: body.status, updated_at: ts };
  const timestampColumn = STATUS_TIMESTAMP_COLUMN[body.status];
  if (timestampColumn) update[timestampColumn] = ts;

  await c.env.DB.batch([
    updateStatement(c.env.DB, "work_orders", id, update),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "status_change",
      from_status: before.status,
      to_status: body.status,
      body: body.body ?? null,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.status_change",
      entityType: "work_order",
      entityId: id,
      before: { status: before.status },
      after: { status: body.status },
      reason: body.body ?? null,
      ...info,
    }),
  ]);

  return c.json({ ok: true, status: body.status });
});

router.post("/:id/assign", requirePermission(PERMISSIONS.WORKORDERS_EXECUTE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, assignBody);

  const before = await requireWorkOrder(c.env.DB, id);
  if (["done", "cancelled"].includes(before.status)) {
    throw conflict(`Uma ordem ${before.status} não pode ser reatribuida.`);
  }
  if (body.assigneeId) await assertUserActive(c.env.DB, body.assigneeId);

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "work_orders", id, { assignee_id: body.assigneeId ?? null, updated_at: ts }),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "assignment",
      from_status: before.status,
      to_status: before.status,
      body: body.assigneeId ? "Responsável definido." : "Responsável removido.",
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.assign",
      entityType: "work_order",
      entityId: id,
      before: { assigneeId: before.assignee_id },
      after: { assigneeId: body.assigneeId ?? null },
      ...info,
    }),
  ];

  if (body.assigneeId && body.assigneeId !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: body.assigneeId,
        type: "work_order_assigned",
        title: `Ordem de serviço ${before.code} atribuída a você`,
        body: before.title,
        link: `/ordens/${id}`,
        entityType: "work_order",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

router.post("/:id/comments", requirePermission(PERMISSIONS.WORKORDERS_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, commentBody);

  const workOrder = await requireWorkOrder(c.env.DB, id);
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "comment",
      from_status: workOrder.status,
      to_status: workOrder.status,
      body: body.body,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.comment",
      entityType: "work_order",
      entityId: id,
      ...info,
    }),
  ]);

  return c.json({ ok: true }, 201);
});

/* -------------------------------------------------------------------------- */
/* Checklist de execução (F-09)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Checklist pessoal do técnico na ordem de serviço.
 *
 * O responsável pela execução (ou um gestor) monta as etapas do serviço,
 * marca o que já foi feito e anexa fotos por etapa -- as fotos reaproveitam o
 * módulo de anexos com `entity_type = 'work_order_checklist_item'`.
 *
 * Toda alteração entra na linha do tempo da OS (`work_order_events.type =
 * 'checklist'`) e na auditoria, para o gestor acompanhar sem precisar abrir o
 * checklist. O item é pessoal do operador: guarda quem criou, quem concluiu e
 * quando.
 */
router.post("/:id/checklist", requirePermission(PERMISSIONS.WORKORDERS_EXECUTE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, checklistCreateBody);

  const workOrder = await requireWorkOrder(c.env.DB, id);
  if (workOrder.status === "cancelled") {
    throw conflict("Ordem cancelada não recebe itens de checklist.");
  }

  const last = await oneRow<{ next_order: number }>(
    c.env.DB,
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
       FROM work_order_checklist_items WHERE work_order_id = ?`,
    [id],
  );

  const itemId = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    insertStatement(c.env.DB, "work_order_checklist_items", {
      id: itemId,
      work_order_id: id,
      label: body.label,
      notes: body.notes ?? null,
      sort_order: Number(last?.next_order ?? 1),
      is_done: 0,
      done_at: null,
      done_by: null,
      created_by: user.id,
      created_at: ts,
      updated_at: ts,
    }),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "checklist",
      from_status: workOrder.status,
      to_status: workOrder.status,
      body: `Etapa adicionada ao checklist: ${body.label}`,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.checklist_add",
      entityType: "work_order",
      entityId: id,
      after: { itemId, label: body.label },
      ...info,
    }),
  ];

  // Quem monta o checklist do colega avisa quem vai executar.
  if (workOrder.assignee_id && workOrder.assignee_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: workOrder.assignee_id,
        type: "work_order_checklist",
        title: `Nova etapa no checklist da ${workOrder.code}`,
        body: body.label,
        link: `/ordens/${id}`,
        entityType: "work_order",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ id: itemId }, 201);
});

router.patch(
  "/:id/checklist/:itemId",
  requirePermission(PERMISSIONS.WORKORDERS_EXECUTE),
  async (c) => {
    const user = currentUser(c);
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");
    const body = await parseBody(c, checklistUpdateBody);

    await requireWorkOrder(c.env.DB, id);
    const item = await requireChecklistItem(c.env.DB, id, itemId);

    const ts = nowIso();
    const changes: Record<string, unknown> = { updated_at: ts };
    if (body.label !== undefined) changes.label = body.label;
    if (body.notes !== undefined) changes.notes = body.notes ?? null;

    let doneEvent: string | null = null;
    if (body.done !== undefined && body.done !== (item.is_done === 1)) {
      changes.is_done = body.done ? 1 : 0;
      changes.done_at = body.done ? ts : null;
      changes.done_by = body.done ? user.id : null;
      doneEvent = body.done ? "Etapa concluída no checklist" : "Etapa reaberta no checklist";
    }

    if (Object.keys(changes).length === 1) {
      throw badRequest("Nada para atualizar neste item do checklist.");
    }

    const info = clientInfo(c);
    const statements: D1PreparedStatement[] = [
      updateStatement(c.env.DB, "work_order_checklist_items", itemId, changes),
    ];

    if (doneEvent) {
      statements.push(
        insertStatement(c.env.DB, "work_order_events", {
          id: uuid(),
          work_order_id: id,
          type: "checklist",
          from_status: null,
          to_status: null,
          body: `${doneEvent}: ${String(changes.label ?? item.label)}`,
          user_id: user.id,
          created_at: ts,
        }),
      );
    }

    statements.push(
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "workorders",
        action: "work_order.checklist_update",
        entityType: "work_order",
        entityId: id,
        before: { label: item.label, notes: item.notes, done: item.is_done === 1 },
        after: {
          label: (changes.label ?? item.label) as string,
          notes: (changes.notes !== undefined ? changes.notes : item.notes) as string | null,
          done: changes.is_done !== undefined ? changes.is_done === 1 : item.is_done === 1,
        },
        ...info,
      }),
    );

    await c.env.DB.batch(statements);
    return c.json({ ok: true });
  },
);

router.delete(
  "/:id/checklist/:itemId",
  requirePermission(PERMISSIONS.WORKORDERS_EXECUTE),
  async (c) => {
    const user = currentUser(c);
    const id = c.req.param("id");
    const itemId = c.req.param("itemId");

    await requireWorkOrder(c.env.DB, id);
    const item = await requireChecklistItem(c.env.DB, id, itemId);
    const ts = nowIso();
    const info = clientInfo(c);

    await c.env.DB.batch([
      // As fotos do item saem junto: nada de anexo órfão.
      c.env.DB.prepare(
        `DELETE FROM attachments WHERE entity_type = 'work_order_checklist_item' AND entity_id = ?`,
      ).bind(itemId),
      c.env.DB.prepare(`DELETE FROM work_order_checklist_items WHERE id = ? AND work_order_id = ?`).bind(
        itemId,
        id,
      ),
      insertStatement(c.env.DB, "work_order_events", {
        id: uuid(),
        work_order_id: id,
        type: "checklist",
        from_status: null,
        to_status: null,
        body: `Etapa removida do checklist: ${item.label}`,
        user_id: user.id,
        created_at: ts,
      }),
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "workorders",
        action: "work_order.checklist_remove",
        entityType: "work_order",
        entityId: id,
        before: { itemId, label: item.label, done: item.is_done === 1 },
        ...info,
      }),
    ]);

    return c.json({ ok: true });
  },
);

/* -------------------------------------------------------------------------- */
/* Material utilizado                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Registra o material utilizado na ordem de serviço.
 *
 * O consumo gera movimentos `maintenance_use` vinculados a OS
 * (ref_type = 'work_order'), portanto o material aparece tanto no histórico da
 * ordem quanto no histórico de movimentação de estoque, sem registro paralelo.
 * Quando falta saldo e `markWaitingOnFailure` esta ativo, a OS e marcada como
 * "aguardando material" -- e nada e baixado, pois o lote e atômico.
 */
router.post("/:id/materials", requirePermission(PERMISSIONS.WORKORDERS_MATERIAL), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, materialBody);

  const workOrder = await requireWorkOrder(c.env.DB, id);
  if (workOrder.status === "cancelled") throw conflict("Ordem cancelada não recebe material.");
  if (workOrder.status === "done") {
    throw conflict("A ordem já foi concluída. Reabra o fluxo antes de registrar novo material.");
  }
  assertLocationAllowed(user, body.fromLocationId);
  await assertLocationActive(c.env.DB, body.fromLocationId);

  const info = clientInfo(c);
  const ts = nowIso();

  try {
    const results = await recordMaterialUse(
      c.env.DB,
      user,
      {
        refType: "work_order",
        refId: id,
        fromLocationId: body.fromLocationId,
        requestKey: body.requestKey,
        items: body.items,
      },
      (recorded) => {
        const statements: D1PreparedStatement[] = [
          insertStatement(c.env.DB, "work_order_events", {
            id: uuid(),
            work_order_id: id,
            type: "material_use",
            from_status: workOrder.status,
            to_status: workOrder.status,
            body: body.items
              .map((i) => `${i.qty} ${Number(i.qty) === 1 ? "unidade" : "unidades"} de material`)
              .join(", "),
            user_id: user.id,
            created_at: ts,
          }),
          auditStatement(c.env.DB, {
            actor: { id: user.id, name: user.name },
            module: "workorders",
            action: "work_order.material_use",
            entityType: "work_order",
            entityId: id,
            after: {
              fromLocationId: body.fromLocationId,
              items: body.items.map((i) => ({ productId: i.productId, qty: i.qty })),
              movementIds: recorded.map((r) => r.id),
            },
            ...info,
          }),
        ];
        // Ao registrar material, uma OS "aguardando material" volta para execução.
        if (workOrder.status === "waiting_material") {
          statements.push(
            updateStatement(c.env.DB, "work_orders", id, { status: "in_progress", updated_at: ts }),
          );
        }
        return statements;
      },
    );

    return c.json(
      { movements: results, idempotentReplay: results.every((r) => r.idempotentReplay) },
      201,
    );
  } catch (error) {
    if (
      body.markWaitingOnFailure &&
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "INSUFFICIENT_STOCK"
    ) {
      await c.env.DB.batch([
        updateStatement(c.env.DB, "work_orders", id, { status: "waiting_material", updated_at: ts }),
        insertStatement(c.env.DB, "work_order_events", {
          id: uuid(),
          work_order_id: id,
          type: "status_change",
          from_status: workOrder.status,
          to_status: "waiting_material",
          body: "Material insuficiente em estoque no momento do lançamento.",
          user_id: user.id,
          created_at: ts,
        }),
      ]);
    }
    throw error;
  }
});

/* -------------------------------------------------------------------------- */
/* Conclusão e cancelamento                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Conclui a ordem de serviço. Não exige material: um atendimento que não
 * precisou de insumos e concluído normalmente.
 */
router.post("/:id/close", requirePermission(PERMISSIONS.WORKORDERS_CLOSE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, closeBody);

  const before = await requireWorkOrder(c.env.DB, id);
  if (before.status === "done") throw conflict("Esta ordem de serviço já foi concluída.");
  if (before.status === "cancelled") throw conflict("Ordem cancelada não pode ser concluída.");

  // Checklist do gerente de facilities é obrigatório: se o gerente criou etapas,
  // o responsável só conclui a OS com todas marcadas. Etapas do próprio técnico
  // (ou de admin) são opcionais e não bloqueiam. (Decisão do usuário — D-22.)
  const pending = await allRows<{ label: string }>(
    c.env.DB,
    `SELECT ci.label
       FROM work_order_checklist_items ci
       JOIN users u ON u.id = ci.created_by
       JOIN roles r ON r.id = u.role_id
      WHERE ci.work_order_id = ? AND ci.is_done = 0 AND r.code = 'facilities_manager'`,
    [id],
  );
  if (pending.length > 0) {
    throw conflict(
      `A ordem tem ${pending.length} etapa(s) do checklist definidas pelo gerente de facilities pendentes. Marque-as antes de concluir.`,
      { pending: pending.map((row) => row.label) },
    );
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "work_orders", id, {
      status: "done",
      result: body.result,
      finished_at: ts,
      updated_at: ts,
      ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    }),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "status_change",
      from_status: before.status,
      to_status: "done",
      body: body.result,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.close",
      entityType: "work_order",
      entityId: id,
      before: { status: before.status },
      after: { status: "done", result: body.result },
      ...info,
    }),
  ];

  const requesterId = await ticketRequesterId(c.env.DB, before.ticket_id);
  if (requesterId && requesterId !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: requesterId,
        type: "work_order_done",
        title: `Ordem de serviço ${before.code} concluída`,
        body: body.result,
        link: `/ordens/${id}`,
        entityType: "work_order",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true, status: "done" });
});

router.post("/:id/cancel", requirePermission(PERMISSIONS.WORKORDERS_CANCEL), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, cancelBody);

  const before = await requireWorkOrder(c.env.DB, id);
  if (before.status === "done") {
    throw conflict("Uma ordem concluída não pode ser cancelada. Registre um novo atendimento se necessário.");
  }
  if (before.status === "cancelled") throw conflict("Esta ordem já está cancelada.");

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "work_orders", id, {
      status: "cancelled",
      cancel_reason: body.reason,
      updated_at: ts,
    }),
    insertStatement(c.env.DB, "work_order_events", {
      id: uuid(),
      work_order_id: id,
      type: "status_change",
      from_status: before.status,
      to_status: "cancelled",
      body: body.reason,
      user_id: user.id,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "workorders",
      action: "work_order.cancel",
      entityType: "work_order",
      entityId: id,
      before: { status: before.status },
      after: { status: "cancelled" },
      reason: body.reason,
      ...info,
    }),
  ];

  const requesterId = await ticketRequesterId(c.env.DB, before.ticket_id);
  if (requesterId && requesterId !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: requesterId,
        type: "work_order_cancelled",
        title: `Ordem de serviço ${before.code} cancelada`,
        body: body.reason,
        link: `/ordens/${id}`,
        entityType: "work_order",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

interface WorkOrderRow {
  id: string;
  code: string;
  status: string;
  priority: string;
  title: string;
  description: string | null;
  location_id: string | null;
  assignee_id: string | null;
  ticket_id: string | null;
}

async function requireWorkOrder(db: D1Database, id: string | undefined): Promise<WorkOrderRow> {
  if (!id) throw badRequest("Ordem de serviço não informada.");
  const row = await oneRow<WorkOrderRow>(
    db,
    `SELECT id, code, status, priority, title, description, location_id, assignee_id, ticket_id
       FROM work_orders WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Ordem de serviço não encontrada.");
  return row;
}

interface ChecklistItemRow {
  id: string;
  label: string;
  notes: string | null;
  sort_order: number;
  is_done: number;
  done_at: string | null;
  done_by: string | null;
  created_by: string;
  created_by_role: string | null;
  created_at: string;
  updated_at: string;
  done_by_name: string | null;
  created_by_name: string;
}

interface ChecklistPhotoRow {
  id: string;
  entity_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
}

/**
 * Checklist da OS com as fotos de cada etapa. As fotos vivem no módulo de
 * anexos (`entity_type = 'work_order_checklist_item'`); aqui elas vão junto do
 * item para o técnico não precisar de uma requisição por etapa.
 */
async function listChecklist(db: D1Database, workOrderId: string) {
  const items = await allRows<ChecklistItemRow>(
    db,
    `SELECT ci.id, ci.label, ci.notes, ci.sort_order, ci.is_done, ci.done_at, ci.done_by,
            ci.created_by, ci.created_at, ci.updated_at,
            du.name AS done_by_name, cu.name AS created_by_name,
            cr.code AS created_by_role
       FROM work_order_checklist_items ci
       LEFT JOIN users du ON du.id = ci.done_by
       JOIN users cu ON cu.id = ci.created_by
       LEFT JOIN roles cr ON cr.id = cu.role_id
      WHERE ci.work_order_id = ?
      ORDER BY ci.sort_order, ci.created_at, ci.id`,
    [workOrderId],
  );

  const photos =
    items.length === 0
      ? []
      : await allRows<ChecklistPhotoRow>(
          db,
          `SELECT a.id, a.entity_id, a.filename, a.mime_type, a.size_bytes, a.uploaded_by, a.created_at
             FROM attachments a
            WHERE a.entity_type = 'work_order_checklist_item'
              AND a.entity_id IN (SELECT id FROM work_order_checklist_items WHERE work_order_id = ?)
            ORDER BY a.created_at, a.id`,
          [workOrderId],
        );

  return items.map((item) => ({
    id: item.id,
    label: item.label,
    notes: item.notes,
    order: Number(item.sort_order),
    done: item.is_done === 1,
    doneAt: item.done_at,
    doneById: item.done_by,
    doneByName: item.done_by_name,
    createdById: item.created_by,
    createdByName: item.created_by_name,
    createdByManager: item.created_by_role === "facilities_manager",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    photos: photos
      .filter((photo) => photo.entity_id === item.id)
      .map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        mimeType: photo.mime_type,
        sizeBytes: Number(photo.size_bytes),
        uploadedBy: photo.uploaded_by,
        createdAt: photo.created_at,
        url: `/api/attachments/${photo.id}`,
      })),
  }));
}

async function requireChecklistItem(
  db: D1Database,
  workOrderId: string,
  itemId: string | undefined,
): Promise<ChecklistItemRow> {
  if (!itemId) throw badRequest("Item do checklist não informado.");
  const row = await oneRow<ChecklistItemRow>(
    db,
    `SELECT ci.id, ci.label, ci.notes, ci.sort_order, ci.is_done, ci.done_at, ci.done_by,
            ci.created_by, ci.created_at, ci.updated_at,
            du.name AS done_by_name, cu.name AS created_by_name
       FROM work_order_checklist_items ci
       LEFT JOIN users du ON du.id = ci.done_by
       JOIN users cu ON cu.id = ci.created_by
      WHERE ci.id = ? AND ci.work_order_id = ?`,
    [itemId, workOrderId],
  );
  if (!row) throw notFound("Item do checklist não encontrado nesta ordem.");
  return row;
}

async function assertUserActive(db: D1Database, userId: string): Promise<void> {
  const user = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM users WHERE id = ?`, [userId]);
  if (!user) throw notFound("Usuário não encontrado.");
  if (user.is_active !== 1) throw badRequest("O usuário informado esta inativo.");
}

/** Solicitante do ticket de origem, quando a OS veio de um ticket. */
async function ticketRequesterId(db: D1Database, ticketId: string | null): Promise<string | null> {
  if (!ticketId) return null;
  const row = await oneRow<{ requester_id: string }>(db, `SELECT requester_id FROM tickets WHERE id = ?`, [
    ticketId,
  ]);
  return row?.requester_id ?? null;
}

async function assertLocationActive(db: D1Database, locationId: string): Promise<void> {
  const location = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM locations WHERE id = ?`, [
    locationId,
  ]);
  if (!location) throw notFound("Local não encontrado.");
  if (location.is_active !== 1) throw badRequest("Este local esta inativo.");
}

async function assertCategoryActive(db: D1Database, categoryId: string): Promise<void> {  const category = await oneRow<{ is_active: number }>(
    db,
    `SELECT is_active FROM ticket_categories WHERE id = ?`,
    [categoryId],
  );
  if (!category) throw notFound("Categoria não encontrada.");
  if (category.is_active !== 1) throw badRequest("Esta categoria esta inativa.");
}

export function mapWorkOrder(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    ticketId: row.ticket_id ? String(row.ticket_id) : null,
    ticketCode: row.ticket_code ? String(row.ticket_code) : null,
    ticketStatus: row.ticket_status ? String(row.ticket_status) : null,
    ticketTitle: row.ticket_title ? String(row.ticket_title) : null,
    parentWorkOrderId: row.parent_work_order_id ? String(row.parent_work_order_id) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: row.category_name ? String(row.category_name) : null,
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    locationPath: row.location_path ? String(row.location_path) : null,
    assigneeId: row.assignee_id ? String(row.assignee_id) : null,
    assigneeName: row.assignee_name ? String(row.assignee_name) : null,
    priority: String(row.priority),
    status: String(row.status),
    requiresMaterial: Number(row.requires_material ?? 0) === 1,
    plannedAt: row.planned_at ? String(row.planned_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    result: row.result ? String(row.result) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    notes: row.notes ? String(row.notes) : null,
    createdBy: String(row.created_by),
    createdByName: row.created_by_name ? String(row.created_by_name) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    eventCount: Number(row.event_count ?? 0),
    checklistCount: Number(row.checklist_count ?? 0),
    checklistDoneCount: Number(row.checklist_done_count ?? 0),
    materialItemCount: Number(row.material_item_count ?? 0),
    materialQtyMilli: Number(row.material_qty_milli ?? 0),
  };
}

/** Resumo de uma OS relacionada (pai ou filha) na árvore do detalhe (F-10). */
export function mapRelatedWorkOrder(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    status: String(row.status),
    priority: String(row.priority),
    assigneeName: row.assignee_name ? String(row.assignee_name) : null,
  };
}

export default router;
