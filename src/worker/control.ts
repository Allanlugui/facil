/**
 * Exclusao controlada de cadastros.
 *
 * Regra de ouro: nada que tenha historico e apagado fisicamente. A linha vira
 * um "tombstone" (`deleted_at` preenchido, `is_active = 0`), sai das listas e
 * dos seletores, mas continua resolvendo o nome nos registros antigos -- que
 * passam a exibir "(excluido)". Quando nao existe nenhuma referencia, a linha e
 * removida de verdade.
 *
 * Toda operacao devolve o impacto calculado no servidor (nunca confia no que a
 * tela mandou), grava auditoria e notifica os administradores.
 */
import { PERMISSIONS } from "@shared/permissions";
import { auditStatement } from "./audit";
import { allRows, countRows, oneRow } from "./db";
import { conflict, forbidden, notFound } from "./errors";
import { notificationStatements } from "./notify";
import { nowIso } from "./util";

export interface ReferenceRule {
  key: string;
  /** Rotulo plural exibido na confirmacao, ex.: "movimentacoes de estoque". */
  label: string;
  /** SELECT COUNT(*) ... WHERE <coluna> = ? (um unico parametro: o id). */
  sql: string;
  /** Quando verdadeiro, a existencia de referencias impede a exclusao. */
  blocking?: boolean;
  hint?: string;
}

export interface ControlEntity {
  key: string;
  table: string;
  label: string;
  plural: string;
  permission: string;
  nameColumn: string;
  codeColumn: string | null;
  updatedAtColumn: string | null;
  /** Cadastros que nunca sao removidos fisicamente (usuario, por exemplo). */
  alwaysArchive?: boolean;
  references: ReferenceRule[];
}

const R = (key: string, label: string, table: string, column: string, extra?: Partial<ReferenceRule>): ReferenceRule => ({
  key,
  label,
  sql: `SELECT COUNT(*) FROM ${table} WHERE ${column} = ?`,
  ...extra,
});

export const CONTROL_ENTITIES: ControlEntity[] = [
  {
    key: "location",
    table: "locations",
    label: "Local",
    plural: "Locais",
    permission: PERMISSIONS.STRUCTURE_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      {
        key: "children",
        label: "sublocais",
        sql: "SELECT COUNT(*) FROM locations WHERE parent_id = ? AND deleted_at IS NULL",
        blocking: true,
        hint: "Exclua ou mova os sublocais antes.",
      },
      {
        key: "stock",
        label: "saldos de estoque",
        sql: "SELECT COUNT(*) FROM stock WHERE location_id = ? AND qty_milli <> 0",
        blocking: true,
        hint: "Transfira ou ajuste o saldo antes de excluir.",
      },
      R("movements", "movimentacoes de estoque", "movements", "from_location_id"),
      R("movementsIn", "movimentacoes de entrada", "movements", "to_location_id"),
      R("consumption", "registros de consumo", "consumption_records", "location_id"),
      R("tickets", "chamados", "tickets", "location_id"),
      R("workOrders", "ordens de servico", "work_orders", "location_id"),
      R("purchases", "solicitacoes de compra", "purchase_requests", "location_id"),
      R("inventories", "inventarios", "inventories", "location_id"),
      R("scopes", "restricoes de acesso", "user_location_scopes", "location_id"),
    ],
  },
  {
    key: "unit",
    table: "units",
    label: "Unidade",
    plural: "Unidades",
    permission: PERMISSIONS.STRUCTURE_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      {
        key: "locations",
        label: "locais ativos",
        sql: "SELECT COUNT(*) FROM locations WHERE unit_id = ? AND deleted_at IS NULL",
        blocking: true,
        hint: "Exclua ou mova os locais antes.",
      },
      R("users", "usuarios vinculados", "users", "unit_id"),
    ],
  },
  {
    key: "location_type",
    table: "location_types",
    label: "Tipo de local",
    plural: "Tipos de local",
    permission: PERMISSIONS.STRUCTURE_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      {
        key: "locations",
        label: "locais usando este tipo",
        sql: "SELECT COUNT(*) FROM locations WHERE type_id = ? AND deleted_at IS NULL",
        blocking: true,
        hint: "Troque o tipo dos locais antes de excluir.",
      },
    ],
  },
  {
    key: "department",
    table: "departments",
    label: "Setor",
    plural: "Setores",
    permission: PERMISSIONS.USERS_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      R("users", "usuarios no setor", "users", "department_id"),
      R("purchases", "solicitacoes de compra", "purchase_requests", "department_id"),
      R("managers", "gestores designados", "department_managers", "department_id"),
    ],
  },
  {
    key: "product_category",
    table: "product_categories",
    label: "Categoria de produto",
    plural: "Categorias de produto",
    permission: PERMISSIONS.CATALOG_MANAGE,
    nameColumn: "name",
    codeColumn: null,
    updatedAtColumn: "updated_at",
    references: [
      {
        key: "children",
        label: "subcategorias ativas",
        sql: "SELECT COUNT(*) FROM product_categories WHERE parent_id = ? AND deleted_at IS NULL",
        blocking: true,
        hint: "Exclua ou mova as subcategorias antes.",
      },
      R("products", "produtos", "products", "category_id"),
    ],
  },
  {
    key: "uom",
    table: "uoms",
    label: "Unidade de medida",
    plural: "Unidades de medida",
    permission: PERMISSIONS.CATALOG_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: null,
    references: [
      R("products", "produtos", "products", "uom_id"),
      R("productsPack", "produtos (embalagem)", "products", "pack_uom_id"),
      R("purchaseItems", "itens de compra", "purchase_request_items", "uom_id"),
    ],
  },
  {
    key: "supplier",
    table: "suppliers",
    label: "Fornecedor",
    plural: "Fornecedores",
    permission: PERMISSIONS.CATALOG_MANAGE,
    nameColumn: "name",
    codeColumn: null,
    updatedAtColumn: "updated_at",
    references: [
      R("products", "produtos", "products", "default_supplier_id"),
      R("quotes", "cotacoes", "purchase_quotes", "supplier_id"),
      R("orders", "pedidos", "purchase_orders", "supplier_id"),
      R("purchaseItems", "itens de compra", "purchase_request_items", "supplier_id"),
    ],
  },
  {
    key: "product",
    table: "products",
    label: "Produto",
    plural: "Produtos",
    permission: PERMISSIONS.CATALOG_MANAGE,
    nameColumn: "name",
    codeColumn: "sku",
    updatedAtColumn: "updated_at",
    references: [
      {
        key: "stock",
        label: "saldos de estoque",
        sql: "SELECT COUNT(*) FROM stock WHERE product_id = ? AND qty_milli <> 0",
        blocking: true,
        hint: "Zere o saldo (ajuste/transferencia) antes de excluir.",
      },
      R("movements", "movimentacoes", "movements", "product_id"),
      R("consumption", "itens de consumo", "consumption_items", "product_id"),
      R("inventory", "itens de inventario", "inventory_items", "product_id"),
      R("purchaseItems", "itens de compra", "purchase_request_items", "product_id"),
      R("quoteItems", "itens de cotacao", "purchase_quote_items", "product_id"),
    ],
  },
  {
    key: "cost_center",
    table: "cost_centers",
    label: "Centro de custo",
    plural: "Centros de custo",
    permission: PERMISSIONS.SETTINGS_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      R("purchases", "solicitacoes de compra", "purchase_requests", "cost_center_id"),
      R("orders", "pedidos", "purchase_orders", "cost_center_id"),
    ],
  },
  {
    key: "payment_method",
    table: "payment_methods",
    label: "Forma de pagamento",
    plural: "Formas de pagamento",
    permission: PERMISSIONS.SETTINGS_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      R("purchases", "solicitacoes de compra", "purchase_requests", "payment_method_id"),
      R("orders", "pedidos", "purchase_orders", "payment_method_id"),
      R("quotes", "cotacoes", "purchase_quotes", "payment_method_id"),
    ],
  },
  {
    key: "ticket_category",
    table: "ticket_categories",
    label: "Categoria de chamado",
    plural: "Categorias de chamado",
    permission: PERMISSIONS.SETTINGS_MANAGE,
    nameColumn: "name",
    codeColumn: "code",
    updatedAtColumn: "updated_at",
    references: [
      R("tickets", "chamados", "tickets", "category_id"),
      R("workOrders", "ordens de servico", "work_orders", "category_id"),
    ],
  },
  {
    key: "user",
    table: "users",
    label: "Usuário",
    plural: "Usuários",
    permission: PERMISSIONS.USERS_MANAGE,
    nameColumn: "name",
    codeColumn: "email",
    updatedAtColumn: "updated_at",
    alwaysArchive: true,
    references: [],
  },
];

export function findEntity(key: string): ControlEntity {
  const entity = CONTROL_ENTITIES.find((item) => item.key === key);
  if (!entity) throw notFound("Cadastro não gerenciado por esta central.");
  return entity;
}

export interface ImpactItem {
  key: string;
  label: string;
  count: number;
  blocking: boolean;
  hint: string | null;
}

export interface ImpactResult {
  entity: string;
  entityLabel: string;
  id: string;
  label: string;
  code: string | null;
  isActive: boolean;
  deletedAt: string | null;
  mode: "blocked" | "archive" | "delete";
  references: ImpactItem[];
  totalReferences: number;
  message: string;
}

export async function analyzeImpact(db: D1Database, entity: ControlEntity, id: string): Promise<ImpactResult> {
  const row = await oneRow<Record<string, unknown>>(
    db,
    `SELECT id, ${entity.nameColumn} AS name, ${entity.codeColumn ?? "NULL"} AS code, is_active, deleted_at
       FROM ${entity.table} WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound(`${entity.label} não encontrado.`);

  const references: ImpactItem[] = [];
  for (const rule of entity.references) {
    const count = await countRows(db, rule.sql, [id]);
    if (count > 0) {
      references.push({
        key: rule.key,
        label: rule.label,
        count,
        blocking: Boolean(rule.blocking),
        hint: rule.hint ?? null,
      });
    }
  }

  const blockers = references.filter((item) => item.blocking);
  const totalReferences = references.reduce((total, item) => total + item.count, 0);
  const mode: ImpactResult["mode"] =
    blockers.length > 0 ? "blocked" : totalReferences > 0 || entity.alwaysArchive ? "archive" : "delete";

  return {
    entity: entity.key,
    entityLabel: entity.label,
    id,
    label: String(row.name),
    code: row.code ? String(row.code) : null,
    isActive: Number(row.is_active) === 1,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    mode,
    references,
    totalReferences,
    message:
      mode === "blocked"
        ? `Exclusão bloqueada: ${blockers.map((item) => `${item.count} ${item.label}`).join(", ")}.`
        : mode === "archive"
          ? "Este registro tem histórico. Ele será arquivado, sai das listas e o histórico continua exibindo o nome original com a marca (excluído)."
          : "Este registro não tem histórico vinculado e será removido definitivamente.",
  };
}

export interface DeleteContext {
  actor: { id: string; name: string };
  ip?: string | null;
  userAgent?: string | null;
  /** Motivo informado pelo administrador (opcional). */
  reason?: string | null;
}

export interface DeleteResult {
  mode: "archive" | "delete";
  impact: ImpactResult;
}

/** Administradores ativos que devem receber o aviso (exceto quem executou). */
async function adminRecipients(db: D1Database, actorId: string): Promise<string[]> {
  const rows = await allRows<{ id: string }>(
    db,
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'admin' AND u.is_active = 1 AND u.deleted_at IS NULL AND u.id <> ?`,
    [actorId],
  );
  return rows.map((row) => row.id);
}

async function assertUserGuards(db: D1Database, id: string, actorId: string): Promise<void> {
  if (id === actorId) throw conflict("Você não pode excluir a própria conta.");
  const target = await oneRow<{ role_code: string; is_active: number; deleted_at: string | null }>(
    db,
    `SELECT r.code AS role_code, u.is_active, u.deleted_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [id],
  );
  if (!target) throw notFound("Usuário não encontrado.");
  if (target.role_code !== "admin" || target.is_active !== 1 || target.deleted_at) return;

  const remaining = await countRows(
    db,
    `SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'admin' AND u.is_active = 1 AND u.deleted_at IS NULL AND u.id <> ?`,
    [id],
  );
  if (remaining === 0) throw conflict("Este é o último administrador ativo. Crie outro administrador antes de excluir.");
}

export async function deleteControlled(
  db: D1Database,
  entity: ControlEntity,
  id: string,
  context: DeleteContext,
): Promise<DeleteResult> {
  const impact = await analyzeImpact(db, entity, id);
  if (impact.deletedAt) throw conflict(`${entity.label} já foi excluído.`);
  if (impact.mode === "blocked") throw conflict(impact.message);
  if (entity.key === "user") await assertUserGuards(db, id, context.actor.id);

  const ts = nowIso();
  const statements: D1PreparedStatement[] = [];
  const archived = impact.mode === "archive";

  if (archived) {
    const patch: Record<string, unknown> = {
      deleted_at: ts,
      deleted_by: context.actor.id,
      is_active: 0,
      ...(entity.updatedAtColumn ? { [entity.updatedAtColumn]: ts } : {}),
    };
    const columns = Object.keys(patch);
    statements.push(
      db
        .prepare(`UPDATE ${entity.table} SET ${columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .bind(...columns.map((column) => patch[column] as string | number | null), id),
    );
  } else {
    statements.push(db.prepare(`DELETE FROM ${entity.table} WHERE id = ?`).bind(id));
  }

  statements.push(
    auditStatement(db, {
      actor: context.actor,
      module: "control",
      action: archived ? `${entity.key}.archive` : `${entity.key}.delete`,
      entityType: entity.key,
      entityId: id,
      before: { label: impact.label, code: impact.code, references: impact.references },
      after: archived ? { deletedAt: ts, archived: true } : { deleted: true },
      reason: context.reason?.trim() || impact.message,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    }),
  );

  const recipients = await adminRecipients(db, context.actor.id);
  if (recipients.length > 0) {
    const detail =
      impact.references.length > 0
        ? `Impacto preservado no histórico: ${impact.references.map((item) => `${item.count} ${item.label}`).join(", ")}.`
        : "Nenhum registro histórico foi afetado.";
    statements.push(
      ...notificationStatements(db, recipients, {
        type: archived ? "control.archive" : "control.delete",
        title: `${entity.label} ${archived ? "arquivado" : "excluído"}: ${impact.label}`,
        body: `${context.actor.name} ${archived ? "arquivou" : "excluiu"} ${impact.label}${
          impact.code ? ` (${impact.code})` : ""
        }. ${detail}`,
        link: "/controle",
        entityType: entity.key,
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await db.batch(statements);
  return { mode: archived ? "archive" : "delete", impact };
}

/** Lista os registros de um cadastro para a central de controle. */
export async function listControlled(
  db: D1Database,
  entity: ControlEntity,
  options: { search?: string; includeDeleted?: boolean; limit?: number },
): Promise<Array<{ id: string; label: string; code: string | null; isActive: boolean; deletedAt: string | null }>> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (!options.includeDeleted) clauses.push("deleted_at IS NULL");
  if (options.search) {
    clauses.push(`(${entity.nameColumn} LIKE ? OR ${entity.codeColumn ?? entity.nameColumn} LIKE ?)`);
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(Math.min(500, Math.max(1, options.limit ?? 200)));

  const rows = await allRows<Record<string, unknown>>(
    db,
    `SELECT id, ${entity.nameColumn} AS name, ${entity.codeColumn ?? "NULL"} AS code, is_active, deleted_at
       FROM ${entity.table} ${where}
      ORDER BY ${entity.nameColumn} LIMIT ?`,
    params,
  );
  return rows.map((row) => ({
    id: String(row.id),
    label: String(row.name),
    code: row.code ? String(row.code) : null,
    isActive: Number(row.is_active) === 1,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  }));
}

export function assertControlPermission(entity: ControlEntity, permissions: Set<string>): void {
  if (!permissions.has(entity.permission)) {
    throw forbidden(`Permissão necessária: ${entity.permission}.`);
  }
}
