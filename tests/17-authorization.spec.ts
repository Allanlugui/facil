import { beforeEach, describe, expect, it } from "vitest";
import {
  createStructure,
  createUser,
  expectError,
  findRoleId,
  findUomId,
  resetDatabase,
  setupAdmin,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Regressões da auditoria 0.1.1: escopo de local e permissões de fluxo.
 * Cada teste reproduz um caminho que antes permitia ampliar acesso.
 */
describe("17: autorização e escopo", () => {
  let admin: Actor;
  let manager: Actor;
  let structure: Structure;
  let managerRole: string;
  let requesterRole: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    managerRole = await findRoleId("facilities_manager");
    requesterRole = await findRoleId("requester");
    manager = await createUser(admin, {
      name: "Gerente Escopado",
      email: "gerente.escopo@facil.test",
      roleId: managerRole,
    });

    const scoped = await admin.api.put(`/api/users/users/${manager.id}/location-scopes`, {
      locationIds: [structure.roomId],
    });
    expect(scoped.status).toBe(200);
  });

  it("gestor não zera o próprio escopo nem mexe em um administrador", async () => {
    const clearOwn = await manager.api.put(`/api/users/users/${manager.id}/location-scopes`, {
      locationIds: [],
    });
    expectError(clearOwn, "FORBIDDEN");

    const adminScope = await manager.api.put(`/api/users/users/${admin.id}/location-scopes`, {
      locationIds: [structure.roomId],
    });
    expectError(adminScope, "FORBIDDEN");

    const adminEmail = await manager.api.patch(`/api/users/users/${admin.id}`, {
      email: "outro-admin@facil.test",
    });
    expectError(adminEmail, "FORBIDDEN");
  });

  it("relatório com locationId fora do escopo é recusado", async () => {
    const outside = await manager.api.get(
      `/api/reports/stock?locationId=${structure.warehouseId}`,
    );
    expectError(outside, "FORBIDDEN");

    const inside = await manager.api.get(`/api/reports/stock?locationId=${structure.roomId}`);
    expect(inside.status).toBe(200);
  });

  it("detalhe de compra fora do escopo é recusado", async () => {
    const created = await admin.api.post<{ id: string }>("/api/purchases", {
      locationId: structure.warehouseId,
      justification: "Compra de teste",
      items: [{ description: "Item de teste", qty: 1, uomId: await findUomId("UN") }],
    });
    expect(created.status).toBe(201);

    const detail = await manager.api.get(`/api/purchases/${created.body.id}`);
    expectError(detail, "FORBIDDEN");
  });

  it("status não conclui OS e o atalho não contorna permissão de cancelar", async () => {
    const created = await admin.api.post<{ id: string }>("/api/workorders", {
      title: "OS para teste de fluxo",
      locationId: structure.roomId,
    });
    expect(created.status).toBe(201);

    const done = await admin.api.post(`/api/workorders/${created.body.id}/status`, {
      status: "done",
    });
    expectError(done, "BAD_REQUEST");

    const started = await admin.api.post(`/api/workorders/${created.body.id}/status`, {
      status: "in_progress",
    });
    expect(started.status).toBe(200);
  });

  it("solicitante não resolve pelo PATCH nem lê anexo de ticket alheio", async () => {
    const ana = await createUser(admin, {
      name: "Ana Solicitante",
      email: "ana.escopo@facil.test",
      roleId: requesterRole,
    });
    const bruno = await createUser(admin, {
      name: "Bruno Solicitante",
      email: "bruno.escopo@facil.test",
      roleId: requesterRole,
    });

    const ticket = await ana.api.post<{ id: string }>("/api/tickets", {
      title: "Chamado da Ana",
      locationId: structure.roomId,
    });
    expect(ticket.status).toBe(201);

    const patch = await ana.api.patch(`/api/tickets/${ticket.body.id}`, {
      status: "resolved",
    });
    expectError(patch, "FORBIDDEN");

    const upload = await ana.api.request(
      "POST",
      `/api/attachments?entityType=ticket&entityId=${ticket.body.id}&filename=foto.png&mimeType=image/png`,
      {
        rawBody: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        headers: { "content-type": "image/png" },
      },
    );
    expect(upload.status).toBe(201);

    const list = await bruno.api.get(
      `/api/attachments?entityType=ticket&entityId=${ticket.body.id}`,
    );
    expectError(list, "FORBIDDEN");
  });
});
