import { beforeEach, describe, expect, it } from "vitest";
import {
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  queryOne,
  resetDatabase,
  seedStock,
  setupAdmin,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Central de controle e devolucao ao solicitante.
 *
 * Cobre as duas garantias centrais:
 *  - exclusao nunca quebra historico: com referencia o cadastro e arquivado
 *    (tombstone), sem referencia e removido de verdade;
 *  - o gestor de Compras devolve a solicitacao, o solicitante ajusta e o
 *    reenvio volta direto para a fila do gestor.
 */
describe("controle do sistema e devolucao ao solicitante", () => {
  let admin: Actor;
  let structure: Structure;
  let productId: string;
  let requester: Actor;
  let buyer: Actor;
  let purchasing: Actor;

  const LIMPEZA = "dept_lim";
  const COMPRAS = "dept_compras";

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    productId = await createProduct(admin, { name: "Detergente", sku: "DET-01" });

    requester = await createUser(admin, {
      name: "Solicitante da limpeza",
      email: "solicitante.ctrl@facil.test",
      roleId: await findRoleId("cleaning_lead"),
      departmentId: LIMPEZA,
    });
    buyer = await createUser(admin, {
      name: "Comprador",
      email: "comprador.ctrl@facil.test",
      roleId: await findRoleId("buyer"),
      departmentId: COMPRAS,
    });
    purchasing = await createUser(admin, {
      name: "Gestor de compras",
      email: "gestor.ctrl@facil.test",
      roleId: await findRoleId("purchasing_manager"),
      departmentId: COMPRAS,
      managedDepartmentIds: [COMPRAS],
    });
  });

  async function createRequest(submit = true): Promise<{ id: string; itemId: string }> {
    const created = await requester.api.post<{ id: string; approvalStage: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      locationId: structure.warehouseId,
      justification: "Reposicao do setor de limpeza",
      priority: "normal",
      submit,
      items: [{ productId, qty: 10 }],
    });
    expect(created.status).toBe(201);
    const detail = await requester.api.get<{ items: Array<{ id: string }> }>(`/api/purchases/${created.body.id}`);
    expect(detail.status).toBe(200);
    return { id: created.body.id, itemId: detail.body.items[0]!.id };
  }

  it("permite criar outro administrador com acesso total e protege o ultimo admin", async () => {
    const second = await createUser(admin, {
      name: "Segundo administrador",
      email: "admin2@facil.test",
      roleId: await findRoleId("admin"),
    });

    const entities = await second.api.get<{ items: Array<{ key: string }> }>("/api/control/entities");
    expect(entities.status).toBe(200);
    expect(entities.body.items.map((item) => item.key)).toContain("location");
    expect(entities.body.items.map((item) => item.key)).toContain("user");

    // Excluir a propria conta e bloqueado.
    const self = await second.api.post(`/api/control/user/${second.id}/delete`, {});
    expectError(self, "CONFLICT");

    // Com dois admins, o primeiro pode ser arquivado...
    const archived = await admin.api.post<{ mode: string }>(`/api/control/user/${second.id}/delete`, {});
    expect(archived.status).toBe(200);
    expect(archived.body.mode).toBe("archive");
    const tombstone = await queryOne<{ deleted_at: string | null; is_active: number }>(
      "SELECT deleted_at, is_active FROM users WHERE id = ?",
      [second.id],
    );
    expect(tombstone?.deleted_at).toBeTruthy();
    expect(tombstone?.is_active).toBe(0);

    // ...mas o ultimo administrador ativo nunca pode ser excluido.
    const last = await admin.api.post(`/api/control/user/${admin.id}/delete`, {});
    expectError(last, "CONFLICT");
  });

  it("remove definitivamente cadastro sem historico", async () => {
    const supplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", { name: "Fornecedor sem uso" });
    expect(supplier.status).toBe(201);

    const impact = await admin.api.get<{ mode: string }>(`/api/control/supplier/${supplier.body.id}/impact`);
    expect(impact.status).toBe(200);
    expect(impact.body.mode).toBe("delete");

    const deleted = await admin.api.post<{ mode: string }>(`/api/control/supplier/${supplier.body.id}/delete`, {});
    expect(deleted.status).toBe(200);
    expect(deleted.body.mode).toBe("delete");
    expect(await countRows("SELECT COUNT(*) AS total FROM suppliers WHERE id = ?", [supplier.body.id])).toBe(0);
  });

  it("arquiva cadastro com historico e preserva o nome na solicitacao", async () => {
    const request = await createRequest();
    const impact = await admin.api.get<{
      mode: string;
      references: Array<{ key: string; count: number }>;
    }>(`/api/control/location/${structure.warehouseId}/impact`);
    expect(impact.status).toBe(200);
    expect(impact.body.mode).toBe("archive");
    expect(impact.body.references.some((item) => item.key === "purchases" && item.count === 1)).toBe(true);

    const deleted = await admin.api.post<{ mode: string }>(
      `/api/control/location/${structure.warehouseId}/delete`,
      { reason: "Almoxarifado desativado no mundo fisico" },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.mode).toBe("archive");

    // Sai das listas e seletores...
    const list = await admin.api.get<{ items: Array<{ id: string }> }>("/api/structure/locations");
    expect(list.body.items.some((item) => item.id === structure.warehouseId)).toBe(false);

    // ...mas a solicitacao historica continua resolvendo o nome original.
    const detail = await requester.api.get<{ request: { locationName: string | null; locationDeleted: boolean } }>(
      `/api/purchases/${request.id}`,
    );
    expect(detail.status).toBe(200);
    expect(detail.body.request.locationName).toBe("Almoxarifado");
    expect(detail.body.request.locationDeleted).toBe(true);
  });

  it("bloqueia exclusao de local com saldo de estoque", async () => {
    await seedStock(admin, structure.warehouseId, productId, 5);

    const impact = await admin.api.get<{ mode: string }>(`/api/control/location/${structure.warehouseId}/impact`);
    expect(impact.body.mode).toBe("blocked");

    const deleted = await admin.api.post(`/api/control/location/${structure.warehouseId}/delete`, {});
    expectError(deleted, "CONFLICT");
    expect(await countRows("SELECT COUNT(*) AS total FROM locations WHERE id = ?", [structure.warehouseId])).toBe(1);
  });

  it("notifica os demais administradores sobre a exclusao", async () => {
    const second = await createUser(admin, {
      name: "Segundo administrador",
      email: "admin.notifica@facil.test",
      roleId: await findRoleId("admin"),
    });
    const supplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", { name: "Fornecedor notificado" });

    const deleted = await admin.api.post(`/api/control/supplier/${supplier.body.id}/delete`, {});
    expect(deleted.status).toBe(200);

    const notifications = await second.api.get<{ items: Array<{ type: string; title: string }> }>(
      "/api/notifications?pageSize=20",
    );
    expect(notifications.status).toBe(200);
    expect(notifications.body.items.some((item) => item.type === "control.delete")).toBe(true);
  });

  it("devolve ao solicitante, aceita ajuste dos itens e reenvia ao gestor", async () => {
    const { id } = await createRequest();

    // Triagem do comprador.
    const triage = await buyer.api.post(`/api/purchases/${id}/decide`, {
      decision: "forward",
      notes: "Itens conferidos.",
    });
    expect(triage.status).toBe(200);

    // Gestor de Compras devolve com motivo.
    const returned = await purchasing.api.post(`/api/purchases/${id}/decide`, {
      decision: "return_to_requester",
      notes: "A quantidade de detergente esta acima do necessario; ajuste para 5.",
    });
    expect(returned.status).toBe(200);

    const detail = await requester.api.get<{
      request: { returned: boolean; returnedReason: string | null; status: string; approvalStage: string };
      items: Array<{ uomId: string | null }>;
    }>(`/api/purchases/${id}`);
    expect(detail.body.request.returned).toBe(true);
    expect(detail.body.request.status).toBe("pending_approval");
    expect(detail.body.request.approvalStage).toBe("purchasing");
    expect(detail.body.request.returnedReason).toContain("ajuste para 5");
    // O item herda a unidade do produto mesmo quando o vínculo foi criado sem
    // `uom_id` explícito — o ajuste precisa exibir a unidade correta.
    expect(detail.body.items[0]!.uomId).toBeTruthy();

    // A lista por etapa "returned" isola exatamente o que aguarda ajuste.
    const returnedList = await requester.api.get<{ items: Array<{ id: string }> }>(
      "/api/purchases?stage=returned",
    );
    expect(returnedList.body.items.some((item) => item.id === id)).toBe(true);

    // Sai da fila do gestor enquanto aguarda o ajuste.
    const overview = await purchasing.api.get<{ queues: { purchasing: number; returned: number } }>(
      "/api/purchases/overview",
    );
    expect(overview.body.queues.purchasing).toBe(0);
    expect(overview.body.queues.returned).toBe(1);

    // Solicitante ajusta os itens e reenvia.
    const items = await requester.api.put(`/api/purchases/${id}/items`, {
      items: [{ productId, qty: 5 }],
    });
    expect(items.status).toBe(200);
    const patched = await requester.api.patch(`/api/purchases/${id}`, {
      justification: "Reposicao do setor de limpeza - quantidade revisada",
    });
    expect(patched.status).toBe(200);
    const resubmitted = await requester.api.post(`/api/purchases/${id}/submit`, {});
    expect(resubmitted.status).toBe(200);

    // Volta direto para o gestor (a triagem ja estava concluida).
    const after = await requester.api.get<{
      request: { returned: boolean; approvalStage: string };
      items: Array<{ qtyMilli: number }>;
    }>(`/api/purchases/${id}`);
    expect(after.body.request.returned).toBe(false);
    expect(after.body.request.approvalStage).toBe("purchasing");
    expect(after.body.items[0]!.qtyMilli).toBe(5000);

    const managerQueue = await purchasing.api.get<{ queues: { purchasing: number; returned: number } }>(
      "/api/purchases/overview",
    );
    expect(managerQueue.body.queues.purchasing).toBe(1);
    expect(managerQueue.body.queues.returned).toBe(0);
  });

  it("exige motivo ao devolver a solicitante", async () => {
    const { id } = await createRequest();
    await buyer.api.post(`/api/purchases/${id}/decide`, { decision: "forward", notes: "Itens conferidos." });

    const returned = await purchasing.api.post(`/api/purchases/${id}/decide`, {
      decision: "return_to_requester",
      notes: "ok",
    });
    expectError(returned, "BAD_REQUEST");
  });
});
