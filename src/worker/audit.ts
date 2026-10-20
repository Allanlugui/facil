import type { Context } from "hono";
import type { AppEnv } from "./types";
import { nowIso, uuid } from "./util";

export interface AuditActor {
  id: string;
  name: string;
}

export interface AuditInput {
  actor: AuditActor | null;
  module: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  result?: "success" | "failure";
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * Monta o INSERT de auditoria sem executa-lo, para que a trilha seja gravada
 * na MESMA transação da operação auditada. Se a operação falhar, o log não
 * fica gravado pela metade.
 */
export function auditStatement(db: D1Database, input: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, actor_id, actor_name, module, action, entity_type, entity_id,
          before_json, after_json, result, reason, ip, user_agent, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      uuid(),
      input.actor?.id ?? null,
      input.actor?.name ?? "sistema",
      input.module,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      serialize(input.before),
      serialize(input.after),
      input.result ?? "success",
      input.reason ?? null,
      input.ip ?? null,
      input.userAgent ?? null,
      nowIso(),
    );
}

/** Grava a auditoria imediatamente (fora de um batch). */
export async function recordAudit(db: D1Database, input: AuditInput): Promise<void> {
  await auditStatement(db, input).run();
}

/** IP e user-agent do cliente. Armazenados apenas para auditoria. */
export function clientInfo(c: Context<AppEnv>): { ip: string | null; userAgent: string | null } {
  const headers = c.req.raw.headers;
  return {
    ip: headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for") ?? null,
    userAgent: headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}
