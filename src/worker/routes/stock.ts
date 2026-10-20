import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { PERMISSIONS, type PermissionCode } from "@shared/permissions";
import { MOVEMENT_TYPES, type MovementType } from "@shared/types";
import type { AppEnv, AuthUser } from "../types";
import {
  assertLocationAllowed,
  currentUser,
  recordPermissionDenied,
  requireAuth,
  requirePermission,
} from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, normalizePage, offsetOf, oneRow } from "../db";
import { badRequest, conflict, forbidden, notFound, parseBody } from "../errors";
import { assertSufficientStock, recordMovements, type MovementRequest, type RefType } from "../stock";
import { normalizeRangeBound } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Regras por tipo de movimentação                                            */
/* -------------------------------------------------------------------------- */

interface MovementRule {
  /** Permissão exigida. `any` aceita qualquer uma da lista. */
  permissions: PermissionCode[];
  requireFrom: boolean;
  requireTo: boolean;
  requireReason: boolean;
  label: string;
}

/**
 * Tipos que podem ser criados diretamente por esta rota.
 * `purchase_receipt`, `maintenance_use`, `consumption` e `inventory_adjust`
 * são criados pelos seus módulos de origem, que garantem o vínculo e a regra
 * de negócio correspondente (recebimento, ordem de serviço, consumo, contagem).
 */
const RULES: Partial<Record<MovementType, MovementRule>> = {
  issue: {
    permissions: [PERMISSIONS.STOCK_ISSUE],
    requireFrom: true,
    requireTo: false,
    requireReason: false,
    label: "Saída definitiva de material",
  },
  transfer: {
    permissions: [PERMISSIONS.STOCK_TRANSFER],
    requireFrom: true,
    requireTo: true,
    requireReason: false,
    label: "Transferência entre locais",
  },
  replenish: {
    permissions: [PERMISSIONS.STOCK_REPLENISH],
    requireFrom: true,
    requireTo: true,
    requireReason: false,
    label: "Reposição de ambiente",
  },
  return: {
    permissions: [PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.STOCK_REPLENISH, PERMISSIONS.STOCK_ISSUE],
    requireFrom: false,
    requireTo: true,
    requireReason: true,
    label: "Devolução ao estoque",
  },
  loss: {
    permissions: [PERMISSIONS.STOCK_LOSS],
    requireFrom: true,
    requireTo: false,
    requireReason: true,
    label: "Perda ou descarte",
  },
  correction: {
    permissions: [PERMISSIONS.STOCK_ADJUST],
    requireFrom: false,
    requireTo: false,
    requireReason: true,
    label: "Lançamento corretivo",
  },
};

const movementItemSchema = z.object({
  productId: z.string().trim().min(1, "Selecione o produto."),
  qty: z.number().finite().positive("Informe uma quantidade maior que zero."),
  notes: z.string().trim().max(500).nullish(),
});

const movementBody = z.object({
  type: z.enum(MOVEMENT_TYPES),
  requestKey: z.string().trim().min(8, "Identificador de requisição inválido.").max(120),
  fromLocationId: z.string().trim().min(1).nullish(),
  toLocationId: z.string().trim().min(1).nullish(),
  reason: z.string().trim().max(300).nullish(),
  counterparty: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  refType: z
    .enum(["ticket", "work_order", "purchase_request", "purchase_receipt", "inventory", "consumption", "manual"])
    .nullish(),
  refId: z.string().trim().max(80).nullish(),
  items: z.array(movementItemSchema).min(1, "Inclua ao menos um item.").max(100),
});

/* -------------------------------------------------------------------------- */
/* Saldos                                                                     */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission(PERMISSIONS.STOCK_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });
  const search = url.searchParams.get("search")?.trim();
  const locationId = url.searchParams.get("locationId")?.trim();
  const unitId = url.searchParams.get("unitId")?.trim();
  const categoryId = url.searchParams.get("categoryId")?.trim();
  const onlyWithStock = url.searchParams.get("onlyWithStock") === "true";
  const belowMinimum = url.searchParams.get("belowMinimum") === "true";

  const clauses: string[] = ["p.is_active = 1", "l.is_active = 1"];
  const params: (string | number)[] = [];
  if (search) {
    clauses.push(`(p.name LIKE ? OR COALESCE(p.sku,'') LIKE ?)`);
    params.push(`%${search}%`, `%${search}%`);
  }
  if (locationId) {
    clauses.push(`s.location_id = ?`);
    params.push(locationId);
  }
  if (unitId) {
    clauses.push(`l.unit_id = ?`);
    params.push(unitId);
  }
  if (categoryId) {
    clauses.push(`p.category_id = ?`);
    params.push(categoryId);
  }
  if (onlyWithStock) clauses.push(`s.qty_milli <> 0`);
  if (belowMinimum) clauses.push(`p.min_qty_milli > 0 AND s.qty_milli < p.min_qty_milli`);
  if (user.locationScope.length > 0) {
    clauses.push(`l.id IN (${user.locationScope.map(() => "?").join(",")})`);
    params.push(...user.locationScope);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const total = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM stock s JOIN products p ON p.id = s.product_id JOIN locations l ON l.id = s.location_id ${where}`,
    params,
  );

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT s.product_id, s.location_id, s.qty_milli, s.updated_at,
            p.name AS product_name, p.sku, p.min_qty_milli, p.pack_factor,
            u.code AS uom_code, u.name AS uom_name,
            c.name AS category_name,
            l.name AS location_name, l.path AS location_path, l.type_id AS location_type_id,
            l.unit_id, un.name AS unit_name
       FROM stock s
       JOIN products p ON p.id = s.product_id
       JOIN uoms u ON u.id = p.uom_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       JOIN locations l ON l.id = s.location_id
       JOIN units un ON un.id = l.unit_id
       ${where}
      ORDER BY p.name, l.path
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({
    items: rows.map((r) => {
      const qtyMilli = Number(r.qty_milli);
      const minMilli = Number(r.min_qty_milli);
      return {
        productId: String(r.product_id),
        productName: String(r.product_name),
        sku: r.sku ? String(r.sku) : null,
        categoryName: r.category_name ? String(r.category_name) : null,
        uomCode: String(r.uom_code),
        uomName: String(r.uom_name),
        packFactor: Number(r.pack_factor ?? 1),
        locationId: String(r.location_id),
        locationName: String(r.location_name),
        locationPath: String(r.location_path),
        unitId: String(r.unit_id),
        unitName: String(r.unit_name),
        qtyMilli,
        minQtyMilli: minMilli,
        deficitMilli: Math.max(0, minMilli - qtyMilli),
        status: qtyMilli <= 0 ? "out_of_stock" : minMilli > 0 && qtyMilli < minMilli ? "low" : "ok",
        updatedAt: String(r.updated_at),
      };
    }),
    total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

/* -------------------------------------------------------------------------- */
/* Histórico de movimentações                                                 */
/* -------------------------------------------------------------------------- */

const MOVEMENT_SELECT = `
  SELECT m.id, m.request_key, m.type, m.product_id, m.qty_milli,
         m.from_location_id, m.to_location_id, m.reason, m.counterparty,
         m.ref_type, m.ref_id, m.reverses_movement_id, m.user_id,
         m.occurred_at, m.notes, m.unit_cost_cents,
         p.name AS product_name, p.sku, u.code AS uom_code,
         lf.name AS from_name, lf.path AS from_path,
         lt.name AS to_name, lt.path AS to_path,
         us.name AS user_name,
         (SELECT COUNT(*) FROM movements r WHERE r.reverses_movement_id = m.id) AS reversal_count
    FROM movements m
    JOIN products p ON p.id = m.product_id
    JOIN uoms u ON u.id = p.uom_id
    LEFT JOIN locations lf ON lf.id = m.from_location_id
    LEFT JOIN locations lt ON lt.id = m.to_location_id
    JOIN users us ON us.id = m.user_id`;

router.get("/movements", requirePermission(PERMISSIONS.STOCK_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const productId = url.searchParams.get("productId")?.trim();
  const locationId = url.searchParams.get("locationId")?.trim();
  const type = url.searchParams.get("type")?.trim();
  const refType = url.searchParams.get("refType")?.trim();
  const refId = url.searchParams.get("refId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dateFrom = url.searchParams.get("dateFrom")?.trim();
  const dateTo = url.searchParams.get("dateTo")?.trim();
  const search = url.searchParams.get("search")?.trim();

  if (productId) {
    clauses.push(`m.product_id = ?`);
    params.push(productId);
  }
  if (locationId) {
    clauses.push(`(m.from_location_id = ? OR m.to_location_id = ?)`);
    params.push(locationId, locationId);
  }
  if (type && MOVEMENT_TYPES.includes(type as MovementType)) {
    clauses.push(`m.type = ?`);
    params.push(type);
  }
  if (refType) {
    clauses.push(`m.ref_type = ?`);
    params.push(refType);
  }
  if (refId) {
    clauses.push(`m.ref_id = ?`);
    params.push(refId);
  }
  if (userId) {
    clauses.push(`m.user_id = ?`);
    params.push(userId);
  }
  if (dateFrom) {
    clauses.push(`m.occurred_at >= ?`);
    params.push(normalizeRangeBound(dateFrom, false));
  }
  if (dateTo) {
    clauses.push(`m.occurred_at <= ?`);
    params.push(normalizeRangeBound(dateTo, true));
  }
  if (search) {
    clauses.push(`(p.name LIKE ? OR COALESCE(p.sku,'') LIKE ? OR COALESCE(m.reason,'') LIKE ? OR COALESCE(m.counterparty,'') LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  // Escopo: usuário restrito só ve movimentações dos seus locais.
  if (user.locationScope.length > 0) {
    clauses.push(
      `(m.from_location_id IN (${user.locationScope.map(() => "?").join(",")}) OR m.to_location_id IN (${user.locationScope
        .map(() => "?")
        .join(",")}) OR (m.from_location_id IS NULL AND m.to_location_id IS NULL))`,
    );
    params.push(...user.locationScope, ...user.locationScope);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM movements m JOIN products p ON p.id = m.product_id ${where}`,
    params,
  );
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${MOVEMENT_SELECT} ${where} ORDER BY m.occurred_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({
    items: rows.map(mapMovement),
    total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

router.get("/movements/:id", requirePermission(PERMISSIONS.STOCK_VIEW), async (c) => {
  const user = currentUser(c);
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${MOVEMENT_SELECT} WHERE m.id = ?`, [
    c.req.param("id"),
  ]);
  if (!row) throw notFound("Movimentação não encontrada.");

  if (user.locationScope.length > 0) {
    const scope = user.locationScope;
    const from = row.from_location_id ? String(row.from_location_id) : null;
    const to = row.to_location_id ? String(row.to_location_id) : null;
    const inScope = (id: string | null) => !id || scope.includes(id);
    if (!inScope(from) && !inScope(to)) {
      throw forbidden("Esta movimentação está fora do seu escopo de locais.");
    }
  }

  const reversals = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${MOVEMENT_SELECT} WHERE m.reverses_movement_id = ?`,
    [String(row.id)],
  );

  return c.json({ movement: mapMovement(row), reversals: reversals.map(mapMovement) });
});

/* -------------------------------------------------------------------------- */
/* Criação de movimentações                                                   */
/* -------------------------------------------------------------------------- */

router.post("/movements", async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, movementBody);
  const rule = RULES[body.type];
  if (!rule) {
    throw badRequest(
      `Movimentações do tipo "${body.type}" são geradas pelos seus módulos de origem e não podem ser lançadas diretamente.`,
    );
  }
  await assertRulePermission(c, user, rule);

  const fromId = body.fromLocationId ?? null;
  const toId = body.toLocationId ?? null;

  if (rule.requireFrom && !fromId) throw badRequest("Informe o local de origem.");
  if (rule.requireTo && !toId) throw badRequest("Informe o local de destino.");
  if (fromId && toId && fromId === toId) throw badRequest("Origem e destino não podem ser o mesmo local.");
  if (rule.requireReason && (body.reason ?? "").trim().length < 3) {
    throw badRequest(`O tipo "${rule.label}" exige uma justificativa.`);
  }

  assertLocationAllowed(user, fromId);
  assertLocationAllowed(user, toId);

  await assertLocationsActive(c.env.DB, [fromId, toId]);
  await assertProductsExist(c.env.DB, body.items.map((i) => i.productId));

  const reasonPrefix = body.reason?.trim() ?? null;
  const requests: MovementRequest[] = body.items.map((item, index) => ({
    type: body.type,
    productId: item.productId,
    qtyMilli: Math.round(item.qty * 1000),
    fromLocationId: fromId,
    toLocationId: toId,
    reason: reasonPrefix,
    counterparty: body.counterparty ?? null,
    refType: (body.refType ?? "manual") as RefType,
    refId: body.refId ?? null,
    notes: item.notes ?? body.notes ?? null,
    requestKey: `${body.requestKey}#${index}`,
    userId: user.id,
  }));

  await assertSufficientStock(c.env.DB, requests);

  const info = clientInfo(c);
  const results = await recordMovements(c.env.DB, { id: user.id, name: user.name }, requests, {
    extraStatements: (recorded) => [
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "stock",
        action: `movement.${body.type}`,
        entityType: "movement",
        entityId: recorded[0]?.id ?? null,
        after: {
          type: body.type,
          fromLocationId: fromId,
          toLocationId: toId,
          counterparty: body.counterparty ?? null,
          reason: reasonPrefix,
          items: body.items.map((i) => ({ productId: i.productId, qty: i.qty })),
          idempotentReplay: recorded.some((r) => r.idempotentReplay),
        },
        ...info,
      }),
    ],
  });

  return c.json({ movements: results, idempotentReplay: results.every((r) => r.idempotentReplay) }, 201);
});

/* -------------------------------------------------------------------------- */
/* Reversão controlada                                                        */
/* -------------------------------------------------------------------------- */

const reverseBody = z.object({
  reason: z.string().trim().min(5, "Explique o motivo da correção (mínimo 5 caracteres).").max(300),
  requestKey: z.string().trim().min(8).max(120),
});

/**
 * Reverte uma movimentação confirmada.
 *
 * Não sobrescreve nem apaga o lançamento original: cria um novo movimento do
 * tipo `correction` com os locais invertidos, vinculado por
 * `reverses_movement_id` e com justificativa obrigatória. Uma movimentação só
 * pode ser revertida uma vez.
 */
router.post("/movements/:id/reverse", requirePermission(PERMISSIONS.STOCK_ADJUST), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, reverseBody);

  const original = await oneRow<{
    id: string;
    type: MovementType;
    product_id: string;
    qty_milli: number;
    from_location_id: string | null;
    to_location_id: string | null;
    ref_type: string | null;
    ref_id: string | null;
  }>(
    c.env.DB,
    `SELECT id, type, product_id, qty_milli, from_location_id, to_location_id, ref_type, ref_id
       FROM movements WHERE id = ?`,
    [id],
  );
  if (!original) throw notFound("Movimentação não encontrada.");
  if (original.type === "correction") {
    throw conflict("Uma correção não pode ser revertida. Lance uma nova correção referenciando o fato.");
  }
  if (original.type === "inventory_adjust") {
    throw conflict("Ajustes de inventário são revertidos reabrindo o inventário de origem, não manualmente.");
  }

  const already = await countRows(c.env.DB, `SELECT COUNT(*) FROM movements WHERE reverses_movement_id = ?`, [id]);
  if (already > 0) throw conflict("Esta movimentação já foi revertida.");

  assertLocationAllowed(user, original.from_location_id);
  assertLocationAllowed(user, original.to_location_id);

  const request: MovementRequest = {
    type: "correction",
    productId: original.product_id,
    qtyMilli: original.qty_milli,
    fromLocationId: original.to_location_id,
    toLocationId: original.from_location_id,
    reason: body.reason,
    counterparty: null,
    refType: (original.ref_type as RefType) ?? "manual",
    refId: original.ref_id,
    notes: `Reversão da movimentação ${original.id}.`,
    requestKey: body.requestKey,
    reversesMovementId: original.id,
    userId: user.id,
  };

  await assertSufficientStock(c.env.DB, [request]);

  const info = clientInfo(c);
  const [created] = await recordMovements(c.env.DB, { id: user.id, name: user.name }, [request], {
    extraStatements: (recorded) => [
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "stock",
        action: "movement.reverse",
        entityType: "movement",
        entityId: original.id,
        before: { type: original.type, qtyMilli: original.qty_milli },
        after: { correctionMovementId: recorded[0]?.id ?? null, reason: body.reason },
        reason: body.reason,
        ...info,
      }),
    ],
  });

  return c.json({ movement: created }, 201);
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

async function assertRulePermission(
  c: Context<AppEnv>,
  user: AuthUser,
  rule: MovementRule,
): Promise<void> {
  if (rule.permissions.some((p) => user.permissions.has(p))) return;

  // A negação entra na trilha como qualquer outra: sem isso, uma tentativa de
  // movimentação sem permissão sumiria sem registro.
  await recordPermissionDenied(
    c,
    user,
    rule.permissions.length === 1 ? rule.permissions[0]! : rule.permissions.join("|"),
  );
  throw forbidden(`Permissão necessária para ${rule.label}: ${rule.permissions.join(" ou ")}.`);
}

async function assertLocationsActive(db: D1Database, ids: (string | null)[]): Promise<void> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return;
  const rows = await allRows<{ id: string; is_active: number; name: string }>(
    db,
    `SELECT id, is_active, name FROM locations WHERE id IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  if (rows.length !== unique.length) throw badRequest("Um dos locais informados não existe.");
  const inactive = rows.filter((r) => r.is_active !== 1);
  if (inactive.length > 0) {
    throw badRequest(`Local inativo não pode receber movimentações: ${inactive.map((r) => r.name).join(", ")}.`);
  }
}

async function assertProductsExist(db: D1Database, productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds)];
  const rows = await allRows<{ id: string; is_active: number; name: string }>(
    db,
    `SELECT id, is_active, name FROM products WHERE id IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  if (rows.length !== unique.length) throw badRequest("Um dos produtos informados não existe.");
  const inactive = rows.filter((r) => r.is_active !== 1);
  if (inactive.length > 0) {
    throw badRequest(`Produto inativo não pode ser movimentado: ${inactive.map((r) => r.name).join(", ")}.`);
  }
}

export function mapMovement(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    requestKey: String(row.request_key),
    type: String(row.type) as MovementType,
    productId: String(row.product_id),
    productName: String(row.product_name),
    sku: row.sku ? String(row.sku) : null,
    uomCode: String(row.uom_code),
    qtyMilli: Number(row.qty_milli),
    fromLocationId: row.from_location_id ? String(row.from_location_id) : null,
    fromName: row.from_name ? String(row.from_name) : null,
    fromPath: row.from_path ? String(row.from_path) : null,
    toLocationId: row.to_location_id ? String(row.to_location_id) : null,
    toName: row.to_name ? String(row.to_name) : null,
    toPath: row.to_path ? String(row.to_path) : null,
    reason: row.reason ? String(row.reason) : null,
    counterparty: row.counterparty ? String(row.counterparty) : null,
    refType: row.ref_type ? String(row.ref_type) : null,
    refId: row.ref_id ? String(row.ref_id) : null,
    reversesMovementId: row.reverses_movement_id ? String(row.reverses_movement_id) : null,
    reversalCount: Number(row.reversal_count ?? 0),
    userId: String(row.user_id),
    userName: String(row.user_name),
    occurredAt: String(row.occurred_at),
    notes: row.notes ? String(row.notes) : null,
    unitCostCents: row.unit_cost_cents === null || row.unit_cost_cents === undefined ? null : Number(row.unit_cost_cents),
  };
}

export default router;
