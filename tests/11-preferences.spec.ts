import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEME_IDS } from "@shared/themes";
import {
  Api,
  assert,
  createUser,
  expectError,
  findRoleId,
  login,
  queryAll,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
} from "./helpers";

/**
 * Aparência (F-18): tema padrão do sistema e preferência de cada usuário.
 *
 * - `settings['ui.theme']` → tema padrão da instalação (escolhido pelo admin);
 * - `users.theme`          → escolha pessoal; NULL = seguir o sistema.
 *
 * O visual em si mora no CSS; aqui validamos catálogo, validação, sessão,
 * herança (usuário sem escolha segue o sistema) e auditoria.
 */
describe("aparência: tema do sistema e preferência do usuário", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
  });

  afterEach(async () => {
    const restored = await admin.api.patch("/api/settings", { values: { "ui.theme": "classico" } });
    assert(restored.status === 200, `Não foi possível restaurar o tema: ${restored.status}`);
  });

  it("catálogo expõe ui.theme com seção, opções e toda entrada tem seção", async () => {
    type Item = {
      key: string;
      value: string;
      definition: { type: string; options?: string[]; section: string } | null;
    };
    const list = await admin.api.get<{ items: Item[] }>("/api/settings");
    expect(list.status).toBe(200);

    const item = list.body.items.find((entry) => entry.key === "ui.theme");
    assert(item, "ui.theme no catálogo");
    expect(item.value).toBe("classico");
    expect(item.definition?.type).toBe("enum");
    expect(item.definition?.section).toBe("aparencia");
    expect(item.definition?.options).toEqual([...THEME_IDS]);

    // Nenhuma configuração pode ficar sem seção: sem isso ela desapareceria da tela.
    expect(
      list.body.items.every((entry) => (entry.definition?.section ?? "").length > 0),
    ).toBe(true);

    const invalid = await admin.api.patch("/api/settings", { values: { "ui.theme": "neon" } });
    expectError(invalid, "BAD_REQUEST");

    const valid = await admin.api.patch("/api/settings", { values: { "ui.theme": "escuro" } });
    expect(valid.status).toBe(200);

    // Páginas públicas (sem sessão) também seguem o tema padrão do sistema.
    const publicInfo = await new Api().get<{ needsSetup: boolean; theme: string }>(
      "/api/auth/setup-status",
    );
    expect(publicInfo.body.needsSetup).toBe(false);
    expect(publicInfo.body.theme).toBe("escuro");

    const me = await admin.api.get<{ app: { theme: string } }>("/api/auth/me");
    expect(me.body.app.theme).toBe("escuro");
  });

  it("preferência pessoal grava, persiste entre sessões, limpa e fica auditada", async () => {
    // Todos os temas declarados são aceitos.
    for (const theme of THEME_IDS) {
      const response = await admin.api.patch("/api/auth/preferences", { theme });
      expect(response.status).toBe(200);
      const me = await admin.api.get<{ user: { theme: string | null } }>("/api/auth/me");
      expect(me.body.user.theme).toBe(theme);
    }

    // A escolha vive no banco: uma sessão nova (outro login) continua com ela.
    const again = await login(admin.email, admin.password);
    const afterLogin = await again.get<{ user: { theme: string | null } }>("/api/auth/me");
    expect(afterLogin.body.user.theme).toBe("ambar");

    // Tema inventado é recusado e não altera o que estava gravado.
    const invalid = await admin.api.patch("/api/auth/preferences", { theme: "neon" });
    expectError(invalid, "VALIDATION_ERROR");
    const stored = await queryOne<{ theme: string | null }>("SELECT theme FROM users WHERE id = ?", [
      admin.id,
    ]);
    expect(stored?.theme).toBe("ambar");

    // Sem sessão a rota nem responde.
    const anonymous = await new Api().patch("/api/auth/preferences", { theme: "escuro" });
    expect(anonymous.status).toBe(401);

    // `null` volta a seguir o sistema.
    const cleared = await admin.api.patch("/api/auth/preferences", { theme: null });
    expect(cleared.status).toBe(200);
    const afterClear = await admin.api.get<{ user: { theme: string | null } }>("/api/auth/me");
    expect(afterClear.body.user.theme).toBeNull();

    // Cada troca fica na auditoria com anterior e novo.
    const audit = await queryAll<{ module: string; before_json: string; after_json: string }>(
      "SELECT module, before_json, after_json FROM audit_log WHERE action = 'theme_update' AND entity_id = ? ORDER BY created_at",
      [admin.id],
    );
    expect(audit.length).toBe(THEME_IDS.length + 1);
    expect(audit.every((row) => row.module === "profile")).toBe(true);
    const afters = audit.map((row) => (JSON.parse(row.after_json) as { theme: string | null }).theme);
    expect(afters).toEqual([...THEME_IDS, null]);
    const befores = audit.map(
      (row) => (JSON.parse(row.before_json) as { theme: string | null }).theme,
    );
    expect(befores).toEqual([null, ...THEME_IDS]);
  });

  it("usuário sem escolha segue o sistema; com escolha, mantém a dele", async () => {
    const roleId = await findRoleId("facilities_manager");
    const follower = await createUser(admin, {
      name: "Segue Sistema",
      email: "segue@facil.test",
      roleId,
    });
    const owner = await createUser(admin, {
      name: "Tema Próprio",
      email: "proprio@facil.test",
      roleId,
    });

    const before = await follower.api.get<{ user: { theme: string | null }; app: { theme: string } }>(
      "/api/auth/me",
    );
    expect(before.body.user.theme).toBeNull();
    expect(before.body.app.theme).toBe("classico");

    // Qualquer usuário autenticado troca o próprio tema, sem permissão especial.
    const chosen = await owner.api.patch("/api/auth/preferences", { theme: "violeta" });
    expect(chosen.status).toBe(200);

    // O admin muda o padrão do sistema.
    const system = await admin.api.patch("/api/settings", { values: { "ui.theme": "escuro" } });
    expect(system.status).toBe(200);

    const followerAfter = await follower.api.get<{ user: { theme: string | null }; app: { theme: string } }>(
      "/api/auth/me",
    );
    expect(followerAfter.body.user.theme).toBeNull();
    expect(followerAfter.body.app.theme).toBe("escuro");

    const ownerAfter = await owner.api.get<{ user: { theme: string | null }; app: { theme: string } }>(
      "/api/auth/me",
    );
    expect(ownerAfter.body.user.theme).toBe("violeta");
    expect(ownerAfter.body.app.theme).toBe("escuro");
  });
});
