import { Hono } from "hono";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { allRows, countRows, normalizePage, offsetOf, oneRow } from "../db";
import { badRequest, notFound } from "../errors";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/**
 * Log de auditoria: somente leitura. A tabela e append-only por convenção da
 * aplicação -- nenhuma rota expoe UPDATE ou DELETE, e o registro e gravado
 * sempre dentro da transação da operação auditada.
 */
router.get("/", requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 50),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const module = url.searchParams.get("module")?.trim();
  if (module) {
    clauses.push("a.module = ?");
    params.push(module);
  }
  const action = url.searchParams.get("action")?.trim();
  if (action) {
    clauses.push("a.action = ?");
    params.push(action);
  }
  const actorId = url.searchParams.get("actorId")?.trim();
  if (actorId) {
    clauses.push("a.actor_id = ?");
    params.push(actorId);
  }
  const entityType = url.searchParams.get("entityType")?.trim();
  if (entityType) {
    clauses.push("a.entity_type = ?");
    params.push(entityType);
  }
  const entityId = url.searchParams.get("entityId")?.trim();
  if (entityId) {
    clauses.push("a.entity_id = ?");
    params.push(entityId);
  }
  const result = url.searchParams.get("result")?.trim();
  if (result === "success" || result === "failure") {
    clauses.push("a.result = ?");
    params.push(result);
  }
  const from = url.searchParams.get("from")?.trim();
  if (from) {
    if (Number.isNaN(Date.parse(from))) throw badRequest("Data inicial inválida.");
    clauses.push("a.created_at >= ?");
    params.push(from);
  }
  const to = url.searchParams.get("to")?.trim();
  if (to) {
    if (Number.isNaN(Date.parse(to))) throw badRequest("Data final inválida.");
    clauses.push("a.created_at <= ?");
    params.push(to);
  }
  const search = url.searchParams.get("search")?.trim();
  if (search) {
    const like = `%${search}%`;
    clauses.push(
      "(a.actor_name LIKE ? OR a.action LIKE ? OR COALESCE(a.entity_id,'') LIKE ? OR COALESCE(a.reason,'') LIKE ?)",
    );
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM audit_log a ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.actor_id, a.actor_name, a.module, a.action, a.entity_type, a.entity_id,
            a.before_json, a.after_json, a.result, a.reason, a.ip, a.user_agent, a.created_at
       FROM audit_log a ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      actorId: row.actor_id ? String(row.actor_id) : null,
      actorName: String(row.actor_name),
      module: String(row.module),
      action: String(row.action),
      entityType: row.entity_type ? String(row.entity_type) : null,
      entityId: row.entity_id ? String(row.entity_id) : null,
      before: safeJson(row.before_json),
      after: safeJson(row.after_json),
      result: String(row.result),
      reason: row.reason ? String(row.reason) : null,
      ip: row.ip ? String(row.ip) : null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
      createdAt: String(row.created_at),
    })),
    total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

/** Módulos e ações disponíveis, para montar os filtros da tela. */
router.get("/facets", requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
  const [modules, actions] = await Promise.all([
    allRows<Record<string, unknown>>(
      c.env.DB,
      `SELECT module, COUNT(*) AS count FROM audit_log GROUP BY module ORDER BY module`,
    ),
    allRows<Record<string, unknown>>(
      c.env.DB,
      `SELECT module, action, COUNT(*) AS count FROM audit_log GROUP BY module, action ORDER BY module, action`,
    ),
  ]);

  return c.json({
    modules: modules.map((row) => ({ module: String(row.module), count: Number(row.count) })),
    actions: actions.map((row) => ({
      module: String(row.module),
      action: String(row.action),
      count: Number(row.count),
    })),
  });
});

/** Histórico de uma entidade específica (aba "Histórico" de cada tela). */
router.get("/entity/:type/:id", requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
  const type = c.req.param("type");
  const id = c.req.param("id");

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.actor_id, a.actor_name, a.module, a.action, a.entity_type, a.entity_id,
            a.before_json, a.after_json, a.result, a.reason, a.created_at
       FROM audit_log a
      WHERE a.entity_type = ? AND a.entity_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 500`,
    [type, id],
  );

  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      actorId: row.actor_id ? String(row.actor_id) : null,
      actorName: String(row.actor_name),
      module: String(row.module),
      action: String(row.action),
      before: safeJson(row.before_json),
      after: safeJson(row.after_json),
      result: String(row.result),
      reason: row.reason ? String(row.reason) : null,
      createdAt: String(row.created_at),
    })),
  });
});

router.get("/:id", requirePermission(PERMISSIONS.AUDIT_VIEW), async (c) => {
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.actor_id, a.actor_name, a.module, a.action, a.entity_type, a.entity_id,
            a.before_json, a.after_json, a.result, a.reason, a.ip, a.user_agent, a.created_at
       FROM audit_log a WHERE a.id = ?`,
    [id],
  );
  if (!row) throw notFound("Registro de auditoria não encontrado.");

  return c.json({
    id: String(row.id),
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorName: String(row.actor_name),
    module: String(row.module),
    action: String(row.action),
    entityType: row.entity_type ? String(row.entity_type) : null,
    entityId: row.entity_id ? String(row.entity_id) : null,
    before: safeJson(row.before_json),
    after: safeJson(row.after_json),
    result: String(row.result),
    reason: row.reason ? String(row.reason) : null,
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null,
    createdAt: String(row.created_at),
  });
});

function safeJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const text = String(value);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export default router;
