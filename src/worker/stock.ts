import type { MovementType } from "@shared/types";
import type { AuditActor } from "./audit";
import { oneRow } from "./db";
import { ApiError, conflict, badRequest } from "./errors";
import { nowIso, uuid } from "./util";

/**
 * Motor de movimentação de estoque.
 *
 * Regras estruturais garantidas aqui:
 *  1. `movements` e a FONTE DE VERDADE. A tabela `stock` e o saldo
 *     materializado, atualizado sempre na mesma transação (`db.batch`).
 *  2. Toda movimentação carrega uma `requestKey` única. Reenvio da mesma
 *     requisição (duplo clique, retry de rede) e detectado pela UNIQUE e
 *     devolvido como replay, sem reaplicar saldo.
 *  3. Estoque negativo e impossível por padrão: os triggers
 *     `trg_stock_no_negative_*` abortam o lote inteiro. A checagem prévia
 *     existe apenas para produzir mensagem amigável.
 *  4. A exceção explicita e a configuração `stock.allow_negative = true`,
 *     lida pelos próprios triggers e respeitada aqui para que a verificação
 *     prévia não contradiga o banco.
 */

/** true quando a configuração permite saldo negativo (não recomendado). */
export async function stockNegativeAllowed(db: D1Database): Promise<boolean> {
  const row = await oneRow<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE key = 'stock.allow_negative'`,
  );
  return row?.value === "true";
}

export type RefType =
  | "ticket"
  | "work_order"
  | "purchase_request"
  | "purchase_receipt"
  | "inventory"
  | "consumption"
  | "manual";

export interface MovementInput {
  type: MovementType;
  productId: string;
  /** Quantidade sempre positiva; o sinal e derivado do tipo e dos locais. */
  qtyMilli: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reason?: string | null;
  /** Destino, setor ou responsável informado quando o material sai do controle. */
  counterparty?: string | null;
  refType?: RefType | null;
  refId?: string | null;
  notes?: string | null;
  requestKey: string;
  unitCostCents?: number | null;
  reversesMovementId?: string | null;
  occurredAt?: string;
  /** Nome do produto apenas para compor mensagens de erro. */
  productName?: string;
}

export interface MovementResult {
  id: string;
  requestKey: string;
  type: MovementType;
  productId: string;
  qtyMilli: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  occurredAt: string;
  /** true quando a movimentação já existia e não foi reaplicada. */
  idempotentReplay: boolean;
}

/** Tipos que exigem justificativa registrada. */
const TYPES_REQUIRING_REASON: readonly MovementType[] = ["loss", "inventory_adjust", "correction"];

export function validateMovementInput(input: MovementInput): void {
  if (!Number.isInteger(input.qtyMilli) || input.qtyMilli <= 0) {
    throw badRequest("A quantidade deve ser um número positivo.");
  }
  if (!input.fromLocationId && !input.toLocationId) {
    throw badRequest("Informe o local de origem ou o local de destino.");
  }
  if (input.fromLocationId && input.toLocationId && input.fromLocationId === input.toLocationId) {
    throw badRequest("Origem e destino não podem ser o mesmo local.");
  }
  if (!input.requestKey || input.requestKey.length < 8) {
    throw badRequest("Identificador de requisição ausente ou inválido.");
  }
  if (TYPES_REQUIRING_REASON.includes(input.type)) {
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) {
      throw badRequest("Este tipo de movimentação exige uma justificativa.");
    }
  }
}

/** Estende MovementInput com o autor (obrigatório no INSERT). */
export interface MovementRequest extends MovementInput {
  userId: string;
}

function movementInsertStatement(
  db: D1Database,
  id: string,
  input: MovementRequest,
  occurredAt: string,
) {
  return db
    .prepare(
      `INSERT INTO movements
         (id, request_key, type, product_id, qty_milli, from_location_id, to_location_id,
          reason, counterparty, ref_type, ref_id, reverses_movement_id, user_id, occurred_at, created_at,
          notes, unit_cost_cents)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      input.requestKey,
      input.type,
      input.productId,
      input.qtyMilli,
      input.fromLocationId ?? null,
      input.toLocationId ?? null,
      input.reason ?? null,
      input.counterparty ?? null,
      input.refType ?? "manual",
      input.refId ?? null,
      input.reversesMovementId ?? null,
      input.userId,
      occurredAt,
      occurredAt,
      input.notes ?? null,
      input.unitCostCents ?? null,
    );
}

/**
 * Upsert de saldo. `deltaMilli` negativo debita; positivo credita.
 * Os triggers do banco impedem que o resultado fique negativo.
 */
function stockDeltaStatement(
  db: D1Database,
  productId: string,
  locationId: string,
  deltaMilli: number,
  ts: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO stock (product_id, location_id, qty_milli, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id, location_id) DO UPDATE SET
         qty_milli  = stock.qty_milli + excluded.qty_milli,
         updated_at = excluded.updated_at`,
    )
    .bind(productId, locationId, deltaMilli, ts);
}

export interface RecordMovementsOptions {
  /**
   * Statements adicionais (entidade, itens, auditoria) na MESMA transação.
   * Pode ser uma função que recebe os movimentos já resolvidos, para vincular
   * registros ao id gerado de cada movimentação.
   */
  extraStatements?:
    | D1PreparedStatement[]
    | ((results: MovementResult[]) => D1PreparedStatement[]);
  /**
   * Statements executados ANTES das movimentações no mesmo lote. Usado quando
   * a movimentação depende de uma linha criada na hora (ex.: produto cadastrado
   * rapidamente no recebimento) e a chave estrangeira precisa existir primeiro.
   */
  preStatements?: D1PreparedStatement[];
}

/**
 * Aplica um conjunto de movimentações de forma atômica.
 *
 * Todas as movimentações do lote são aplicadas ou nenhuma e. Isso é usado, por
 * exemplo, para registrar o consumo de vários materiais em uma única ordem de
 * serviço: não pode ocorrer de metade dos itens ser baixada.
 */
export async function recordMovements(
  db: D1Database,
  actor: AuditActor,
  requests: MovementRequest[],
  options: RecordMovementsOptions = {},
): Promise<MovementResult[]> {
  if (requests.length === 0) return [];

  const statements: D1PreparedStatement[] = [];
  const results: MovementResult[] = [];

  if (options.preStatements?.length) statements.push(...options.preStatements);

  for (const input of requests) {
    validateMovementInput(input);
    const id = uuid();
    const occurredAt = input.occurredAt ?? nowIso();
    statements.push(movementInsertStatement(db, id, input, occurredAt));
    if (input.fromLocationId) {
      statements.push(stockDeltaStatement(db, input.productId, input.fromLocationId, -input.qtyMilli, occurredAt));
    }
    if (input.toLocationId) {
      statements.push(stockDeltaStatement(db, input.productId, input.toLocationId, input.qtyMilli, occurredAt));
    }
    results.push({
      id,
      requestKey: input.requestKey,
      type: input.type,
      productId: input.productId,
      qtyMilli: input.qtyMilli,
      fromLocationId: input.fromLocationId ?? null,
      toLocationId: input.toLocationId ?? null,
      occurredAt,
      idempotentReplay: false,
    });
  }

  if (options.extraStatements) {
    const extra =
      typeof options.extraStatements === "function" ? options.extraStatements(results) : options.extraStatements;
    if (extra.length) statements.push(...extra);
  }

  try {
    await db.batch(statements);
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/UNIQUE constraint failed: movements\.request_key/.test(message)) {
      const replay = await replayMovements(db, results.map((r) => r.requestKey));
      if (replay) return replay;
      throw conflict("Movimentação duplicada detectada.", { requestKeys: results.map((r) => r.requestKey) });
    }

    if (/INSUFFICIENT_STOCK/.test(message)) {
      throw new ApiError(
        409,
        "INSUFFICIENT_STOCK",
        "Saldo insuficiente para concluir a movimentação. Nenhuma alteração foi aplicada.",
        { products: requests.map((r) => ({ productId: r.productId, name: r.productName ?? null })) },
      );
    }

    throw error;
  }
}

/**
 * Se TODAS as requestKeys já existirem, o lote e um reenvio e devolvemos os
 * registros originais. Se apenas parte existir, o estado e ambíguo e o erro
 * original e propagado.
 */
async function replayMovements(db: D1Database, requestKeys: string[]): Promise<MovementResult[] | null> {
  const placeholders = requestKeys.map(() => "?").join(",");
  const rows = await db
    .prepare(
      `SELECT id, request_key, type, product_id, qty_milli, from_location_id, to_location_id, occurred_at
         FROM movements WHERE request_key IN (${placeholders})`,
    )
    .bind(...requestKeys)
    .all<{
      id: string;
      request_key: string;
      type: MovementType;
      product_id: string;
      qty_milli: number;
      from_location_id: string | null;
      to_location_id: string | null;
      occurred_at: string;
    }>();

  if (rows.results.length !== requestKeys.length) return null;

  const byKey = new Map(rows.results.map((r) => [r.request_key, r]));
  return requestKeys.map((key) => {
    const r = byKey.get(key)!;
    return {
      id: r.id,
      requestKey: r.request_key,
      type: r.type,
      productId: r.product_id,
      qtyMilli: r.qty_milli,
      fromLocationId: r.from_location_id,
      toLocationId: r.to_location_id,
      occurredAt: r.occurred_at,
      idempotentReplay: true,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Consultas de saldo                                                         */
/* -------------------------------------------------------------------------- */

export interface StockAvailability {
  productId: string;
  locationId: string;
  qtyMilli: number;
}

export async function getStockLevel(
  db: D1Database,
  productId: string,
  locationId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT qty_milli FROM stock WHERE product_id = ? AND location_id = ?`)
    .bind(productId, locationId)
    .first<{ qty_milli: number }>();
  return row?.qty_milli ?? 0;
}

/**
 * Verificação prévia de saldo, apenas para mensagem de erro amigável.
 * A garantia real esta nos triggers do banco.
 */
export async function assertSufficientStock(
  db: D1Database,
  requests: MovementRequest[],
): Promise<void> {
  // Com `stock.allow_negative` ligado, o banco aceita saldo negativo: a
  // verificação prévia não pode recusar o que os triggers permitem.
  if (await stockNegativeAllowed(db)) return;

  type Need = { productId: string; locationId: string; requiredMilli: number };
  const needs = new Map<string, Need>();

  for (const r of requests) {
    if (!r.fromLocationId) continue;
    const key = `${r.productId}::${r.fromLocationId}`;
    const current = needs.get(key) ?? {
      productId: r.productId,
      locationId: r.fromLocationId,
      requiredMilli: 0,
    };
    current.requiredMilli += r.qtyMilli;
    needs.set(key, current);
  }
  if (needs.size === 0) return;

  const insufficient: { productId: string; productName: string | null; locationId: string; available: number; required: number }[] = [];

  for (const need of needs.values()) {
    const available = await getStockLevel(db, need.productId, need.locationId);
    if (available < need.requiredMilli) {
      const name = requests.find((r) => r.productId === need.productId)?.productName ?? null;
      insufficient.push({
        productId: need.productId,
        productName: name,
        locationId: need.locationId,
        available,
        required: need.requiredMilli,
      });
    }
  }

  if (insufficient.length > 0) {
    throw new ApiError(
      409,
      "INSUFFICIENT_STOCK",
      "Saldo insuficiente para concluir a operação. Nenhuma alteração foi aplicada.",
      { insufficient },
    );
  }
}
