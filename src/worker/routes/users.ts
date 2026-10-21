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
  departmentId: z.string().trim().min(1).nullish(),
  /** Setores sob responsabilidade do usuário (um gestor pode ter vários). */
  managedDepartmentIds: z.array(z.string().trim().min(1)).max(100).optional(),
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
  departmentId: z.string().trim().min(1).nullish(),
  managedDepartmentIds: z.array(z.string().trim().min(1)).max(100).optional(),
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

const departmentBody = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, "Use letras maiúsculas, números, hífen ou sublinhado."),
  name: z.string().trim().min(2, "Informe o nome do setor.").max(120),
  isPurchasing: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  notes: z.string().trim().max(500).nullish(),
});

const departmentManagersBody = z.object({
  userIds: z.array(z.string().trim().min(1)).max(100),
});

/* -------------------------------------------------------------------------- */
/* Catálogo de permissões                                                     */
/* -------------------------------------------------------------------------- */

router.get("/permissions", requirePermission(PERMISSIONS.USERS_VIEW), (c) => {
  return c.json({ groups: PERMISSION_GROUPS, total: ALL_PERMISSION_CODES.length });
});

/* -------------------------------------------------------------------------- */
/* Setores e gestores                                                         */
/* -------------------------------------------------------------------------- */

router.get("/departments", requirePermission(PERMISSIONS.USERS_VIEW), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name, is_purchasing, is_active, notes, created_at, updated_at
       FROM departments ORDER BY is_purchasing DESC, name`,
  );
  const managers = await allRows<{ department_id: string; user_id: string; name: string; email: string }>(
    c.env.DB,
    `SELECT dm.department_id, dm.user_id, u.name, u.email
       FROM department_managers dm JOIN users u ON u.id = dm.user_id
      WHERE u.is_active = 1
      ORDER BY u.name`,
  );
  const byDepartment = new Map<string, { id: string; name: string; email: string }[]>();
  for (const manager of managers) {
    const list = byDepartment.get(manager.department_id) ?? [];
    list.push({ id: manager.user_id, name: manager.name, email: manager.email });
    byDepartment.set(manager.department_id, list);
  }

  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      isPurchasing: Number(row.is_purchasing) === 1,
      isActive: Number(row.is_active) === 1,
      notes: row.notes ? String(row.notes) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      managers: byDepartment.get(String(row.id)) ?? [],
    })),
  });
});

router.post("/departments", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const body = await parseBody(c, departmentBody);
  const duplicate = await oneRow<{ id: string }>(
    c.env.DB,
    `SELECT id FROM departments WHERE code = ? COLLATE NOCASE`,
    [body.code],
  );
  if (duplicate) throw conflict("Já existe um setor com este código.");

  const id = uuid();
  const ts = nowIso();
  await c.env.DB.batch([
    insertStatement(c.env.DB, "departments", {
      id,
      code: body.code,
      name: body.name,
      is_purchasing: body.isPurchasing ? 1 : 0,
      is_active: body.isActive ? 1 : 0,
      notes: body.notes ?? null,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "department.create",
      entityType: "department",
      entityId: id,
      after: body,
      ...clientInfo(c),
    }),
  ]);
  return c.json({ id }, 201);
});

router.patch("/departments/:id", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, departmentBody.partial());
  const before = await oneRow<Record<string, unknown>>(c.env.DB, `SELECT * FROM departments WHERE id = ?`, [id]);
  if (!before) throw notFound("Setor não encontrado.");

  if (body.code) {
    const duplicate = await oneRow<{ id: string }>(
      c.env.DB,
      `SELECT id FROM departments WHERE code = ? COLLATE NOCASE AND id <> ?`,
      [body.code, id],
    );
    if (duplicate) throw conflict("Já existe um setor com este código.");
  }

  const updated = {
    ...(body.code !== undefined ? { code: body.code } : {}),
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.isPurchasing !== undefined ? { is_purchasing: body.isPurchasing ? 1 : 0 } : {}),
    ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    updated_at: nowIso(),
  };
  await c.env.DB.batch([
    updateStatement(c.env.DB, "departments", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "department.update",
      entityType: "department",
      entityId: id,
      before,
      after: updated,
      ...clientInfo(c),
    }),
  ]);
  return c.json({ ok: true });
});

router.put("/departments/:id/managers", requirePermission(PERMISSIONS.USERS_MANAGE), async (c) => {
  const actor = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, departmentManagersBody);
  const department = await oneRow<{ id: string; name: string }>(
    c.env.DB,
    `SELECT id, name FROM departments WHERE id = ?`,
    [id],
  );
  if (!department) throw notFound("Setor não encontrado.");

  const unique = [...new Set(body.userIds)];
  if (unique.length > 0) {
    const found = await allRows<{ id: string }>(
      c.env.DB,
      `SELECT id FROM users WHERE is_active = 1 AND id IN (${unique.map(() => "?").join(",")})`,
      unique,
    );
    if (found.length !== unique.length) throw badRequest("Um ou mais gestores informados não estão ativos.");
  }

  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM department_managers WHERE department_id = ?`).bind(id),
    ...unique.map((userId) =>
      c.env.DB
        .prepare(`INSERT INTO department_managers (department_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(id, userId, ts),
    ),
    auditStatement(c.env.DB, {
      actor: { id: actor.id, name: actor.name },
      module: "users",
      action: "department.managers_update",
      entityType: "department",
      entityId: id,
      after: { department: department.name, userIds: unique },
      ...clientInfo(c),
    }),
  ]);
  return c.json({ ok: true, userIds: unique });
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
  // Só altera perfis cujas permissões o ator já possui (não dá para desativar
  // ou renomear um perfil mais poderoso e contornar a matriz).
  await assertRoleWithinAuthority(c.env.DB, user, id);

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
         d.name AS department_name, d.is_purchasing AS department_is_purchasing,
         (SELECT COUNT(*) FROM user_location_scopes s WHERE s.user_id = u.id) AS scope_count
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN units un ON un.id = u.unit_id
    LEFT JOIN departments d ON d.id = u.department_id`;

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

  const managed = ids.length
    ? await allRows<{ user_id: string; department_id: string }>(
        c.env.DB,
        `SELECT user_id, department_id FROM department_managers
          WHERE user_id IN (${ids.map(() => "?").join(",")})`,
        ids,
      )
    : [];
  const managedByUser = new Map<string, string[]>();
  for (const item of managed) {
    const list = managedByUser.get(item.user_id) ?? [];
    list.push(item.department_id);
    managedByUser.set(item.user_id, list);
  }

  return c.json({
    items: rows.map((r) => ({
      ...mapUser(r),
      locationScope: scopeByUser.get(String(r.id)) ?? [],
      managedDepartmentIds: managedByUser.get(String(r.id)) ?? [],
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
  const managed = await allRows<{ department_id: string }>(
    c.env.DB,
    `SELECT department_id FROM department_managers WHERE user_id = ?`,
    [String(row.id)],
  );
  return c.json({
    user: {
      ...mapUser(row),
      locationScope: scope.map((s) => ({ id: s.location_id, path: s.path })),
      managedDepartmentIds: managed.map((item) => item.department_id),
    },
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
  if (body.departmentId) await assertDepartmentActive(c.env.DB, body.departmentId);
  const managedDepartmentIds = await assertDepartmentsActive(c.env.DB, body.managedDepartmentIds ?? []);

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
      department_id: body.departmentId ?? null,
      employee_code: body.employeeCode ?? null,
      phone: body.phone ?? null,
      job_title: body.jobTitle ?? null,
      notes: body.notes ?? null,
      is_active: 1,
      must_change_password: temporary || body.mustChangePassword ? 1 : 0,
      created_at: ts,
      updated_at: ts,
    }),
    ...managedDepartmentIds.map((departmentId) =>
      c.env.DB
        .prepare(`INSERT INTO department_managers (department_id, user_id, created_at) VALUES (?, ?, ?)`)
        .bind(departmentId, id, ts),
    ),
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

  // O ator só mexe em contas cujo perfil atual ele já poderia atribuir. Sem
  // isso, um gestor conseguiria trocar o e-mail/senha de um administrador.
  await assertRoleWithinAuthority(c.env.DB, actor, String(before.role_id));

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
  if (body.departmentId) await assertDepartmentActive(c.env.DB, body.departmentId);
  const managedDepartmentIds =
    body.managedDepartmentIds !== undefined
      ? await assertDepartmentsActive(c.env.DB, body.managedDepartmentIds)
      : null;

  const ts = nowIso();
  const updated = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.roleId !== undefined ? { role_id: body.roleId } : {}),
    ...(body.unitId !== undefined ? { unit_id: body.unitId ?? null } : {}),
    ...(body.departmentId !== undefined ? { department_id: body.departmentId ?? null } : {}),
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
    ...(managedDepartmentIds !== null
      ? [
          c.env.DB.prepare(`DELETE FROM department_managers WHERE user_id = ?`).bind(id),
          ...managedDepartmentIds.map((departmentId) =>
            c.env.DB
              .prepare(`INSERT INTO department_managers (department_id, user_id, created_at) VALUES (?, ?, ?)`)
              .bind(departmentId, id, ts),
          ),
        ]
      : []),
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

  const target = await oneRow<{ id: string; role_id: string }>(
    c.env.DB,
    `SELECT id, role_id FROM users WHERE id = ?`,
    [id],
  );
  if (!target) throw notFound("Usuário não encontrado.");
  // Um gestor não altera o escopo de uma conta com perfil acima do dele.
  await assertRoleWithinAuthority(c.env.DB, actor, target.role_id);

  const unique = [...new Set(body.locationIds)];
  // Lista vazia significa "sem restrição": um ator restrito não pode usar isso
  // para se livrar do próprio escopo (nem para ampliar o de outra conta).
  if (actor.locationScope.length > 0 && unique.length === 0) {
    throw forbidden(
      "Você não pode remover todo o escopo de locais. Selecione ao menos um local dentro do seu escopo.",
    );
  }
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

async function assertDepartmentActive(db: D1Database, departmentId: string): Promise<void> {
  const department = await oneRow<{ id: string; is_active: number }>(
    db,
    `SELECT id, is_active FROM departments WHERE id = ?`,
    [departmentId],
  );
  if (!department) throw notFound("Setor não encontrado.");
  if (department.is_active !== 1) throw badRequest("O setor informado está inativo.");
}

async function assertDepartmentsActive(db: D1Database, departmentIds: string[]): Promise<string[]> {
  const unique = [...new Set(departmentIds)];
  if (unique.length === 0) return unique;
  const found = await allRows<{ id: string }>(
    db,
    `SELECT id FROM departments WHERE is_active = 1 AND id IN (${unique.map(() => "?").join(",")})`,
    unique,
  );
  if (found.length !== unique.length) throw badRequest("Um ou mais setores informados não estão ativos.");
  return unique;
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
    departmentId: row.department_id ? String(row.department_id) : null,
    departmentName: row.department_name ? String(row.department_name) : null,
    departmentIsPurchasing: Number(row.department_is_purchasing) === 1,
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
