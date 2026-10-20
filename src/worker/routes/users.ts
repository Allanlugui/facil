import { Hono } from "hono";
import { z } from "zod";
import { ALL_PERMISSION_CODES, PERMISSION_GROUPS, PERMISSIONS } from "@shared/permissions";
import type { AppEnv, AuthUser } from "../types";
import { assertPasswordNotFromEmail, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow, updateStatement } from "../db";
import { badRequest, conflict, forbidden, notFound, parseBody } from "../errors";
import { hashPassword, nowIso, randomToken, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido.");

const userCreateBody = z.object({
  name: z.string().trim().min(2, "Informe o nome do colaborador.").max(120),
  email: emailSchema,
  roleId: z.string().trim().min(1, "Selecione o perfil."),
  unitId: z.string().trim().min(1).nullish(),
  employeeCode: z.string().trim().max(40).nullish(),
  phone: z.string().trim().max(40).nullish(),
  jobTitle: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  password: z.string().min(10, "A senha deve ter ao menos 10 caracteres.").max(200).optional(),
  /**
   * Obriga a troca de senha no primeiro acesso. Vale também quando a senha e
   * definida pelo administrador -- quem cria a conta pode exigir a troca.
   */
  mustChangePassword: z.boolean().optional().default(false),
});

const userUpdateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: emailSchema.optional(),
  roleId: z.string().trim().min(1).optional(),
  unitId: z.string().trim().min(1).nullish(),
  employeeCode: z.string().trim().max(40).nullish(),
  phone: z.string().trim().max(40).nullish(),
  jobTitle: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().optional(),
});

const roleBody = z.object({
  name: z.string().trim().min(2, "Informe o nome do perfil.").max(80),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "Use apenas letras minusculas, números e sublinhado."),
  description: z.string().trim().max(300).nullish(),
});

const rolePermissionsBody = z.object({
  permissions: z.array(z.string().trim().min(1)).max(500),
});

const scopesBody = z.object({
  locationIds: z.array(z.string().trim().min(1)).max(500),
});

/* -------------------------------------------------------------------------- */
/* Catálogo de permissões                                                     */
/* -------------------------------------------------------------------------- */

router.get("/permissions", requirePermission(PERMISSIONS.USERS_VIEW), (c) => {
  return c.json({ groups: PERMISSION_GROUPS, total: ALL_PERMISSION_CODES.length });
});

/* -------------------------------------------------------------------------- */
/* Perfis                                                                     */
/* -------------------------------------------------------------------------- */

router.get("/roles", requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
  const roles = await allRows<{ id: string; name: string; code: string; description: string | null; is_system: number; is_active: number; user_count: number }>(
    c.env.DB,
    `SELECT r.id, r.name, r.code, r.description, r.is_system, r.is_active,
            (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
       FROM roles r
      ORDER BY r.is_system DESC, r.name`,
  );

  const perms = await allRows<{ role_id: string; permission_code: string }>(
    c.env.DB,
    `SELECT role_id, permission_code FROM role_permissions`,
  );
  const byRole = new Map<string, string[]>();
  for (const p of perms) {
    const list = byRole.get(p.role_id) ?? [];
    list.push(p.permission_code);
    byRole.set(p.role_id, list);
  }

  return c.json({
    items: roles.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      description: r.description,
      isSystem: r.is_system === 1,
      isActive: r.is_active === 1,
      userCount: r.user_count,
      permissions: (byRole.get(r.id) ?? []).sort(),
    })),
  });
});

router.post("/roles", requirePermission(PERMISSIONS.USERS_PERMISSIONS), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, roleBody);

  const duplicate = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM roles WHERE code = ? COLLATE NOCASE`, [
    body.code,
  ]);
  if (duplicate) throw conflict("Já existe um perfil com este código.");

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "roles", {
      id,
      name: body.name,
      code: body.code,
      description: body.description ?? null,
      is_system: 0,
      is_active: 1,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "users",
      action: "role.create",
      entityType: "role",
      entityId: id,
      after: body,
      ...info,
    }),
  ]);

  return c.json({ id }, 201);
});

router.patch("/roles/:id", requirePermission(PERMISSIONS.USERS_PERMISSIONS), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, roleBody.partial().extend({ isActive: z.boolean().optional() }));

  const role = await oneRow<{ id: string; is_system: number; code: string }>(
    c.env.DB,
    `SELECT id, is_system, code FROM roles WHERE id = ?`,
    [id],
  );
  if (!role) throw notFound("Perfil não encontrado.");
  if (role.code === "admin") throw conflict("O perfil Administrador não pode ser alterado.");

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.description !== undefined ? { description: body.description ?? null } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "roles", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "users",
      action: "role.update",
      entityType: "role",
      entityId: id,
      before: role,
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

/**
 * Substitui a matriz de permissões de um perfil.
 *
 * Regra de menor privilegio: o ator só pode CONCEDER permissões que ele mesmo
 * possui e só pode REVOGAR permissões que ele mesmo possui. Isso impede que um
 * usuário amplie o próprio poder alterando outros perfis, inclusive removendo
 * restrições que não estão sob sua alcada.
 */
router.put("/roles/:id/permissions", requirePermission(PERMISSIONS.USERS_PERMISSIONS), async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, rolePermissionsBody);

  const role = await oneRow<{ id: string; code: string }>(c.env.DB, `SELECT id, code FROM roles WHERE id = ?`, [id]);
  if (!role) throw notFound("Perfil não encontrado.");
  if (role.code === "admin") {
    throw conflict(
      "As permissões do perfil Administrador não podem ser alteradas por seguranca. Crie um perfil específico.",
    );
  }

  const requested = [...new Set(body.permissions)];
  const unknown = requested.filter((code) => !ALL_PERMISSION_CODES.includes(code as never));
  if (unknown.length > 0) throw badRequest("Permissões desconhecidas.", { unknown });

  const current = await allRows<{ permission_code: string }>(
    c.env.DB,
    `SELECT permission_code FROM role_permissions WHERE role_id = ?`,
    [id],
  );
  const currentCodes = current.map((p) => p.permission_code);

  const outsideAuthority = [...requested, ...currentCodes].filter((code) => !actor.permissions.has(code));
  if (outsideAuthority.length > 0) {
    throw forbidden(
      "Você não pode conceder ou revogar permissões que não possui. Solicite a um administrador.",
      { blockedPermissions: [...new Set(outsideAuthority)].sort() },
    );
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements = [
    c.env.DB.prepare(`DELETE FROM role_permissions WHERE role_id = ?`).bind(id),
    ...requested.map((code) =>
      c.env.DB.prepare(`INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)`).bind(id, code),
    ),
    c.env.DB.prepare(`UPDATE roles SET updated_at = ? WHERE id = ?`).bind(ts, id),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "role.permissions_update",
      entityType: "role",
      entityId: id,
      before: { permissions: currentCodes.sort() },
      after: { permissions: requested.sort() },
      ...info,
    }),
  ];

  await c.env.DB.batch(statements);
  return c.json({ ok: true, permissions: requested.sort() });
});

/* -------------------------------------------------------------------------- */
/* Usuários                                                                   */
/* -------------------------------------------------------------------------- */

const USER_SELECT = `
  SELECT u.id, u.name, u.email, u.role_id, u.unit_id, u.employee_code, u.phone, u.job_title,
         u.notes, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
         r.name AS role_name, r.code AS role_code,
         un.name AS unit_name,
         (SELECT COUNT(*) FROM user_location_scopes s WHERE s.user_id = u.id) AS scope_count
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN units un ON un.id = u.unit_id`;

router.get("/users", requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });
  const search = url.searchParams.get("search")?.trim();
  const roleId = url.searchParams.get("roleId")?.trim();
  const isActive = url.searchParams.get("isActive");

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (search) {
    clauses.push(`(u.name LIKE ? OR u.email LIKE ? OR COALESCE(u.employee_code,'') LIKE ?)`);
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (roleId) {
    clauses.push(`u.role_id = ?`);
    params.push(roleId);
  }
  if (isActive) {
    clauses.push(`u.is_active = ?`);
    params.push(isActive === "true" ? 1 : 0);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM users u ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${USER_SELECT} ${where} ORDER BY u.is_active DESC, u.name LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  const ids = rows.map((r) => String(r.id));
  const scopes = ids.length
    ? await allRows<{ user_id: string; location_id: string; path: string }>(
        c.env.DB,
        `SELECT s.user_id, s.location_id, l.path
           FROM user_location_scopes s JOIN locations l ON l.id = s.location_id
          WHERE s.user_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      )
    : [];
  const scopeByUser = new Map<string, { id: string; path: string }[]>();
  for (const s of scopes) {
    const list = scopeByUser.get(s.user_id) ?? [];
    list.push({ id: s.location_id, path: s.path });
    scopeByUser.set(s.user_id, list);
  }

  return c.json({
    items: rows.map((r) => ({
      ...mapUser(r),
      locationScope: scopeByUser.get(String(r.id)) ?? [],
    })),
    total,
    page: page.page,
    pageSize: page.pageSize,
  });
});

router.get("/users/:id", requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${USER_SELECT} WHERE u.id = ?`, [
    c.req.param("id"),
  ]);
  if (!row) throw notFound("Usuário não encontrado.");
  const scope = await allRows<{ location_id: string; path: string }>(
    c.env.DB,
    `SELECT s.location_id, l.path FROM user_location_scopes s
       JOIN locations l ON l.id = s.location_id WHERE s.user_id = ?`,
    [String(row.id)],
  );
  return c.json({
    user: { ...mapUser(row), locationScope: scope.map((s) => ({ id: s.location_id, path: s.path })) },
  });
});

/**
 * Cria usuário. Sem `password` informada, gera uma senha temporária que e
 * devolvida UMA ÚNICA VEZ para o administrador entregar ao colaborador, e
 * marca a troca obrigatória no primeiro acesso. Não há serviço de e-mail.
 */
router.post("/users", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const body = await parseBody(c, userCreateBody);

  const role = await oneRow<{ id: string; code: string }>(c.env.DB, `SELECT id, code FROM roles WHERE id = ?`, [
    body.roleId,
  ]);
  if (!role) throw notFound("Perfil não encontrado.");
  await assertRoleWithinAuthority(c.env.DB, actor, role.id);
  if (body.unitId) await assertUnitExists(c.env.DB, body.unitId);

  const duplicate = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM users WHERE email = ?`, [body.email]);
  if (duplicate) throw conflict("Já existe um usuário com este e-mail.");

  if (body.password) assertPasswordNotFromEmail(body.password, body.email);

  const temporary = body.password ? null : `Fl-${randomToken(9)}`;
  const plainPassword = body.password ?? temporary!;
  const { hash, salt, iterations } = await hashPassword(plainPassword);

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);

  await c.env.DB.batch([
    insertStatement(c.env.DB, "users", {
      id,
      name: body.name,
      email: body.email,
      password_hash: hash,
      password_salt: salt,
      password_iterations: iterations,
      role_id: body.roleId,
      unit_id: body.unitId ?? null,
      employee_code: body.employeeCode ?? null,
      phone: body.phone ?? null,
      job_title: body.jobTitle ?? null,
      notes: body.notes ?? null,
      is_active: 1,
      must_change_password: temporary || body.mustChangePassword ? 1 : 0,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "user.create",
      entityType: "user",
      entityId: id,
      after: { email: body.email, roleId: body.roleId, temporaryPassword: Boolean(temporary) },
      ...info,
    }),
  ]);

  return c.json({ id, temporaryPassword: temporary }, 201);
});

router.patch("/users/:id", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, userUpdateBody);

  const before = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, email, role_id, unit_id, employee_code, phone, job_title, notes, is_active FROM users WHERE id = ?`,
    [id],
  );
  if (!before) throw notFound("Usuário não encontrado.");

  if (body.email) {
    const duplicate = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM users WHERE email = ? AND id <> ?`, [
      body.email,
      id,
    ]);
    if (duplicate) throw conflict("Já existe um usuário com este e-mail.");
  }

  // Ninguem altera o próprio perfil nem desativa a própria conta.
  if (body.roleId && body.roleId !== before.role_id) {
    if (id === actor.id) throw forbidden("Você não pode alterar o seu próprio perfil.");
    await assertRoleWithinAuthority(c.env.DB, actor, body.roleId);
    await assertNotLastAdmin(c.env.DB, id, "role");
  }
  if (body.isActive === false) {
    if (id === actor.id) throw forbidden("Você não pode desativar a própria conta.");
    await assertNotLastAdmin(c.env.DB, id, "deactivate");
  }
  if (body.unitId) await assertUnitExists(c.env.DB, body.unitId);

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.roleId !== undefined ? { role_id: body.roleId } : {}),
    ...(body.unitId !== undefined ? { unit_id: body.unitId ?? null } : {}),
    ...(body.employeeCode !== undefined ? { employee_code: body.employeeCode ?? null } : {}),
    ...(body.phone !== undefined ? { phone: body.phone ?? null } : {}),
    ...(body.jobTitle !== undefined ? { job_title: body.jobTitle ?? null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  const statements = [
    updateStatement(c.env.DB, "users", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "user.update",
      entityType: "user",
      entityId: id,
      before,
      after: updated,
      ...info,
    }),
  ];

  // Perfil alterado ou usuário desativado: encerra as sessões ativas.
  if (updated.role_id !== undefined || updated.is_active === 0) {
    statements.push(c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id));
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});

/** Redefine a senha. Gera senha temporária e exige troca no primeiro acesso. */
router.post("/users/:id/reset-password", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const target = await oneRow<{ id: string; role_id: string; is_active: number }>(
    c.env.DB,
    `SELECT id, role_id, is_active FROM users WHERE id = ?`,
    [id],
  );
  if (!target) throw notFound("Usuário não encontrado.");
  await assertRoleWithinAuthority(c.env.DB, actor, target.role_id);

  const temporary = `Fl-${randomToken(9)}`;
  const { hash, salt, iterations } = await hashPassword(temporary);
  const ts = nowIso();
  const info = clientInfo(c);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?,
              must_change_password = 1, updated_at = ? WHERE id = ?`,
    ).bind(hash, salt, iterations, ts, id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "user.reset_password",
      entityType: "user",
      entityId: id,
      reason: "Redefinição administrativa de senha.",
      ...info,
    }),
  ]);

  return c.json({ temporaryPassword: temporary });
});

/**
 * Define o escopo de locais do usuário. Lista vazia significa "sem restrição".
 * Um administrador não pode conceder a outro escopo mais amplo que o próprio.
 */
router.put("/users/:id/location-scopes", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, scopesBody);

  const target = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM users WHERE id = ?`, [id]);
  if (!target) throw notFound("Usuário não encontrado.");

  const unique = [...new Set(body.locationIds)];
  if (unique.length > 0) {
    const found = await allRows<{ id: string }>(
      c.env.DB,
      `SELECT id FROM locations WHERE id IN (${unique.map(() => "?").join(",")})`,
      unique,
    );
    if (found.length !== unique.length) throw badRequest("Um ou mais locais informados não existem.");

    if (actor.locationScope.length > 0) {
      const outside = unique.filter((loc) => !actor.locationScope.includes(loc));
      if (outside.length > 0) {
        throw forbidden("Você não pode conceder acesso a locais fora do seu próprio escopo.", {
          blockedLocations: outside,
        });
      }
    }
  }

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM user_location_scopes WHERE user_id = ?`).bind(id),
    ...unique.map((locationId) =>
      c.env.DB.prepare(`INSERT INTO user_location_scopes (user_id, location_id) VALUES (?, ?)`).bind(id, locationId),
    ),
    c.env.DB.prepare(`UPDATE users SET updated_at = ? WHERE id = ?`).bind(ts, id),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "user.location_scopes_update",
      entityType: "user",
      entityId: id,
      after: { locationIds: unique },
      ...info,
    }),
  ]);

  return c.json({ ok: true, locationIds: unique });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares de autorização                                                  */
/* -------------------------------------------------------------------------- */

/**
 * O ator só pode atribuir um perfil cujas permissões ele próprio possui.
 * Impede que um gerente crie um usuário administrador, por exemplo.
 */
async function assertRoleWithinAuthority(db: D1Database, actor: AuthUser, roleId: string): Promise<void> {
  const role = await oneRow<{ code: string; name: string }>(db, `SELECT code, name FROM roles WHERE id = ?`, [
    roleId,
  ]);
  if (!role) throw notFound("Perfil não encontrado.");

  const perms = await allRows<{ permission_code: string }>(
    db,
    `SELECT permission_code FROM role_permissions WHERE role_id = ?`,
    [roleId],
  );
  const outside = perms.map((p) => p.permission_code).filter((code) => !actor.permissions.has(code));
  if (outside.length > 0) {
    throw forbidden(
      `Você não pode atribuir o perfil "${role.name}" porque ele possui permissões que você não tem.`,
      { blockedPermissions: outside.sort() },
    );
  }
}

/** Impede que a última conta de administrador ativa seja rebaixada ou desativada. */
async function assertNotLastAdmin(db: D1Database, userId: string, reason: "role" | "deactivate"): Promise<void> {
  const target = await oneRow<{ role_id: string; is_active: number }>(
    db,
    `SELECT role_id, is_active FROM users WHERE id = ?`,
    [userId],
  );
  if (!target || target.is_active !== 1) return;
  const adminRole = await oneRow<{ id: string }>(db, `SELECT id FROM roles WHERE code = 'admin'`);
  if (!adminRole || target.role_id !== adminRole.id) return;

  const remaining = await countRows(
    db,
    `SELECT COUNT(*) FROM users WHERE role_id = ? AND is_active = 1 AND id <> ?`,
    [adminRole.id, userId],
  );
  if (remaining === 0) {
    throw conflict(
      reason === "deactivate"
        ? "Não é possível desativar o último administrador ativo do sistema."
        : "Não é possível alterar o perfil do último administrador ativo do sistema.",
    );
  }
}

async function assertUnitExists(db: D1Database, unitId: string): Promise<void> {
  const unit = await oneRow<{ id: string }>(db, `SELECT id FROM units WHERE id = ?`, [unitId]);
  if (!unit) throw notFound("Unidade não encontrada.");
}

function mapUser(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    roleId: String(row.role_id),
    roleName: String(row.role_name),
    roleCode: String(row.role_code),
    unitId: row.unit_id ? String(row.unit_id) : null,
    unitName: row.unit_name ? String(row.unit_name) : null,
    employeeCode: row.employee_code ? String(row.employee_code) : null,
    phone: row.phone ? String(row.phone) : null,
    jobTitle: row.job_title ? String(row.job_title) : null,
    notes: row.notes ? String(row.notes) : null,
    isActive: Number(row.is_active) === 1,
    mustChangePassword: Number(row.must_change_password) === 1,
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    createdAt: String(row.created_at),
    scopeCount: row.scope_count !== undefined ? Number(row.scope_count) : undefined,
  };
}

export default router;
