import { PERMISSIONS, type PermissionCode } from "@shared/permissions";
import type { AuthUser } from "./types";
import { allRows } from "./db";
import { badRequest, forbidden } from "./errors";
import { assertSufficientStock, recordMovements, type MovementRequest, type MovementResult } from "./stock";

/**
 * Consumo de material em tickets e ordens de serviço.
 *
 * O próprio registro em `movements` (type = 'maintenance_use', ref_type/ref_id)
 * e a fonte de verdade do material utilizado: não existe tabela paralela que
 * possa divergir do histórico de estoque.
 */

export interface MaterialUseItem {
  productId: string;
  qty: number;
  notes?: string | null;
}

export interface MaterialUseInput {
  refType: "ticket" | "work_order";
  refId: string;
  /** Local de estoque de onde o material foi retirado. */
  fromLocationId: string;
  requestKey: string;
  items: MaterialUseItem[];
}

export const MATERIAL_USE_PERMISSION: PermissionCode = PERMISSIONS.WORKORDERS_MATERIAL;

export async function recordMaterialUse(
  db: D1Database,
  user: AuthUser,
  input: MaterialUseInput,
  extraStatements?: (results: MovementResult[]) => D1PreparedStatement[],
): Promise<MovementResult[]> {
  if (!user.permissions.has(MATERIAL_USE_PERMISSION)) {
    throw forbidden(`Permissão necessária: ${MATERIAL_USE_PERMISSION}.`);
  }
  if (input.items.length === 0) throw badRequest("Informe ao menos um material utilizado.");
  if (input.items.length > 100) throw badRequest("Limite de 100 itens por lançamento.");

  const duplicated = findDuplicates(input.items.map((i) => i.productId));
  if (duplicated.length > 0) {
    throw badRequest("O mesmo produto aparece mais de uma vez. Some as quantidades em uma única linha.", {
      duplicatedProductIds: duplicated,
    });
  }

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await allRows<{ id: string; is_active: number; name: string }>(
    db,
    `SELECT id, is_active, name FROM products WHERE id IN (${productIds.map(() => "?").join(",")})`,
    productIds,
  );
  if (products.length !== productIds.length) throw badRequest("Um dos produtos informados não existe.");
  const inactive = products.filter((p) => p.is_active !== 1);
  if (inactive.length > 0) {
    throw badRequest(`Produto inativo não pode ser utilizado: ${inactive.map((p) => p.name).join(", ")}.`);
  }

  const requests: MovementRequest[] = input.items.map((item, index) => ({
    type: "maintenance_use",
    productId: item.productId,
    qtyMilli: Math.round(item.qty * 1000),
    fromLocationId: input.fromLocationId,
    toLocationId: null,
    reason: input.refType === "work_order" ? "Material utilizado em ordem de serviço" : "Material utilizado em atendimento",
    counterparty: null,
    refType: input.refType,
    refId: input.refId,
    notes: item.notes ?? null,
    requestKey: `${input.requestKey}#${index}`,
    userId: user.id,
    productName: products.find((p) => p.id === item.productId)?.name,
  }));

  await assertSufficientStock(db, requests);

  return recordMovements(db, { id: user.id, name: user.name }, requests, {
    extraStatements: extraStatements
      ? (results) => extraStatements(results)
      : undefined,
  });
}

export interface MaterialUseRow {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  uomCode: string;
  qtyMilli: number;
  locationId: string | null;
  locationName: string | null;
  userId: string;
  userName: string;
  occurredAt: string;
  notes: string | null;
  reversesMovementId: string | null;
}

/** Materiais utilizados em um ticket ou ordem de serviço, em ordem cronológica. */
export async function listMaterialUse(
  db: D1Database,
  refType: "ticket" | "work_order",
  refId: string,
): Promise<MaterialUseRow[]> {
  const rows = await allRows<Record<string, unknown>>(
    db,
    `SELECT m.id, m.product_id, m.qty_milli, m.from_location_id, m.user_id, m.occurred_at,
            m.notes, m.reverses_movement_id,
            p.name AS product_name, p.sku, u.code AS uom_code,
            l.name AS location_name, us.name AS user_name
       FROM movements m
       JOIN products p ON p.id = m.product_id
       JOIN uoms u ON u.id = p.uom_id
       LEFT JOIN locations l ON l.id = m.from_location_id
       JOIN users us ON us.id = m.user_id
      WHERE m.ref_type = ? AND m.ref_id = ? AND m.type = 'maintenance_use'
      ORDER BY m.occurred_at, m.id`,
    [refType, refId],
  );

  return rows.map((r) => ({
    id: String(r.id),
    productId: String(r.product_id),
    productName: String(r.product_name),
    sku: r.sku ? String(r.sku) : null,
    uomCode: String(r.uom_code),
    qtyMilli: Number(r.qty_milli),
    locationId: r.from_location_id ? String(r.from_location_id) : null,
    locationName: r.location_name ? String(r.location_name) : null,
    userId: String(r.user_id),
    userName: String(r.user_name),
    occurredAt: String(r.occurred_at),
    notes: r.notes ? String(r.notes) : null,
    reversesMovementId: r.reverses_movement_id ? String(r.reverses_movement_id) : null,
  }));
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}
