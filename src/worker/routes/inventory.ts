import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { assertLocationAllowed, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, normalizePage, offsetOf, oneRow } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { recordMovements, type MovementRequest } from "../stock";
import { buildCode, nextCounter, nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/** Limite de statements por lote do D1; o snapshot é enviado em blocos. */
const BATCH_CHUNK = 100;

/* -------------------------------------------------------------------------- */
/* Rótulo de período                                                          */
/* -------------------------------------------------------------------------- */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Número da semana ISO-8601 da data informada. */
function isoWeek(date: Date): number {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const monday = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - monday + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstMonday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstMonday + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Rótulo do ciclo quando o cliente não informa um, derivado da configuração
 * `inventory.periodicity` (diário, semanal, quinzenal, mensal, trimestral,
 * anual ou livre). Assim a periodicidade configurada muda o sistema de fato,
 * sem obrigar o usuário a digitar o período em toda abertura.
 */
async function defaultPeriodLabel(db: D1Database, reference = new Date()): Promise<string> {
  const row = await oneRow<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE key = 'inventory.periodicity'`,
  );
  const periodicity = row?.value ?? "monthly";
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth() + 1;
  const day = reference.getUTCDate();

  switch (periodicity) {
    case "daily":
      return `${year}-${pad2(month)}-${pad2(day)}`;
    case "weekly":
      return `${year}-S${pad2(isoWeek(reference))}`;
    case "biweekly":
      return `${year}-B${pad2(Math.floor((isoWeek(reference) + 1) / 2))}`;
    case "quarterly":
      return `${year}-T${Math.floor((month - 1) / 3) + 1}`;
    case "annual":
      return String(year);
    default:
      return `${year}-${pad2(month)}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const openBody = z.object({
  locationId: z.string().trim().min(1, "Selecione o local do inventário."),
  /** Quando ausente, o rótulo e derivado de `inventory.periodicity`. */
  periodLabel: z
    .string()
    .trim()
    .min(4, "Informe o período (ex: 2026-10).")
    .max(40)
    .optional(),
  notes: z.string().trim().max(1000).nullish(),
});

const countBody = z.object({
  countedQty: z.number().finite().nonnegative("A quantidade contada não pode ser negativa."),
  justification: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const adjustBody = z.object({
  justification: z.string().trim().min(5, "Explique a divergência (mínimo 5 caracteres).").max(500),
});

const skipBody = z.object({
  reason: z.string().trim().min(5, "Explique por que o item será dispensado.").max(300),
});

const closeBody = z.object({
  force: z.boolean().optional().default(false),
  forceReason: z.string().trim().max(500).nullish(),
});

const reopenBody = z.object({
  reason: z.string().trim().min(5, "Explique o motivo da reabertura (mínimo 5 caracteres).").max(300),
});

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

const INVENTORY_SELECT = `
  SELECT i.id, i.code, i.period_label, i.location_id, i.status, i.opened_by, i.opened_at,
         i.closed_by, i.closed_at, i.reopen_count, i.notes,
         l.name AS location_name, l.path AS location_path,
         ob.name AS opened_by_name, cb.name AS closed_by_name,
         (SELECT COUNT(*) FROM inventory_items ii WHERE ii.inventory_id = i.id) AS item_count,
         (SELECT COUNT(*) FROM inventory_items ii WHERE ii.inventory_id = i.id AND ii.status = 'pending') AS pending_count,
         (SELECT COUNT(*) FROM inventory_items ii WHERE ii.inventory_id = i.id AND ii.status = 'divergent') AS divergent_count,
         (SELECT COUNT(*) FROM inventory_items ii WHERE ii.inventory_id = i.id AND ii.status = 'adjusted') AS adjusted_count,
         (SELECT COUNT(*) FROM inventory_items ii WHERE ii.inventory_id = i.id AND ii.status = 'skipped') AS skipped_count
    FROM inventories i
    JOIN locations l ON l.id = i.location_id
    JOIN users ob ON ob.id = i.opened_by
    LEFT JOIN users cb ON cb.id = i.closed_by`;

router.get("/", requirePermission(PERMISSIONS.INVENTORY_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  const status = url.searchParams.get("status")?.trim();
  const locationId = url.searchParams.get("locationId")?.trim();
  const period = url.searchParams.get("period")?.trim();
  if (status) {
    clauses.push("i.status = ?");
    params.push(status);
  }
  if (locationId) {
    clauses.push("i.location_id = ?");
    params.push(locationId);
  }
  if (period) {
    clauses.push("i.period_label LIKE ?");
    params.push(`%${period}%`);
  }
  if (user.locationScope.length > 0) {
    clauses.push(`i.location_id IN (${user.locationScope.map(() => "?").join(",")})`);
    params.push(...user.locationScope);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM inventories i ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${INVENTORY_SELECT} ${where} ORDER BY i.status = 'open' DESC, i.opened_at DESC LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({ items: rows.map(mapInventory), total, page: page.page, pageSize: page.pageSize });
});

router.get("/:id", requirePermission(PERMISSIONS.INVENTORY_VIEW), async (c) => {
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${INVENTORY_SELECT} WHERE i.id = ?`, [id]);
  if (!row) throw notFound("Inventário não encontrado.");
  return c.json({ inventory: mapInventory(row) });
});

const ITEM_SELECT = `
  SELECT ii.id, ii.inventory_id, ii.product_id, ii.system_qty_milli, ii.counted_qty_milli,
         ii.difference_milli, ii.status, ii.counted_by, ii.counted_at, ii.justification,
         ii.notes, ii.is_inactive_product, ii.adjustment_movement_id,
         p.name AS product_name, p.sku, p.min_qty_milli, p.is_active AS product_active,
         u.code AS uom_code,
         c.name AS category_name,
         cu.name AS counted_by_name,
         COALESCE(s.qty_milli, 0) AS live_qty_milli,
         m.qty_milli AS adjustment_qty_milli,
         m.from_location_id AS adjustment_from, m.to_location_id AS adjustment_to
    FROM inventory_items ii
    JOIN products p ON p.id = ii.product_id
    JOIN uoms u ON u.id = p.uom_id
    LEFT JOIN product_categories c ON c.id = p.category_id
    LEFT JOIN users cu ON cu.id = ii.counted_by
    JOIN inventories inv ON inv.id = ii.inventory_id
    LEFT JOIN stock s ON s.product_id = ii.product_id AND s.location_id = inv.location_id
    LEFT JOIN movements m ON m.id = ii.adjustment_movement_id`;

router.get("/:id/items", requirePermission(PERMISSIONS.INVENTORY_VIEW), async (c) => {
  const url = new URL(c.req.url);
  const id = c.req.param("id");
  const status = url.searchParams.get("status")?.trim();
  const search = url.searchParams.get("search")?.trim();

  await requireInventory(c.env.DB, id);

  const clauses = ["ii.inventory_id = ?"];
  const params: (string | number)[] = [id];
  if (status) {
    clauses.push("ii.status = ?");
    params.push(status);
  }
  if (search) {
    clauses.push("(p.name LIKE ? OR COALESCE(p.sku,'') LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${ITEM_SELECT} WHERE ${clauses.join(" AND ")} ORDER BY ii.status = 'pending' DESC, p.name LIMIT 1000`,
    params,
  );
  return c.json({ items: rows.map(mapInventoryItem) });
});

/** Relatório de fechamento / acompanhamento do ciclo. */
router.get("/:id/report", requirePermission(PERMISSIONS.INVENTORY_VIEW), async (c) => {
  const id = c.req.param("id");
  const inventory = await oneRow<Record<string, unknown>>(c.env.DB, `${INVENTORY_SELECT} WHERE i.id = ?`, [id]);
  if (!inventory) throw notFound("Inventário não encontrado.");

  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${ITEM_SELECT} WHERE ii.inventory_id = ? ORDER BY p.name LIMIT 5000`,
    [id],
  );
  const mapped = items.map(mapInventoryItem);

  const counted = mapped.filter((i) => i.countedQtyMilli !== null);
  const excess = counted.filter((i) => i.differenceMilli !== null && i.differenceMilli > 0);
  const shortage = counted.filter((i) => i.differenceMilli !== null && i.differenceMilli < 0);
  const belowMin = mapped.filter(
    (i) => i.countedQtyMilli !== null && i.minQtyMilli > 0 && i.countedQtyMilli < i.minQtyMilli,
  );

  // Um registro por pessoa que contou, com a primeira contagem da pessoa no
  // ciclo: DISTINCT sobre (nome, momento) listaria a mesma pessoa várias vezes.
  const responsible = await allRows<{ name: string; counted_at: string }>(
    c.env.DB,
    `SELECT u.name AS name, MIN(ii.counted_at) AS counted_at
       FROM inventory_items ii
       JOIN users u ON u.id = ii.counted_by
      WHERE ii.inventory_id = ? AND ii.counted_by IS NOT NULL
      GROUP BY u.id, u.name
      ORDER BY MIN(ii.counted_at)`,
    [id],
  );

  return c.json({
    inventory: mapInventory(inventory),
    summary: {
      totalItems: mapped.length,
      pending: mapped.filter((i) => i.status === "pending").length,
      counted: counted.length,
      divergent: mapped.filter((i) => i.status === "divergent").length,
      adjusted: mapped.filter((i) => i.status === "adjusted").length,
      skipped: mapped.filter((i) => i.status === "skipped").length,
      excessItems: excess.length,
      shortageItems: shortage.length,
      belowMinimumItems: belowMin.length,
      totalExcessMilli: excess.reduce((sum, i) => sum + (i.differenceMilli ?? 0), 0),
      totalShortageMilli: shortage.reduce((sum, i) => sum + (i.differenceMilli ?? 0), 0),
      appliedAdjustmentMilli: mapped.reduce((sum, i) => sum + (i.adjustmentDeltaMilli ?? 0), 0),
    },
    counters: responsible.map((r) => ({ name: r.name, firstCountAt: r.counted_at })),
    items: mapped,
  });
});

/* -------------------------------------------------------------------------- */
/* Abertura                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Abre um ciclo de inventário e congela o snapshot dos itens a conferir.
 *
 * Regra explicita de escopo do snapshot (para nenhum item desaparecer
 * silenciosamente):
 *   1. produtos com saldo diferente de zero no local;
 *   2. produtos com movimentação registrada no local (mesmo com saldo zero);
 *   3. produtos ativos com quantidade mínima definida (conferem o zero).
 * Produtos inativos que entram por (1) ou (2) são marcados com
 * `is_inactive_product` e permanecem visíveis, sinalizados na tela e no
 * relatório. Produtos criados depois da abertura entram via
 * POST /:id/sync-items, que registra a inclusão na auditoria.
 */
router.post("/", requirePermission(PERMISSIONS.INVENTORY_CREATE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, openBody);
  assertLocationAllowed(user, body.locationId);

  const location = await oneRow<{ id: string; name: string; is_active: number }>(
    c.env.DB,
    `SELECT id, name, is_active FROM locations WHERE id = ?`,
    [body.locationId],
  );
  if (!location) throw notFound("Local não encontrado.");
  if (location.is_active !== 1) throw badRequest("Não é possível abrir inventário em um local inativo.");

  const open = await oneRow<{ id: string; code: string }>(
    c.env.DB,
    `SELECT id, code FROM inventories WHERE location_id = ? AND status = 'open'`,
    [body.locationId],
  );
  if (open) throw conflict(`Já existe um inventário aberto para este local (${open.code}).`);

  const id = uuid();
  const ts = nowIso();
  const code = buildCode("INV", await nextCounter(c.env.DB, "inventory"));
  const periodLabel = body.periodLabel?.trim() || (await defaultPeriodLabel(c.env.DB));

  const candidates = await allRows<{ id: string; qty_milli: number; is_active: number }>(
    c.env.DB,
    `SELECT p.id, COALESCE(s.qty_milli, 0) AS qty_milli, p.is_active
       FROM products p
       LEFT JOIN stock s ON s.product_id = p.id AND s.location_id = ?
      WHERE COALESCE(s.qty_milli, 0) <> 0
         OR EXISTS (SELECT 1 FROM movements m
                     WHERE m.product_id = p.id
                       AND (m.from_location_id = ? OR m.to_location_id = ?))
         OR (p.is_active = 1 AND p.min_qty_milli > 0)
      ORDER BY p.name`,
    [body.locationId, body.locationId, body.locationId],
  );

  const info = clientInfo(c);
  const header = c.env.DB.prepare(
    `INSERT INTO inventories (id, code, period_label, location_id, status, opened_by, opened_at, notes)
     VALUES (?,?,?,?,'open',?,?,?)`,
  ).bind(id, code, periodLabel, body.locationId, user.id, ts, body.notes ?? null);

  const itemStatements = candidates.map((p) =>
    c.env.DB
      .prepare(
        `INSERT INTO inventory_items
           (id, inventory_id, product_id, system_qty_milli, counted_qty_milli, difference_milli,
            status, is_inactive_product)
         VALUES (?,?,?,?,NULL,NULL,'pending',?)`,
      )
      .bind(uuid(), id, p.id, p.qty_milli, p.is_active === 1 ? 0 : 1),
  );

  const audit = auditStatement(c.env.DB, {
    actor: { id: user.id, name: user.name },
    module: "inventory",
    action: "inventory.open",
    entityType: "inventory",
    entityId: id,
    after: { code, periodLabel, locationId: body.locationId, itemCount: candidates.length },
    ...info,
  });

  // Cria o cabeçalho primeiro (referência de FK dos itens) e depois os itens
  // em blocos, mantendo o ciclo utilizável mesmo em catálogo grande.
  await c.env.DB.batch([header, audit]);
  for (let i = 0; i < itemStatements.length; i += BATCH_CHUNK) {
    await c.env.DB.batch(itemStatements.slice(i, i + BATCH_CHUNK));
  }

  return c.json({ id, code, periodLabel, status: "open", locationId: body.locationId, itemCount: candidates.length }, 201);
});

/**
 * Adiciona ao ciclo aberto os produtos ativos criados após a abertura do
 * inventário, que de outra forma nunca seriam conferidos neste ciclo.
 */
router.post("/:id/sync-items", requirePermission(PERMISSIONS.INVENTORY_CREATE), async (c) => {
  const user = currentUser(c);
  const inventory = await requireInventory(c.env.DB, c.req.param("id"));
  if (inventory.status !== "open") throw conflict("Somente inventários abertos podem receber novos itens.");

  const missing = await allRows<{ id: string; qty_milli: number; created_at: string }>(
    c.env.DB,
    `SELECT p.id, COALESCE(s.qty_milli, 0) AS qty_milli, p.created_at
       FROM products p
       LEFT JOIN stock s ON s.product_id = p.id AND s.location_id = ?
      WHERE p.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM inventory_items ii
                         WHERE ii.inventory_id = ? AND ii.product_id = p.id)
      ORDER BY p.name`,
    [inventory.location_id, inventory.id],
  );

  if (missing.length === 0) return c.json({ ok: true, added: 0 });

  const statements = missing.map((p) =>
    c.env.DB
      .prepare(
        `INSERT INTO inventory_items
           (id, inventory_id, product_id, system_qty_milli, status, is_inactive_product)
         VALUES (?,?,?,?, 'pending', 0)`,
      )
      .bind(uuid(), inventory.id, p.id, p.qty_milli),
  );

  const info = clientInfo(c);
  statements.push(
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "inventory",
      action: "inventory.sync_items",
      entityType: "inventory",
      entityId: inventory.id,
      after: { addedProducts: missing.map((p) => p.id) },
      reason: "Inclusão de produtos criados após a abertura do inventário.",
      ...info,
    }),
  );

  for (let i = 0; i < statements.length; i += BATCH_CHUNK) {
    await c.env.DB.batch(statements.slice(i, i + BATCH_CHUNK));
  }

  return c.json({ ok: true, added: missing.length });
});

/* -------------------------------------------------------------------------- */
/* Contagem                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Registra a contagem física de um item.
 *
 * Preserva o histórico: cada contagem gera uma linha em `inventory_counts`.
 * Uma nova contagem do mesmo item é registrada como correção (is_correction=1)
 * e marca a anterior como superada, sem apagar nada.
 */
router.post("/:id/items/:itemId/count", requirePermission(PERMISSIONS.INVENTORY_COUNT), async (c) => {
  const user = currentUser(c);
  const inventory = await requireInventory(c.env.DB, c.req.param("id"));
  const itemId = c.req.param("itemId");
  const body = await parseBody(c, countBody);

  if (inventory.status !== "open") {
    throw conflict("Este inventário não está aberto. Reabra o ciclo para registrar novas contagens.");
  }
  assertLocationAllowed(user, inventory.location_id);

  const item = await oneRow<{ id: string; system_qty_milli: number; counted_qty_milli: number | null }>(
    c.env.DB,
    `SELECT id, system_qty_milli, counted_qty_milli FROM inventory_items WHERE id = ? AND inventory_id = ?`,
    [itemId, inventory.id],
  );
  if (!item) throw notFound("Item de inventário não encontrado.");

  const countedMilli = Math.round(body.countedQty * 1000);
  const difference = countedMilli - item.system_qty_milli;
  const isCorrection = item.counted_qty_milli !== null;
  const status = difference === 0 ? "counted" : "divergent";
  const ts = nowIso();
  const countId = uuid();
  const info = clientInfo(c);

  const previous = isCorrection
    ? await oneRow<{ id: string }>(
        c.env.DB,
        `SELECT id FROM inventory_counts WHERE inventory_item_id = ? AND superseded_by IS NULL
          ORDER BY counted_at DESC LIMIT 1`,
        [itemId],
      )
    : null;

  const statements: D1PreparedStatement[] = [
    c.env.DB
      .prepare(
        `INSERT INTO inventory_counts
           (id, inventory_item_id, counted_qty_milli, system_qty_milli, justification, notes,
            counted_by, counted_at, is_correction, superseded_by)
         VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .bind(
        countId,
        itemId,
        countedMilli,
        item.system_qty_milli,
        body.justification ?? null,
        body.notes ?? null,
        user.id,
        ts,
        isCorrection ? 1 : 0,
      ),
    c.env.DB
      .prepare(
        `UPDATE inventory_items
            SET counted_qty_milli = ?, difference_milli = ?, status = ?, counted_by = ?, counted_at = ?,
                justification = COALESCE(?, justification), notes = COALESCE(?, notes)
          WHERE id = ?`,
      )
      .bind(
        countedMilli,
        difference,
        status,
        user.id,
        ts,
        body.justification ?? null,
        body.notes ?? null,
        itemId,
      ),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "inventory",
      action: isCorrection ? "inventory.recount" : "inventory.count",
      entityType: "inventory_item",
      entityId: itemId,
      before: { countedQtyMilli: item.counted_qty_milli },
      after: { countedQtyMilli: countedMilli, differenceMilli: difference, status },
      reason: body.justification ?? null,
      ...info,
    }),
  ];

  if (previous) {
    statements.push(
      c.env.DB.prepare(`UPDATE inventory_counts SET superseded_by = ? WHERE id = ?`).bind(countId, previous.id),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({
    ok: true,
    systemQtyMilli: item.system_qty_milli,
    countedQtyMilli: countedMilli,
    differenceMilli: difference,
    status,
  });
});

/** Dispensa um item do ciclo, com justificativa registrada. */
router.post("/:id/items/:itemId/skip", requirePermission(PERMISSIONS.INVENTORY_COUNT), async (c) => {
  const user = currentUser(c);
  const inventory = await requireInventory(c.env.DB, c.req.param("id"));
  const itemId = c.req.param("itemId");
  const body = await parseBody(c, skipBody);
  if (inventory.status !== "open") throw conflict("Este inventário não está aberto.");

  const item = await oneRow<{ id: string; status: string; counted_qty_milli: number | null }>(
    c.env.DB,
    `SELECT id, status, counted_qty_milli FROM inventory_items WHERE id = ? AND inventory_id = ?`,
    [itemId, inventory.id],
  );
  if (!item) throw notFound("Item de inventário não encontrado.");
  if (item.counted_qty_milli !== null) {
    throw conflict("Um item já contado não pode ser dispensado. Registre uma nova contagem.");
  }

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    c.env.DB
      .prepare(`UPDATE inventory_items SET status = 'skipped', justification = ?, counted_by = ?, counted_at = ? WHERE id = ?`)
      .bind(body.reason, user.id, ts, itemId),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "inventory",
      action: "inventory.item_skip",
      entityType: "inventory_item",
      entityId: itemId,
      before: { status: item.status },
      after: { status: "skipped" },
      reason: body.reason,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Ajuste                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Aplica o ajuste de inventário de um item.
 *
 * Calcula a diferença entre a contagem física e o saldo ATUAL do local (que
 * pode ter mudado desde a abertura do ciclo) e gera o movimento
 * `inventory_adjust` correspondente. O saldo nunca e alterado sem movimento.
 * A `requestKey` e determinística (`adj-<itemId>`), portanto um reenvio não
 * gera ajuste duplicado.
 */
router.post("/:id/items/:itemId/adjust", requirePermission(PERMISSIONS.INVENTORY_ADJUST), async (c) => {
  const user = currentUser(c);
  const inventory = await requireInventory(c.env.DB, c.req.param("id"));
  const itemId = c.req.param("itemId");
  const body = await parseBody(c, adjustBody);

  if (inventory.status !== "open") throw conflict("Este inventário não está aberto.");
  assertLocationAllowed(user, inventory.location_id);

  const item = await oneRow<{
    id: string;
    product_id: string;
    counted_qty_milli: number | null;
    difference_milli: number | null;
    status: string;
    adjustment_movement_id: string | null;
  }>(
    c.env.DB,
    `SELECT id, product_id, counted_qty_milli, difference_milli, status, adjustment_movement_id
       FROM inventory_items WHERE id = ? AND inventory_id = ?`,
    [itemId, inventory.id],
  );
  if (!item) throw notFound("Item de inventário não encontrado.");
  if (item.counted_qty_milli === null) throw conflict("Registre a contagem física antes de aplicar o ajuste.");
  if (item.adjustment_movement_id) throw conflict("Este item já foi ajustado. Registre uma nova contagem para reajustar.");

  const live = await oneRow<{ qty_milli: number }>(
    c.env.DB,
    `SELECT COALESCE(qty_milli, 0) AS qty_milli FROM stock WHERE product_id = ? AND location_id = ?`,
    [item.product_id, inventory.location_id],
  );
  const liveMilli = live?.qty_milli ?? 0;
  const delta = item.counted_qty_milli - liveMilli;

  const info = clientInfo(c);

  const baseAudit = {
    actor: { id: user.id, name: user.name },
    module: "inventory",
    action: "inventory.adjust",
    entityType: "inventory_item",
    entityId: itemId,
    before: { systemQtyMilli: liveMilli, snapshotQtyMilli: item.counted_qty_milli - (item.difference_milli ?? 0) },
    after: { countedQtyMilli: item.counted_qty_milli, appliedDeltaMilli: delta },
    reason: body.justification,
    ...info,
  };

  let movementId: string | null = null;

  if (delta !== 0) {
    const request: MovementRequest = {
      type: "inventory_adjust",
      productId: item.product_id,
      qtyMilli: Math.abs(delta),
      fromLocationId: delta < 0 ? inventory.location_id : null,
      toLocationId: delta > 0 ? inventory.location_id : null,
      reason: `Ajuste de inventário ${inventory.code}: ${body.justification}`,
      counterparty: null,
      refType: "inventory",
      refId: inventory.id,
      notes: `Contagem física ${item.counted_qty_milli} contra saldo ${liveMilli}.`,
      requestKey: `adj-${itemId}`,
      userId: user.id,
    };

    const [movement] = await recordMovements(c.env.DB, { id: user.id, name: user.name }, [request], {
      // O id do movimento já está disponível ao montar o lote, portanto o item
      // e atualizado e vinculado DENTRO da mesma transação.
      extraStatements: (recorded) => [
        c.env.DB
          .prepare(`UPDATE inventory_items SET status = 'adjusted', adjustment_movement_id = ? WHERE id = ?`)
          .bind(recorded[0]?.id ?? null, itemId),
        auditStatement(c.env.DB, {
          ...baseAudit,
          after: { ...baseAudit.after, appliedDeltaMilli: delta, movementId: recorded[0]?.id ?? null },
        }),
      ],
    });
    movementId = movement?.id ?? null;
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE inventory_items SET status = 'adjusted' WHERE id = ?`).bind(itemId),
      auditStatement(c.env.DB, { ...baseAudit, after: { ...baseAudit.after, appliedDeltaMilli: 0 } }),
    ]);
  }

  return c.json({
    ok: true,
    appliedDeltaMilli: delta,
    movementId,
    status: "adjusted",
  });
});

/* -------------------------------------------------------------------------- */
/* Fechamento e reabertura                                                    */
/* -------------------------------------------------------------------------- */

router.post("/:id/close", requirePermission(PERMISSIONS.INVENTORY_CLOSE), async (c) => {
  const user = currentUser(c);
  const inventory = await requireInventory(c.env.DB, c.req.param("id"));
  const body = await parseBody(c, closeBody);

  if (inventory.status !== "open") throw conflict("Este inventário não está aberto.");
  assertLocationAllowed(user, inventory.location_id);

  const pending = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM inventory_items WHERE inventory_id = ? AND status = 'pending'`,
    [inventory.id],
  );

  if (pending > 0 && !body.force) {
    throw conflict(
      `Existem ${pending} ${pending === 1 ? "item pendente" : "itens pendentes"} de contagem. Conte ou dispense todos os itens antes de fechar.`,
      { pending },
    );
  }
  if (pending > 0 && body.force && (body.forceReason ?? "").trim().length < 5) {
    throw badRequest("Para fechar com itens pendentes é obrigatório informar a justificativa da exceção.");
  }

  const unadjusted = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM inventory_items WHERE inventory_id = ? AND status = 'divergent' AND adjustment_movement_id IS NULL`,
    [inventory.id],
  );
  if (unadjusted > 0 && !body.force) {
    throw conflict(
      `Existem ${unadjusted} ${unadjusted === 1 ? "item" : "itens"} com divergência sem ajuste aplicado. Aplique o ajuste ou use o fechamento com exceção justificada.`,
      { unadjusted },
    );
  }

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    c.env.DB
      .prepare(`UPDATE inventories SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?`)
      .bind(user.id, ts, inventory.id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "inventory",
      action: body.force ? "inventory.close_with_exception" : "inventory.close",
      entityType: "inventory",
      entityId: inventory.id,
      before: { status: "open" },
      after: { status: "closed", pendingItems: pending, unadjustedDivergences: unadjusted },
      reason: body.force ? (body.forceReason ?? null) : null,
      ...info,
    }),
  ]);

  return c.json({ ok: true, closedWithPending: pending, closedWithUnadjusted: unadjusted });
});

/**
 * Reabertura excepcional. Não altera nem apaga contagens e ajustes já
 * realizados; apenas devolve o ciclo ao estado aberto, registrando o motivo e
 * incrementando o contador de reaberturas exibido no relatório.
 */
router.post("/:id/reopen", requirePermission(PERMISSIONS.INVENTORY_REOPEN), async (c) => {
  const user = currentUser(c);
  const inventory = await requireInventory(c.env.DB, c.req.param("id"));
  const body = await parseBody(c, reopenBody);

  if (inventory.status !== "closed") throw conflict("Somente inventários encerrados podem ser reabertos.");
  assertLocationAllowed(user, inventory.location_id);

  const info = clientInfo(c);
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `UPDATE inventories SET status = 'open', closed_by = NULL, closed_at = NULL,
                reopen_count = reopen_count + 1 WHERE id = ?`,
      )
      .bind(inventory.id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "inventory",
      action: "inventory.reopen",
      entityType: "inventory",
      entityId: inventory.id,
      before: { status: "closed" },
      after: { status: "open", reopenCount: inventory.reopen_count + 1 },
      reason: body.reason,
      ...info,
    }),
  ]);

  return c.json({ ok: true, reopenCount: inventory.reopen_count + 1 });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

interface InventoryRow {
  id: string;
  code: string;
  location_id: string;
  status: string;
  reopen_count: number;
  period_label: string;
}

async function requireInventory(db: D1Database, id: string | undefined): Promise<InventoryRow> {
  if (!id) throw badRequest("Inventário não informado.");
  const row = await oneRow<InventoryRow>(
    db,
    `SELECT id, code, location_id, status, reopen_count, period_label FROM inventories WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Inventário não encontrado.");
  return row;
}

function mapInventory(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    code: String(row.code),
    periodLabel: String(row.period_label),
    locationId: String(row.location_id),
    locationName: row.location_name ? String(row.location_name) : null,
    locationPath: row.location_path ? String(row.location_path) : null,
    status: String(row.status),
    openedBy: String(row.opened_by),
    openedByName: row.opened_by_name ? String(row.opened_by_name) : null,
    openedAt: String(row.opened_at),
    closedBy: row.closed_by ? String(row.closed_by) : null,
    closedByName: row.closed_by_name ? String(row.closed_by_name) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    reopenCount: Number(row.reopen_count ?? 0),
    notes: row.notes ? String(row.notes) : null,
    itemCount: Number(row.item_count ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    divergentCount: Number(row.divergent_count ?? 0),
    adjustedCount: Number(row.adjusted_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
  };
}

function mapInventoryItem(row: Record<string, unknown>) {
  const adjustmentQty = row.adjustment_qty_milli === null || row.adjustment_qty_milli === undefined
    ? null
    : Number(row.adjustment_qty_milli);
  const signedAdjustment =
    adjustmentQty === null ? null : row.adjustment_to ? adjustmentQty : -adjustmentQty;

  return {
    id: String(row.id),
    inventoryId: String(row.inventory_id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    sku: row.sku ? String(row.sku) : null,
    uomCode: String(row.uom_code),
    categoryName: row.category_name ? String(row.category_name) : null,
    productActive: Number(row.product_active ?? 1) === 1,
    isInactiveProduct: Number(row.is_inactive_product ?? 0) === 1,
    minQtyMilli: Number(row.min_qty_milli ?? 0),
    systemQtyMilli: Number(row.system_qty_milli),
    liveQtyMilli: Number(row.live_qty_milli ?? 0),
    countedQtyMilli: row.counted_qty_milli === null || row.counted_qty_milli === undefined
      ? null
      : Number(row.counted_qty_milli),
    differenceMilli: row.difference_milli === null || row.difference_milli === undefined
      ? null
      : Number(row.difference_milli),
    status: String(row.status),
    countedBy: row.counted_by ? String(row.counted_by) : null,
    countedByName: row.counted_by_name ? String(row.counted_by_name) : null,
    countedAt: row.counted_at ? String(row.counted_at) : null,
    justification: row.justification ? String(row.justification) : null,
    notes: row.notes ? String(row.notes) : null,
    adjustmentMovementId: row.adjustment_movement_id ? String(row.adjustment_movement_id) : null,
    adjustmentDeltaMilli: signedAdjustment,
  };
}

export default router;
