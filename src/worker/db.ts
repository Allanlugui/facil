/**
 * Helpers de acesso a dados.
 *
 * Os nomes de tabela/coluna usados aqui vem SEMPRE de constantes do próprio
 * código (nunca de entrada do usuário), portanto a interpolação em SQL nestes
 * helpers não e vetor de injeção. Valores sempre via bind (?).
 */

export type SqlValue = string | number | null | ArrayBuffer;

export function normalizeValue(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Valor numérico inválido para o banco.");
    return value;
  }
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) return value.buffer.slice(0) as ArrayBuffer;
  return JSON.stringify(value);
}

export function buildInsert(table: string, data: Record<string, unknown>): { sql: string; values: SqlValue[] } {
  const columns = Object.keys(data);
  if (columns.length === 0) throw new Error(`INSERT em ${table} sem colunas.`);
  return {
    sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    values: columns.map((c) => normalizeValue(data[c])),
  };
}

export function buildUpdate(
  table: string,
  id: string,
  data: Record<string, unknown>,
): { sql: string; values: SqlValue[] } {
  const columns = Object.keys(data);
  if (columns.length === 0) throw new Error(`UPDATE em ${table} sem colunas.`);
  return {
    sql: `UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    values: [...columns.map((c) => normalizeValue(data[c])), id],
  };
}

export function insertStatement(
  db: D1Database,
  table: string,
  data: Record<string, unknown>,
): D1PreparedStatement {
  const { sql, values } = buildInsert(table, data);
  return db.prepare(sql).bind(...values);
}

export function updateStatement(
  db: D1Database,
  table: string,
  id: string,
  data: Record<string, unknown>,
): D1PreparedStatement {
  const { sql, values } = buildUpdate(table, id, data);
  return db.prepare(sql).bind(...values);
}

export async function insertRecord(
  db: D1Database,
  table: string,
  data: Record<string, unknown>,
): Promise<void> {
  await insertStatement(db, table, data).run();
}

export async function updateRecord(
  db: D1Database,
  table: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await updateStatement(db, table, id, data).run();
}

export async function allRows<T>(
  db: D1Database,
  sql: string,
  params: SqlValue[] = [],
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results;
}

export async function oneRow<T>(
  db: D1Database,
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function scalar<T extends SqlValue>(
  db: D1Database,
  sql: string,
  params: SqlValue[] = [],
): Promise<T | null> {
  const row = await db.prepare(sql).bind(...params).first<Record<string, T>>();
  if (!row) return null;
  const values = Object.values(row);
  return (values.length > 0 ? (values[0] as T) : null) ?? null;
}

export async function countRows(
  db: D1Database,
  sql: string,
  params: SqlValue[] = [],
): Promise<number> {
  return (await scalar<number>(db, sql, params)) ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Paginação                                                                  */
/* -------------------------------------------------------------------------- */

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function normalizePage(input: { page?: number; pageSize?: number }): PageRequest {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(input.pageSize ?? 25)));
  return { page, pageSize };
}

export function offsetOf(page: PageRequest): number {
  return (page.page - 1) * page.pageSize;
}

/* -------------------------------------------------------------------------- */
/* Filtros dinâmicos                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Acumula fragmentos de WHERE com seus parâmetros na ordem correta.
 * Uso: const w = new WhereBuilder(); w.add('p.is_active = ?', 1); w.sql() ...
 */
export class WhereBuilder {
  private readonly clauses: string[] = [];
  private readonly params: SqlValue[] = [];

  add(clause: string, ...params: SqlValue[]): void {
    this.clauses.push(clause);
    this.params.push(...params);
  }

  addIf(condition: unknown, clause: string, ...params: SqlValue[]): void {
    if (condition) this.add(clause, ...params);
  }

  inList(column: string, values: string[], required = false): void {
    if (values.length === 0) {
      if (required) this.add("1 = 0");
      return;
    }
    this.add(`${column} IN (${values.map(() => "?").join(", ")})`, ...values);
  }

  sql(): string {
    return this.clauses.length > 0 ? `WHERE ${this.clauses.join(" AND ")}` : "";
  }

  values(): SqlValue[] {
    return [...this.params];
  }
}
