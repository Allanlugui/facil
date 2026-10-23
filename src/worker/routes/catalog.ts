import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import { toMilli } from "@shared/types";
import type { AppEnv } from "../types";
import { currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow, updateStatement } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { searchTokens, sqlSearchExpression } from "../search";
import { nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const optionalText = (max: number) => z.string().trim().max(max).nullish();
const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9._-]+$/, "Use apenas letras, números, ponto, hifen e sublinhado.");

const categoryBody = z.object({
  name: z.string().trim().min(2, "Informe o nome da categoria.").max(80),
  parentId: z.string().trim().min(1).nullish(),
  description: optionalText(300),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const uomBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Informe a sigla.")
    .max(10)
    .regex(/^[A-Z0-9]{1,10}$/, "Use de 1 a 10 caracteres alfanuméricos."),
  name: z.string().trim().min(2, "Informe o nome da unidade.").max(60),
  allowsDecimal: z.boolean().optional(),
});

const supplierBody = z.object({
  name: z.string().trim().min(2, "Informe o nome do fornecedor.").max(160),
  doc: optionalText(40),
  contactName: optionalText(120),
  phone: optionalText(40),
  email: z.union([z.string().trim().toLowerCase().email("E-mail inválido."), z.literal("")]).nullish(),
  notes: optionalText(1000),
});

const qtySchema = z
  .number()
  .finite()
  .nonnegative("A quantidade não pode ser negativa.")
  .max(1_000_000, "Quantidade fora do limite permitido.");

const productBody = z.object({
  name: z.string().trim().min(2, "Informe o nome do produto.").max(160),
  sku: z.union([codeSchema, z.literal("")]).nullish(),
  description: optionalText(1000),
  categoryId: z.string().trim().min(1).nullish(),
  uomId: z.string().trim().min(1, "Selecione a unidade de consumo."),
  packUomId: z.string().trim().min(1).nullish(),
  packFactor: z.number().int().min(1, "O fator de conversão deve ser pelo menos 1.").max(100_000).optional(),
  minQty: qtySchema.optional(),
  defaultSupplierId: z.string().trim().min(1).nullish(),
  tracksStock: z.boolean().optional(),
  notes: optionalText(1000),
});

const toggleBody = z.object({ isActive: z.boolean() });
const catalogStatusBody = z.object({
  /** Conclui (ou reabre) o cadastro rápido feito no recebimento. */
  catalogStatus: z.enum(["complete", "incomplete"]).optional(),
});

export function milliOrThrow(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const milli = toMilli(value);
  if (!Number.isInteger(milli)) throw badRequest("Quantidade com precisão inválida.");
  return milli;
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                 */
/* -------------------------------------------------------------------------- */

router.get("/categories", requirePermission(PERMISSIONS.CATALOG_VIEW), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT c.id, c.name, c.parent_id, c.description, c.sort_order, c.is_active,
            p.name AS parent_name,
            (SELECT COUNT(*) FROM products pr WHERE pr.category_id = c.id) AS product_count
       FROM product_categories c
       LEFT JOIN product_categories p ON p.id = c.parent_id
      WHERE c.deleted_at IS NULL
      ORDER BY c.sort_order, c.name`,
  );
  return c.json({
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      parentId: r.parent_id ? String(r.parent_id) : null,
      parentName: r.parent_name ? String(r.parent_name) : null,
      description: r.description ? String(r.description) : null,
      sortOrder: Number(r.sort_order),
      isActive: Number(r.is_active) === 1,
      productCount: Number(r.product_count ?? 0),
    })),
  });
});

router.post("/categories", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, categoryBody);
  const id = uuid();
  const ts = nowIso();

  if (body.parentId) {
    const parent = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM product_categories WHERE id = ?`, [
      body.parentId,
    ]);
    if (!parent) throw notFound("Categoria superior não encontrada.");
  }
  const duplicate = await oneRow<{ id: string }>(
    c.env.DB,
    `SELECT id FROM product_categories WHERE name = ? COLLATE NOCASE AND COALESCE(parent_id,'') = COALESCE(?,'')`,
    [body.name, body.parentId ?? null],
  );
  if (duplicate) throw conflict("Já existe uma categoria com este nome neste nível.");

  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "product_categories", {
      id,
      name: body.name,
      parent_id: body.parentId ?? null,
      description: body.description ?? null,
      sort_order: body.sortOrder ?? 500,
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "category.create",
      entityType: "product_category",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);
  return c.json({ id }, 201);
});

router.patch("/categories/:id", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, categoryBody.partial().merge(toggleBody.partial()));

  const before = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, parent_id, description, sort_order, is_active FROM product_categories WHERE id = ?`,
    [id],
  );
  if (!before) throw notFound("Categoria não encontrada.");
  if (body.parentId === id) throw badRequest("Uma categoria não pode ser superior de si mesma.");

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.parentId !== undefined ? { parent_id: body.parentId ?? null } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "product_categories", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "category.update",
      entityType: "product_category",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Unidades de medida                                                         */
/* -------------------------------------------------------------------------- */

router.get("/uoms", requirePermission(PERMISSIONS.CATALOG_VIEW), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT u.id, u.code, u.name, u.allows_decimal, u.is_active,
            (SELECT COUNT(*) FROM products p WHERE p.uom_id = u.id) AS product_count
       FROM uoms u WHERE u.deleted_at IS NULL ORDER BY u.is_active DESC, u.name`,
  );
  return c.json({
    items: rows.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      allowsDecimal: Number(r.allows_decimal) === 1,
      isActive: Number(r.is_active) === 1,
      productCount: Number(r.product_count ?? 0),
    })),
  });
});

router.post("/uoms", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, uomBody);
  const duplicate = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM uoms WHERE code = ?`, [body.code]);
  if (duplicate) throw conflict("Já existe uma unidade de medida com esta sigla.");

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "uoms", {
      id,
      code: body.code,
      name: body.name,
      allows_decimal: body.allowsDecimal ? 1 : 0,
      is_active: 1,
      created_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "uom.create",
      entityType: "uom",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);
  return c.json({ id }, 201);
});

router.patch("/uoms/:id", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(
    c,
    uomBody.partial().merge(toggleBody.partial()),
  );
  const before = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name, allows_decimal, is_active FROM uoms WHERE id = ?`,
    [id],
  );
  if (!before) throw notFound("Unidade de medida não encontrada.");

  const ts = nowIso();
  const updated = {
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.allowsDecimal !== undefined ? { allows_decimal: body.allowsDecimal ? 1 : 0 } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "uoms", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "uom.update",
      entityType: "uom",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);
  void ts;
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Fornecedores                                                               */
/* -------------------------------------------------------------------------- */

router.get("/suppliers", requirePermission(PERMISSIONS.CATALOG_VIEW), async (c) => {
  const url = new URL(c.req.url);
  const search = url.searchParams.get("search")?.trim();
  const isActive = url.searchParams.get("isActive");
  const clauses: string[] = ["s.deleted_at IS NULL"];
  const params: (string | number)[] = [];
  if (search) {
    clauses.push(`(s.name LIKE ? OR COALESCE(s.doc,'') LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (isActive) {
    clauses.push(`s.is_active = ?`);
    params.push(isActive === "true" ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT s.id, s.name, s.doc, s.contact_name, s.phone, s.email, s.notes, s.is_active
       FROM suppliers s ${where} ORDER BY s.is_active DESC, s.name LIMIT 500`,
    params,
  );
  return c.json({
    items: rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      doc: r.doc ? String(r.doc) : null,
      contactName: r.contact_name ? String(r.contact_name) : null,
      phone: r.phone ? String(r.phone) : null,
      email: r.email ? String(r.email) : null,
      notes: r.notes ? String(r.notes) : null,
      isActive: Number(r.is_active) === 1,
    })),
  });
});

router.post("/suppliers", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, supplierBody);
  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "suppliers", {
      id,
      name: body.name,
      doc: body.doc ?? null,
      contact_name: body.contactName ?? null,
      phone: body.phone ?? null,
      email: body.email ? body.email : null,
      notes: body.notes ?? null,
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "supplier.create",
      entityType: "supplier",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);
  return c.json({ id }, 201);
});

router.patch("/suppliers/:id", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, supplierBody.partial().merge(toggleBody.partial()));
  const before = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, doc, contact_name, phone, email, notes, is_active FROM suppliers WHERE id = ?`,
    [id],
  );
  if (!before) throw notFound("Fornecedor não encontrado.");

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.doc !== undefined ? { doc: body.doc ?? null } : {}),
    ...(body.contactName !== undefined ? { contact_name: body.contactName ?? null } : {}),
    ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
    ...(body.email !== undefined ? { email: body.email ? body.email : null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "suppliers", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "supplier.update",
      entityType: "supplier",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Produtos                                                                   */
/* -------------------------------------------------------------------------- */

export const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.name, p.description, p.category_id, p.uom_id,
         p.pack_uom_id, p.pack_factor, p.min_qty_milli, p.default_supplier_id,
         p.requires_location, p.is_active, p.catalog_status, p.notes, p.created_at, p.updated_at,
         c.name AS category_name,
         u.code AS uom_code, u.name AS uom_name, u.allows_decimal,
         pu.code AS pack_uom_code,
         s.name AS supplier_name,
         (SELECT COALESCE(SUM(st.qty_milli), 0) FROM stock st WHERE st.product_id = p.id) AS total_qty_milli,
         (SELECT COUNT(*) FROM stock st WHERE st.product_id = p.id AND st.qty_milli > 0) AS stocked_locations
    FROM products p
    LEFT JOIN product_categories c ON c.id = p.category_id
    JOIN uoms u ON u.id = p.uom_id
    LEFT JOIN uoms pu ON pu.id = p.pack_uom_id
    LEFT JOIN suppliers s ON s.id = p.default_supplier_id`;

/**
 * Texto pesquisável do produto: nome + SKU + descrição normalizados em SQL.
 * É a base da busca aproximada (acentos e caixa não importam).
 */
const PRODUCT_SEARCH_EXPR = sqlSearchExpression(
  `p.name || ' ' || COALESCE(p.sku,'') || ' ' || COALESCE(p.description,'')`,
);


router.get("/products", requirePermission(PERMISSIONS.CATALOG_VIEW), async (c) => {
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });
  const search = url.searchParams.get("search")?.trim();
  const categoryId = url.searchParams.get("categoryId")?.trim();
  const isActive = url.searchParams.get("isActive");
  const lowStockOnly = url.searchParams.get("lowStock") === "true";
  const incompleteOnly = url.searchParams.get("incomplete") === "true";
  const sort = url.searchParams.get("sort") ?? "name";

  const clauses: string[] = ["p.deleted_at IS NULL"];
  const params: (string | number)[] = [];
  // Busca aproximada: cada termo digitado precisa aparecer no nome, SKU ou
  // descrição — "agua sanit" acha "Água Sanitária" e a ordem das palavras
  // não importa.
  const tokens = search ? searchTokens(search) : [];
  for (const token of tokens) {
    clauses.push(`${PRODUCT_SEARCH_EXPR} LIKE ?`);
    params.push(`%${token}%`);
  }
  if (categoryId) {
    clauses.push(`p.category_id = ?`);
    params.push(categoryId);
  }
  if (isActive) {
    clauses.push(`p.is_active = ?`);
    params.push(isActive === "true" ? 1 : 0);
  }
  if (incompleteOnly) {
    clauses.push(`p.catalog_status = 'incomplete'`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBase =
    sort === "stock"
      ? "total_qty_milli ASC, p.name"
      : sort === "category"
        ? "COALESCE(c.name,'Zzz'), p.name"
        : "p.name";
  // Na busca, quem tem o primeiro termo mais perto do início vem primeiro.
  const orderBy = tokens.length ? `instr(${PRODUCT_SEARCH_EXPR}, ?) ASC, ${orderBase}` : orderBase;

  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM products p ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${PRODUCT_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, ...(tokens.length ? [tokens[0] as string] : []), page.pageSize, offsetOf(page)],
  );

  let items = rows.map(mapProduct);
  if (lowStockOnly) items = items.filter((p) => p.isBelowMinimum);

  return c.json({ items, total, page: page.page, pageSize: page.pageSize });
});

/** Produtos com saldo abaixo do mínimo, detalhados por local de estoque. */
router.get("/products/low-stock", requirePermission(PERMISSIONS.STOCK_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const unitId = url.searchParams.get("unitId")?.trim();
  const categoryId = url.searchParams.get("categoryId")?.trim();

  const clauses = ["p.is_active = 1", "p.min_qty_milli > 0", "l.is_active = 1"];
  const params: (string | number)[] = [];
  if (unitId) {
    clauses.push("l.unit_id = ?");
    params.push(unitId);
  }
  if (categoryId) {
    clauses.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (user.locationScope.length > 0) {
    clauses.push(`l.id IN (${user.locationScope.map(() => "?").join(",")})`);
    params.push(...user.locationScope);
  }
  // Considera apenas locais que armazenam estoque (tenham saldo ou mínimo definido
  // por produto): o painel mostra a falta REAL por local, sem esconder a ausência
  // em um almoxarifado por existir saldo em outro.
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT p.id AS product_id, p.name AS product_name, p.sku, p.min_qty_milli,
            u.code AS uom_code, c.name AS category_name,
            l.id AS location_id, l.name AS location_name, l.path AS location_path,
            COALESCE(s.qty_milli, 0) AS qty_milli
       FROM products p
       JOIN uoms u ON u.id = p.uom_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       JOIN (
         SELECT DISTINCT product_id, location_id FROM stock
         UNION
         SELECT p2.id, l2.id FROM products p2, locations l2
          WHERE l2.is_active = 1 AND p2.is_active = 1 AND p2.min_qty_milli > 0
            AND l2.type_id = 'lt_almoxarifado'
       ) pairs ON pairs.product_id = p.id
       JOIN locations l ON l.id = pairs.location_id
       LEFT JOIN stock s ON s.product_id = p.id AND s.location_id = l.id
      WHERE ${clauses.join(" AND ")}
      ORDER BY (COALESCE(s.qty_milli,0) - p.min_qty_milli) ASC, p.name, l.path`,
    params,
  );

  const items = rows
    .map((r) => {
      const qtyMilli = Number(r.qty_milli);
      const minMilli = Number(r.min_qty_milli);
      return {
        productId: String(r.product_id),
        productName: String(r.product_name),
        sku: r.sku ? String(r.sku) : null,
        uomCode: String(r.uom_code),
        categoryName: r.category_name ? String(r.category_name) : null,
        locationId: String(r.location_id),
        locationName: String(r.location_name),
        locationPath: String(r.location_path),
        qtyMilli,
        minQtyMilli: minMilli,
        deficitMilli: Math.max(0, minMilli - qtyMilli),
        status: qtyMilli <= 0 ? ("out_of_stock" as const) : qtyMilli < minMilli ? ("low" as const) : ("ok" as const),
      };
    })
    .filter((r) => r.status !== "ok");

  return c.json({
    items,
    summary: {
      outOfStock: items.filter((i) => i.status === "out_of_stock").length,
      low: items.filter((i) => i.status === "low").length,
    },
  });
});

router.get("/products/:id", requirePermission(PERMISSIONS.CATALOG_VIEW), async (c) => {
  const user = currentUser(c);
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${PRODUCT_SELECT} WHERE p.id = ?`, [
    c.req.param("id"),
  ]);
  if (!row) throw notFound("Produto não encontrado.");

  const params: string[] = [String(row.id)];
  const scopeClause =
    user.locationScope.length > 0
      ? ` AND s.location_id IN (${user.locationScope.map(() => "?").join(",")})`
      : "";
  if (user.locationScope.length > 0) params.push(...user.locationScope);

  const byLocation = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT l.id AS location_id, l.name AS location_name, l.path AS location_path,
            l.is_active AS location_active, s.qty_milli
       FROM stock s JOIN locations l ON l.id = s.location_id
      WHERE s.product_id = ? AND s.qty_milli <> 0${scopeClause}
      ORDER BY s.qty_milli DESC, l.path`,
    params,
  );

  return c.json({
    product: mapProduct(row),
    stockByLocation: byLocation.map((s) => ({
      locationId: String(s.location_id),
      locationName: String(s.location_name),
      locationPath: String(s.location_path),
      locationActive: Number(s.location_active) === 1,
      qtyMilli: Number(s.qty_milli),
    })),
  });
});

router.post("/products", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, productBody);

  await assertUomExists(c.env.DB, body.uomId);
  if (body.packUomId) await assertUomExists(c.env.DB, body.packUomId);
  if (body.categoryId) {
    const category = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM product_categories WHERE id = ?`, [
      body.categoryId,
    ]);
    if (!category) throw notFound("Categoria não encontrada.");
  }
  if (body.defaultSupplierId) {
    const supplier = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM suppliers WHERE id = ?`, [
      body.defaultSupplierId,
    ]);
    if (!supplier) throw notFound("Fornecedor não encontrado.");
  }
  if (body.sku) {
    const duplicate = await oneRow<{ id: string }>(
      c.env.DB,
      `SELECT id FROM products WHERE sku = ? COLLATE NOCASE`,
      [body.sku],
    );
    if (duplicate) throw conflict("Já existe um produto com este código (SKU).");
  }
  if (body.packUomId && !body.packFactor) {
    throw badRequest("Informe quantas unidades de consumo existem em uma embalagem.");
  }

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "products", {
      id,
      sku: body.sku ? body.sku : null,
      name: body.name,
      description: body.description ?? null,
      category_id: body.categoryId ?? null,
      uom_id: body.uomId,
      pack_uom_id: body.packUomId ?? null,
      pack_factor: body.packFactor ?? 1,
      min_qty_milli: milliOrThrow(body.minQty) ?? 0,
      default_supplier_id: body.defaultSupplierId ?? null,
      requires_location: body.tracksStock === false ? 0 : 1,
      is_active: 1,
      notes: body.notes ?? null,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "product.create",
      entityType: "product",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);

  return c.json({ id }, 201);
});

router.patch("/products/:id", requirePermission(PERMISSIONS.CATALOG_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, productBody.partial().merge(toggleBody.partial()).merge(catalogStatusBody.partial()));

  const before = await oneRow<Record<string, unknown>>(c.env.DB, `SELECT * FROM products WHERE id = ?`, [id]);
  if (!before) throw notFound("Produto não encontrado.");

  if (body.uomId) await assertUomExists(c.env.DB, body.uomId);
  if (body.packUomId) await assertUomExists(c.env.DB, body.packUomId);
  if (body.sku) {
    const duplicate = await oneRow<{ id: string }>(
      c.env.DB,
      `SELECT id FROM products WHERE sku = ? COLLATE NOCASE AND id <> ?`,
      [body.sku, id],
    );
    if (duplicate) throw conflict("Já existe um produto com este código (SKU).");
  }
  // Alterar a unidade de consumo de um produto com saldo tornaria os números
  // históricos incompatíveis com os novos lançamentos.
  if (body.uomId && body.uomId !== before.uom_id) {
    const stock = await countRows(c.env.DB, `SELECT COUNT(*) FROM stock WHERE product_id = ? AND qty_milli <> 0`, [
      id,
    ]);
    if (stock > 0) {
      throw conflict(
        "Não é possível alterar a unidade de consumo de um produto que possui saldo. Zere o saldo ou crie um novo produto.",
      );
    }
  }

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.sku !== undefined ? { sku: body.sku ? body.sku : null } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.categoryId !== undefined ? { category_id: body.categoryId ?? null } : {}),
    ...(body.uomId !== undefined ? { uom_id: body.uomId } : {}),
    ...(body.packUomId !== undefined ? { pack_uom_id: body.packUomId ?? null } : {}),
    ...(body.packFactor !== undefined ? { pack_factor: body.packFactor } : {}),
    ...(body.minQty !== undefined ? { min_qty_milli: milliOrThrow(body.minQty) ?? 0 } : {}),
    ...(body.defaultSupplierId !== undefined ? { default_supplier_id: body.defaultSupplierId ?? null } : {}),
    ...(body.tracksStock !== undefined ? { requires_location: body.tracksStock ? 1 : 0 } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    ...(body.catalogStatus !== undefined ? { catalog_status: body.catalogStatus } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "products", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "catalog",
      action: "product.update",
      entityType: "product",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

async function assertUomExists(db: D1Database, uomId: string): Promise<void> {
  const uom = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM uoms WHERE id = ?`, [uomId]);
  if (!uom) throw notFound("Unidade de medida não encontrada.");
  if (uom.is_active !== 1) throw badRequest("Esta unidade de medida esta inativa.");
}

export function mapProduct(row: Record<string, unknown>) {
  const minMilli = Number(row.min_qty_milli ?? 0);
  const totalMilli = Number(row.total_qty_milli ?? 0);
  return {
    id: String(row.id),
    sku: row.sku ? String(row.sku) : null,
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    categoryId: row.category_id ? String(row.category_id) : null,
    categoryName: row.category_name ? String(row.category_name) : null,
    uomId: String(row.uom_id),
    uomCode: row.uom_code ? String(row.uom_code) : null,
    uomName: row.uom_name ? String(row.uom_name) : null,
    allowsDecimal: Number(row.allows_decimal ?? 1) === 1,
    packUomId: row.pack_uom_id ? String(row.pack_uom_id) : null,
    packUomCode: row.pack_uom_code ? String(row.pack_uom_code) : null,
    packFactor: Number(row.pack_factor ?? 1),
    minQtyMilli: minMilli,
    defaultSupplierId: row.default_supplier_id ? String(row.default_supplier_id) : null,
    supplierName: row.supplier_name ? String(row.supplier_name) : null,
    tracksStock: Number(row.requires_location ?? 1) === 1,
    isActive: Number(row.is_active) === 1,
    catalogStatus: row.catalog_status ? String(row.catalog_status) : "complete",
    notes: row.notes ? String(row.notes) : null,
    totalQtyMilli: totalMilli,
    stockedLocations: Number(row.stocked_locations ?? 0),
    isBelowMinimum: minMilli > 0 && totalMilli < minMilli,
    createdAt: row.created_at ? String(row.created_at) : null,
  };
}

export default router;
