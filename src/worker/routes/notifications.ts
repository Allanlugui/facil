import { Hono } from "hono";
import type { AppEnv } from "../types";
import { currentUser, requireAuth } from "../auth";
import { allRows, countRows, offsetOf, oneRow, normalizePage } from "../db";
import { notFound } from "../errors";
import { nowIso } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/**
 * Notificações são dados do próprio usuário: nenhuma permissão adicional e
 * necessária para ler ou marcar as próprias notificações. Ninguem ve a caixa de
 * outra pessoa -- o filtro `user_id = ?` é sempre aplicado no servidor.
 */
router.get("/", async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 20),
  });

  const clauses = ["n.user_id = ?"];
  const params: (string | number)[] = [user.id];

  if (url.searchParams.get("unread") === "true") clauses.push("n.read_at IS NULL");
  const type = url.searchParams.get("type")?.trim();
  if (type) {
    clauses.push("n.type = ?");
    params.push(type);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM notifications n ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT n.id, n.type, n.title, n.body, n.link, n.entity_type, n.entity_id, n.read_at, n.created_at
       FROM notifications n ${where}
      ORDER BY n.created_at DESC, n.id
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      title: String(row.title),
      body: row.body ? String(row.body) : null,
      link: row.link ? String(row.link) : null,
      entityType: row.entity_type ? String(row.entity_type) : null,
      entityId: row.entity_id ? String(row.entity_id) : null,
      readAt: row.read_at ? String(row.read_at) : null,
      createdAt: String(row.created_at),
    })),
    total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

router.get("/unread-count", async (c) => {
  const user = currentUser(c);
  const count = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [user.id],
  );
  return c.json({ count });
});

router.post("/:id/read", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<{ id: string; read_at: string | null }>(
    c.env.DB,
    `SELECT id, read_at FROM notifications WHERE id = ? AND user_id = ?`,
    [id, user.id],
  );
  if (!row) throw notFound("Notificação não encontrada.");

  if (!row.read_at) {
    await c.env.DB
      .prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`)
      .bind(nowIso(), id, user.id)
      .run();
  }
  return c.json({ ok: true });
});

router.post("/read-all", async (c) => {
  const user = currentUser(c);
  const result = await c.env.DB
    .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
    .bind(nowIso(), user.id)
    .run();
  return c.json({ ok: true, updated: result.meta?.changes ?? 0 });
});

router.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const result = await c.env.DB
    .prepare(`DELETE FROM notifications WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) throw notFound("Notificação não encontrada.");
  return c.json({ ok: true });
});

export default router;
