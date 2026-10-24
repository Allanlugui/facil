import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createStructure,
  createUser,
  expectError,
  findRoleId,
  login,
  queryAll,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Patrimônio: cadastro, movimentações, escopo de local e categorias.
 *
 * O foco é o que não pode regredir: o ativo nunca é apagado, toda mudança
 * operacional deixa histórico, o escopo de local vale para leitura e destino,
 * e baixa/descarte exigem `assets.manage` (não apenas `assets.move`).
 */
describe("22: patrimônio", () => {
  let admin: Actor;
  let structure: Structure;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
  });

  async function createAsset(overrides: Record<string, unknown> = {}) {
    const response = await admin.api.post<{ id: string; code: string }>("/api/assets", {
      name: "Notebook Dell Latitude",
      categoryId: "ac_it",
      locationId: structure.roomId,
      acquisitionValueCents: 450_000,
      serialNumber: "SN-123",
      ...overrides,
    });
    expect(response.status).toBe(201);
    return response.body;
  }

  it("cadastra o ativo com código gerado e movimentação de aquisição", async () => {
    const created = await createAsset({ tag: "PAT-ETQ-001" });
    expect(created.code).toMatch(/^PAT-\d{4}-000001$/);

    const detail = await admin.api.get<{
      asset: {
        id: string;
        code: string;
        status: string;
        condition: string;
        categoryName: string;
        locationName: string;
        acquisitionValueCents: number;
      };
      movements: Array<{ type: string; toStatus: string | null; toLocationId: string | null }>;
    }>(`/api/assets/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.asset.status).toBe("in_use");
    expect(detail.body.asset.condition).toBe("good");
    expect(detail.body.asset.categoryName).toBe("Tecnologia");
    expect(detail.body.asset.locationName).toBe("Sala 101");
    expect(detail.body.asset.acquisitionValueCents).toBe(450_000);
    expect(detail.body.movements).toHaveLength(1);
    expect(detail.body.movements[0]).toMatchObject({
      type: "acquisition",
      toStatus: "in_use",
      toLocationId: structure.roomId,
    });

    const list = await admin.api.get<{ items: Array<{ id: string; code: string }>; total: number }>(
      `/api/assets?search=${encodeURIComponent(created.code)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]?.id).toBe(created.id);

    const audit = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM audit_log WHERE module = 'assets' AND action = 'create' AND entity_id = ?`,
      [created.id],
    );
    expect(audit?.total).toBe(1);
  });

  it("recusa etiqueta duplicada e referências inválidas", async () => {
    await createAsset({ tag: "PAT-ETQ-002" });
    const duplicated = await admin.api.post("/api/assets", {
      name: "Outro notebook",
      categoryId: "ac_it",
      locationId: structure.roomId,
      tag: "PAT-ETQ-002",
    });
    expectError(duplicated, "CONFLICT");

    const invalidCategory = await admin.api.post("/api/assets", {
      name: "Ativo sem categoria",
      categoryId: "nao-existe",
      locationId: structure.roomId,
    });
    expectError(invalidCategory, "BAD_REQUEST");

    const terminal = await admin.api.post("/api/assets", {
      name: "Ativo já baixado",
      categoryId: "ac_it",
      locationId: structure.roomId,
      status: "retired",
    });
    expectError(terminal, "BAD_REQUEST");
  });

  it("controla permissões: visão não cria, operação move, baixa exige gestão", async () => {
    const created = await createAsset();

    const techRole = await findRoleId("maintenance_tech");
    const tech = await createUser(admin, {
      name: "Técnico de patrimônio",
      email: "tecnico.patrimonio@facil.test",
      roleId: techRole,
    });

    const list = await tech.api.get("/api/assets");
    expect(list.status).toBe(200);

    const createDenied = await tech.api.post("/api/assets", {
      name: "Ativo do técnico",
      categoryId: "ac_it",
      locationId: structure.roomId,
    });
    expectError(createDenied, "FORBIDDEN");

    const moveDenied = await tech.api.post(`/api/assets/${created.id}/transfer`, {
      toLocationId: structure.warehouseId,
    });
    expectError(moveDenied, "FORBIDDEN");

    // Concede apenas `assets.move` e reabre a sessão para refletir a permissão.
    await env.DB.prepare(
      `INSERT INTO role_permissions (role_id, permission_code) VALUES (?, 'assets.move')`,
    )
      .bind(techRole)
      .run();
    const mover = await login(tech.email, tech.password);

    const transfer = await mover.post(`/api/assets/${created.id}/transfer`, {
      toLocationId: structure.warehouseId,
      reason: "Mudança de sala",
    });
    expect(transfer.status).toBe(200);

    const retireDenied = await mover.post(`/api/assets/${created.id}/status`, {
      status: "retired",
      reason: "Fim da vida útil",
    });
    expectError(retireDenied, "FORBIDDEN");

    const retired = await admin.api.post(`/api/assets/${created.id}/status`, {
      status: "retired",
      reason: "Fim da vida útil",
    });
    expect(retired.status).toBe(200);

    await env.DB.prepare(
      `DELETE FROM role_permissions WHERE role_id = ? AND permission_code = 'assets.move'`,
    )
      .bind(techRole)
      .run();
  });

  it("transferência grava histórico e respeita o escopo de local", async () => {
    const created = await createAsset();

    const transfer = await admin.api.post(`/api/assets/${created.id}/transfer`, {
      toLocationId: structure.warehouseId,
      reason: "Enviado para o almoxarifado",
    });
    expect(transfer.status).toBe(200);

    const detail = await admin.api.get<{
      asset: { locationId: string; locationName: string };
      movements: Array<{ type: string; fromLocationId: string | null; toLocationId: string | null }>;
    }>(`/api/assets/${created.id}`);
    expect(detail.body.asset.locationId).toBe(structure.warehouseId);
    expect(detail.body.asset.locationName).toBe("Almoxarifado");
    expect(detail.body.movements[0]).toMatchObject({
      type: "transfer",
      fromLocationId: structure.roomId,
      toLocationId: structure.warehouseId,
    });

    const manager = await createUser(admin, {
      name: "Gestor escopado",
      email: "gestor.patrimonio@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const scoped = await admin.api.put(`/api/users/users/${manager.id}/location-scopes`, {
      locationIds: [structure.roomId],
    });
    expect(scoped.status).toBe(200);

    const outside = await manager.api.get(`/api/assets/${created.id}`);
    expectError(outside, "FORBIDDEN");

    const scopedList = await manager.api.get<{ items: Array<{ id: string }> }>("/api/assets");
    expect(scopedList.status).toBe(200);
    expect(scopedList.body.items.some((item) => item.id === created.id)).toBe(false);

    // Mesmo com gestão, o destino fora do escopo é recusado.
    const outsideTransfer = await manager.api.post(`/api/assets/${created.id}/transfer`, {
      toLocationId: structure.roomId,
    });
    expectError(outsideTransfer, "FORBIDDEN");
  });

  it("atribui e remove responsável, muda condição e mantém o histórico", async () => {
    const created = await createAsset();
    const tech = await createUser(admin, {
      name: "Responsável pelo ativo",
      email: "responsavel.ativo@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });

    const assignment = await admin.api.post(`/api/assets/${created.id}/assignment`, {
      custodianUserId: tech.id,
      reason: "Entrega do equipamento",
    });
    expect(assignment.status).toBe(200);

    const condition = await admin.api.post(`/api/assets/${created.id}/condition`, {
      condition: "fair",
      reason: "Risco na tampa",
    });
    expect(condition.status).toBe(200);

    const detail = await admin.api.get<{
      asset: { custodianUserId: string | null; custodianName: string | null; condition: string };
      movements: Array<{ type: string; fromUserId: string | null; toUserId: string | null }>;
    }>(`/api/assets/${created.id}`);
    expect(detail.body.asset.custodianUserId).toBe(tech.id);
    expect(detail.body.asset.custodianName).toBe("Responsável pelo ativo");
    expect(detail.body.asset.condition).toBe("fair");
    expect(detail.body.movements.map((movement) => movement.type)).toEqual([
      "condition_change",
      "assignment",
      "acquisition",
    ]);
    expect(detail.body.movements[1]).toMatchObject({ fromUserId: null, toUserId: tech.id });

    const release = await admin.api.post(`/api/assets/${created.id}/assignment`, {
      custodianUserId: null,
      reason: "Devolução ao almoxarifado",
    });
    expect(release.status).toBe(200);
    const after = await admin.api.get<{ asset: { custodianUserId: string | null } }>(
      `/api/assets/${created.id}`,
    );
    expect(after.body.asset.custodianUserId).toBeNull();
  });

  it("registra manutenção e conferência de inventário", async () => {
    const created = await createAsset();

    const maintenance = await admin.api.post(`/api/assets/${created.id}/maintenance`, {
      reason: "Troca da fonte",
      status: "maintenance",
    });
    expect(maintenance.status).toBe(200);

    const inventory = await admin.api.post(`/api/assets/${created.id}/inventory`, {
      locationId: structure.warehouseId,
      condition: "good",
      reason: "Conferência mensal",
    });
    expect(inventory.status).toBe(200);

    const detail = await admin.api.get<{
      asset: { status: string; condition: string; locationId: string };
      movements: Array<{ type: string; fromStatus: string | null; toStatus: string | null }>;
    }>(`/api/assets/${created.id}`);
    expect(detail.body.asset.status).toBe("maintenance");
    expect(detail.body.asset.locationId).toBe(structure.warehouseId);
    expect(detail.body.movements[0]?.type).toBe("inventory");
    expect(detail.body.movements[1]?.type).toBe("maintenance");
    expect(detail.body.movements[1]).toMatchObject({
      fromStatus: "in_use",
      toStatus: "maintenance",
    });
  });

  it("baixa é terminal: preserva motivo e bloqueia novas movimentações", async () => {
    const created = await createAsset();

    const retired = await admin.api.post(`/api/assets/${created.id}/status`, {
      status: "retired",
      reason: "Equipamento sem conserto",
    });
    expect(retired.status).toBe(200);

    const detail = await admin.api.get<{
      asset: { status: string; retiredAt: string | null; retiredReason: string | null; retiredByName: string | null };
      movements: Array<{ type: string; fromStatus: string | null; toStatus: string | null; reason: string | null }>;
    }>(`/api/assets/${created.id}`);
    expect(detail.body.asset.status).toBe("retired");
    expect(detail.body.asset.retiredAt).toBeTruthy();
    expect(detail.body.asset.retiredReason).toBe("Equipamento sem conserto");
    expect(detail.body.asset.retiredByName).toBe(admin.name);
    expect(detail.body.movements[0]).toMatchObject({
      type: "disposal",
      fromStatus: "in_use",
      toStatus: "retired",
      reason: "Equipamento sem conserto",
    });

    const transfer = await admin.api.post(`/api/assets/${created.id}/transfer`, {
      toLocationId: structure.warehouseId,
    });
    expectError(transfer, "CONFLICT");

    const again = await admin.api.post(`/api/assets/${created.id}/status`, {
      status: "in_use",
    });
    expectError(again, "CONFLICT");
  });

  it("gerencia categorias e integra a exclusão controlada", async () => {
    const createdCategory = await admin.api.post<{ id: string; code: string }>("/api/assets/categories", {
      code: "teste",
      name: "Categoria de teste",
      sortOrder: 5,
    });
    expect(createdCategory.status).toBe(201);
    expect(createdCategory.body.code).toBe("TESTE");

    const duplicate = await admin.api.post("/api/assets/categories", {
      code: "TESTE",
      name: "Duplicada",
    });
    expectError(duplicate, "CONFLICT");

    const updated = await admin.api.patch(`/api/assets/categories/${createdCategory.body.id}`, {
      name: "Categoria renomeada",
      isActive: false,
    });
    expect(updated.status).toBe(200);

    const categories = await admin.api.get<{
      items: Array<{ id: string; name: string; isActive: boolean }>;
    }>("/api/assets/categories");
    expect(categories.status).toBe(200);
    expect(categories.body.items.some((item) => item.id === createdCategory.body.id)).toBe(false);

    const allCategories = await admin.api.get<{ items: Array<{ id: string; name: string }> }>(
      "/api/assets/categories?includeInactive=1",
    );
    expect(allCategories.body.items.find((item) => item.id === createdCategory.body.id)?.name).toBe(
      "Categoria renomeada",
    );

    const entities = await admin.api.get<{ items: Array<{ key: string }> }>("/api/control/entities");
    expect(entities.body.items.map((item) => item.key)).toContain("asset_category");

    // Sem ativos: impacto é exclusão definitiva.
    const emptyImpact = await admin.api.get<{ mode: string }>(
      `/api/control/asset_category/${createdCategory.body.id}/impact`,
    );
    expect(emptyImpact.status).toBe(200);
    expect(emptyImpact.body.mode).toBe("delete");
    const deleted = await admin.api.post(`/api/control/asset_category/${createdCategory.body.id}/delete`, {});
    expect(deleted.status).toBe(200);

    // Com ativo: impacto é arquivamento e o histórico continua resolvendo o nome.
    const linkedCategory = await admin.api.post<{ id: string }>("/api/assets/categories", {
      code: "LINK",
      name: "Categoria vinculada",
    });
    const asset = await createAsset({ categoryId: linkedCategory.body.id });

    const linkedImpact = await admin.api.get<{ mode: string; totalReferences: number }>(
      `/api/control/asset_category/${linkedCategory.body.id}/impact`,
    );
    expect(linkedImpact.body.mode).toBe("archive");
    expect(linkedImpact.body.totalReferences).toBe(1);

    const archived = await admin.api.post<{ mode: string }>(
      `/api/control/asset_category/${linkedCategory.body.id}/delete`,
      { reason: "Categoria descontinuada" },
    );
    expect(archived.status).toBe(200);
    expect(archived.body.mode).toBe("archive");

    const detail = await admin.api.get<{ asset: { categoryName: string } }>(`/api/assets/${asset.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.asset.categoryName).toBe("Categoria vinculada");

    const tombstone = await queryOne<{ deleted_at: string | null; is_active: number }>(
      `SELECT deleted_at, is_active FROM asset_categories WHERE id = ?`,
      [linkedCategory.body.id],
    );
    expect(tombstone?.deleted_at).toBeTruthy();
    expect(tombstone?.is_active).toBe(0);
  });

  it("resume ativos por situação e categoria respeitando o escopo", async () => {
    const first = await createAsset({ name: "Ativo 1" });
    await createAsset({ name: "Ativo 2", categoryId: "ac_mob", acquisitionValueCents: 100_000 });
    await admin.api.post(`/api/assets/${first.id}/status`, {
      status: "disposed",
      reason: "Descarte ecológico",
    });

    const summary = await admin.api.get<{
      total: number;
      active: number;
      terminal: number;
      activeValueCents: number;
      byStatus: Array<{ status: string; total: number }>;
      byCategory: Array<{ id: string; total: number }>;
    }>("/api/assets/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.total).toBe(2);
    expect(summary.body.active).toBe(1);
    expect(summary.body.terminal).toBe(1);
    expect(summary.body.activeValueCents).toBe(100_000);
    expect(summary.body.byStatus.find((row) => row.status === "disposed")?.total).toBe(1);
    expect(summary.body.byCategory.find((row) => row.id === "ac_mob")?.total).toBe(1);

    const scopedUser = await createUser(admin, {
      name: "Usuário de outro local",
      email: "outro.local@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    await admin.api.put(`/api/users/users/${scopedUser.id}/location-scopes`, {
      locationIds: [structure.warehouseId],
    });

    const scopedSummary = await scopedUser.api.get<{ total: number; byCategory: Array<{ total: number }> }>(
      "/api/assets/summary",
    );
    expect(scopedSummary.status).toBe(200);
    expect(scopedSummary.body.total).toBe(0);
    expect(scopedSummary.body.byCategory.every((row) => row.total === 0)).toBe(true);
  });

  it("expõe opções para os seletores sem exigir permissões de outros módulos", async () => {
    const tech = await createUser(admin, {
      name: "Técnico consulta",
      email: "tecnico.consulta@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });

    const options = await tech.api.get<{
      categories: Array<{ id: string }>;
      locations: Array<{ id: string }>;
      departments: Array<{ id: string }>;
      users: Array<{ id: string }>;
      costCenters: Array<{ id: string }>;
      suppliers: Array<{ id: string }>;
    }>("/api/assets/options");
    expect(options.status).toBe(200);
    expect(options.body.categories.some((item) => item.id === "ac_it")).toBe(true);
    expect(options.body.locations.some((item) => item.id === structure.roomId)).toBe(true);
    expect(options.body.users.some((item) => item.id === tech.id)).toBe(true);

    const audit = await queryAll<{ action: string }>(
      `SELECT action FROM audit_log WHERE module = 'assets' ORDER BY created_at`,
    );
    expect(audit.length).toBe(0);
  });
});
