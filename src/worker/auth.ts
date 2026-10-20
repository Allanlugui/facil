import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AuthUser, AppEnv } from "./types";
import type { PermissionCode } from "@shared/permissions";
import { passwordChangeRequired, badRequest, forbidden, unauthorized } from "./errors";
import { recordAudit, clientInfo } from "./audit";
import { SESSION_TTL_SECONDS, nowIso, randomToken, sha256Hex } from "./util";

export const SESSION_COOKIE = "facil_session";

interface SessionRow {
  id: string;
  name: string;
  email: string;
  role_id: string;
  role_code: string;
  role_name: string;
  unit_id: string | null;
  must_change_password: number;
  theme: string | null;
  token_hash: string;
}

export async function createSession(
  db: D1Database,
  userId: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at, user_agent, ip)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(tokenHash, userId, ts, expiresAt, ts, meta.userAgent, meta.ip)
    .run();
  return { token, expiresAt };
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
}

export async function destroyAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
}

/**
 * Resolve o usuário a partir do token de sessão. A autorização (perfil e
 * permissões) vem sempre do banco, nunca do cliente.
 */
export async function resolveUser(db: D1Database, token: string): Promise<AuthUser | null> {
  const tokenHash = await sha256Hex(token);
  const now = nowIso();
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role_id, u.unit_id, u.must_change_password, u.theme,
              r.code AS role_code, r.name AS role_name, s.token_hash
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1 AND r.is_active = 1`,
    )
    .bind(tokenHash, now)
    .first<SessionRow>();
  if (!row) return null;

  const permRows = await db
    .prepare(`SELECT permission_code FROM role_permissions WHERE role_id = ?`)
    .bind(row.role_id)
    .all<{ permission_code: string }>();

  const permissions = new Set(permRows.results.map((p) => p.permission_code));
  const locationScope = await resolveLocationScope(db, row.id);

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    unitId: row.unit_id,
    mustChangePassword: row.must_change_password === 1,
    permissions,
    locationScope,
    theme: row.theme,
  };
}

/**
 * Locais visíveis para o usuário: os locais atribuídos em `user_location_scopes`
 * mais todos os seus descendentes na hierarquia. Lista vazia = sem restrição.
 */
export async function resolveLocationScope(db: D1Database, userId: string): Promise<string[]> {
  const direct = await db
    .prepare(`SELECT location_id FROM user_location_scopes WHERE user_id = ?`)
    .bind(userId)
    .all<{ location_id: string }>();
  if (direct.results.length === 0) return [];

  const descendants = await db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT location_id FROM user_location_scopes WHERE user_id = ?
         UNION
         SELECT l.id FROM locations l JOIN tree t ON l.parent_id = t.id
       )
       SELECT id FROM tree`,
    )
    .bind(userId)
    .all<{ id: string }>();

  return descendants.results.map((r) => r.id);
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  const isHttps = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: isHttps,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function getSessionToken(c: Context<AppEnv>): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Middlewares                                                                */
/* -------------------------------------------------------------------------- */

/** Carrega o usuário (se houver sessão válida). Não bloqueia a requisição. */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getSessionToken(c);
  c.set("sessionToken", token);
  if (token) {
    const user = await resolveUser(c.env.DB, token);
    c.set("user", user);
    if (user) {
      // Atualiza last_seen_at sem bloquear a resposta.
      const ts = nowIso();
      c.executionCtx.waitUntil(
        c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`)
          .bind(ts, await sha256Hex(token))
          .run()
          .catch(() => undefined),
      );
    }
  }
  await next();
});

/** Exige sessão válida. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user) throw unauthorized();
  if (user.mustChangePassword && !isPasswordChangeAllowed(c.req.path)) {
    throw passwordChangeRequired();
  }
  await next();
});

function isPasswordChangeAllowed(path: string): boolean {
  return (
    path.endsWith("/api/auth/me") ||
    path.endsWith("/api/auth/change-password") ||
    path.endsWith("/api/auth/logout")
  );
}

export function currentUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) throw unauthorized();
  return user;
}

/**
 * Exige uma permissão específica.
 *
 * A negação é registrada na auditoria antes de responder 403. Sem isso, uma
 * tentativa de acesso indevido não deixaria rastro -- e a auditoria e
 * justamente o que comprova quem tentou o que. A falha ao gravar o log nunca
 * impede a resposta de bloqueio.
 */
export function requirePermission(code: PermissionCode) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = currentUser(c);
    if (!user.permissions.has(code)) {
      await recordPermissionDenied(c, user, code);
      throw forbidden(`Permissão necessária: ${code}.`);
    }
    await next();
  });
}

/**
 * Grava a negação de permissão na trilha de auditoria antes de devolver 403.
 *
 * Exportado porque nem toda autorização passa por `requirePermission`: rotas com
 * vários níveis de permissão (ex.: tipos de movimentação de estoque) decidem pelo
 * corpo da requisição e precisam registrar a negação da mesma forma.
 */
export async function recordPermissionDenied(
  c: Context<AppEnv>,
  user: AuthUser,
  code: string,
): Promise<void> {
  try {
    await recordAudit(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: code.split(".")[0] ?? "auth",
      action: "permission_denied",
      entityType: "permission",
      entityId: code,
      result: "failure",
      after: { method: c.req.method, path: new URL(c.req.url).pathname, roleId: user.roleId },
      ...clientInfo(c),
    });
  } catch {
    // Log de auditoria não pode derrubar a requisição; a negação acontece de qualquer forma.
  }
}

/**
 * Rejeita senhas derivadas do e-mail (mesma regra aplicada na troca de senha).
 * Vale para setup, criação de usuário e redefinição -- nunca só em uma rota.
 */
export function assertPasswordNotFromEmail(password: string, email: string): void {
  const localPart = (email.split("@")[0] ?? "").trim().toLowerCase();
  if (localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
    throw badRequest("A senha não pode conter o seu e-mail.");
  }
}

export function can(user: AuthUser, code: PermissionCode): boolean {
  return user.permissions.has(code);
}

export function assertCan(user: AuthUser, code: PermissionCode): void {
  if (!user.permissions.has(code)) throw forbidden(`Permissão necessária: ${code}.`);
}

/* -------------------------------------------------------------------------- */
/* Escopo por local                                                           */
/* -------------------------------------------------------------------------- */

/** true quando o usuário não tem restrição de local. */
export function hasFullLocationAccess(user: AuthUser): boolean {
  return user.locationScope.length === 0;
}

export function assertLocationAllowed(user: AuthUser, locationId: string | null | undefined): void {
  if (!locationId) return;
  if (hasFullLocationAccess(user)) return;
  if (!user.locationScope.includes(locationId)) {
    throw forbidden("Você não tem acesso a este local.");
  }
}

/**
 * Filtra uma lista de locais pelo escopo do usuário. Usado em filtros de
 * consulta para que o usuário jamais receba dados de fora do seu escopo.
 */
export function filterLocationsForUser(user: AuthUser, locationIds: (string | null)[]): (string | null)[] {
  if (hasFullLocationAccess(user)) return locationIds;
  return locationIds.filter((id) => id !== null && user.locationScope.includes(id));
}
