import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { assertLocationAllowed, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { assertSufficientStock, recordMovements, type MovementRequest } from "../stock";
import { buildCode, nextCounter, normalizeRangeBound, nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");

const consumptionItemSchema = z.object({
  productId: z.string().trim().min(1, "Selecione o produto."),
  qty: z.number().finite().positive("Informe uma quantidade maior que zero."),
  /** Local de referência do consumo (distribuição/uso). */
  locationId: z.string().trim().min(1).nullish(),
  /** Sobrescreve o local de baixa de estoque para este item. */
  deductFromLocationId: z.string().trim().min(1).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

const consumptionBody = z.object({
  requestKey: z.string().trim().min(8).max(120),
  periodStart: isoDate,
  periodEnd: isoDate,
  /** Periodicidade do lançamento; quando ausente usa a configuração padrão. */
  periodicity: z
    .enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "custom"])
    .optional(),
  scopeNote: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** Local de referência do lançamento inteiro. */
  locationId: z.string().trim().min(1).nullish(),
  /**
   * Quando informado, o lançamento também GERA BAIXA de estoque neste local.
   * Quando ausente, o registro e apenas uma MEDIÇÃO de consumo e NÃO altera
   * saldo -- exatamente para não descontar duas vezes o mesmo material.
   */
  deductFromLocationId: z.string().trim().min(1).nullish(),
  items: z.array(consumptionItemSchema).min(1, "Inclua ao menos um item.").max(200),
});

const CONSUMPTION_SELECT = `
  SELECT cr.id, cr.code, cr.period_start, cr.period_end, cr.periodicity, cr.location_id, cr.scope_note,
         cr.status, cr.notes, cr.cancel_reason, cr.cancelled_at, cr.created_by, cr.created_at,
         l.name AS location_name, l.path AS location_path,
         u.name AS user_name,
         (SELECT COUNT(*) FROM consumption_items ci WHERE ci.consumption_id = cr.id) AS item_count,
         (SELECT COUNT(*) FROM consumption_items ci WHERE ci.consumption_id = cr.id AND ci.movement_id IS NOT NULL) AS deducted_count
    FROM consumption_records cr
    LEFT JOIN locations l ON l.id = cr.location_id
    JOIN users u ON u.id = cr.created_by`;

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission(PERMISSIONS.CONSUMPTION_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const fromRaw = url.searchParams.get("periodFrom")?.trim();
  const toRaw = url.searchParams.get("periodTo")?.trim();
  const from = fromRaw ? normalizeRangeBound(fromRaw, false) : undefined;
  const to = toRaw ? normalizeRangeBound(toRaw, true) : undefined;
  const locationId = url.searchParams.get("locationId")?.trim();
  const productId = url.searchParams.get("productId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const status = url.searchParams.get("status")?.trim();

  if (from) {
    clauses.push(`cr.period_end >= ?`);
    params.push(from);
  }
  if (to) {
    clauses.push(`cr.period_start <= ?`);
    params.push(to);
  }
  if (locationId) {
    clauses.push(`cr.location_id = ?`);
    params.push(locationId);
  }
  if (userId) {
    clauses.push(`cr.created_by = ?`);
    params.push(userId);
  }
  if (status) {
    clauses.push(`cr.status = ?`);
    params.push(status);
  }
  if (productId) {
    clauses.push(`EXISTS (SELECT 1 FROM consumption_items ci WHERE ci.consumption_id = cr.id AND ci.product_id = ?)`);
    params.push(productId);
  }
  if (user.locationScope.length > 0) {
    clauses.push(
      `(cr.location_id IS NULL OR cr.location_id IN (${user.locationScope.map(() => "?").join(",")})
        OR EXISTS (SELECT 1 FROM consumption_items ci WHERE ci.consumption_id = cr.id AND ci.location_id IN (${user.locationScope
          .map(() => "?")
          .join(",")})))`,
    );
    params.push(...user.locationScope, ...user.locationScope);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM consumption_records cr ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${CONSUMPTION_SELECT} ${where} ORDER BY cr.period_end DESC, cr.created_at DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({ items: rows.map(mapConsumption), total, page: page.page, pageSize: page.pageSize });
});

/**
 * Consolidado de consumo por produto, local ou categoria, dentro de um período.
 * Soma apenas itens de lançamentos não cancelados.
 */
router.get("/summary", requirePermission(PERMISSIONS.CONSUMPTION_VIEW), async (c) => {
  const url = new URL(c.req.url);
  const fromRaw = url.searchParams.get("periodFrom")?.trim();
  const toRaw = url.searchParams.get("periodTo")?.trim();
  const from = fromRaw ? normalizeRangeBound(fromRaw, false) : undefined;
  const to = toRaw ? normalizeRangeBound(toRaw, true) : undefined;
  const groupBy = url.searchParams.get("groupBy") ?? "product";
  const locationId = url.searchParams.get("locationId")?.trim();

  if (!from || !to) throw badRequest("Informe periodFrom e periodTo.");
  if (!["product", "location", "category"].includes(groupBy)) {
    throw badRequest("groupBy deve ser product, location ou category.");
  }

  const clauses = ["cr.status <> 'cancelled'", "cr.period_start <= ?", "cr.period_end >= ?"];
  const params: (string | number)[] = [to, from];
  if (locationId) {
    clauses.push("(ci.location_id = ? OR cr.location_id = ?)");
    params.push(locationId, locationId);
  }

  const dimension =
    groupBy === "location"
      ? "COALESCE(ci.location_id, cr.location_id)"
      : groupBy === "category"
        ? "p.category_id"
        : "ci.product_id";

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT ${dimension} AS dimension_id,
            COALESCE(p2.name, l2.path, 'Sem classificação') AS dimension_name,
            p.id AS product_id, p.name AS product_name, u.code AS uom_code,
            c.name AS category_name,
            SUM(ci.qty_milli) AS qty_milli,
            COUNT(DISTINCT cr.id) AS record_count
       FROM consumption_items ci
       JOIN consumption_records cr ON cr.id = ci.consumption_id
       JOIN products p ON p.id = ci.product_id
       JOIN uoms u ON u.id = p.uom_id
       LEFT JOIN product_categories c ON c.id = p.category_id
       LEFT JOIN products p2 ON p2.id = ${groupBy === "product" ? "ci.product_id" : "NULL"}
       LEFT JOIN locations l2 ON l2.id = ${groupBy === "location" ? "COALESCE(ci.location_id, cr.location_id)" : "NULL"}
      WHERE ${clauses.join(" AND ")}
      GROUP BY ${dimension}, p.id
      ORDER BY qty_milli DESC, dimension_name
      LIMIT 500`,
    params,
  );

  return c.json({
    period: { from, to },
    groupBy,
    items: rows.map((r) => ({
      dimensionId: r.dimension_id ? String(r.dimension_id) : null,
      dimensionName: String(r.dimension_name),
      productId: String(r.product_id),
      productName: String(r.product_name),
      uomCode: String(r.uom_code),
      categoryName: r.category_name ? String(r.category_name) : null,
      qtyMilli: Number(r.qty_milli),
      recordCount: Number(r.record_count),
    })),
  });
});

router.get("/:id", requirePermission(PERMISSIONS.CONSUMPTION_VIEW), async (c) => {
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${CONSUMPTION_SELECT} WHERE cr.id = ?`, [id]);
  if (!row) throw notFound("Lançamento de consumo não encontrado.");

  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT ci.id, ci.product_id, ci.qty_milli, ci.location_id, ci.movement_id, ci.notes,
            p.name AS product_name, p.sku, u.code AS uom_code,
            l.name AS location_name, l.path AS location_path,
            m.type AS movement_type, m.from_location_id AS movement_from, m.occurred_at AS movement_at
       FROM consumption_items ci
       JOIN products p ON p.id = ci.product_id
       JOIN uoms u ON u.id = p.uom_id
       LEFT JOIN locations l ON l.id = ci.location_id
       LEFT JOIN movements m ON m.id = ci.movement_id
      WHERE ci.consumption_id = ?
      ORDER BY p.name`,
    [id],
  );

  return c.json({
    record: mapConsumption(row),
    items: items.map((i) => ({
      id: String(i.id),
      productId: String(i.product_id),
      productName: String(i.product_name),
      sku: i.sku ? String(i.sku) : null,
      uomCode: String(i.uom_code),
      qtyMilli: Number(i.qty_milli),
      locationId: i.location_id ? String(i.location_id) : null,
      locationName: i.location_name ? String(i.location_name) : null,
      locationPath: i.location_path ? String(i.location_path) : null,
      movementId: i.movement_id ? String(i.movement_id) : null,
      movementFrom: i.movement_from ? String(i.movement_from) : null,
      movementAt: i.movement_at ? String(i.movement_at) : null,
      notes: i.notes ? String(i.notes) : null,
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Lançamento de consumo                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Periodicidade padrão do lançamento, lida de `settings`
 * (`consumption.periodicity`). Mantem o comportamento configurável sem
 * duplicar a regra no cliente.
 */
async function readDefaultPeriodicity(db: D1Database): Promise<string> {
  const row = await oneRow<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE key = 'consumption.periodicity'`,
  );
  return row?.value ?? "weekly";
}

router.post("/", requirePermission(PERMISSIONS.CONSUMPTION_CREATE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, consumptionBody);

  /**
   * Reenvio do mesmo lançamento (duplo clique, retry após timeout): devolve o
   * registro que já existe, sem criar outro e sem descontar o estoque de novo.
   */
  const replay = await oneRow<{ id: string; code: string }>(
    c.env.DB,
    `SELECT id, code FROM consumption_records WHERE request_key = ?`,
    [body.requestKey],
  );
  if (replay) {
    const movements = await allRows<{ id: string }>(
      c.env.DB,
      `SELECT ci.movement_id AS id FROM consumption_items ci
        WHERE ci.consumption_id = ? AND ci.movement_id IS NOT NULL`,
      [replay.id],
    );
    return c.json({
      id: replay.id,
      code: replay.code,
      stockDeducted: movements.length > 0,
      movements: movements.map((m) => m.id),
      idempotentReplay: true,
    });
  }

  if (body.periodEnd < body.periodStart) {
    throw badRequest("O fim do período não pode ser anterior ao início.");
  }
  assertLocationAllowed(user, body.locationId ?? null);
  assertLocationAllowed(user, body.deductFromLocationId ?? null);
  for (const item of body.items) {
    assertLocationAllowed(user, item.locationId ?? null);
    assertLocationAllowed(user, item.deductFromLocationId ?? null);
  }

  const duplicates = findDuplicateProducts(body.items.map((i) => i.productId));
  if (duplicates.length > 0) {
    throw badRequest(
      "O mesmo produto aparece mais de uma vez no lançamento. Somente os valores e informe uma única linha por produto.",
      { duplicatedProductIds: duplicates },
    );
  }

  await assertProductsActive(c.env.DB, body.items.map((i) => i.productId));
  await assertLocationsActive(c.env.DB, [
    body.locationId ?? null,
    body.deductFromLocationId ?? null,
    ...body.items.map((i) => i.locationId ?? null),
    ...body.items.map((i) => i.deductFromLocationId ?? null),
  ]);

  const consumptionId = uuid();
  const ts = nowIso();
  const code = buildCode("CON", await nextCounter(c.env.DB, "consumption"));
  const info = clientInfo(c);
  const periodicity = body.periodicity ?? (await readDefaultPeriodicity(c.env.DB));

  const itemIds = body.items.map(() => uuid());
  const deduct = Boolean(body.deductFromLocationId);

  const movementRequests: MovementRequest[] = deduct
    ? body.items.map((item, index) => ({
        type: "consumption",
        productId: item.productId,
        qtyMilli: Math.round(item.qty * 1000),
        fromLocationId: item.deductFromLocationId ?? body.deductFromLocationId!,
        toLocationId: null,
        reason: `Consumo ${body.periodStart} a ${body.periodEnd}`,
        counterparty: null,
        refType: "consumption" as const,
        refId: consumptionId,
        notes: item.notes ?? body.notes ?? null,
        requestKey: `${body.requestKey}#${index}`,
        userId: user.id,
      }))
    : [];

  if (deduct) await assertSufficientStock(c.env.DB, movementRequests);

  const recordStatement = insertStatement(c.env.DB, "consumption_records", {
    id: consumptionId,
    code,
    period_start: body.periodStart,
    period_end: body.periodEnd,
    periodicity,
    location_id: body.locationId ?? null,
    scope_note: body.scopeNote ?? null,
    status: "registered",
    notes: body.notes ?? null,
    request_key: body.requestKey,
    created_by: user.id,
    created_at: ts,
  });

  const audit = (movementIds: (string | null)[]) =>
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "consumption",
      action: "consumption.create",
      entityType: "consumption_record",
      entityId: consumptionId,
      after: {
        code,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        stockDeducted: deduct,
        movementIds,
        items: body.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      },
      ...info,
    });

  /**
   * Registro, itens e baixas de estoque entram na MESMA transação. Cada item
   * recebe o id do seu movimento, o que torna impossível existir consumo
   * registrado sem a baixa correspondente (ou o inverso).
   */
  const buildExtraStatements = (movementIds: (string | null)[]) => [
    recordStatement,
    ...body.items.map((item, index) =>
      insertStatement(c.env.DB, "consumption_items", {
        id: itemIds[index],
        consumption_id: consumptionId,
        product_id: item.productId,
        qty_milli: Math.round(item.qty * 1000),
        location_id: item.locationId ?? body.locationId ?? null,
        movement_id: movementIds[index] ?? null,
        notes: item.notes ?? null,
      }),
    ),
    audit(movementIds),
  ];

  let movements: { id: string }[] = [];
  try {
    if (deduct) {
      const recorded = await recordMovements(c.env.DB, { id: user.id, name: user.name }, movementRequests, {
        extraStatements: (results) => buildExtraStatements(results.map((r) => r.id)),
      });
      movements = recorded.map((r) => ({ id: r.id }));
    } else {
      await c.env.DB.batch(buildExtraStatements(body.items.map(() => null)));
    }
  } catch (error) {
    // Duas requisições idênticas chegaram juntas: a segunda perde no indice
    // único. Em vez de erro, devolve o lançamento vencedor -- o efeito e o
    // mesmo de um reenvio, e o estoque foi descontado uma única vez.
    const message = error instanceof Error ? error.message : String(error);
    if (/idx_consumption_request_key|UNIQUE constraint failed: consumption_records\.request_key/.test(message)) {
      const winner = await oneRow<{ id: string; code: string }>(
        c.env.DB,
        `SELECT id, code FROM consumption_records WHERE request_key = ?`,
        [body.requestKey],
      );
      if (winner) {
        const winnerMovements = await allRows<{ id: string }>(
          c.env.DB,
          `SELECT ci.movement_id AS id FROM consumption_items ci
            WHERE ci.consumption_id = ? AND ci.movement_id IS NOT NULL`,
          [winner.id],
        );
        return c.json({
          id: winner.id,
          code: winner.code,
          stockDeducted: winnerMovements.length > 0,
          movements: winnerMovements.map((m) => m.id),
          idempotentReplay: true,
        });
      }
    }
    throw error;
  }

  return c.json(
    {
      id: consumptionId,
      code,
      stockDeducted: deduct,
      movements: movements.map((m) => m.id),
      idempotentReplay: false,
    },
    201,
  );
});

/* -------------------------------------------------------------------------- */
/* Cancelamento                                                               */
/* -------------------------------------------------------------------------- */

const cancelBody = z.object({
  reason: z.string().trim().min(5, "Explique o motivo do cancelamento (mínimo 5 caracteres).").max(300),
  requestKey: z.string().trim().min(8).max(120),
});

/**
 * Cancela um lançamento. Não apaga nada: marca o registro como cancelado com
 * justificativa e, se houve baixa de estoque, gera movimentos `correction`
 * devolvendo exatamente as quantidades baixadas.
 */
router.post("/:id/cancel", requirePermission(PERMISSIONS.CONSUMPTION_CANCEL), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, cancelBody);

  const record = await oneRow<{ id: string; code: string; status: string; location_id: string | null }>(
    c.env.DB,
    `SELECT id, code, status, location_id FROM consumption_records WHERE id = ?`,
    [id],
  );
  if (!record) throw notFound("Lançamento de consumo não encontrado.");
  if (record.status === "cancelled") throw conflict("Este lançamento já está cancelado.");
  assertLocationAllowed(user, record.location_id);

  const items = await allRows<{
    id: string;
    product_id: string;
    qty_milli: number;
    movement_id: string | null;
    from_location_id: string | null;
  }>(
    c.env.DB,
    `SELECT ci.id, ci.product_id, ci.qty_milli, ci.movement_id, m.from_location_id
       FROM consumption_items ci
       LEFT JOIN movements m ON m.id = ci.movement_id
      WHERE ci.consumption_id = ?`,
    [id],
  );

  const reversals: MovementRequest[] = items
    .filter((i) => i.movement_id && i.from_location_id)
    .map((i, index) => ({
      type: "correction",
      productId: i.product_id,
      qtyMilli: i.qty_milli,
      fromLocationId: null,
      toLocationId: i.from_location_id,
      reason: `Cancelamento do consumo ${record.code}: ${body.reason}`,
      counterparty: null,
      refType: "consumption",
      refId: id,
      notes: `Reversão da baixa ${i.movement_id}.`,
      requestKey: `${body.requestKey}#${index}`,
      reversesMovementId: i.movement_id,
      userId: user.id,
    }));

  const ts = nowIso();
  const info = clientInfo(c);
  const statements = [
    c.env.DB.prepare(
      `UPDATE consumption_records SET status = 'cancelled', cancel_reason = ?, cancelled_at = ?, cancelled_by = ? WHERE id = ?`,
    ).bind(body.reason, ts, user.id, id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "consumption",
      action: "consumption.cancel",
      entityType: "consumption_record",
      entityId: id,
      before: { status: record.status },
      after: { status: "cancelled" },
      reason: body.reason,
      ...info,
    }),
  ];

  if (reversals.length > 0) {
    await recordMovements(c.env.DB, { id: user.id, name: user.name }, reversals, {
      extraStatements: statements,
    });
  } else {
    await c.env.DB.batch(statements);
  }

  return c.json({ ok: true, reversedMovements: reversals.length });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

function findDuplicateProducts(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

async function assertProductsActive(db: D1Database, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const rows = await allRows<{ id: string; is_active: number; name: string }>(
    db,
    `SELECT id, is_active, name FROM products WHERE id IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  if (rows.length !== unique.length) throw badRequest("Um dos produtos informados não existe.");
  const inactive = rows.filter((r) => r.is_active !== 1);
  if (inactive.length > 0) {
    throw badRequest(`Produto inativo não pode ser usado em lançamentos: ${inactive.map((r) => r.name).join(", ")}.`);
  }
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
    throw badRequest(`Local inativo: ${inactive.map((r) => r.name).join(", ")}.`);
  }
}

function mapConsumption(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    periodicity: row.periodicity ? String(row.periodicity) : "weekly",
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    locationPath: row.location_path ? String(row.location_path) : null,
    scopeNote: row.scope_note ? String(row.scope_note) : null,
    status: String(row.status),
    notes: row.notes ? String(row.notes) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    createdBy: String(row.created_by),
    userName: String(row.user_name),
    createdAt: String(row.created_at),
    itemCount: Number(row.item_count ?? 0),
    deductedItemCount: Number(row.deducted_count ?? 0),
    stockDeducted: Number(row.deducted_count ?? 0) > 0,
  };
}

export default router;
