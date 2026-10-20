import { Hono } from "hono";
import { PERMISSIONS } from "@shared/permissions";
import { PURCHASE_ITEM_MODE_LABEL, PURCHASE_STATUS } from "@shared/types";
import type { AppEnv } from "../types";
import { currentUser, requireAuth, requirePermission } from "../auth";
import { allRows, oneRow } from "../db";
import { badRequest, forbidden } from "../errors";
import { normalizeRangeBound } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Filtros comuns                                                             */
/* -------------------------------------------------------------------------- */

interface Range {
  from: string;
  to: string;
}

function parseRange(url: URL): Range {
  const to = normalizeRangeBound(
    url.searchParams.get("to")?.trim() || new Date().toISOString(),
    true,
  );
  const from = normalizeRangeBound(
    url.searchParams.get("from")?.trim() ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    false,
  );
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw badRequest("Período inválido: informe datas ISO-8601 em `from` e `to`.");
  }
  if (Date.parse(from) > Date.parse(to)) {
    throw badRequest("A data inicial não pode ser posterior a data final.");
  }
  return { from, to };
}

function scopeClause(column: string, scope: string[], params: (string | number)[]): string {
  if (scope.length === 0) return "1=1";
  params.push(...scope);
  return `${column} IN (${scope.map(() => "?").join(",")})`;
}

/** Filtro explícito de local não pode furar o escopo do usuário. */
function assertLocationAllowed(locationId: string | null | undefined, scope: string[]): void {
  if (!locationId || scope.length === 0) return;
  if (!scope.includes(locationId)) {
    throw forbidden("O local informado está fora do seu escopo de acesso.");
  }
}

/**
 * Período padrão dos relatórios de CONSUMO.
 *
 * Consumo e lançado por período (semanal, mensal...), então um filtro de
 * "últimos 30 dias" esconderia um lançamento semanal fechado há 40 dias ou um
 * período que ainda não terminou. O padrão aqui e do primeiro dia do mês
 * anterior ao último dia do mês seguinte -- cobre o mês corrente e os vizinhos,
 * que e o horizonte operacional de quem confere consumo.
 */
function parseConsumptionRange(url: URL): Range {
  const now = new Date();
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0);
  const defaultFrom = new Date(monthStart).toISOString().slice(0, 10);
  const defaultTo = new Date(monthEnd).toISOString().slice(0, 10);

  const from = url.searchParams.get("from")?.trim() || defaultFrom;
  const to = url.searchParams.get("to")?.trim() || defaultTo;

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw badRequest("Período inválido: informe datas ISO-8601 em `from` e `to`.");
  }
  if (Date.parse(from) > Date.parse(to)) {
    throw badRequest("A data inicial não pode ser posterior a data final.");
  }
  return { from, to };
}

/* -------------------------------------------------------------------------- */
/* Escopo do alerta de estoque mínimo                                        */
/* -------------------------------------------------------------------------- */

export type LowStockScope = "per_location" | "global";

/**
 * Escopo configurado em `settings.stock.low_stock_scope`:
 *  - `per_location` (padrão): o alerta compara o saldo DE CADA local com o
 *    mínimo do produto;
 *  - `global`: o alerta compara a SOMA de todos os locais com o mínimo, que e
 *    o critério correto para itens rateados entre depósitos.
 */
export async function lowStockScope(db: D1Database): Promise<LowStockScope> {
  const row = await oneRow<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE key = 'stock.low_stock_scope'`,
  );
  return row?.value === "global" ? "global" : "per_location";
}

/** Condição SQL de "abaixo do mínimo" conforme o escopo configurado. */
function lowStockCondition(scope: LowStockScope): string {
  return scope === "global"
    ? `p.min_qty_milli > 0 AND (SELECT COALESCE(SUM(s2.qty_milli), 0) FROM stock s2
         WHERE s2.product_id = p.id) <= p.min_qty_milli`
    : `p.min_qty_milli > 0 AND stock.qty_milli <= p.min_qty_milli`;
}

/* -------------------------------------------------------------------------- */
/* Posição de estoque                                                         */
/* -------------------------------------------------------------------------- */

const STOCK_POSITION_SQL = `
  SELECT p.id AS product_id, p.name AS product_name, p.sku, p.min_qty_milli, p.is_active,
         u.code AS uom_code, c.name AS category_name,
         l.id AS location_id, l.name AS location_name, l.path AS location_path,
         stock.qty_milli, stock.updated_at,
         (SELECT COALESCE(SUM(s2.qty_milli), 0) FROM stock s2
           WHERE s2.product_id = p.id) AS total_qty_milli,
         (SELECT m.unit_cost_cents FROM movements m
           WHERE m.product_id = p.id AND m.unit_cost_cents IS NOT NULL
           ORDER BY m.occurred_at DESC LIMIT 1) AS last_cost_cents
    FROM stock
    JOIN products p ON p.id = stock.product_id
    JOIN locations l ON l.id = stock.location_id
    LEFT JOIN uoms u ON u.id = p.uom_id
    LEFT JOIN product_categories c ON c.id = p.category_id`;

router.get("/stock", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const params: (string | number)[] = [];
  const clauses: string[] = [];

  const locationId = url.searchParams.get("locationId")?.trim();
  assertLocationAllowed(locationId, user.locationScope);
  if (locationId) {
    params.push(locationId);
    clauses.push("stock.location_id = ?");
  } else {
    clauses.push(scopeClause("stock.location_id", user.locationScope, params));
  }

  const categoryId = url.searchParams.get("categoryId")?.trim();
  if (categoryId) {
    params.push(categoryId);
    clauses.push("p.category_id = ?");
  }

  const search = url.searchParams.get("search")?.trim();
  if (search) {
    const like = `%${search}%`;
    params.push(like, like);
    clauses.push("(p.name LIKE ? OR COALESCE(p.sku,'') LIKE ?)");
  }

  const onlyLow = url.searchParams.get("onlyLow") === "true";
  const scope = await lowStockScope(c.env.DB);
  if (onlyLow) clauses.push(lowStockCondition(scope));

  const includeZero = url.searchParams.get("includeZero") !== "false";
  if (!includeZero) clauses.push("stock.qty_milli > 0");

  const activeOnly = url.searchParams.get("activeOnly") === "true";
  if (activeOnly) clauses.push("p.is_active = 1");

  const where = `WHERE ${clauses.join(" AND ")}`;
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${STOCK_POSITION_SQL} ${where} ORDER BY p.name, l.path LIMIT 2000`,
    params,
  );

  const totals = await oneRow<{ lines: number; qty_milli: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS lines, COALESCE(SUM(stock.qty_milli), 0) AS qty_milli
       FROM stock
       JOIN products p ON p.id = stock.product_id
      ${where}`,
    params,
  );

  return c.json({
    scope,
    items: rows.map((row) => ({
      productId: String(row.product_id),
      productName: String(row.product_name),
      sku: row.sku ? String(row.sku) : null,
      uomCode: row.uom_code ? String(row.uom_code) : null,
      categoryName: row.category_name ? String(row.category_name) : null,
      locationId: String(row.location_id),
      locationName: String(row.location_name),
      locationPath: row.location_path ? String(row.location_path) : null,
      qtyMilli: Number(row.qty_milli),
      totalQtyMilli: Number(row.total_qty_milli ?? 0),
      minQtyMilli: Number(row.min_qty_milli ?? 0),
      isBelowMin:
        Number(row.min_qty_milli ?? 0) > 0 &&
        (scope === "global"
          ? Number(row.total_qty_milli ?? 0) <= Number(row.min_qty_milli ?? 0)
          : Number(row.qty_milli) <= Number(row.min_qty_milli ?? 0)),
      isZero: Number(row.qty_milli) <= 0,
      lastCostCents: row.last_cost_cents === null || row.last_cost_cents === undefined
        ? null
        : Number(row.last_cost_cents),
      updatedAt: String(row.updated_at),
    })),
    totals: {
      lines: (totals?.lines ?? 0) as number,
      qtyMilli: (totals?.qty_milli ?? 0) as number,
    },
  });
});

router.get("/low-stock", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const params: (string | number)[] = [];
  const clause = scopeClause("stock.location_id", user.locationScope, params);
  const scope = await lowStockScope(c.env.DB);

  // Escopo por local: uma linha por local abaixo do mínimo.
  // Escopo global: uma linha por PRODUTO, somando todos os locais.
  const query =
    scope === "global"
      ? `SELECT p.id AS product_id, p.name AS product_name, p.sku, p.min_qty_milli,
                u.code AS uom_code,
                SUM(stock.qty_milli) AS qty_milli,
                COUNT(DISTINCT stock.location_id) AS location_count,
                (SELECT COALESCE(SUM(m.qty_milli), 0) FROM movements m
                  WHERE m.product_id = p.id AND m.to_location_id IS NOT NULL
                    AND m.occurred_at >= datetime('now','-30 days')) AS inbound_30d_milli,
                (SELECT COALESCE(SUM(m.qty_milli), 0) FROM movements m
                  WHERE m.product_id = p.id AND m.from_location_id IS NOT NULL
                    AND m.occurred_at >= datetime('now','-30 days')) AS outbound_30d_milli
           FROM stock
           JOIN products p ON p.id = stock.product_id
           LEFT JOIN uoms u ON u.id = p.uom_id
          WHERE p.is_active = 1 AND p.min_qty_milli > 0 AND ${clause}
          GROUP BY p.id
         HAVING SUM(stock.qty_milli) <= p.min_qty_milli
          ORDER BY (SUM(stock.qty_milli) * 1.0 / NULLIF(p.min_qty_milli,0)) ASC, p.name
          LIMIT 2000`
      : `SELECT p.id AS product_id, p.name AS product_name, p.sku, p.min_qty_milli,
                u.code AS uom_code, l.id AS location_id, l.name AS location_name, l.path AS location_path,
                stock.qty_milli,
                (SELECT COALESCE(SUM(m.qty_milli), 0) FROM movements m
                  WHERE m.product_id = p.id AND m.to_location_id = l.id
                    AND m.occurred_at >= datetime('now','-30 days')) AS inbound_30d_milli,
                (SELECT COALESCE(SUM(m.qty_milli), 0) FROM movements m
                  WHERE m.product_id = p.id AND m.from_location_id = l.id
                    AND m.occurred_at >= datetime('now','-30 days')) AS outbound_30d_milli
           FROM stock
           JOIN products p ON p.id = stock.product_id
           JOIN locations l ON l.id = stock.location_id
           LEFT JOIN uoms u ON u.id = p.uom_id
          WHERE p.is_active = 1 AND p.min_qty_milli > 0
            AND stock.qty_milli <= p.min_qty_milli
            AND ${clause}
          ORDER BY (stock.qty_milli * 1.0 / NULLIF(p.min_qty_milli,0)) ASC, p.name
          LIMIT 2000`;

  const rows = await allRows<Record<string, unknown>>(c.env.DB, query, params);

  return c.json({
    scope,
    items: rows.map((row) => ({
      productId: String(row.product_id),
      productName: String(row.product_name),
      sku: row.sku ? String(row.sku) : null,
      uomCode: row.uom_code ? String(row.uom_code) : null,
      locationId: row.location_id ? String(row.location_id) : null,
      locationName: row.location_name ? String(row.location_name) : null,
      locationPath: row.location_path ? String(row.location_path) : null,
      locationCount: row.location_count === undefined ? null : Number(row.location_count),
      qtyMilli: Number(row.qty_milli),
      minQtyMilli: Number(row.min_qty_milli),
      shortageMilli: Math.max(0, Number(row.min_qty_milli) - Number(row.qty_milli)),
      inbound30dMilli: Number(row.inbound_30d_milli ?? 0),
      outbound30dMilli: Number(row.outbound_30d_milli ?? 0),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Movimentação de estoque                                                    */
/* -------------------------------------------------------------------------- */

interface MovementFilter {
  clauses: string[];
  params: (string | number)[];
}

function buildMovementFilter(url: URL, scope: string[]): MovementFilter {
  const params: (string | number)[] = [];
  const clauses: string[] = [];
  const range = parseRange(url);

  clauses.push("m.occurred_at >= ?");
  params.push(range.from);
  clauses.push("m.occurred_at <= ?");
  params.push(range.to);

  const type = url.searchParams.get("type")?.trim();
  if (type) {
    clauses.push("m.type = ?");
    params.push(type);
  }
  const productId = url.searchParams.get("productId")?.trim();
  if (productId) {
    clauses.push("m.product_id = ?");
    params.push(productId);
  }
  const userId = url.searchParams.get("userId")?.trim();
  if (userId) {
    clauses.push("m.user_id = ?");
    params.push(userId);
  }
  const locationId = url.searchParams.get("locationId")?.trim();
  assertLocationAllowed(locationId, scope);
  if (locationId) {
    clauses.push("(m.from_location_id = ? OR m.to_location_id = ?)");
    params.push(locationId, locationId);
  } else if (scope.length > 0) {
    clauses.push(
      `(m.from_location_id IN (${scope.map(() => "?").join(",")}) OR m.to_location_id IN (${scope
        .map(() => "?")
        .join(",")}))`,
    );
    params.push(...scope, ...scope);
  }
  const refType = url.searchParams.get("refType")?.trim();
  if (refType) {
    clauses.push("m.ref_type = ?");
    params.push(refType);
  }
  const search = url.searchParams.get("search")?.trim();
  if (search) {
    const like = `%${search}%`;
    clauses.push("(p.name LIKE ? OR COALESCE(p.sku,'') LIKE ? OR COALESCE(m.reason,'') LIKE ?)");
    params.push(like, like, like);
  }

  return { clauses, params };
}

router.get("/movements", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const { clauses, params } = buildMovementFilter(url, user.locationScope);
  const where = `WHERE ${clauses.join(" AND ")}`;

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT m.id, m.type, m.qty_milli, m.occurred_at, m.reason, m.counterparty, m.notes,
            m.ref_type, m.ref_id, m.unit_cost_cents,
            p.name AS product_name, p.sku, u2.code AS uom_code,
            fl.name AS from_location_name, fl.path AS from_location_path,
            tl.name AS to_location_name, tl.path AS to_location_path,
            us.name AS user_name
       FROM movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN uoms u2 ON u2.id = p.uom_id
       LEFT JOIN locations fl ON fl.id = m.from_location_id
       LEFT JOIN locations tl ON tl.id = m.to_location_id
       JOIN users us ON us.id = m.user_id
       ${where}
      ORDER BY m.occurred_at DESC, m.id DESC
      LIMIT 2000`,
    params,
  );

  const byType = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT m.type, COUNT(*) AS count, COALESCE(SUM(m.qty_milli), 0) AS qty_milli
       FROM movements m
       JOIN products p ON p.id = m.product_id
       ${where}
      GROUP BY m.type
      ORDER BY m.type`,
    params,
  );

  const totals = await oneRow<{ count: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS count FROM movements m JOIN products p ON p.id = m.product_id ${where}`,
    params,
  );

  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      qtyMilli: Number(row.qty_milli),
      occurredAt: String(row.occurred_at),
      reason: row.reason ? String(row.reason) : null,
      counterparty: row.counterparty ? String(row.counterparty) : null,
      notes: row.notes ? String(row.notes) : null,
      refType: row.ref_type ? String(row.ref_type) : null,
      refId: row.ref_id ? String(row.ref_id) : null,
      unitCostCents: row.unit_cost_cents === null || row.unit_cost_cents === undefined
        ? null
        : Number(row.unit_cost_cents),
      productName: String(row.product_name),
      sku: row.sku ? String(row.sku) : null,
      uomCode: row.uom_code ? String(row.uom_code) : null,
      fromLocationName: row.from_location_name ? String(row.from_location_name) : null,
      fromLocationPath: row.from_location_path ? String(row.from_location_path) : null,
      toLocationName: row.to_location_name ? String(row.to_location_name) : null,
      toLocationPath: row.to_location_path ? String(row.to_location_path) : null,
      userName: String(row.user_name),
    })),
    byType: byType.map((row) => ({
      type: String(row.type),
      count: Number(row.count),
      qtyMilli: Number(row.qty_milli),
    })),
    total: (totals?.count ?? 0) as number,
  });
});

/* -------------------------------------------------------------------------- */
/* Consumo                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Relatório de consumo. `groupBy=product` (padrão), `location`, `day`, `week`
 * ou `user`. Trabalha somente com lançamentos confirmados -- rascunhos e
 * cancelados não entram em nenhum total.
 */
router.get("/consumption", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const range = parseConsumptionRange(url);
  const groupBy = (url.searchParams.get("groupBy") ?? "product").trim();

  const params: (string | number)[] = [range.from.slice(0, 10), range.to.slice(0, 10)];
  const clauses = ["cr.status = 'registered'", "cr.period_end >= ?", "cr.period_start <= ?"];

  const locationId = url.searchParams.get("locationId")?.trim();
  assertLocationAllowed(locationId, user.locationScope);
  if (locationId) {
    params.push(locationId);
    clauses.push("cr.location_id = ?");
  } else if (user.locationScope.length > 0) {
    clauses.push(`cr.location_id IN (${user.locationScope.map(() => "?").join(",")})`);
    params.push(...user.locationScope);
  }

  const productId = url.searchParams.get("productId")?.trim();
  if (productId) {
    params.push(productId);
    clauses.push("ci.product_id = ?");
  }

  const where = `WHERE ${clauses.join(" AND ")}`;

  const groupExpressions: Record<string, { key: string; label: string; join: string }> = {
    product: { key: "p.id", label: "p.name", join: "JOIN products p ON p.id = ci.product_id" },
    location: { key: "l.id", label: "l.name", join: "LEFT JOIN locations l ON l.id = cr.location_id" },
    user: { key: "us.id", label: "us.name", join: "JOIN users us ON us.id = cr.created_by" },
    // Consumo e lançado por período (semanal, mensal...): o agrupamento por
    // tempo usa o FIM do período, que e a data em que o consumo foi fechado.
    day: { key: "substr(cr.period_end, 1, 10)", label: "substr(cr.period_end, 1, 10)", join: "" },
    week: {
      key: "strftime('%Y-W%W', cr.period_end)",
      label: "strftime('%Y-W%W', cr.period_end)",
      join: "",
    },
    month: { key: "substr(cr.period_end, 1, 7)", label: "substr(cr.period_end, 1, 7)", join: "" },
  };

  const group = groupExpressions[groupBy];
  if (!group) {
    throw badRequest(
      "Agrupamento inválido. Use product, location, user, day, week ou month.",
      { received: groupBy },
    );
  }

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT ${group.key} AS group_key, ${group.label} AS group_label,
            COALESCE(SUM(ci.qty_milli), 0) AS qty_milli,
            COUNT(DISTINCT cr.id) AS record_count,
            COUNT(*) AS line_count
       FROM consumption_records cr
       JOIN consumption_items ci ON ci.consumption_id = cr.id
       ${group.join}
       ${where}
      GROUP BY group_key, group_label
      ORDER BY qty_milli DESC
      LIMIT 500`,
    params,
  );

  const totals = await oneRow<{ qty_milli: number; record_count: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(ci.qty_milli), 0) AS qty_milli, COUNT(DISTINCT cr.id) AS record_count
       FROM consumption_records cr
       JOIN consumption_items ci ON ci.consumption_id = cr.id
       ${where}`,
    params,
  );

  const byPeriodicity = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT cr.periodicity, COUNT(DISTINCT cr.id) AS record_count,
            COALESCE(SUM(ci.qty_milli), 0) AS qty_milli
       FROM consumption_records cr
       JOIN consumption_items ci ON ci.consumption_id = cr.id
       ${where}
      GROUP BY cr.periodicity`,
    params,
  );

  return c.json({
    period: range,
    groupBy,
    groups: rows.map((row) => ({
      key: row.group_key === null || row.group_key === undefined ? null : String(row.group_key),
      label: row.group_label === null || row.group_label === undefined ? null : String(row.group_label),
      qtyMilli: Number(row.qty_milli),
      recordCount: Number(row.record_count),
      lineCount: Number(row.line_count),
    })),
    byPeriodicity: byPeriodicity.map((row) => ({
      periodicity: String(row.periodicity),
      recordCount: Number(row.record_count),
      qtyMilli: Number(row.qty_milli),
    })),
    totals: {
      qtyMilli: (totals?.qty_milli ?? 0) as number,
      recordCount: (totals?.record_count ?? 0) as number,
    },
  });
});

/* -------------------------------------------------------------------------- */
/* Tickets e ordens de serviço                                                */
/* -------------------------------------------------------------------------- */

router.get("/tickets", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const range = parseRange(url);
  const params: (string | number)[] = [range.from, range.to];
  const clauses = ["t.created_at >= ?", "t.created_at <= ?"];

  const locationId = url.searchParams.get("locationId")?.trim();
  assertLocationAllowed(locationId, user.locationScope);
  if (locationId) {
    params.push(locationId);
    clauses.push("t.location_id = ?");
  } else if (user.locationScope.length > 0) {
    clauses.push(`(t.location_id IS NULL OR t.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
    params.push(...user.locationScope);
  }

  const where = `WHERE ${clauses.join(" AND ")}`;

  const byStatus = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT t.status, COUNT(*) AS count FROM tickets t ${where} GROUP BY t.status ORDER BY count DESC`,
    params,
  );
  const byCategory = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT COALESCE(tc.name, 'Sem categoria') AS category_name, COUNT(*) AS count,
            SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count
       FROM tickets t
       LEFT JOIN ticket_categories tc ON tc.id = t.category_id
       ${where}
      GROUP BY category_name ORDER BY count DESC`,
    params,
  );
  const byPriority = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT t.priority, COUNT(*) AS count FROM tickets t ${where} GROUP BY t.priority`,
    params,
  );
  const timing = await oneRow<{ avg_hours: number | null; resolved_count: number; converted_count: number }>(
    c.env.DB,
    `SELECT AVG(CASE WHEN t.resolved_at IS NOT NULL
                     THEN (julianday(t.resolved_at) - julianday(t.created_at)) * 24 END) AS avg_hours,
            SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved_count,
            SUM(CASE WHEN t.status = 'converted' THEN 1 ELSE 0 END) AS converted_count
       FROM tickets t ${where}`,
    params,
  );
  const byLocation = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT COALESCE(l.name, 'Sem local') AS location_name, COUNT(*) AS count
       FROM tickets t LEFT JOIN locations l ON l.id = t.location_id
       ${where}
      GROUP BY location_name ORDER BY count DESC LIMIT 50`,
    params,
  );

  return c.json({
    period: range,
    byStatus: byStatus.map((r) => ({ status: String(r.status), count: Number(r.count) })),
    byCategory: byCategory.map((r) => ({
      categoryName: String(r.category_name),
      count: Number(r.count),
      resolvedCount: Number(r.resolved_count ?? 0),
    })),
    byPriority: byPriority.map((r) => ({ priority: String(r.priority), count: Number(r.count) })),
    byLocation: byLocation.map((r) => ({ locationName: String(r.location_name), count: Number(r.count) })),
    timing: {
      avgResolutionHours: timing?.avg_hours === null || timing?.avg_hours === undefined
        ? null
        : Number(timing.avg_hours),
      resolvedCount: Number(timing?.resolved_count ?? 0),
      convertedCount: Number(timing?.converted_count ?? 0),
    },
  });
});

router.get("/workorders", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const range = parseRange(url);
  const params: (string | number)[] = [range.from, range.to];
  const clauses = ["w.created_at >= ?", "w.created_at <= ?"];
  const locationId = url.searchParams.get("locationId")?.trim();
  assertLocationAllowed(locationId, user.locationScope);
  if (locationId) {
    params.push(locationId);
    clauses.push("w.location_id = ?");
  } else if (user.locationScope.length > 0) {
    clauses.push(`(w.location_id IS NULL OR w.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
    params.push(...user.locationScope);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const byStatus = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT w.status, COUNT(*) AS count FROM work_orders w ${where} GROUP BY w.status`,
    params,
  );
  const byAssignee = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT COALESCE(u.name, 'Sem responsável') AS assignee_name,
            COUNT(*) AS count,
            SUM(CASE WHEN w.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM work_orders w LEFT JOIN users u ON u.id = w.assignee_id
       ${where}
      GROUP BY assignee_name ORDER BY count DESC LIMIT 50`,
    params,
  );
  const timing = await oneRow<{ avg_hours: number | null; materials_milli: number }>(
    c.env.DB,
    `SELECT AVG(CASE WHEN w.finished_at IS NOT NULL
                     THEN (julianday(w.finished_at) - julianday(w.created_at)) * 24 END) AS avg_hours,
            (SELECT COALESCE(SUM(m.qty_milli), 0) FROM movements m
              WHERE m.ref_type = 'work_order' AND m.type = 'maintenance_use') AS materials_milli
       FROM work_orders w ${where}`,
    params,
  );

  return c.json({
    period: range,
    byStatus: byStatus.map((r) => ({ status: String(r.status), count: Number(r.count) })),
    byAssignee: byAssignee.map((r) => ({
      assigneeName: String(r.assignee_name),
      count: Number(r.count),
      doneCount: Number(r.done_count ?? 0),
    })),
    timing: {
      avgCompletionHours: timing?.avg_hours === null || timing?.avg_hours === undefined
        ? null
        : Number(timing.avg_hours),
    },
    materialsQtyMilli: Number(timing?.materials_milli ?? 0),
  });
});

/* -------------------------------------------------------------------------- */
/* Compras                                                                    */
/* -------------------------------------------------------------------------- */

router.get("/purchases", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const range = parseRange(url);
  const params: (string | number)[] = [range.from, range.to];
  const clauses = ["r.created_at >= ?", "r.created_at <= ?"];
  if (user.locationScope.length > 0) {
    clauses.push(`(r.location_id IS NULL OR r.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
    params.push(...user.locationScope);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;

  const byStatus = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT r.status, COUNT(*) AS count FROM purchase_requests r ${where} GROUP BY r.status`,
    params,
  );
  const pendingQty = await oneRow<{ pending_milli: number; expected_milli: number; received_milli: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(COALESCE(i.qty_ordered_milli, i.qty_approved_milli, i.qty_milli)), 0) AS expected_milli,
            COALESCE(SUM(i.qty_received_milli), 0) AS received_milli
       FROM purchase_requests r
       JOIN purchase_request_items i ON i.request_id = r.id
       ${where}`,
    params,
  );
  const receivedValue = await oneRow<{ value_cents: number; receipts: number }>(
    c.env.DB,
    // O valor recebido vem do MOVIMENTO de entrada (livro-razão), que carrega o
    // custo unitário no momento do recebimento -- e não de uma cópia na linha do
    // recebimento, que ficaria desatualizada em relação ao que entrou no estoque.
    `SELECT COALESCE(SUM(ri.qty_milli * COALESCE(m.unit_cost_cents, 0) / 1000), 0) AS value_cents,
            COUNT(DISTINCT rc.id) AS receipts
       FROM purchase_receipts rc
       JOIN purchase_receipt_items ri ON ri.receipt_id = rc.id
       LEFT JOIN movements m ON m.id = ri.movement_id
      WHERE rc.status = 'confirmed' AND rc.received_at >= ? AND rc.received_at <= ?`,
    [range.from, range.to],
  );
  const bySupplier = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT COALESCE(s.name, 'Sem fornecedor') AS supplier_name,
            COUNT(DISTINCT rc.id) AS receipt_count,
            COALESCE(SUM(ri.qty_milli), 0) AS qty_milli
       FROM purchase_receipts rc
       JOIN purchase_receipt_items ri ON ri.receipt_id = rc.id
       LEFT JOIN suppliers s ON s.id = rc.supplier_id
      WHERE rc.status = 'confirmed' AND rc.received_at >= ? AND rc.received_at <= ?
      GROUP BY supplier_name ORDER BY qty_milli DESC LIMIT 50`,
    [range.from, range.to],
  );
  // F-04: o ciclo de cotação (F-02) passa a fazer parte do relatório -- quantas
  // propostas foram registradas, aprovadas e recusadas no período.
  const quotesByStatus = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT q.status, COUNT(*) AS count
       FROM purchase_quotes q
       JOIN purchase_requests r ON r.id = q.request_id
       ${where}
      GROUP BY q.status`,
    params,
  );

  // F-03: onde o dinheiro está sendo comprometido -- itens com fornecedor
  // definido (pedido feito), com quantidade e valor pela última cotação/pedido.
  const ordersBySupplier = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT COALESCE(s.name, 'Sem fornecedor') AS supplier_name,
            COUNT(*) AS item_count,
            COALESCE(SUM(COALESCE(i.qty_ordered_milli, i.qty_approved_milli, i.qty_milli)), 0) AS qty_milli,
            COALESCE(SUM(
              COALESCE(i.qty_ordered_milli, i.qty_approved_milli, i.qty_milli)
                * COALESCE(i.unit_price_cents, 0) / 1000
            ), 0) AS value_cents
       FROM purchase_request_items i
       JOIN purchase_requests r ON r.id = i.request_id
       LEFT JOIN suppliers s ON s.id = i.supplier_id
       ${where} AND i.supplier_id IS NOT NULL
      GROUP BY supplier_name
      ORDER BY value_cents DESC, supplier_name
      LIMIT 50`,
    params,
  );

  // F-04: visão do ciclo completo por solicitação (até 100), com filtro
  // opcional de situação para localizar um estágio (ex.: "em cotação").
  const statusFilter = url.searchParams.get("status")?.trim() || "";
  if (statusFilter && !PURCHASE_STATUS.includes(statusFilter as (typeof PURCHASE_STATUS)[number])) {
    throw badRequest("Situação de compra inválida para o filtro.");
  }
  const requestClauses = [...clauses];
  const requestParams = [...params];
  if (statusFilter) {
    requestClauses.push("r.status = ?");
    requestParams.push(statusFilter);
  }
  const requests = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT r.id, r.code, r.status, r.priority, r.created_at, r.updated_at,
            rq.name AS requester_name,
            (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = r.id) AS item_count,
            (SELECT COUNT(*) FROM purchase_request_items i
               WHERE i.request_id = r.id AND i.purchase_mode = 'quote'
                 AND i.status NOT IN ('rejected','cancelled')) AS quote_item_count,
            (SELECT COUNT(*) FROM purchase_quotes q WHERE q.request_id = r.id) AS quote_count,
            (SELECT GROUP_CONCAT(DISTINCT s.name) FROM purchase_request_items i
               JOIN suppliers s ON s.id = i.supplier_id
              WHERE i.request_id = r.id) AS supplier_names,
            (SELECT COALESCE(SUM(
                 COALESCE(i.qty_ordered_milli, i.qty_approved_milli, i.qty_milli)
                   * COALESCE(i.unit_price_cents, 0) / 1000
               ), 0)
               FROM purchase_request_items i WHERE i.request_id = r.id) AS ordered_value_cents,
            (SELECT COALESCE(SUM(COALESCE(i.qty_ordered_milli, i.qty_approved_milli, i.qty_milli)), 0)
               FROM purchase_request_items i WHERE i.request_id = r.id) AS expected_qty_milli,
            (SELECT COALESCE(SUM(i.qty_received_milli), 0) FROM purchase_request_items i
              WHERE i.request_id = r.id) AS received_qty_milli,
            (SELECT COUNT(*) FROM purchase_receipts rc
              WHERE rc.request_id = r.id AND rc.status = 'confirmed') AS receipt_count
       FROM purchase_requests r
       JOIN users rq ON rq.id = r.requester_id
      WHERE ${requestClauses.join(" AND ")}
      ORDER BY r.created_at DESC, r.code DESC
      LIMIT 100`,
    requestParams,
  );

  const discrepancies = await oneRow<{ count: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS count FROM purchase_receipt_items ri
       JOIN purchase_receipts rc ON rc.id = ri.receipt_id
      WHERE ri.has_discrepancy = 1 AND rc.received_at >= ? AND rc.received_at <= ?`,
    [range.from, range.to],
  );

  const expected = Number(pendingQty?.expected_milli ?? 0);
  const received = Number(pendingQty?.received_milli ?? 0);

  return c.json({
    period: range,
    byStatus: byStatus.map((r) => ({ status: String(r.status), count: Number(r.count) })),
    quantities: {
      expectedQtyMilli: expected,
      receivedQtyMilli: received,
      pendingQtyMilli: Math.max(0, expected - received),
    },
    receipts: {
      count: Number(receivedValue?.receipts ?? 0),
      valueCents: Number(receivedValue?.value_cents ?? 0),
      discrepancyCount: Number(discrepancies?.count ?? 0),
    },
    bySupplier: bySupplier.map((r) => ({
      supplierName: String(r.supplier_name),
      receiptCount: Number(r.receipt_count),
      qtyMilli: Number(r.qty_milli),
    })),
    quotes: {
      total: quotesByStatus.reduce((sum, r) => sum + Number(r.count), 0),
      byStatus: quotesByStatus.map((r) => ({ status: String(r.status), count: Number(r.count) })),
    },
    ordersBySupplier: ordersBySupplier.map((r) => ({
      supplierName: String(r.supplier_name),
      itemCount: Number(r.item_count),
      qtyMilli: Number(r.qty_milli),
      valueCents: Number(r.value_cents),
    })),
    requests: requests.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      status: String(r.status),
      priority: String(r.priority),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      requesterName: String(r.requester_name),
      itemCount: Number(r.item_count),
      quoteItemCount: Number(r.quote_item_count),
      quoteCount: Number(r.quote_count),
      supplierNames: r.supplier_names ? String(r.supplier_names) : null,
      orderedValueCents: Number(r.ordered_value_cents),
      expectedQtyMilli: Number(r.expected_qty_milli),
      receivedQtyMilli: Number(r.received_qty_milli),
      receiptCount: Number(r.receipt_count),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Divergências de inventário                                                 */
/* -------------------------------------------------------------------------- */

router.get("/inventory-variances", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const params: (string | number)[] = [];
  const clauses: string[] = [];

  const inventoryId = url.searchParams.get("inventoryId")?.trim();
  if (inventoryId) {
    params.push(inventoryId);
    clauses.push("inv.id = ?");
  } else if (user.locationScope.length > 0) {
    clauses.push(`(inv.location_id IS NULL OR inv.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
    params.push(...user.locationScope);
  }

  const onlyWithDifference = url.searchParams.get("onlyDifference") !== "false";
  if (onlyWithDifference) clauses.push("ii.difference_milli != 0");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT inv.id AS inventory_id, inv.code AS inventory_code, inv.status AS inventory_status,
            inv.closed_at, inv.opened_at,
            l.name AS location_name, l.path AS location_path,
            ii.id AS item_id, ii.system_qty_milli AS qty_expected_milli, ii.counted_qty_milli, ii.difference_milli,
            ii.adjustment_movement_id, ii.is_inactive_product,
            p.name AS product_name, p.sku, u.code AS uom_code
       FROM inventory_items ii
       JOIN inventories inv ON inv.id = ii.inventory_id
       JOIN products p ON p.id = ii.product_id
       LEFT JOIN locations l ON l.id = inv.location_id
       LEFT JOIN uoms u ON u.id = p.uom_id
       ${where}
      ORDER BY ABS(ii.difference_milli) DESC, inv.closed_at DESC
      LIMIT 2000`,
    params,
  );

  const totals = await oneRow<{ shortage_milli: number; surplus_milli: number; lines: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(CASE WHEN ii.difference_milli < 0 THEN -ii.difference_milli ELSE 0 END), 0) AS shortage_milli,
            COALESCE(SUM(CASE WHEN ii.difference_milli > 0 THEN ii.difference_milli ELSE 0 END), 0) AS surplus_milli,
            COUNT(*) AS lines
       FROM inventory_items ii
       JOIN inventories inv ON inv.id = ii.inventory_id
       ${where}`,
    params,
  );

  return c.json({
    items: rows.map((row) => ({
      inventoryId: String(row.inventory_id),
      inventoryCode: String(row.inventory_code),
      inventoryStatus: String(row.inventory_status),
      closedAt: row.closed_at ? String(row.closed_at) : null,
      openedAt: row.opened_at ? String(row.opened_at) : null,
      locationName: row.location_name ? String(row.location_name) : null,
      locationPath: row.location_path ? String(row.location_path) : null,
      itemId: String(row.item_id),
      productName: String(row.product_name),
      sku: row.sku ? String(row.sku) : null,
      uomCode: row.uom_code ? String(row.uom_code) : null,
      qtyExpectedMilli: Number(row.qty_expected_milli ?? 0),
      qtyCountedMilli: Number(row.qty_counted_milli ?? 0),
      differenceMilli: Number(row.difference_milli ?? 0),
      adjustmentMovementId: row.adjustment_movement_id ? String(row.adjustment_movement_id) : null,
      isInactiveProduct: Number(row.is_inactive_product ?? 0) === 1,
    })),
    totals: {
      shortageMilli: (totals?.shortage_milli ?? 0) as number,
      surplusMilli: (totals?.surplus_milli ?? 0) as number,
      lines: (totals?.lines ?? 0) as number,
    },
  });
});

/* -------------------------------------------------------------------------- */
/* Alertas de reposição (água/uniformes como qualquer insumo)                  */
/* -------------------------------------------------------------------------- */

router.get("/consumption-by-location", requirePermission(PERMISSIONS.REPORTS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const range = parseConsumptionRange(url);
  const params: (string | number)[] = [range.from.slice(0, 10), range.to.slice(0, 10)];
  const clauses = ["cr.status = 'registered'", "cr.period_end >= ?", "cr.period_start <= ?"];
  if (user.locationScope.length > 0) {
    clauses.push(`cr.location_id IN (${user.locationScope.map(() => "?").join(",")})`);
    params.push(...user.locationScope);
  }

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT cr.id, cr.code, cr.location_id, cr.period_start, cr.period_end, cr.periodicity, cr.notes,
            l.name AS location_name, l.path AS location_path,
            u.name AS created_by_name,
            (SELECT COALESCE(SUM(ci.qty_milli), 0) FROM consumption_items ci WHERE ci.consumption_id = cr.id) AS qty_milli,
            (SELECT COUNT(*) FROM consumption_items ci WHERE ci.consumption_id = cr.id) AS item_count,
            (SELECT COUNT(*) FROM consumption_items ci
              WHERE ci.consumption_id = cr.id AND ci.movement_id IS NOT NULL) AS deducted_item_count
       FROM consumption_records cr
       LEFT JOIN locations l ON l.id = cr.location_id
       JOIN users u ON u.id = cr.created_by
      WHERE ${clauses.join(" AND ")}
      ORDER BY cr.period_end DESC, cr.created_at DESC LIMIT 500`,
    params,
  );

  return c.json({
    period: range,
    items: rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      locationId: row.location_id ? String(row.location_id) : null,
      locationName: row.location_name ? String(row.location_name) : null,
      locationPath: row.location_path ? String(row.location_path) : null,
      periodStart: String(row.period_start),
      periodEnd: String(row.period_end),
      periodicity: String(row.periodicity),
      notes: row.notes ? String(row.notes) : null,
      createdByName: String(row.created_by_name),
      qtyMilli: Number(row.qty_milli),
      itemCount: Number(row.item_count),
      deductedItemCount: Number(row.deducted_item_count),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Exportação CSV                                                             */
/* -------------------------------------------------------------------------- */

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    if (/[",;\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.map(escape).join(";")];
  for (const row of rows) lines.push(row.map(escape).join(";"));
  // BOM para o Excel abrir acentos corretamente.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * Exportação em CSV (separador `;`, compatível com Excel pt-BR). Exige
 * `reports.export`, além de `reports.view` para ler o relatório.
 */
router.get("/export", requirePermission(PERMISSIONS.REPORTS_EXPORT), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const report = (url.searchParams.get("report") ?? "").trim();

  const RESPONSES: Record<string, () => Promise<{ filename: string; csv: string }>> = {
    "stock-position": async () => {
      const params: (string | number)[] = [];
      const clauses = [scopeClause("stock.location_id", user.locationScope, params)];
      const locationId = url.searchParams.get("locationId")?.trim();
  assertLocationAllowed(locationId, user.locationScope);
      if (locationId) {
        params.push(locationId);
        clauses.push("stock.location_id = ?");
      }
      if (url.searchParams.get("onlyLow") === "true") {
        clauses.push(lowStockCondition(await lowStockScope(c.env.DB)));
      }
      const rows = await allRows<Record<string, unknown>>(
        c.env.DB,
        `${STOCK_POSITION_SQL} WHERE ${clauses.join(" AND ")} ORDER BY p.name, l.path LIMIT 20000`,
        params,
      );
      return {
        filename: "posicao-estoque",
        csv: toCsv(
          ["Produto", "SKU", "Categoria", "Unidade", "Local", "Caminho", "Quantidade", "Mínimo", "Abaixo do mínimo", "Atualizado em"],
          rows.map((r) => [
            String(r.product_name),
            r.sku ? String(r.sku) : null,
            r.category_name ? String(r.category_name) : null,
            r.uom_code ? String(r.uom_code) : null,
            String(r.location_name),
            r.location_path ? String(r.location_path) : null,
            (Number(r.qty_milli) / 1000).toFixed(3),
            (Number(r.min_qty_milli ?? 0) / 1000).toFixed(3),
            Number(r.min_qty_milli ?? 0) > 0 && Number(r.qty_milli) <= Number(r.min_qty_milli) ? "sim" : "não",
            String(r.updated_at),
          ]),
        ),
      };
    },
    movements: async () => {
      const { clauses, params } = buildMovementFilter(url, user.locationScope);
      const rows = await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT m.occurred_at, m.type, p.name AS product_name, p.sku, u2.code AS uom_code,
                m.qty_milli, fl.path AS from_path, tl.path AS to_path, m.reason, m.counterparty,
                us.name AS user_name, m.ref_type, m.ref_id
           FROM movements m
           JOIN products p ON p.id = m.product_id
           LEFT JOIN uoms u2 ON u2.id = p.uom_id
           LEFT JOIN locations fl ON fl.id = m.from_location_id
           LEFT JOIN locations tl ON tl.id = m.to_location_id
           JOIN users us ON us.id = m.user_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY m.occurred_at DESC LIMIT 20000`,
        params,
      );
      return {
        filename: "movimentações",
        csv: toCsv(
          ["Data", "Tipo", "Produto", "SKU", "Unidade", "Quantidade", "Origem", "Destino", "Motivo", "Contraparte", "Usuário", "Referência", "Referência ID"],
          rows.map((r) => [
            String(r.occurred_at),
            String(r.type),
            String(r.product_name),
            r.sku ? String(r.sku) : null,
            r.uom_code ? String(r.uom_code) : null,
            (Number(r.qty_milli) / 1000).toFixed(3),
            r.from_path ? String(r.from_path) : null,
            r.to_path ? String(r.to_path) : null,
            r.reason ? String(r.reason) : null,
            r.counterparty ? String(r.counterparty) : null,
            String(r.user_name),
            r.ref_type ? String(r.ref_type) : null,
            r.ref_id ? String(r.ref_id) : null,
          ]),
        ),
      };
    },
    consumption: async () => {
      const range = parseConsumptionRange(url);
      const params: (string | number)[] = [range.from.slice(0, 10), range.to.slice(0, 10)];
      const clauses = ["cr.status = 'registered'", "cr.period_end >= ?", "cr.period_start <= ?"];
      if (user.locationScope.length > 0) {
        clauses.push(`cr.location_id IN (${user.locationScope.map(() => "?").join(",")})`);
        params.push(...user.locationScope);
      }
      const rows = await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT cr.period_start, cr.period_end, cr.code, l.path AS location_path, cr.periodicity,
                p.name AS product_name, p.sku, u2.code AS uom_code, ci.qty_milli,
                CASE WHEN ci.movement_id IS NULL THEN 'medição' ELSE 'baixa' END AS mode,
                us.name AS user_name, cr.notes
           FROM consumption_records cr
           JOIN consumption_items ci ON ci.consumption_id = cr.id
           LEFT JOIN products p ON p.id = ci.product_id
           LEFT JOIN uoms u2 ON u2.id = p.uom_id
           LEFT JOIN locations l ON l.id = cr.location_id
           JOIN users us ON us.id = cr.created_by
          WHERE ${clauses.join(" AND ")}
          ORDER BY cr.period_end DESC, cr.created_at DESC LIMIT 20000`,
        params,
      );
      return {
        filename: "consumo",
        csv: toCsv(
          ["Período inicial", "Período final", "Lançamento", "Local", "Periodicidade", "Produto", "SKU", "Unidade", "Quantidade", "Modo", "Usuário", "Observações"],
          rows.map((r) => [
            String(r.period_start),
            String(r.period_end),
            String(r.code),
            r.location_path ? String(r.location_path) : null,
            String(r.periodicity),
            r.product_name ? String(r.product_name) : null,
            r.sku ? String(r.sku) : null,
            r.uom_code ? String(r.uom_code) : null,
            (Number(r.qty_milli) / 1000).toFixed(3),
            String(r.mode),
            String(r.user_name),
            r.notes ? String(r.notes) : null,
          ]),
        ),
      };
    },
    tickets: async () => {
      const range = parseRange(url);
      const params: (string | number)[] = [range.from, range.to];
      const clauses = ["t.created_at >= ?", "t.created_at <= ?"];
      if (user.locationScope.length > 0) {
        clauses.push(`(t.location_id IS NULL OR t.location_id IN (${user.locationScope.map(() => "?").join(",")}))`);
        params.push(...user.locationScope);
      }
      const rows = await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT t.code, t.title, tc.name AS category_name, l.path AS location_path, t.priority, t.status,
                rq.name AS requester_name, asg.name AS assignee_name, t.created_at, t.resolved_at, t.resolution
           FROM tickets t
           LEFT JOIN ticket_categories tc ON tc.id = t.category_id
           LEFT JOIN locations l ON l.id = t.location_id
           JOIN users rq ON rq.id = t.requester_id
           LEFT JOIN users asg ON asg.id = t.assignee_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY t.created_at DESC LIMIT 20000`,
        params,
      );
      return {
        filename: "tickets",
        csv: toCsv(
          ["Código", "Titulo", "Categoria", "Local", "Prioridade", "Status", "Solicitante", "Responsável", "Aberto em", "Resolvido em", "Solução"],
          rows.map((r) => [
            String(r.code),
            String(r.title),
            r.category_name ? String(r.category_name) : null,
            r.location_path ? String(r.location_path) : null,
            String(r.priority),
            String(r.status),
            String(r.requester_name),
            r.assignee_name ? String(r.assignee_name) : null,
            String(r.created_at),
            r.resolved_at ? String(r.resolved_at) : null,
            r.resolution ? String(r.resolution) : null,
          ]),
        ),
      };
    },
    purchases: async () => {
      const range = parseRange(url);
      const statusFilter = url.searchParams.get("status")?.trim() || "";
      if (statusFilter && !PURCHASE_STATUS.includes(statusFilter as (typeof PURCHASE_STATUS)[number])) {
        throw badRequest("Situação de compra inválida para o filtro.");
      }
      const params: (string | number)[] = [range.from, range.to];
      if (statusFilter) params.push(statusFilter);
      const rows = await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT r.code, r.status, r.priority, r.created_at, r.approved_at,
                rq.name AS requester_name, l.path AS location_path, r.justification,
                p.name AS product_name, p.sku, u2.code AS uom_code,
                i.qty_milli, i.qty_approved_milli, i.qty_ordered_milli, i.qty_received_milli,
                i.status AS item_status, s.name AS supplier_name, i.unit_price_cents,
                i.purchase_mode, i.order_ref,
                (SELECT q2.code FROM purchase_quote_items qi
                   JOIN purchase_quotes q2 ON q2.id = qi.quote_id
                  WHERE qi.request_item_id = i.id AND q2.status = 'approved'
                  LIMIT 1) AS approved_quote_code,
                (SELECT rc.received_at FROM purchase_receipt_items ri
                   JOIN purchase_receipts rc ON rc.id = ri.receipt_id
                  WHERE ri.request_item_id = i.id AND rc.status = 'confirmed'
                  ORDER BY rc.received_at DESC LIMIT 1) AS last_received_at
           FROM purchase_requests r
           JOIN purchase_request_items i ON i.request_id = r.id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN uoms u2 ON u2.id = p.uom_id
           LEFT JOIN locations l ON l.id = r.location_id
           LEFT JOIN suppliers s ON s.id = i.supplier_id
           JOIN users rq ON rq.id = r.requester_id
          WHERE r.created_at >= ? AND r.created_at <= ?${statusFilter ? " AND r.status = ?" : ""}
          ORDER BY r.created_at DESC LIMIT 20000`,
        params,
      );
      return {
        filename: "compras",
        csv: toCsv(
          ["Solicitação", "Status", "Prioridade", "Criada em", "Aprovada em", "Solicitante", "Local", "Justificativa",
            "Produto", "SKU", "Unidade", "Solicitado", "Aprovado", "Pedido", "Recebido", "Status do item",
            "Modo", "Cotação", "Referência do pedido", "Fornecedor", "Preço unitário (R$)",
            "Valor total (R$)", "Último recebimento em"],
          rows.map((r) => [
            String(r.code),
            String(r.status),
            String(r.priority),
            String(r.created_at),
            r.approved_at ? String(r.approved_at) : null,
            String(r.requester_name),
            r.location_path ? String(r.location_path) : null,
            r.justification ? String(r.justification) : null,
            r.product_name ? String(r.product_name) : null,
            r.sku ? String(r.sku) : null,
            r.uom_code ? String(r.uom_code) : null,
            (Number(r.qty_milli) / 1000).toFixed(3),
            r.qty_approved_milli === null ? null : (Number(r.qty_approved_milli) / 1000).toFixed(3),
            r.qty_ordered_milli === null ? null : (Number(r.qty_ordered_milli) / 1000).toFixed(3),
            (Number(r.qty_received_milli) / 1000).toFixed(3),
            String(r.item_status),
            r.purchase_mode === "quote"
              ? PURCHASE_ITEM_MODE_LABEL.quote
              : r.purchase_mode === "direct"
                ? PURCHASE_ITEM_MODE_LABEL.direct
                : null,
            r.approved_quote_code ? String(r.approved_quote_code) : null,
            r.order_ref ? String(r.order_ref) : null,
            r.supplier_name ? String(r.supplier_name) : null,
            r.unit_price_cents === null ? null : (Number(r.unit_price_cents) / 100).toFixed(2),
            r.unit_price_cents === null
              ? null
              : (
                  Math.round(
                    (Number(r.qty_ordered_milli ?? r.qty_approved_milli ?? r.qty_milli) *
                      Number(r.unit_price_cents)) /
                      1000,
                  ) / 100
                ).toFixed(2),
            r.last_received_at ? String(r.last_received_at) : null,
          ]),
        ),
      };
    },
    "inventory-variances": async () => {
      const params: (string | number)[] = [];
      const clauses: string[] = ["ii.difference_milli != 0"];
      if (url.searchParams.get("inventoryId")?.trim()) {
        params.push(url.searchParams.get("inventoryId")!.trim());
        clauses.push("inv.id = ?");
      } else if (user.locationScope.length > 0) {
        clauses.push(`inv.location_id IN (${user.locationScope.map(() => "?").join(",")})`);
        params.push(...user.locationScope);
      }
      const rows = await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT inv.code AS inventory_code, inv.closed_at, l.path AS location_path,
                p.name AS product_name, p.sku, u2.code AS uom_code,
                ii.system_qty_milli, ii.counted_qty_milli, ii.difference_milli,
                ii.adjustment_movement_id, ii.is_inactive_product
           FROM inventory_items ii
           JOIN inventories inv ON inv.id = ii.inventory_id
           JOIN products p ON p.id = ii.product_id
           LEFT JOIN locations l ON l.id = inv.location_id
           LEFT JOIN uoms u2 ON u2.id = p.uom_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY ABS(ii.difference_milli) DESC LIMIT 20000`,
        params,
      );
      return {
        filename: "divergencias-inventario",
        csv: toCsv(
          ["Inventário", "Fechado em", "Local", "Produto", "SKU", "Unidade", "Esperado", "Contado", "Diferença",
            "Movimento de ajuste", "Produto inativo"],
          rows.map((r) => [
            String(r.inventory_code),
            r.closed_at ? String(r.closed_at) : null,
            r.location_path ? String(r.location_path) : null,
            String(r.product_name),
            r.sku ? String(r.sku) : null,
            r.uom_code ? String(r.uom_code) : null,
            (Number(r.system_qty_milli) / 1000).toFixed(3),
            (Number(r.counted_qty_milli) / 1000).toFixed(3),
            (Number(r.difference_milli) / 1000).toFixed(3),
            r.adjustment_movement_id ? String(r.adjustment_movement_id) : null,
            Number(r.is_inactive_product ?? 0) === 1 ? "sim" : "não",
          ]),
        ),
      };
    },
  };

  const builder = RESPONSES[report];
  if (!builder) {
    throw badRequest(
      "Relatório inválido para exportação. Use stock-position, movements, consumption, tickets, purchases ou inventory-variances.",
      { received: report, available: Object.keys(RESPONSES) },
    );
  }

  const { filename, csv } = await builder();
  const stamp = new Date().toISOString().slice(0, 10);
  // Cabeçalho HTTP aceita apenas ASCII: remove acentos do nome do arquivo.
  const asciiName = filename.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${asciiName}-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
});

export default router;
