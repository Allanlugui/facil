import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  ADMIN_PASSWORD,
  Api,
  DEFAULT_PASSWORD,
  countRows,
  createUser,
  expectError,
  findRoleId,
  login,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
} from "./helpers";

/**
 * Cenário 25 da especificação: "usuário sem permissão não consegue executar a
 * ação mesmo chamando a API direto".
 *
 * A autorização e verificada no backend, com permissão lida do banco -- ocultar
 * botão no frontend não e tratado como controle de acesso.
 */
describe("autenticação, sessões e autorização", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
  });

  it("cria o primeiro administrador pelo setup e recusa um segundo setup", async () => {
    const me = await admin.api.get<{ user: { email: string; permissions: string[] } }>("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(admin.email);
    expect(me.body.user.permissions.length).toBe(48);

    const other = new Api();
    const second = await other.post("/api/auth/setup", {
      companyName: "Outra Empresa",
      name: "Outro Admin",
      email: "outro@facil.test",
      password: ADMIN_PASSWORD,
    });
    expectError(second, "CONFLICT");
    expect(await countRows("SELECT COUNT(*) AS total FROM users")).toBe(1);
  });

  it("exige sessão em rotas protegidas e rejeita cookie inválido", async () => {
    const anonymous = new Api();
    const noCookie = await anonymous.get("/api/stock/");
    expect(noCookie.status).toBe(401);

    const forged = await anonymous.request("GET", "/api/stock/", {
      headers: { cookie: "facil_session=token-invalido-000000" },
    });
    expect(forged.status).toBe(401);
  });

  it("bloqueia ação sem permissão mesmo chamando a API direto", async () => {
    // Recepcionista não tem nenhuma permissão de estoque nem users.manage.
    const receptionRole = await findRoleId("receptionist");
    const receptionist = await createUser(admin, {
      name: "Recepção",
      email: "recepcao@facil.test",
      roleId: receptionRole,
    });

    const issueAttempt = await receptionist.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "tentativa-issue-001",
      fromLocationId: "qualquer",
      items: [{ productId: "qualquer", qty: 1 }],
    });
    expectError(issueAttempt, "FORBIDDEN");

    // Nem reposição (stock.replenish) nem leitura do módulo: o controle de
    // estoque é dos perfis responsáveis (admin, gerente e estoquista).
    const replenishAttempt = await receptionist.api.post("/api/stock/movements", {
      type: "replenish",
      requestKey: "tentativa-reposicao-001",
      fromLocationId: "qualquer",
      toLocationId: "qualquer",
      items: [{ productId: "qualquer", qty: 1 }],
    });
    expectError(replenishAttempt, "FORBIDDEN");
    expectError(await receptionist.api.get("/api/stock"), "FORBIDDEN");

    const userList = await receptionist.api.get("/api/users/users");
    expectError(userList, "FORBIDDEN");

    const auditAttempt = await receptionist.api.get("/api/audit/");
    expectError(auditAttempt, "FORBIDDEN");

    // A negação fica registrada: o backend sabe quem tentou o que.
    expect(await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'permission_denied'")).toBeGreaterThan(0);
  });

  it("não permite que o usuário conceda permissão que ele próprio não possui", async () => {
    // Gerente de estoque tem users.view mas NÃO tem users.permissions.
    const stockRole = await findRoleId("stock_keeper");
    const keeper = await createUser(admin, {
      name: "Estoquista",
      email: "estoque@facil.test",
      roleId: stockRole,
    });

    const attempt = await keeper.api.post("/api/users/roles", {
      name: "Papel Criado por Estoquista",
      code: "papel_estoquista",
    });
    expectError(attempt, "FORBIDDEN");

    // Administrador com users.permissions cria papel e define permissões.
    const created = await admin.api.post<{ id: string }>("/api/users/roles", {
      name: "Conferente",
      code: "conferente",
      description: "Somente leitura de estoque",
    });
    expect(created.status).toBe(201);

    const granted = await admin.api.put(`/api/users/roles/${created.body.id}/permissions`, {
      permissions: ["stock.view", "dashboard.view"],
    });
    expect(granted.status).toBe(200);

    const roles = await admin.api.get<{ items: { id: string; permissions: string[] }[] }>("/api/users/roles");
    const role = roles.body.items.find((item) => item.id === created.body.id);
    expect(role?.permissions.sort()).toEqual(["dashboard.view", "stock.view"]);

    // O estoquista também não pode alterar permissões de um papel existente.
    const escalation = await keeper.api.put(`/api/users/roles/${created.body.id}/permissions`, {
      permissions: ["stock.view", "purchases.approve"],
    });
    expectError(escalation, "FORBIDDEN");
  });

  it("não permite conceder permissão que o próprio ator não possui", async () => {
    // Papel de teste com users.permissions mas sem purchases.approve.
    const custom = await admin.api.post<{ id: string }>("/api/users/roles", {
      name: "Gestor Parcial",
      code: "gestor_parcial",
    });
    expect(custom.status).toBe(201);

    const grantsOwnPermissions = await admin.api.put(`/api/users/roles/${custom.body.id}/permissions`, {
      permissions: ["users.view", "users.manage", "users.permissions", "dashboard.view"],
    });
    expect(grantsOwnPermissions.status).toBe(200);

    const partial = await createUser(admin, {
      name: "Gestor Parcial",
      email: "gestor.parcial@facil.test",
      roleId: custom.body.id,
    });

    const escalates = await partial.api.put(`/api/users/roles/${custom.body.id}/permissions`, {
      permissions: ["users.view", "users.manage", "users.permissions", "dashboard.view", "purchases.approve"],
    });
    expectError(escalates, "FORBIDDEN");

    const revokesOutside = await partial.api.put(`/api/users/roles/${custom.body.id}/permissions`, {
      permissions: ["users.view"],
    });
    // O papel tinha usuários.manage/permissions (que ele possui) e dashboard.view
    // (que ele possui): revogar o que possui é permitido, então a operação passa.
    expect(revokesOutside.status).toBe(200);
  });

  it("impede alterar o próprio papel e desativar a própria conta", async () => {
    const managerRole = await findRoleId("facilities_manager");

    const selfRoleChange = await admin.api.patch(`/api/users/users/${admin.id}`, { roleId: managerRole });
    expectError(selfRoleChange, "FORBIDDEN");

    const selfDeactivate = await admin.api.patch(`/api/users/users/${admin.id}`, { isActive: false });
    expectError(selfDeactivate, "FORBIDDEN");

    const stillAdmin = await queryOne<{ role_id: string; is_active: number }>(
      "SELECT role_id, is_active FROM users WHERE id = ?",
      [admin.id],
    );
    expect(stillAdmin?.role_id).toBe("role_admin");
    expect(stillAdmin?.is_active).toBe(1);
  });

  it("impede rebaixar ou desativar o último administrador ativo", async () => {
    const managerRole = await findRoleId("facilities_manager");

    // Papel alternativo com o MESMO conjunto de permissões do administrador:
    // assim o ator tem alcada para tentar rebaixar o admin e o bloqueio testado
    // e o da regra "último administrador ativo", não o de alcada.
    const custom = await admin.api.post<{ id: string }>("/api/users/roles", {
      name: "Supervisor Geral",
      code: "supervisor_geral",
    });
    expect(custom.status).toBe(201);
    await env.DB.prepare(
      `INSERT INTO role_permissions (role_id, permission_code)
       SELECT ?, permission_code FROM role_permissions WHERE role_id = 'role_admin'`,
    )
      .bind(custom.body.id)
      .run();

    const supervisor = await createUser(admin, {
      name: "Supervisor",
      email: "supervisor@facil.test",
      roleId: custom.body.id,
    });

    const demote = await supervisor.api.patch(`/api/users/users/${admin.id}`, { roleId: managerRole });
    expectError(demote, "CONFLICT");

    const deactivate = await supervisor.api.patch(`/api/users/users/${admin.id}`, { isActive: false });
    expectError(deactivate, "CONFLICT");

    const stillAdmin = await queryOne<{ role_id: string; is_active: number }>(
      "SELECT role_id, is_active FROM users WHERE id = ?",
      [admin.id],
    );
    expect(stillAdmin?.role_id).toBe("role_admin");
    expect(stillAdmin?.is_active).toBe(1);
  });

  it("registra alteração de permissão de papel na auditoria", async () => {
    const stockRole = await findRoleId("stock_keeper");

    const before = await queryOne<{ perms: number }>(
      "SELECT COUNT(*) AS perms FROM role_permissions WHERE role_id = ?",
      [stockRole],
    );

    const update = await admin.api.put(`/api/users/roles/${stockRole}/permissions`, {
      permissions: ["stock.view", "stock.issue", "dashboard.view"],
    });
    expect(update.status).toBe(200);

    const after = await queryOne<{ perms: number }>(
      "SELECT COUNT(*) AS perms FROM role_permissions WHERE role_id = ?",
      [stockRole],
    );
    expect(after?.perms).toBe(3);
    expect(after?.perms).not.toBe(before?.perms);

    const audit = await queryOne<{ before_json: string; after_json: string }>(
      `SELECT before_json, after_json FROM audit_log
        WHERE module = 'users' AND action = 'role.permissions_update' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(audit).not.toBeNull();
    const afterJson = JSON.parse(audit!.after_json) as { permissions?: string[] };
    expect(afterJson.permissions).toContain("stock.issue");
  });

  it("limita tentativas de login inválidas", async () => {
    const attacker = new Api();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await attacker.post("/api/auth/login", {
        email: admin.email,
        password: "SenhaErrada#2026",
      });
      expect(response.status).toBe(401);
    }

    const blocked = await attacker.post("/api/auth/login", {
      email: admin.email,
      password: ADMIN_PASSWORD,
    });
    expectError(blocked, "TOO_MANY_ATTEMPTS");

    const failures = await countRows(
      `SELECT COUNT(*) AS total FROM audit_log
        WHERE module = 'auth' AND action = 'login_failed' AND entity_id = ?`,
      [admin.email],
    );
    expect(failures).toBe(10);
  });

  it("exige troca de senha antes de liberar as demais rotas", async () => {
    const requesterRole = await findRoleId("requester");
    const created = await admin.api.post<{ id: string }>("/api/users/users", {
      name: "Novo Colaborador",
      email: "novo@facil.test",
      roleId: requesterRole,
      password: "TrocarSenha#2026",
      mustChangePassword: true,
    });
    expect(created.status).toBe(201);

    const api = await login("novo@facil.test", "TrocarSenha#2026");
    const blocked = await api.get("/api/tickets/");
    expectError(blocked, "PASSWORD_CHANGE_REQUIRED");

    const weakChange = await api.post("/api/auth/change-password", {
      currentPassword: "TrocarSenha#2026",
      newPassword: "novoColaborador#2026",
    });
    expectError(weakChange, "BAD_REQUEST");

    const changed = await api.post("/api/auth/change-password", {
      currentPassword: "TrocarSenha#2026",
      newPassword: "MinhaSenhaForte#2026",
    });
    expect(changed.status).toBe(200);

    const nowAllowed = await api.get("/api/tickets/");
    expect(nowAllowed.status).toBe(200);

    const stored = await queryOne<{ must_change_password: number; password_iterations: number }>(
      "SELECT must_change_password, password_iterations FROM users WHERE id = ?",
      [created.body.id],
    );
    expect(stored?.must_change_password).toBe(0);
    expect(stored?.password_iterations).toBeGreaterThanOrEqual(100_000);
  });

  it("inválida todas as sessões ao trocar a senha", async () => {
    const requesterRole = await findRoleId("requester");
    await createUser(admin, {
      name: "Solicitante",
      email: "solicitante@facil.test",
      roleId: requesterRole,
    });

    const sessionA = await login("solicitante@facil.test", DEFAULT_PASSWORD);
    const sessionB = await login("solicitante@facil.test", DEFAULT_PASSWORD);

    const changed = await sessionA.post("/api/auth/change-password", {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: "NovaSenhaForte#2026",
    });
    expect(changed.status).toBe(200);

    const stillValid = await sessionB.get("/api/auth/me");
    expect(stillValid.status).toBe(401);

    const newSession = await sessionA.get("/api/auth/me");
    expect(newSession.status).toBe(200);

    const sessions = await countRows("SELECT COUNT(*) AS total FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)", [
      "solicitante@facil.test",
    ]);
    expect(sessions).toBe(1);
  });

  it("encerra a sessão no logout", async () => {
    const api = await login(admin.email, ADMIN_PASSWORD);
    expect((await api.get("/api/auth/me")).status).toBe(200);

    const logout = await api.post("/api/auth/logout");
    expect(logout.status).toBe(200);

    expect((await api.get("/api/auth/me")).status).toBe(401);
    // Sobra apenas a sessão criada pelo setup deste teste.
    expect(await countRows("SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?", [admin.id])).toBe(1);
  });

  it("não aceita usuário inativo nem senha fraca ou derivada do e-mail", async () => {
    const requesterRole = await findRoleId("requester");
    const created = await admin.api.post<{ id: string }>("/api/users/users", {
      name: "Inativo",
      email: "inativo@facil.test",
      roleId: requesterRole,
      password: "SenhaValida#2026",
      mustChangePassword: false,
    });
    expect(created.status).toBe(201);

    const deactivated = await admin.api.patch(`/api/users/users/${created.body.id}`, { isActive: false });
    expect(deactivated.status).toBe(200);

    const blocked = await new Api().post("/api/auth/login", {
      email: "inativo@facil.test",
      password: "SenhaValida#2026",
    });
    expect(blocked.status).toBe(401);

    const weak = await admin.api.post("/api/users/users", {
      name: "Senha Fraca",
      email: "fraco@facil.test",
      roleId: requesterRole,
      password: "fraca",
      mustChangePassword: false,
    });
    expectError(weak, "VALIDATION_ERROR");

    const equalsEmail = await admin.api.post("/api/users/users", {
      name: "Senha Igual",
      email: "emailigual@facil.test",
      roleId: requesterRole,
      password: "emailigual@facil.test",
      mustChangePassword: false,
    });
    expectError(equalsEmail, "BAD_REQUEST");
  });
});
