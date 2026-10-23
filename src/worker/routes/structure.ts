import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { assertLocationAllowed, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, insertStatement, oneRow, updateStatement } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Validação                                                                  */
/* -------------------------------------------------------------------------- */

const optionalText = (max: number) => z.string().trim().max(max).nullish();

const unitBody = z.object({
  name: z.string().trim().min(2, "Informe o nome da unidade.").max(120),
  code: z.string().trim().min(1, "Informe o código da unidade.").max(30),
  address: optionalText(300),
  notes: optionalText(1000),
});

const locationTypeBody = z.object({
  name: z.string().trim().min(2, "Informe o nome do tipo.").max(80),
  code: z
    .string()
    .trim()
    .min(2, "Informe o código do tipo.")
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Use apenas letras minusculas, números e sublinhado."),
  description: optionalText(300),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const locationBody = z.object({
  unitId: z.string().trim().min(1, "Selecione a unidade."),
  parentId: z.string().trim().min(1).nullish(),
  typeId: z.string().trim().min(1, "Selecione o tipo de local."),
  name: z.string().trim().min(1, "Informe o nome do local.").max(120),
  code: optionalText(40),
  notes: optionalText(1000),
});

const toggleBody = z.object({ isActive: z.boolean() });

const listQuery = z.object({
  unitId: z.string().trim().optional(),
  typeId: z.string().trim().optional(),
  typeCode: z.string().trim().optional(),
  parentId: z.string().trim().optional(),
  search: z.string().trim().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

/* -------------------------------------------------------------------------- */
/* Unidades                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/units", requirePermission(PERMISSIONS.STRUCTURE_VIEW), async (c) => {
  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT u.id, u.name, u.code, u.address, u.notes, u.is_active,
            (SELECT COUNT(*) FROM locations l WHERE l.unit_id = u.id AND l.deleted_at IS NULL) AS location_count
       FROM units u
      WHERE u.deleted_at IS NULL
      ORDER BY u.is_active DESC, u.name`,
  );
  return c.json({ items: items.map(mapUnit) });
});

router.post("/units", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, unitBody);
  const ts = nowIso();
  const id = uuid();

  const duplicate = await oneRow<{ id: string }>(
    c.env.DB,
    `SELECT id FROM units WHERE code = ? COLLATE NOCASE`,
    [body.code],
  );
  if (duplicate) throw conflict("Já existe uma unidade com este código.");

  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "units", {
      id,
      name: body.name,
      code: body.code,
      address: body.address ?? null,
      notes: body.notes ?? null,
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "unit.create",
      entityType: "unit",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);

  return c.json({ id }, 201);
});

router.patch("/units/:id", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, unitBody.partial().merge(toggleBody.partial()));

  const before = await oneRow<Record<string, unknown>>(c.env.DB, `SELECT * FROM units WHERE id = ?`, [id]);
  if (!before) throw notFound("Unidade não encontrada.");

  if (body.code) {
    const duplicate = await oneRow<{ id: string }>(
      c.env.DB,
      `SELECT id FROM units WHERE code = ? COLLATE NOCASE AND id <> ?`,
      [body.code, id],
    );
    if (duplicate) throw conflict("Já existe uma unidade com este código.");
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.address !== undefined ? { address: body.address ?? null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  await c.env.DB.batch([
    updateStatement(c.env.DB, "units", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "unit.update",
      entityType: "unit",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Tipos de local                                                             */
/* -------------------------------------------------------------------------- */

router.get("/location-types", requirePermission(PERMISSIONS.STRUCTURE_VIEW), async (c) => {
  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, code, description, sort_order, is_active FROM location_types
      WHERE deleted_at IS NULL
      ORDER BY is_active DESC, sort_order, name`,
  );
  return c.json({ items: items.map(mapLocationType) });
});

router.post("/location-types", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, locationTypeBody);
  const id = uuid();
  const ts = nowIso();

  const duplicate = await oneRow<{ id: string }>(
    c.env.DB,
    `SELECT id FROM location_types WHERE code = ? COLLATE NOCASE`,
    [body.code],
  );
  if (duplicate) throw conflict("Já existe um tipo de local com este código.");

  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "location_types", {
      id,
      name: body.name,
      code: body.code,
      description: body.description ?? null,
      sort_order: body.sortOrder ?? 500,
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "location_type.create",
      entityType: "location_type",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);

  return c.json({ id }, 201);
});

router.patch("/location-types/:id", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, locationTypeBody.partial().merge(toggleBody.partial()));

  const before = await oneRow<Record<string, unknown>>(c.env.DB, `SELECT * FROM location_types WHERE id = ?`, [id]);
  if (!before) throw notFound("Tipo de local não encontrado.");

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "location_types", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "location_type.update",
      entityType: "location_type",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Locais                                                                     */
/* -------------------------------------------------------------------------- */

const LOCATION_SELECT = `
  SELECT l.id, l.unit_id, l.parent_id, l.type_id, l.name, l.code, l.path, l.notes, l.is_active,
         l.created_at, l.updated_at,
         t.name AS type_name, t.code AS type_code, t.sort_order AS type_sort_order,
         u.name AS unit_name,
         p.name AS parent_name,
         (SELECT COALESCE(SUM(s.qty_milli), 0) FROM stock s WHERE s.location_id = l.id) AS stock_qty_milli,
         (SELECT COUNT(*) FROM locations c WHERE c.parent_id = l.id) AS child_count
    FROM locations l
    JOIN location_types t ON t.id = l.type_id
    JOIN units u ON u.id = l.unit_id
    LEFT JOIN locations p ON p.id = l.parent_id`;

router.get("/locations", requirePermission(PERMISSIONS.STRUCTURE_VIEW), async (c) => {
  const user = currentUser(c);
  const q = parseQuery(c);

  const clauses: string[] = ["l.deleted_at IS NULL"];
  const params: (string | number)[] = [];

  if (q.unitId) {
    clauses.push("l.unit_id = ?");
    params.push(q.unitId);
  }
  if (q.typeId) {
    clauses.push("l.type_id = ?");
    params.push(q.typeId);
  }
  if (q.typeCode) {
    clauses.push("t.code = ?");
    params.push(q.typeCode);
  }
  if (q.parentId) {
    clauses.push("l.parent_id = ?");
    params.push(q.parentId);
  }
  if (q.isActive) {
    clauses.push("l.is_active = ?");
    params.push(q.isActive === "true" ? 1 : 0);
  }
  if (q.search) {
    clauses.push("(l.name LIKE ? OR COALESCE(l.code,'') LIKE ? OR l.path LIKE ?)");
    const like = `%${q.search}%`;
    params.push(like, like, like);
  }
  // Escopo por local: usuário restrito só enxerga seus locais.
  if (user.locationScope.length > 0) {
    clauses.push(`l.id IN (${user.locationScope.map(() => "?").join(",")})`);
    params.push(...user.locationScope);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = q.limit ?? 2000;

  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${LOCATION_SELECT} ${where} ORDER BY u.name, l.path LIMIT ?`,
    [...params, limit],
  );
  return c.json({ items: items.map(mapLocation) });
});

function parseQuery(c: { req: { url: string } }) {
  const url = new URL(c.req.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const parsed = listQuery.safeParse({
    unitId: get("unitId"),
    typeId: get("typeId"),
    typeCode: get("typeCode"),
    parentId: get("parentId"),
    search: get("search"),
    isActive: get("isActive"),
    limit: get("limit"),
  });
  if (!parsed.success) throw badRequest("Filtros inválidos.", parsed.error.issues);
  return parsed.data;
}

/** Arvore completa para seletores de local. */
router.get("/locations/tree", requirePermission(PERMISSIONS.STRUCTURE_VIEW), async (c) => {
  const user = currentUser(c);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${LOCATION_SELECT} WHERE l.is_active = 1 AND l.deleted_at IS NULL ORDER BY u.name, t.sort_order, l.name`,
  );
  const allowed = user.locationScope;
  const visible = allowed.length === 0 ? rows : rows.filter((r) => allowed.includes(String(r.id)));

  const byId = new Map<string, LocationNode>();
  for (const row of visible) {
    const mapped = mapLocation(row);
    byId.set(mapped.id, { ...mapped, children: [] });
  }
  const roots: LocationNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return c.json({ items: roots });
});

interface LocationNode extends ReturnType<typeof mapLocation> {
  children: LocationNode[];
}

router.get("/locations/:id", requirePermission(PERMISSIONS.STRUCTURE_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${LOCATION_SELECT} WHERE l.id = ?`, [id]);
  if (!row) throw notFound("Local não encontrado.");
  assertLocationAllowed(user, id);
  return c.json({ location: mapLocation(row) });
});

router.post("/locations", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, locationBody);

  await assertUnitExists(c.env.DB, body.unitId);
  await assertLocationTypeExists(c.env.DB, body.typeId);
  if (body.parentId) {
    const parent = await oneRow<{ unit_id: string }>(c.env.DB, `SELECT unit_id FROM locations WHERE id = ?`, [
      body.parentId,
    ]);
    if (!parent) throw notFound("Local superior não encontrado.");
    if (parent.unit_id !== body.unitId) {
      throw badRequest("O local superior pertence a outra unidade.");
    }
  }

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);

  await c.env.DB.batch([
    insertStatement(c.env.DB, "locations", {
      id,
      unit_id: body.unitId,
      parent_id: body.parentId ?? null,
      type_id: body.typeId,
      name: body.name,
      code: body.code ?? null,
      path: body.name,
      notes: body.notes ?? null,
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "location.create",
      entityType: "location",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);

  await recomputePaths(c.env.DB, body.unitId);
  return c.json({ id }, 201);
});

router.patch("/locations/:id", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, locationBody.partial().merge(toggleBody.partial()));

  const before = await oneRow<Record<string, unknown>>(c.env.DB, `SELECT * FROM locations WHERE id = ?`, [id]);
  if (!before) throw notFound("Local não encontrado.");

  const unitId = String(before.unit_id);
  const parentId = body.parentId !== undefined ? (body.parentId ?? null) : (before.parent_id as string | null);

  if (parentId === id) throw badRequest("Um local não pode ser superior de si mesmo.");
  if (body.typeId) await assertLocationTypeExists(c.env.DB, body.typeId);

  if (parentId) {
    const parent = await oneRow<{ unit_id: string }>(c.env.DB, `SELECT unit_id FROM locations WHERE id = ?`, [
      parentId,
    ]);
    if (!parent) throw notFound("Local superior não encontrado.");
    if (parent.unit_id !== unitId) throw badRequest("O local superior pertence a outra unidade.");
    if (await isDescendant(c.env.DB, parentId, id)) {
      throw badRequest("Não é possível mover um local para dentro de um descendente dele.");
    }
  }

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.code !== undefined ? { code: body.code ?? null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.typeId !== undefined ? { type_id: body.typeId } : {}),
    ...(body.parentId !== undefined ? { parent_id: parentId } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "locations", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "location.update",
      entityType: "location",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);

  await recomputePaths(c.env.DB, unitId);
  return c.json({ ok: true });
});

/**
 * Desativação de local. Nunca exclui fisicamente: o histórico de movimentações
 * e de consumo referência este local e precisa continuar integro.
 */
router.delete("/locations/:id", requirePermission(PERMISSIONS.STRUCTURE_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");

  const location = await oneRow<{ unit_id: string; name: string }>(
    c.env.DB,
    `SELECT unit_id, name FROM locations WHERE id = ?`,
    [id],
  );
  if (!location) throw notFound("Local não encontrado.");

  const children = await oneRow<{ total: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS total FROM locations WHERE parent_id = ? AND is_active = 1`,
    [id],
  );
  if ((children?.total ?? 0) > 0) {
    throw conflict("Desative primeiro os locais filhos deste local.");
  }

  const stock = await oneRow<{ total: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(qty_milli), 0) AS total FROM stock WHERE location_id = ?`,
    [id],
  );
  if ((stock?.total ?? 0) !== 0) {
    throw conflict("Este local ainda possui saldo de estoque. Transfira ou ajuste antes de desativar.");
  }

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "locations", id, { is_active: 0, updated_at: ts }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "structure",
      action: "location.deactivate",
      entityType: "location",
      entityId: id,
      reason: "Desativação solicitada pelo usuário.",
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

async function assertUnitExists(db: D1Database, unitId: string): Promise<void> {
  const unit = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM units WHERE id = ?`, [unitId]);
  if (!unit) throw notFound("Unidade não encontrada.");
}

async function assertLocationTypeExists(db: D1Database, typeId: string): Promise<void> {
  const type = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM location_types WHERE id = ?`, [
    typeId,
  ]);
  if (!type) throw notFound("Tipo de local não encontrado.");
  if (type.is_active !== 1) throw badRequest("Este tipo de local esta inativo.");
}

/** true quando `candidateId` esta na subarvore de `ancestorId`. */
async function isDescendant(db: D1Database, candidateId: string, ancestorId: string): Promise<boolean> {
  const row = await oneRow<{ total: number }>(
    db,
    `WITH RECURSIVE subtree(id) AS (
       SELECT id FROM locations WHERE id = ?
       UNION
       SELECT l.id FROM locations l JOIN subtree s ON l.parent_id = s.id
     )
     SELECT COUNT(*) AS total FROM subtree WHERE id = ?`,
    [ancestorId, candidateId],
  );
  return (row?.total ?? 0) > 0;
}

/**
 * Recalcula o caminho materializado de todos os locais de uma unidade.
 * Executado após criação, renomeação ou movimentação de um local para que o
 * `path` nunca fique desatualizado em relação a hierarquia real.
 */
export async function recomputePaths(db: D1Database, unitId: string): Promise<void> {
  const rows = await allRows<{ id: string; parent_id: string | null; name: string; path: string }>(
    db,
    `SELECT id, parent_id, name, path FROM locations WHERE unit_id = ?`,
    [unitId],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const memo = new Map<string, string>();

  const pathOf = (id: string, guard = 0): string => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const row = byId.get(id);
    if (!row || guard > 50) return "";
    const value = row.parent_id ? `${pathOf(row.parent_id, guard + 1)} / ${row.name}` : row.name;
    memo.set(id, value);
    return value;
  };

  const updates = rows
    .map((row) => ({ id: row.id, path: pathOf(row.id), previous: row.path }))
    .filter((row) => row.path !== row.previous);

  if (updates.length === 0) return;

  const ts = nowIso();
  const statements = updates.map((row) =>
    db.prepare(`UPDATE locations SET path = ?, updated_at = ? WHERE id = ?`).bind(row.path, ts, row.id),
  );
  // D1 limita o número de statements por batch; envia em blocos seguros.
  for (let i = 0; i < statements.length; i += 50) {
    await db.batch(statements.slice(i, i + 50));
  }
}

function mapUnit(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    address: row.address ? String(row.address) : null,
    notes: row.notes ? String(row.notes) : null,
    isActive: Number(row.is_active) === 1,
    locationCount: row.location_count !== undefined ? Number(row.location_count) : undefined,
  };
}

function mapLocationType(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    description: row.description ? String(row.description) : null,
    sortOrder: Number(row.sort_order),
    isActive: Number(row.is_active) === 1,
  };
}

function mapLocation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    unitId: String(row.unit_id),
    unitName: row.unit_name ? String(row.unit_name) : null,
    parentId: row.parent_id ? String(row.parent_id) : null,
    parentName: row.parent_name ? String(row.parent_name) : null,
    typeId: String(row.type_id),
    typeName: row.type_name ? String(row.type_name) : null,
    typeCode: row.type_code ? String(row.type_code) : null,
    name: String(row.name),
    code: row.code ? String(row.code) : null,
    path: String(row.path ?? row.name),
    notes: row.notes ? String(row.notes) : null,
    isActive: Number(row.is_active) === 1,
    childCount: row.child_count !== undefined ? Number(row.child_count) : undefined,
    stockQtyMilli: row.stock_qty_milli !== undefined ? Number(row.stock_qty_milli) : undefined,
  };
}

export default router;
