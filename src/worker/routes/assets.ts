import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import {
  ASSET_CONDITIONS,
  ASSET_CRITICALITIES,
  ASSET_MOVEMENT_TYPE_LABELS,
  ASSET_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_TERMINAL_STATUSES,
  type AssetCondition,
  type AssetCriticality,
  type AssetMovementType,
  type AssetStatus,
} from "@shared/assets";
import type { AppEnv, AuthUser } from "../types";
import {
  assertLocationAllowed,
  currentUser,
  recordPermissionDenied,
  requireAuth,
  requirePermission,
} from "../auth";
import { auditStatement, clientInfo } from "../audit";
import {
  allRows,
  countRows,
  insertStatement,
  normalizePage,
  offsetOf,
  oneRow,
  updateStatement,
  WhereBuilder,
} from "../db";
import { badRequest, conflict, forbidden, notFound, parseBody } from "../errors";
import { searchTokens, sqlSearchExpression } from "../search";
import { buildCode, nextCounter, nowIso, uuid } from "../util";

/**
 * Patrimônio (ativos fixos).
 *
 * Regras centrais:
 *  - o ativo nunca é apagado: baixa e descarte são situações terminais com
 *    histórico (`asset_movements`) e dados de baixa preservados;
 *  - toda mudança operacional (local, responsável, situação, condição,
 *    manutenção e inventário) grava uma movimentação na mesma transação;
 *  - o escopo de local do usuário vale para leitura e para qualquer destino de
 *    transferência;
 *  - `assets.manage` cuida do cadastro e da baixa/descarte; `assets.move` cuida
 *    da operação do dia a dia.
 */

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const optionalText = (max: number) => z.string().trim().max(max).nullish();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato AAAA-MM-DD.");
const idSchema = z.string().trim().min(1, "Informe o identificador.").max(80);

const assetBody = z.object({
  name: z.string().trim().min(2, "Informe o nome do ativo.").max(160),
  description: optionalText(2000),
  categoryId: idSchema,
  tag: optionalText(60),
  status: z.enum(ASSET_STATUSES).optional(),
  condition: z.enum(ASSET_CONDITIONS).optional(),
  criticality: z.enum(ASSET_CRITICALITIES).optional(),
  locationId: idSchema,
  departmentId: idSchema.nullish(),
  custodianUserId: idSchema.nullish(),
  costCenterId: idSchema.nullish(),
  supplierId: idSchema.nullish(),
  acquisitionDate: isoDate.nullish(),
  acquisitionValueCents: z.number().int().min(0).max(1_000_000_000_000).nullish(),
  invoiceNumber: optionalText(60),
  invoiceSeries: optionalText(20),
  warrantyUntil: isoDate.nullish(),
  serialNumber: optionalText(120),
  manufacturer: optionalText(120),
  model: optionalText(120),
  manufactureYear: z.number().int().min(1900).max(2100).nullish(),
  notes: optionalText(2000),
});

/**
 * A edição do cadastro não altera situação, condição, local nem responsável:
 * esses campos têm rotas próprias que registram histórico. Corrigir o cadastro
 * não pode reescrever a linha do tempo do ativo.
 */
const assetUpdateBody = assetBody
  .omit({ status: true, condition: true, locationId: true, custodianUserId: true })
  .partial();

const movementDate = isoDate.nullish();
const reasonSchema = z.string().trim().max(500).nullish();

const transferBody = z.object({
  toLocationId: idSchema,
  reason: reasonSchema,
  movementDate,
});

const assignmentBody = z.object({
  custodianUserId: idSchema.nullish(),
  reason: reasonSchema,
  movementDate,
});

const statusBody = z.object({
  status: z.enum(ASSET_STATUSES),
  reason: reasonSchema,
  movementDate,
});

const conditionBody = z.object({
  condition: z.enum(ASSET_CONDITIONS),
  reason: reasonSchema,
  movementDate,
});

const maintenanceBody = z.object({
  reason: z.string().trim().min(3, "Descreva a manutenção realizada.").max(500),
  status: z.enum(ASSET_STATUSES).nullish(),
  movementDate,
});

const inventoryBody = z.object({
  locationId: idSchema.nullish(),
  condition: z.enum(ASSET_CONDITIONS).nullish(),
  reason: reasonSchema,
  movementDate,
});

const categoryBody = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Informe o código da categoria.")
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou sublinhado."),
  name: z.string().trim().min(2, "Informe o nome da categoria.").max(120),
  description: optionalText(500),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});

const categoryUpdateBody = categoryBody
  .omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

/* -------------------------------------------------------------------------- */
/* Tipos e mapeamentos                                                        */
/* -------------------------------------------------------------------------- */

interface AssetRow {
  id: string;
  code: string;
  tag: string | null;
  name: string;
  description: string | null;
  category_id: string;
  status: AssetStatus;
  condition: AssetCondition;
  criticality: AssetCriticality;
  location_id: string;
  department_id: string | null;
  custodian_user_id: string | null;
  cost_center_id: string | null;
  supplier_id: string | null;
  acquisition_date: string | null;
  acquisition_value_cents: number | null;
  invoice_number: string | null;
  invoice_series: string | null;
  warranty_until: string | null;
  serial_number: string | null;
  manufacturer: string | null;
  model: string | null;
  manufacture_year: number | null;
  notes: string | null;
  retired_at: string | null;
  retired_reason: string | null;
  retired_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AssetJoinedRow extends AssetRow {
  category_name: string;
  location_name: string;
  location_path: string | null;
  department_name: string | null;
  custodian_name: string | null;
  cost_center_name: string | null;
  supplier_name: string | null;
  created_by_name: string | null;
  retired_by_name: string | null;
}

interface MovementRow {
  id: string;
  asset_id: string;
  type: AssetMovementType;
  from_location_id: string | null;
  to_location_id: string | null;
  from_user_id: string | null;
  to_user_id: string | null;
  from_status: string | null;
  to_status: string | null;
  from_condition: string | null;
  to_condition: string | null;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  movement_date: string;
  created_by: string;
  created_at: string;
  from_location_name: string | null;
  to_location_name: string | null;
  from_user_name: string | null;
  to_user_name: string | null;
  created_by_name: string | null;
}

const ASSET_SELECT = `
  SELECT a.id, a.code, a.tag, a.name, a.description, a.category_id,
         a.status, a.condition, a.criticality, a.location_id, a.department_id,
         a.custodian_user_id, a.cost_center_id, a.supplier_id,
         a.acquisition_date, a.acquisition_value_cents, a.invoice_number,
         a.invoice_series, a.warranty_until, a.serial_number, a.manufacturer,
         a.model, a.manufacture_year, a.notes, a.retired_at, a.retired_reason,
         a.retired_by, a.created_by, a.created_at, a.updated_at,
         c.name AS category_name,
         l.name AS location_name, l.path AS location_path,
         d.name AS department_name,
         u.name AS custodian_name,
         cc.name AS cost_center_name,
         s.name AS supplier_name,
         cb.name AS created_by_name,
         rb.name AS retired_by_name
    FROM assets a
    JOIN asset_categories c ON c.id = a.category_id
    JOIN locations l ON l.id = a.location_id
    LEFT JOIN departments d ON d.id = a.department_id
    LEFT JOIN users u ON u.id = a.custodian_user_id
    LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
    LEFT JOIN suppliers s ON s.id = a.supplier_id
    LEFT JOIN users cb ON cb.id = a.created_by
    LEFT JOIN users rb ON rb.id = a.retired_by`;

const MOVEMENT_SELECT = `
  SELECT m.id, m.asset_id, m.type, m.from_location_id, m.to_location_id,
         m.from_user_id, m.to_user_id, m.from_status, m.to_status,
         m.from_condition, m.to_condition, m.reason, m.reference_type,
         m.reference_id, m.movement_date, m.created_by, m.created_at,
         fl.name AS from_location_name, tl.name AS to_location_name,
         fu.name AS from_user_name, tu.name AS to_user_name,
         cb.name AS created_by_name
    FROM asset_movements m
    LEFT JOIN locations fl ON fl.id = m.from_location_id
    LEFT JOIN locations tl ON tl.id = m.to_location_id
    LEFT JOIN users fu ON fu.id = m.from_user_id
    LEFT JOIN users tu ON tu.id = m.to_user_id
    LEFT JOIN users cb ON cb.id = m.created_by`;

function mapAsset(row: AssetJoinedRow) {
  return {
    id: row.id,
    code: row.code,
    tag: row.tag,
    name: row.name,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name,
    status: row.status,
    statusLabel: ASSET_STATUS_LABELS[row.status] ?? row.status,
    condition: row.condition,
    criticality: row.criticality,
    locationId: row.location_id,
    locationName: row.location_name,
    locationPath: row.location_path,
    departmentId: row.department_id,
    departmentName: row.department_name,
    custodianUserId: row.custodian_user_id,
    custodianName: row.custodian_name,
    costCenterId: row.cost_center_id,
    costCenterName: row.cost_center_name,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    acquisitionDate: row.acquisition_date,
    acquisitionValueCents: row.acquisition_value_cents,
    invoiceNumber: row.invoice_number,
    invoiceSeries: row.invoice_series,
    warrantyUntil: row.warranty_until,
    serialNumber: row.serial_number,
    manufacturer: row.manufacturer,
    model: row.model,
    manufactureYear: row.manufacture_year,
    notes: row.notes,
    retiredAt: row.retired_at,
    retiredReason: row.retired_reason,
    retiredBy: row.retired_by,
    retiredByName: row.retired_by_name,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMovement(row: MovementRow) {
  return {
    id: row.id,
    assetId: row.asset_id,
    type: row.type,
    typeLabel: ASSET_MOVEMENT_TYPE_LABELS[row.type] ?? row.type,
    fromLocationId: row.from_location_id,
    fromLocationName: row.from_location_name,
    toLocationId: row.to_location_id,
    toLocationName: row.to_location_name,
    fromUserId: row.from_user_id,
    fromUserName: row.from_user_name,
    toUserId: row.to_user_id,
    toUserName: row.to_user_name,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    fromCondition: row.from_condition,
    toCondition: row.to_condition,
    reason: row.reason,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    movementDate: row.movement_date,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function assertReference(
  db: D1Database,
  table: string,
  value: string,
  label: string,
): Promise<void> {
  const row = await oneRow<{ id: string; is_active: number | null; deleted_at: string | null }>(
    db,
    `SELECT id, is_active, deleted_at FROM ${table} WHERE id = ?`,
    [value],
  );
  if (!row || row.deleted_at || (row.is_active !== null && Number(row.is_active) === 0)) {
    throw badRequest(`${label} inválido ou inativo.`);
  }
}

async function loadAsset(db: D1Database, assetId: string): Promise<AssetRow> {
  const row = await oneRow<AssetRow>(db, `SELECT * FROM assets WHERE id = ?`, [assetId]);
  if (!row) throw notFound("Ativo não encontrado.");
  return row;
}

function assertAssetVisible(user: AuthUser, asset: AssetRow): void {
  assertLocationAllowed(user, asset.location_id);
}

function assertOperational(asset: AssetRow): void {
  if (ASSET_TERMINAL_STATUSES.includes(asset.status)) {
    throw conflict("Ativo baixado ou descartado não pode ser movimentado.");
  }
}

function terminalReason(status: AssetStatus, reason: string | null | undefined): string {
  return reason?.trim() || `Ativo marcado como ${ASSET_STATUS_LABELS[status].toLowerCase()}.`;
}

/**
 * Datas sem hora (AAAA-MM-DD) são gravadas ao meio-dia UTC. Sem isso, o
 * histórico exibiria o dia anterior em fusos negativos (o Brasil é UTC-3),
 * porque `new Date("2026-10-01")` é meia-noite UTC.
 */
function normalizeMovementDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value;
}

function movementStatement(
  db: D1Database,
  input: {
    assetId: string;
    type: AssetMovementType;
    actorId: string;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    fromUserId?: string | null;
    toUserId?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    fromCondition?: string | null;
    toCondition?: string | null;
    reason?: string | null;
    movementDate?: string | null;
    referenceType?: string | null;
    referenceId?: string | null;
  },
): D1PreparedStatement {
  const ts = nowIso();
  return insertStatement(db, "asset_movements", {
    id: uuid(),
    asset_id: input.assetId,
    type: input.type,
    from_location_id: input.fromLocationId ?? null,
    to_location_id: input.toLocationId ?? null,
    from_user_id: input.fromUserId ?? null,
    to_user_id: input.toUserId ?? null,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    from_condition: input.fromCondition ?? null,
    to_condition: input.toCondition ?? null,
    reason: input.reason ?? null,
    reference_type: input.referenceType ?? null,
    reference_id: input.referenceId ?? null,
    movement_date: normalizeMovementDate(input.movementDate ?? ts),
    created_by: input.actorId,
    created_at: ts,
  });
}

function auditAsset(
  db: D1Database,
  actor: { id: string; name: string },
  action: string,
  assetId: string,
  before: unknown,
  after: unknown,
  c: Parameters<typeof clientInfo>[0],
): D1PreparedStatement {
  return auditStatement(db, {
    actor,
    module: "assets",
    action,
    entityType: "asset",
    entityId: assetId,
    before,
    after,
    ...clientInfo(c),
  });
}

async function assertManageForTerminal(
  c: Parameters<typeof currentUser>[0],
  user: AuthUser,
): Promise<void> {
  if (!user.permissions.has(PERMISSIONS.ASSETS_MANAGE)) {
    await recordPermissionDenied(c, user, PERMISSIONS.ASSETS_MANAGE);
    throw forbidden(`Permissão necessária: ${PERMISSIONS.ASSETS_MANAGE}.`);
  }
}

function queryInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* -------------------------------------------------------------------------- */
/* Opções para os seletores                                                   */
/* -------------------------------------------------------------------------- */

router.get("/options", requirePermission(PERMISSIONS.ASSETS_VIEW), async (c) => {
  const user = currentUser(c);
  const db = c.env.DB;
  const locationScope = user.locationScope;

  const categories = await allRows<{ id: string; code: string; name: string }>(
    db,
    `SELECT id, code, name FROM asset_categories
      WHERE deleted_at IS NULL AND is_active = 1
      ORDER BY sort_order, name`,
  );
  const locations = await allRows<{ id: string; name: string; path: string }>(
    db,
    `SELECT id, name, path FROM locations
      WHERE deleted_at IS NULL AND is_active = 1
        ${locationScope.length > 0 ? `AND id IN (${locationScope.map(() => "?").join(", ")})` : ""}
      ORDER BY path, name`,
    locationScope,
  );
  const departments = await allRows<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM departments WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name`,
  );
  const users = await allRows<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM users WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name`,
  );
  const costCenters = await allRows<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM cost_centers WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name`,
  );
  const suppliers = await allRows<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM suppliers WHERE deleted_at IS NULL AND is_active = 1 ORDER BY name`,
  );

  return c.json({ categories, locations, departments, users, costCenters, suppliers });
});

/* -------------------------------------------------------------------------- */
/* Resumo                                                                     */
/* -------------------------------------------------------------------------- */

router.get("/summary", requirePermission(PERMISSIONS.ASSETS_VIEW), async (c) => {
  const user = currentUser(c);
  const db = c.env.DB;
  const scope = new WhereBuilder();
  if (user.locationScope.length > 0) scope.inList("a.location_id", user.locationScope, true);
  const where = scope.sql();
  const params = scope.values();
  const active = ASSET_STATUSES.filter((status) => !ASSET_TERMINAL_STATUSES.includes(status));

  const totals = await oneRow<{
    total: number;
    active: number;
    terminal: number;
    active_value_cents: number;
    warranty_expiring: number;
  }>(
    db,
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN a.status IN (${active.map(() => "?").join(", ")}) THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN a.status IN ('retired', 'disposed') THEN 1 ELSE 0 END), 0) AS terminal,
            COALESCE(SUM(CASE WHEN a.status IN (${active.map(() => "?").join(", ")}) THEN a.acquisition_value_cents ELSE 0 END), 0) AS active_value_cents,
            COALESCE(SUM(CASE WHEN a.status IN (${active.map(() => "?").join(", ")})
                                AND a.warranty_until IS NOT NULL
                                AND a.warranty_until >= date('now')
                                AND a.warranty_until <= date('now', '+30 days')
                              THEN 1 ELSE 0 END), 0) AS warranty_expiring
       FROM assets a ${where}`,
    [...active, ...active, ...active, ...params],
  );

  const byStatus = await allRows<{ status: AssetStatus; total: number }>(
    db,
    `SELECT a.status, COUNT(*) AS total FROM assets a ${where} GROUP BY a.status`,
    params,
  );

  const categoryScope =
    user.locationScope.length > 0
      ? `AND a.location_id IN (${user.locationScope.map(() => "?").join(", ")})`
      : "";
  const byCategory = await allRows<{ id: string; name: string; total: number }>(
    db,
    `SELECT c.id, c.name, COUNT(a.id) AS total
       FROM asset_categories c
       LEFT JOIN assets a ON a.category_id = c.id ${categoryScope}
      WHERE c.deleted_at IS NULL
      GROUP BY c.id, c.name
      ORDER BY c.sort_order, c.name`,
    user.locationScope,
  );

  return c.json({
    total: Number(totals?.total ?? 0),
    active: Number(totals?.active ?? 0),
    terminal: Number(totals?.terminal ?? 0),
    activeValueCents: Number(totals?.active_value_cents ?? 0),
    warrantyExpiring: Number(totals?.warranty_expiring ?? 0),
    byStatus: byStatus.map((row) => ({ status: row.status, total: Number(row.total) })),
    byCategory: byCategory.map((row) => ({
      id: row.id,
      name: row.name,
      total: Number(row.total),
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Categorias                                                                 */
/* -------------------------------------------------------------------------- */

router.get("/categories", requirePermission(PERMISSIONS.ASSETS_VIEW), async (c) => {
  const includeInactive = c.req.query("includeInactive") === "1";
  const rows = await allRows<{
    id: string;
    code: string;
    name: string;
    description: string | null;
    sort_order: number;
    is_active: number;
    asset_count: number;
  }>(
    c.env.DB,
    `SELECT c.id, c.code, c.name, c.description, c.sort_order, c.is_active,
            (SELECT COUNT(*) FROM assets a WHERE a.category_id = c.id) AS asset_count
       FROM asset_categories c
      WHERE c.deleted_at IS NULL ${includeInactive ? "" : "AND c.is_active = 1"}
      ORDER BY c.sort_order, c.name`,
  );
  return c.json({
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      sortOrder: Number(row.sort_order),
      isActive: Number(row.is_active) === 1,
      assetCount: Number(row.asset_count),
    })),
  });
});

router.post("/categories", requirePermission(PERMISSIONS.ASSETS_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, categoryBody);
  const code = body.code.toUpperCase();
  const existing = await oneRow<{ id: string }>(
    c.env.DB,
    `SELECT id FROM asset_categories WHERE code = ?`,
    [code],
  );
  if (existing) throw conflict("Já existe uma categoria com este código.");

  const ts = nowIso();
  const categoryId = uuid();
  const data = {
    id: categoryId,
    code,
    name: body.name,
    description: body.description ?? null,
    sort_order: body.sortOrder ?? 100,
    is_active: 1,
    created_at: ts,
    updated_at: ts,
  };
  await c.env.DB.batch([
    insertStatement(c.env.DB, "asset_categories", data),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "assets",
      action: "category_create",
      entityType: "asset_category",
      entityId: categoryId,
      after: data,
      ...clientInfo(c),
    }),
  ]);
  return c.json({ id: categoryId, code }, 201);
});

router.patch("/categories/:id", requirePermission(PERMISSIONS.ASSETS_MANAGE), async (c) => {
  const user = currentUser(c);
  const categoryId = c.req.param("id");
  const body = await parseBody(c, categoryUpdateBody);
  const before = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name, description, sort_order, is_active FROM asset_categories WHERE id = ? AND deleted_at IS NULL`,
    [categoryId],
  );
  if (!before) throw notFound("Categoria não encontrada.");
  if (
    body.name === undefined &&
    body.description === undefined &&
    body.sortOrder === undefined &&
    body.isActive === undefined
  ) {
    throw badRequest("Nenhum campo para atualizar.");
  }

  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: nowIso(),
  };
  await c.env.DB.batch([
    updateStatement(c.env.DB, "asset_categories", categoryId, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "assets",
      action: "category_update",
      entityType: "asset_category",
      entityId: categoryId,
      before,
      after: updated,
      ...clientInfo(c),
    }),
  ]);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Lista e detalhe                                                            */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission(PERMISSIONS.ASSETS_VIEW), async (c) => {
  const user = currentUser(c);
  const page = normalizePage({
    page: queryInt(c.req.query("page"), 1),
    pageSize: queryInt(c.req.query("pageSize"), 25),
  });

  const where = new WhereBuilder();
  if (user.locationScope.length > 0) where.inList("a.location_id", user.locationScope, true);

  const categoryId = c.req.query("categoryId")?.trim();
  if (categoryId) where.add("a.category_id = ?", categoryId);
  const locationId = c.req.query("locationId")?.trim();
  if (locationId) where.add("a.location_id = ?", locationId);
  const departmentId = c.req.query("departmentId")?.trim();
  if (departmentId) where.add("a.department_id = ?", departmentId);
  const custodianUserId = c.req.query("custodianUserId")?.trim();
  if (custodianUserId) where.add("a.custodian_user_id = ?", custodianUserId);

  const status = c.req.query("status")?.trim();
  if (status) {
    if (!(ASSET_STATUSES as readonly string[]).includes(status)) throw badRequest("Situação inválida.");
    where.add("a.status = ?", status);
  }
  const condition = c.req.query("condition")?.trim();
  if (condition) {
    if (!(ASSET_CONDITIONS as readonly string[]).includes(condition)) throw badRequest("Condição inválida.");
    where.add("a.condition = ?", condition);
  }
  const criticality = c.req.query("criticality")?.trim();
  if (criticality) {
    if (!(ASSET_CRITICALITIES as readonly string[]).includes(criticality)) {
      throw badRequest("Criticidade inválida.");
    }
    where.add("a.criticality = ?", criticality);
  }

  const search = c.req.query("search")?.trim();
  if (search) {
    const terms = searchTokens(search);
    const nameExpr = sqlSearchExpression("a.name");
    const codeExpr = sqlSearchExpression("a.code");
    const tagExpr = sqlSearchExpression("COALESCE(a.tag, '')");
    const serialExpr = sqlSearchExpression("COALESCE(a.serial_number, '')");
    const modelExpr = sqlSearchExpression("COALESCE(a.model, '')");
    for (const term of terms) {
      const like = `%${term}%`;
      where.add(
        `(${nameExpr} LIKE ? OR ${codeExpr} LIKE ? OR ${tagExpr} LIKE ? OR ${serialExpr} LIKE ? OR ${modelExpr} LIKE ?)`,
        like,
        like,
        like,
        like,
        like,
      );
    }
  }

  const whereSql = where.sql();
  const params = where.values();
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM assets a ${whereSql}`, params);
  const rows = await allRows<AssetJoinedRow>(
    c.env.DB,
    `${ASSET_SELECT} ${whereSql}
      ORDER BY a.created_at DESC, a.code DESC
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({
    items: rows.map(mapAsset),
    total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

router.get("/:id", requirePermission(PERMISSIONS.ASSETS_VIEW), async (c) => {
  const user = currentUser(c);
  const assetId = c.req.param("id");
  const asset = await oneRow<AssetJoinedRow>(c.env.DB, `${ASSET_SELECT} WHERE a.id = ?`, [assetId]);
  if (!asset) throw notFound("Ativo não encontrado.");
  assertLocationAllowed(user, asset.location_id);

  const movements = await allRows<MovementRow>(
    c.env.DB,
    `${MOVEMENT_SELECT} WHERE m.asset_id = ? ORDER BY m.movement_date DESC, m.created_at DESC LIMIT 200`,
    [assetId],
  );

  return c.json({ asset: mapAsset(asset), movements: movements.map(mapMovement) });
});

router.get("/:id/movements", requirePermission(PERMISSIONS.ASSETS_VIEW), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  const rows = await allRows<MovementRow>(
    c.env.DB,
    `${MOVEMENT_SELECT} WHERE m.asset_id = ? ORDER BY m.movement_date DESC, m.created_at DESC LIMIT 500`,
    [asset.id],
  );
  return c.json({ items: rows.map(mapMovement) });
});

/* -------------------------------------------------------------------------- */
/* Cadastro e edição                                                          */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission(PERMISSIONS.ASSETS_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, assetBody);
  assertLocationAllowed(user, body.locationId);

  await assertReference(c.env.DB, "asset_categories", body.categoryId, "Categoria");
  await assertReference(c.env.DB, "locations", body.locationId, "Local");
  if (body.departmentId) {
    await assertReference(c.env.DB, "departments", body.departmentId, "Setor");
  }
  if (body.custodianUserId) {
    await assertReference(c.env.DB, "users", body.custodianUserId, "Responsável");
  }
  if (body.costCenterId) {
    await assertReference(c.env.DB, "cost_centers", body.costCenterId, "Centro de custo");
  }
  if (body.supplierId) {
    await assertReference(c.env.DB, "suppliers", body.supplierId, "Fornecedor");
  }

  const status = body.status ?? "in_use";
  if (ASSET_TERMINAL_STATUSES.includes(status)) {
    throw badRequest("Cadastre o ativo em uso/estoque e registre a baixa pelo histórico.");
  }
  const condition = body.condition ?? "good";
  const tag = body.tag?.trim() || null;
  if (tag) {
    const existing = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM assets WHERE tag = ?`, [tag]);
    if (existing) throw conflict("Já existe um ativo com esta etiqueta.");
  }

  const ts = nowIso();
  const assetId = uuid();
  const sequence = await nextCounter(c.env.DB, "asset");
  const code = buildCode("PAT", sequence);
  const data = {
    id: assetId,
    code,
    tag,
    name: body.name,
    description: body.description ?? null,
    category_id: body.categoryId,
    status,
    condition,
    criticality: body.criticality ?? "normal",
    location_id: body.locationId,
    department_id: body.departmentId ?? null,
    custodian_user_id: body.custodianUserId ?? null,
    cost_center_id: body.costCenterId ?? null,
    supplier_id: body.supplierId ?? null,
    acquisition_date: body.acquisitionDate ?? null,
    acquisition_value_cents: body.acquisitionValueCents ?? null,
    invoice_number: body.invoiceNumber ?? null,
    invoice_series: body.invoiceSeries ?? null,
    warranty_until: body.warrantyUntil ?? null,
    serial_number: body.serialNumber ?? null,
    manufacturer: body.manufacturer ?? null,
    model: body.model ?? null,
    manufacture_year: body.manufactureYear ?? null,
    notes: body.notes ?? null,
    retired_at: null,
    retired_reason: null,
    retired_by: null,
    created_by: user.id,
    created_at: ts,
    updated_at: ts,
  };

  try {
    await c.env.DB.batch([
      insertStatement(c.env.DB, "assets", data),
      movementStatement(c.env.DB, {
        assetId,
        type: "acquisition",
        actorId: user.id,
        toLocationId: body.locationId,
        toUserId: body.custodianUserId ?? null,
        toStatus: status,
        toCondition: condition,
        reason: "Cadastro inicial do ativo",
        movementDate: body.acquisitionDate ?? ts,
      }),
      auditAsset(c.env.DB, { id: user.id, name: user.name }, "create", assetId, null, data, c),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) throw conflict("Código ou etiqueta já cadastrados.");
    throw error;
  }

  return c.json({ id: assetId, code }, 201);
});

router.patch("/:id", requirePermission(PERMISSIONS.ASSETS_MANAGE), async (c) => {
  const user = currentUser(c);
  const assetId = c.req.param("id");
  const asset = await loadAsset(c.env.DB, assetId);
  assertAssetVisible(user, asset);

  const body = await parseBody(c, assetUpdateBody);
  const provided = Object.entries(body).filter(([, value]) => value !== undefined);
  if (provided.length === 0) throw badRequest("Nenhum campo para atualizar.");

  if (body.categoryId) {
    await assertReference(c.env.DB, "asset_categories", body.categoryId, "Categoria");
  }
  if (body.departmentId) {
    await assertReference(c.env.DB, "departments", body.departmentId, "Setor");
  }
  if (body.costCenterId) {
    await assertReference(c.env.DB, "cost_centers", body.costCenterId, "Centro de custo");
  }
  if (body.supplierId) {
    await assertReference(c.env.DB, "suppliers", body.supplierId, "Fornecedor");
  }

  let tag: string | null | undefined;
  if (body.tag !== undefined) {
    tag = body.tag?.trim() || null;
    if (tag) {
      const existing = await oneRow<{ id: string }>(
        c.env.DB,
        `SELECT id FROM assets WHERE tag = ? AND id <> ?`,
        [tag, assetId],
      );
      if (existing) throw conflict("Já existe outro ativo com esta etiqueta.");
    }
  }

  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.categoryId !== undefined ? { category_id: body.categoryId } : {}),
    ...(tag !== undefined ? { tag } : {}),
    ...(body.criticality !== undefined ? { criticality: body.criticality } : {}),
    ...(body.departmentId !== undefined ? { department_id: body.departmentId ?? null } : {}),
    ...(body.costCenterId !== undefined ? { cost_center_id: body.costCenterId ?? null } : {}),
    ...(body.supplierId !== undefined ? { supplier_id: body.supplierId ?? null } : {}),
    ...(body.acquisitionDate !== undefined ? { acquisition_date: body.acquisitionDate ?? null } : {}),
    ...(body.acquisitionValueCents !== undefined
      ? { acquisition_value_cents: body.acquisitionValueCents ?? null }
      : {}),
    ...(body.invoiceNumber !== undefined ? { invoice_number: body.invoiceNumber ?? null } : {}),
    ...(body.invoiceSeries !== undefined ? { invoice_series: body.invoiceSeries ?? null } : {}),
    ...(body.warrantyUntil !== undefined ? { warranty_until: body.warrantyUntil ?? null } : {}),
    ...(body.serialNumber !== undefined ? { serial_number: body.serialNumber ?? null } : {}),
    ...(body.manufacturer !== undefined ? { manufacturer: body.manufacturer ?? null } : {}),
    ...(body.model !== undefined ? { model: body.model ?? null } : {}),
    ...(body.manufactureYear !== undefined ? { manufacture_year: body.manufactureYear ?? null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    updated_at: nowIso(),
  };

  try {
    await c.env.DB.batch([
      updateStatement(c.env.DB, "assets", assetId, updated),
      auditAsset(c.env.DB, { id: user.id, name: user.name }, "update", assetId, asset, updated, c),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("UNIQUE")) throw conflict("Já existe outro ativo com esta etiqueta.");
    throw error;
  }

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Movimentações                                                              */
/* -------------------------------------------------------------------------- */

router.post("/:id/transfer", requirePermission(PERMISSIONS.ASSETS_MOVE), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  assertOperational(asset);

  const body = await parseBody(c, transferBody);
  assertLocationAllowed(user, body.toLocationId);
  await assertReference(c.env.DB, "locations", body.toLocationId, "Local de destino");
  if (body.toLocationId === asset.location_id) {
    throw badRequest("O ativo já está neste local.");
  }

  const ts = nowIso();
  await c.env.DB.batch([
    updateStatement(c.env.DB, "assets", asset.id, {
      location_id: body.toLocationId,
      updated_at: ts,
    }),
    movementStatement(c.env.DB, {
      assetId: asset.id,
      type: "transfer",
      actorId: user.id,
      fromLocationId: asset.location_id,
      toLocationId: body.toLocationId,
      reason: body.reason ?? null,
      movementDate: body.movementDate ?? ts,
    }),
    auditAsset(c.env.DB, { id: user.id, name: user.name }, "transfer", asset.id, {
      locationId: asset.location_id,
    }, { locationId: body.toLocationId, reason: body.reason ?? null }, c),
  ]);

  return c.json({ ok: true });
});

router.post("/:id/assignment", requirePermission(PERMISSIONS.ASSETS_MOVE), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  assertOperational(asset);

  const body = await parseBody(c, assignmentBody);
  const nextCustodian = body.custodianUserId ?? null;
  if (nextCustodian === asset.custodian_user_id) {
    throw badRequest("O responsável informado já está vinculado ao ativo.");
  }
  if (nextCustodian) {
    await assertReference(c.env.DB, "users", nextCustodian, "Responsável");
  }

  const ts = nowIso();
  await c.env.DB.batch([
    updateStatement(c.env.DB, "assets", asset.id, {
      custodian_user_id: nextCustodian,
      updated_at: ts,
    }),
    movementStatement(c.env.DB, {
      assetId: asset.id,
      type: "assignment",
      actorId: user.id,
      fromUserId: asset.custodian_user_id,
      toUserId: nextCustodian,
      reason: body.reason ?? null,
      movementDate: body.movementDate ?? ts,
    }),
    auditAsset(c.env.DB, { id: user.id, name: user.name }, "assignment", asset.id, {
      custodianUserId: asset.custodian_user_id,
    }, { custodianUserId: nextCustodian, reason: body.reason ?? null }, c),
  ]);

  return c.json({ ok: true });
});

router.post("/:id/status", requirePermission(PERMISSIONS.ASSETS_MOVE), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  assertOperational(asset);

  const body = await parseBody(c, statusBody);
  if (body.status === asset.status) throw badRequest("O ativo já está nesta situação.");

  const isTerminal = ASSET_TERMINAL_STATUSES.includes(body.status);
  if (isTerminal) await assertManageForTerminal(c, user);

  const ts = nowIso();
  const reason = isTerminal ? terminalReason(body.status, body.reason) : (body.reason ?? null);
  const updated = {
    status: body.status,
    ...(isTerminal
      ? { retired_at: ts, retired_reason: reason, retired_by: user.id }
      : {}),
    updated_at: ts,
  };

  await c.env.DB.batch([
    updateStatement(c.env.DB, "assets", asset.id, updated),
    movementStatement(c.env.DB, {
      assetId: asset.id,
      type: isTerminal ? "disposal" : "status_change",
      actorId: user.id,
      fromStatus: asset.status,
      toStatus: body.status,
      reason,
      movementDate: body.movementDate ?? ts,
    }),
    auditAsset(
      c.env.DB,
      { id: user.id, name: user.name },
      isTerminal ? "dispose" : "status_change",
      asset.id,
      { status: asset.status },
      { status: body.status, reason },
      c,
    ),
  ]);

  return c.json({ ok: true });
});

router.post("/:id/condition", requirePermission(PERMISSIONS.ASSETS_MOVE), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  assertOperational(asset);

  const body = await parseBody(c, conditionBody);
  if (body.condition === asset.condition) throw badRequest("O ativo já está nesta condição.");

  const ts = nowIso();
  await c.env.DB.batch([
    updateStatement(c.env.DB, "assets", asset.id, {
      condition: body.condition,
      updated_at: ts,
    }),
    movementStatement(c.env.DB, {
      assetId: asset.id,
      type: "condition_change",
      actorId: user.id,
      fromCondition: asset.condition,
      toCondition: body.condition,
      reason: body.reason ?? null,
      movementDate: body.movementDate ?? ts,
    }),
    auditAsset(c.env.DB, { id: user.id, name: user.name }, "condition_change", asset.id, {
      condition: asset.condition,
    }, { condition: body.condition, reason: body.reason ?? null }, c),
  ]);

  return c.json({ ok: true });
});

router.post("/:id/maintenance", requirePermission(PERMISSIONS.ASSETS_MOVE), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  assertOperational(asset);

  const body = await parseBody(c, maintenanceBody);
  const nextStatus = body.status ?? null;
  if (nextStatus && ASSET_TERMINAL_STATUSES.includes(nextStatus)) {
    throw badRequest("Use a mudança de situação para baixar ou descartar o ativo.");
  }

  const ts = nowIso();
  const statements: D1PreparedStatement[] = [
    movementStatement(c.env.DB, {
      assetId: asset.id,
      type: "maintenance",
      actorId: user.id,
      fromStatus: asset.status,
      toStatus: nextStatus ?? asset.status,
      reason: body.reason,
      movementDate: body.movementDate ?? ts,
    }),
  ];
  if (nextStatus && nextStatus !== asset.status) {
    statements.unshift(
      updateStatement(c.env.DB, "assets", asset.id, {
        status: nextStatus,
        updated_at: ts,
      }),
    );
  }
  statements.push(
    auditAsset(c.env.DB, { id: user.id, name: user.name }, "maintenance", asset.id, {
      status: asset.status,
    }, { status: nextStatus ?? asset.status, reason: body.reason }, c),
  );

  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

router.post("/:id/inventory", requirePermission(PERMISSIONS.ASSETS_MOVE), async (c) => {
  const user = currentUser(c);
  const asset = await loadAsset(c.env.DB, c.req.param("id"));
  assertAssetVisible(user, asset);
  assertOperational(asset);

  const body = await parseBody(c, inventoryBody);
  const foundLocation = body.locationId ?? asset.location_id;
  assertLocationAllowed(user, foundLocation);
  await assertReference(c.env.DB, "locations", foundLocation, "Local encontrado");
  const foundCondition = body.condition ?? asset.condition;

  const ts = nowIso();
  await c.env.DB.batch([
    updateStatement(c.env.DB, "assets", asset.id, {
      location_id: foundLocation,
      condition: foundCondition,
      updated_at: ts,
    }),
    movementStatement(c.env.DB, {
      assetId: asset.id,
      type: "inventory",
      actorId: user.id,
      fromLocationId: asset.location_id,
      toLocationId: foundLocation,
      fromCondition: asset.condition,
      toCondition: foundCondition,
      reason: body.reason ?? "Conferência de inventário",
      movementDate: body.movementDate ?? ts,
    }),
    auditAsset(c.env.DB, { id: user.id, name: user.name }, "inventory", asset.id, {
      locationId: asset.location_id,
      condition: asset.condition,
    }, {
      locationId: foundLocation,
      condition: foundCondition,
      reason: body.reason ?? null,
    }, c),
  ]);

  return c.json({ ok: true });
});

export default router;
