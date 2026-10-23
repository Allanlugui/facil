import { Hono } from "hono";
import { z } from "zod";
import type { SessionUser } from "@shared/types";
import { DEFAULT_THEME, THEME_IDS, isThemeId } from "@shared/themes";
import type { AppEnv, AuthUser } from "../types";
import {
  assertPasswordNotFromEmail,
  clearSessionCookie,
  createSession,
  currentUser,
  destroyAllSessions,
  destroySession,
  resolveLocationScope,
  setSessionCookie,
} from "../auth";
import { clientInfo, recordAudit } from "../audit";
import { allRows } from "../db";
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  parseBody,
  unauthorized,
} from "../errors";
import { readCaptchaConfig, isCaptchaRequired, verifyCaptchaToken } from "../captcha";
import { DEFAULT_PBKDF2_ITERATIONS, hashPassword, nowIso, uuid, verifyPassword } from "../util";

const router = new Hono<AppEnv>();

const PASSWORD_MIN = 10;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 10;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `A senha deve ter ao menos ${PASSWORD_MIN} caracteres.`)
  .max(200, "Senha muito longa.");

const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido.");

const setupSchema = z.object({
  companyName: z.string().trim().min(2, "Informe o nome da empresa.").max(120),
  name: z.string().trim().min(2, "Informe o nome do administrador.").max(120),
  email: emailSchema,
  password: passwordSchema,
  createStarterStructure: z.boolean().optional().default(true),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe a senha.").max(200, "Senha muito longa."),
  // Captcha (camada final, D-15): exigido somente quando o administrador
  // habilitou `captcha.enabled` e configurou as chaves. Opcional no schema
  // para nao quebrar instancias sem captcha.
  captcha_token: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual."),
  newPassword: passwordSchema,
});

function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roleId: user.roleId,
    roleCode: user.roleCode,
    roleName: user.roleName,
    unitId: user.unitId,
    departmentId: user.departmentId,
    departmentName: user.departmentName,
    departmentIsPurchasing: user.departmentIsPurchasing,
    managedDepartmentIds: user.managedDepartmentIds,
    mustChangePassword: user.mustChangePassword,
    permissions: [...user.permissions].sort(),
    locationScope: user.locationScope,
    theme: user.theme,
  };
}

/* -------------------------------------------------------------------------- */
/* Instalação inicial                                                         */
/* -------------------------------------------------------------------------- */

router.get("/setup-status", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM users WHERE id <> 'user_intake'`,
  ).first<{ total: number }>();
  const settings = await allRows<{ key: string; value: string }>(
    c.env.DB,
    `SELECT key, value FROM settings WHERE key IN ('company.name','ui.theme')`,
  );
  const values = new Map(settings.map((entry) => [String(entry.key), String(entry.value)]));
  const theme = values.get("ui.theme");
  return c.json({
    needsSetup: (row?.total ?? 0) === 0,
    companyName: values.get("company.name") ?? null,
    // Páginas públicas (login, suporte) aplicam o tema padrão antes da sessão existir.
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
  });
});

/**
 * Cria o primeiro administrador. Só funciona enquanto não existir nenhum
 * usuário, o que impede escalonamento posterior por esta rota.
 */
router.post("/setup", async (c) => {
  const body = await parseBody(c, setupSchema);
  // `user_intake` é o solicitante técnico das integrações, não uma conta de
  // acesso. Ele pode existir antes da instalação inicial e não pode bloquear a
  // criação do primeiro administrador.
  const existing = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM users WHERE id <> 'user_intake'`,
  ).first<{ total: number }>();
  if ((existing?.total ?? 0) > 0) {
    throw conflict("A instalação inicial já foi concluída.");
  }
  assertPasswordNotFromEmail(body.password, body.email);

  const ts = nowIso();
  const userId = uuid();
  const { hash, salt, iterations } = await hashPassword(body.password);
  const statements: D1PreparedStatement[] = [];

  let unitId: string | null = null;
  if (body.createStarterStructure) {
    unitId = uuid();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO units (id, name, code, notes, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      ).bind(unitId, `${body.companyName} - Matriz`, "MATRIZ", "Unidade criada na instalação inicial.", ts, ts),
    );
  }

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO users
         (id, name, email, password_hash, password_salt, password_iterations, role_id, unit_id,
          is_active, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'role_admin', ?, 1, 0, ?, ?)`,
    ).bind(userId, body.name, body.email, hash, salt, iterations, unitId, ts, ts),
  );

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO settings (key, value, description, updated_at) VALUES ('company.name', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(body.companyName, "Nome exibido no topo da aplicação", ts),
  );

  await c.env.DB.batch(statements);

  if (unitId) {
    await createStarterLocations(c.env.DB, unitId, ts);
  }

  const info = clientInfo(c);
  await recordAudit(c.env.DB, {
    actor: { id: userId, name: body.name },
    module: "auth",
    action: "setup",
    entityType: "user",
    entityId: userId,
    after: { email: body.email, companyName: body.companyName, starterStructure: body.createStarterStructure },
    ...info,
  });

  const { token } = await createSession(c.env.DB, userId, info);
  setSessionCookie(c, token);

  const user = await loadUserForResponse(c.env.DB, userId);
  return c.json({ user }, 201);
});

/**
 * Estrutura inicial mínima: uma unidade e um almoxarifado central.
 * O usuário pode renomear ou remover em Estrutura. Nenhum outro dado é criado.
 */
async function createStarterLocations(db: D1Database, unitId: string, ts: string): Promise<void> {
  const warehouseId = uuid();
  await db
    .prepare(
      `INSERT INTO locations (id, unit_id, parent_id, type_id, name, code, path, notes, is_active, created_at, updated_at)
       VALUES (?, ?, NULL, 'lt_almoxarifado', 'Almoxarifado Central', 'ALM-01', ?, 'Local de estoque criado na instalação inicial.', 1, ?, ?)`,
    )
    .bind(warehouseId, unitId, "Almoxarifado Central", ts, ts)
    .run();
}

async function loadUserForResponse(db: D1Database, userId: string): Promise<SessionUser> {
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role_id, u.unit_id, u.department_id,
              u.must_change_password, u.theme,
              d.name AS department_name, d.is_purchasing AS department_is_purchasing,
              r.code AS role_code, r.name AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.id = ?`,
    )
    .bind(userId)
    .first<{
      id: string;
      name: string;
      email: string;
      role_id: string;
      unit_id: string | null;
      department_id: string | null;
      department_name: string | null;
      department_is_purchasing: number | null;
      must_change_password: number;
      theme: string | null;
      role_code: string;
      role_name: string;
    }>();
  if (!row) throw unauthorized();

  const permissions = await db
    .prepare(`SELECT permission_code FROM role_permissions WHERE role_id = ?`)
    .bind(row.role_id)
    .all<{ permission_code: string }>();

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    unitId: row.unit_id,
    departmentId: row.department_id,
    departmentName: row.department_name,
    departmentIsPurchasing: row.department_is_purchasing === 1,
    managedDepartmentIds: (
      await db
        .prepare(`SELECT department_id FROM department_managers WHERE user_id = ?`)
        .bind(row.id)
        .all<{ department_id: string }>()
    ).results.map((item) => item.department_id),
    mustChangePassword: row.must_change_password === 1,
    permissions: permissions.results.map((p) => p.permission_code).sort(),
    locationScope: await resolveLocationScope(db, row.id),
    theme: row.theme,
  };
}

/* -------------------------------------------------------------------------- */
/* Login / logout                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Dados de apresentação usados pelo cliente (nome da empresa e fuso horário).
 * Vão junto da sessão para que a interface formate datas no fuso configurado,
 * sem uma chamada extra e sem duplicar a regra no front-end.
 */
async function loadAppSettings(
  db: D1Database,
): Promise<{ companyName: string | null; timezone: string; theme: string }> {
  const rows = await allRows<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM settings WHERE key IN ('company.name','company.timezone','ui.theme')`,
  );
  const values = new Map(rows.map((r) => [String(r.key), String(r.value)]));
  const theme = values.get("ui.theme");
  return {
    companyName: values.get("company.name") ?? null,
    timezone: values.get("company.timezone") ?? "America/Sao_Paulo",
    theme: isThemeId(theme) ? theme : DEFAULT_THEME,
  };
}

router.post("/login", async (c) => {
  const body = await parseBody(c, loginSchema);
  const info = clientInfo(c);

  // Captcha (camada final, D-15): quando habilitado, exige token valido antes
  // de qualquer tentativa de autenticacao.
  const captchaRows = await allRows<{ key: string; value: string }>(
    c.env.DB,
    `SELECT key, value FROM settings WHERE key IN ('captcha.enabled','captcha.site_key','captcha.secret_key')`,
  );
  const captchaConfig = readCaptchaConfig(
    Object.fromEntries(captchaRows.map((row) => [String(row.key), String(row.value)])),
  );
  if (isCaptchaRequired(captchaConfig)) {
    const ok = await verifyCaptchaToken(captchaConfig.secretKey, body.captcha_token ?? "", info.ip);
    if (!ok) {
      await recordAudit(c.env.DB, {
        actor: null,
        module: "auth",
        action: "login_captcha_failed",
        entityType: "email",
        entityId: body.email,
        result: "failure",
        reason: "Captcha invalido ou ausente.",
        ...info,
      });
      throw new ApiError(400, "CAPTCHA_REQUIRED", "Preencha o captcha e tente novamente.");
    }
  }

  const windowStart = new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
  const failures = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total FROM audit_log
      WHERE module = 'auth' AND action = 'login_failed' AND entity_id = ? AND created_at > ?`,
  )
    .bind(body.email, windowStart)
    .first<{ total: number }>();

  if ((failures?.total ?? 0) >= LOGIN_MAX_FAILURES) {
    await recordAudit(c.env.DB, {
      actor: null,
      module: "auth",
      action: "login_throttled",
      entityType: "email",
      entityId: body.email,
      result: "failure",
      reason: "Excesso de tentativas inválidas.",
      ...info,
    });
    throw new ApiError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Muitas tentativas inválidas. Tente novamente em ${LOGIN_WINDOW_MINUTES} minutos.`,
    );
  }

  const user = await c.env.DB.prepare(
    `SELECT id, name, password_hash, password_salt, password_iterations, is_active
       FROM users WHERE email = ?`,
  )
    .bind(body.email)
    .first<{
      id: string;
      name: string;
      password_hash: string | null;
      password_salt: string | null;
      password_iterations: number | null;
      is_active: number;
    }>();

  const invalid = () => unauthorized("E-mail ou senha inválidos.");

  if (!user || !user.password_hash || !user.password_salt || user.is_active !== 1) {
    await recordAudit(c.env.DB, {
      actor: null,
      module: "auth",
      action: "login_failed",
      entityType: "email",
      entityId: body.email,
      result: "failure",
      reason: !user ? "Usuário inexistente." : user.password_hash ? "Usuário inativo." : "Sem senha definida.",
      ...info,
    });
    throw invalid();
  }

  const ok = await verifyPassword(body.password, {
    hash: user.password_hash,
    salt: user.password_salt,
    iterations: user.password_iterations,
  });

  if (!ok) {
    await recordAudit(c.env.DB, {
      actor: null,
      module: "auth",
      action: "login_failed",
      entityType: "email",
      entityId: body.email,
      result: "failure",
      reason: "Senha incorreta.",
      ...info,
    });
    throw invalid();
  }

  const ts = nowIso();
  await c.env.DB.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`)
    .bind(ts, ts, user.id)
    .run();

  // Rehash automático quando o custo configurado aumenta.
  if ((user.password_iterations ?? 0) < DEFAULT_PBKDF2_ITERATIONS) {
    const rehashed = await hashPassword(body.password, DEFAULT_PBKDF2_ITERATIONS);
    await c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE id = ?`,
    )
      .bind(rehashed.hash, rehashed.salt, rehashed.iterations, user.id)
      .run();
  }

  const { token } = await createSession(c.env.DB, user.id, info);
  setSessionCookie(c, token);

  await recordAudit(c.env.DB, {
    actor: { id: user.id, name: user.name },
    module: "auth",
    action: "login",
    entityType: "user",
    entityId: user.id,
    ...info,
  });

  const sessionUser = await loadUserForResponse(c.env.DB, user.id);
  return c.json({ user: sessionUser, app: await loadAppSettings(c.env.DB) });
});

router.post("/logout", async (c) => {
  const token = c.get("sessionToken");
  const user = c.get("user");
  if (token) {
    await destroySession(c.env.DB, token);
    clearSessionCookie(c);
    if (user) {
      await recordAudit(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "auth",
        action: "logout",
        entityType: "user",
        entityId: user.id,
        ...clientInfo(c),
      });
    }
  }
  return c.json({ ok: true });
});

router.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) throw unauthorized();
  return c.json({ user: toSessionUser(user), app: await loadAppSettings(c.env.DB) });
});

const preferencesSchema = z.object({
  theme: z
    .string()
    .refine(isThemeId, `Tema desconhecido. Valores aceitos: ${THEME_IDS.join(", ")}.`)
    .nullable(),
});

/**
 * Preferência individual de aparência.
 *
 * `theme: null` volta a seguir o tema padrão do sistema; qualquer alteração
 * fica na auditoria com o valor anterior e o novo. A lista de temas vive em
 * `src/shared/themes.ts` e o padrão do sistema em `settings['ui.theme']`.
 */
router.patch("/preferences", async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, preferencesSchema);
  const ts = nowIso();

  await c.env.DB.prepare(`UPDATE users SET theme = ?, updated_at = ? WHERE id = ?`)
    .bind(body.theme, ts, user.id)
    .run();

  await recordAudit(c.env.DB, {
    actor: { id: user.id, name: user.name },
    module: "profile",
    action: "theme_update",
    entityType: "user",
    entityId: user.id,
    before: { theme: user.theme },
    after: { theme: body.theme },
    ...clientInfo(c),
  });

  return c.json({ theme: body.theme });
});

router.post("/change-password", async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, changePasswordSchema);

  if (body.currentPassword === body.newPassword) {
    throw badRequest("A nova senha deve ser diferente da senha atual.");
  }
  assertPasswordNotFromEmail(body.newPassword, user.email);

  const row = await c.env.DB.prepare(`SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ password_hash: string | null; password_salt: string | null; password_iterations: number | null }>();
  if (!row?.password_hash || !row.password_salt) throw unauthorized();

  const ok = await verifyPassword(body.currentPassword, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations,
  });
  if (!ok) throw forbidden("Senha atual incorreta.");

  const hashed = await hashPassword(body.newPassword);
  const ts = nowIso();
  await c.env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?,
            must_change_password = 0, updated_at = ? WHERE id = ?`,
  )
    .bind(hashed.hash, hashed.salt, hashed.iterations, ts, user.id)
    .run();

  // Troca de senha inválida as demais sessões por seguranca.
  const currentToken = c.get("sessionToken");
  await destroyAllSessions(c.env.DB, user.id);
  if (currentToken) {
    const info = clientInfo(c);
    const { token } = await createSession(c.env.DB, user.id, info);
    setSessionCookie(c, token);
  }

  await recordAudit(c.env.DB, {
    actor: { id: user.id, name: user.name },
    module: "auth",
    action: "change_password",
    entityType: "user",
    entityId: user.id,
    ...clientInfo(c),
  });

  return c.json({ ok: true });
});

export default router;
