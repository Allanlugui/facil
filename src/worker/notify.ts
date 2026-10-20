import { insertStatement } from "./db";
import { nowIso, uuid } from "./util";

/**
 * Notificações internas.
 *
 * Toda notificação e gravada na tabela `notifications` DENTRO do mesmo lote
 * atômico da operação que a originou (ver `notificationStatement`). Assim, ou a
 * operação e a notificação existem juntas, ou nenhuma das duas existe -- nunca
 * há notificação de uma ação que falhou.
 */

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  createdAt?: string;
}

export function notificationStatement(db: D1Database, input: NotifyInput): D1PreparedStatement {
  return insertStatement(db, "notifications", {
    id: uuid(),
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    read_at: null,
    created_at: input.createdAt ?? nowIso(),
  });
}

export function notificationStatements(
  db: D1Database,
  userIds: string[],
  input: Omit<NotifyInput, "userId">,
): D1PreparedStatement[] {
  const unique = [...new Set(userIds)].filter(Boolean);
  return unique.map((userId) => notificationStatement(db, { ...input, userId }));
}

/** Usuários ativos que possuem determinada permissão em algum papel. */
export async function usersWithPermission(db: D1Database, permissionCode: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
        WHERE u.is_active = 1 AND rp.permission_code = ?`,
    )
    .bind(permissionCode)
    .all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
}
