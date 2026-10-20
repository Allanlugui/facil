import { beforeEach, describe, expect, it } from "vitest";
import {
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  resetDatabase,
  seedStock,
  setupAdmin,
  stockMilli,
  queryOne,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Cenários 16 a 19 da especificação: ordem de serviço criada do zero ou a
 * partir de um chamado, fluxo de status com histórico, material com baixa
 * única, espera por material sem baixa e conclusão com resultado.
 */
describe("ordens de serviço: fluxo, material e conclusão", () => {
  let admin: Actor;
  let structure: Structure;
  let aguaId: string;
  let cafeId: string;
  let tech: Actor;
  let manager: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    aguaId = await createProduct(admin, { name: "Água 500ml", sku: "AGU-500" });
    cafeId = await createProduct(admin, { name: "Café 500g", sku: "CAF-500" });
    await seedStock(admin, structure.warehouseId, aguaId, 20);
    await seedStock(admin, structure.warehouseId, cafeId, 10);
    tech = await createUser(admin, {
      name: "Técnico Silva",
      email: "tecnico@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });
    manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Criação                                                                  */
  /* ------------------------------------------------------------------------ */

  it("abre a ordem de serviço manual com evento de criação e auditoria", async () => {
    const created = await openWorkOrder({
      title: "Revisar quadro de energia do bloco B",
      description: "Verificar disjuntores e reaperto dos terminais.",
      assigneeId: tech.id,
      priority: "high",
      requiresMaterial: true,
      plannedAt: "2026-10-21T09:00:00.000Z",
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("OS-2026-000001");

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.workOrder.status).toBe("open");
    expect(detail.body.workOrder.ticketId).toBeNull();
    expect(detail.body.workOrder.assigneeId).toBe(tech.id);
    expect(detail.body.workOrder.requiresMaterial).toBe(true);
    expect(detail.body.events.length).toBe(1);
    expect(detail.body.events[0]?.type).toBe("created");
    expect(detail.body.events[0]?.toStatus).toBe("open");

    const notify = await countRows(
      "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'work_order_assigned'",
      [tech.id],
    );
    expect(notify).toBe(1);

    const audit = await countRows(
      "SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'work_order.create'",
      [created.body.id],
    );
    expect(audit).toBe(1);
  });

  it("válida responsável, local e categoria na criação e edição", async () => {
    const inactive = await createUser(admin, {
      name: "Técnico Inativo",
      email: "inativo@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });
    await admin.api.patch(`/api/users/users/${inactive.id}`, { isActive: false });

    const withInactive = await openWorkOrder({ title: "Serviço com responsável inativo", assigneeId: inactive.id });
    expectError(withInactive, "BAD_REQUEST");

    const withUnknownCategory = await openWorkOrder({
      title: "Serviço com categoria inexistente",
      categoryId: "tc_inexistente",
    });
    expectError(withUnknownCategory, "NOT_FOUND");

    const created = await openWorkOrder({ title: "Serviço válido para edição" });
    const editDone = await manager.api.patch(`/api/workorders/${created.body.id}`, {
      priority: "urgent",
      plannedAt: "2026-10-22T08:00:00.000Z",
    });
    expect(editDone.status).toBe(200);

    // Edição parcial (só notas) não pode reaplicar defaults nem apagar o que já
    // estava gravado — prioridade urgent e data planejada continuam abaixo.
    const partialEdit = await manager.api.patch(`/api/workorders/${created.body.id}`, {
      notes: "Acompanhar a limpeza com o zelador na quinta.",
    });
    expect(partialEdit.status).toBe(200);

    const invalidEdit = await manager.api.patch(`/api/workorders/${created.body.id}`, { title: "abc" });
    expectError(invalidEdit, "VALIDATION_ERROR");

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.priority).toBe("urgent");
    expect(detail.body.workOrder.plannedAt).toBe("2026-10-22T08:00:00.000Z");
  });

  it("cria a ordem a partir de um chamado e marca o ticket como convertido", async () => {
    const ticket = await admin.api.post<{ id: string; code: string }>("/api/tickets", {
      title: "Trocar a boia da caixa d'água",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "high",
    });
    expect(ticket.status).toBe(201);

    const created = await openWorkOrder({
      title: "Substituir boia da caixa d'água",
      ticketId: ticket.body.id,
      assigneeId: tech.id,
    });
    expect(created.status).toBe(201);

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.ticketId).toBe(ticket.body.id);
    expect(detail.body.workOrder.ticketCode).toBe(ticket.body.code);

    const ticketRow = await queryOne<{ status: string }>(
      "SELECT status FROM tickets WHERE id = ?",
      [ticket.body.id],
    );
    expect(ticketRow?.status).toBe("converted");

    // Repetir a criação para o mesmo ticket devolve a ordem existente.
    const replay = await openWorkOrder({ title: "Outra tentativa para o mesmo chamado", ticketId: ticket.body.id });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(await countRows("SELECT COUNT(*) AS total FROM work_orders")).toBe(1);

    // Ticket resolvido ou cancelado não pode virar ordem.
    const resolved = await admin.api.post<{ id: string }>("/api/tickets", { title: "Pintura da guarita" });
    await manager.api.post(`/api/tickets/${resolved.body.id}/resolve`, { resolution: "Pintura concluída." });
    const fromResolved = await openWorkOrder({ title: "Ordem para chamado resolvido", ticketId: resolved.body.id });
    expectError(fromResolved, "CONFLICT");
  });

  /* ------------------------------------------------------------------------ */
  /* Fluxo de status                                                          */
  /* ------------------------------------------------------------------------ */

  it("percorre o fluxo de status registrando histórico e timestamps", async () => {
    const created = await openWorkOrder({ title: "Limpeza técnica do ar-condicionado" });

    const planned = await tech.api.post(`/api/workorders/${created.body.id}/status`, { status: "planned" });
    expect(planned.status).toBe(200);

    const started = await tech.api.post<{ status: string }>(`/api/workorders/${created.body.id}/status`, {
      status: "in_progress",
      body: "Início do atendimento as 9h.",
    });
    expect(started.body.status).toBe("in_progress");

    const invalid = await tech.api.post(`/api/workorders/${created.body.id}/status`, { status: "planned" });
    expectError(invalid, "CONFLICT");

    const waiting = await tech.api.post(`/api/workorders/${created.body.id}/status`, {
      status: "waiting_material",
      body: "Faltou filtro de reposição.",
    });
    expect(waiting.status).toBe(200);

    const resumed = await tech.api.post(`/api/workorders/${created.body.id}/status`, { status: "in_progress" });
    expect(resumed.status).toBe(200);

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.startedAt).toBeTruthy();
    expect(detail.body.workOrder.finishedAt).toBeNull();
    const transitions = detail.body.events
      .filter((e) => e.type === "status_change")
      .map((e) => `${e.fromStatus}->${e.toStatus}`);
    expect(transitions).toEqual([
      "open->planned",
      "planned->in_progress",
      "in_progress->waiting_material",
      "waiting_material->in_progress",
    ]);

    // Reenviar o status atual e inofensivo (idempotente).
    const same = await tech.api.post<{ unchanged: boolean }>(`/api/workorders/${created.body.id}/status`, {
      status: "in_progress",
    });
    expect(same.body.unchanged).toBe(true);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM work_order_events WHERE work_order_id = ? AND type = 'status_change'", [
        created.body.id,
      ]),
    ).toBe(4);
  });

  it("atribui, comenta e recusa atribuição após a conclusão", async () => {
    const created = await openWorkOrder({ title: "Reparo do portão de garagem" });

    const assigned = await manager.api.post(`/api/workorders/${created.body.id}/assign`, { assigneeId: tech.id });
    expect(assigned.status).toBe(200);

    const comment = await tech.api.post(`/api/workorders/${created.body.id}/comments`, {
      body: "Verificado no local: necessário trocar o motor do portão.",
    });
    expect(comment.status).toBe(201);

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.assigneeId).toBe(tech.id);
    expect(detail.body.events.some((e) => e.type === "assignment")).toBe(true);
    expect(detail.body.events.some((e) => e.type === "comment")).toBe(true);
    expect(detail.body.events.find((e) => e.type === "comment")?.body).toContain("motor do portão");

    await manager.api.post(`/api/workorders/${created.body.id}/close`, {
      result: "Motor substituido e portão testado.",
    });

    const reassign = await manager.api.post(`/api/workorders/${created.body.id}/assign`, { assigneeId: manager.id });
    expectError(reassign, "CONFLICT");
    const edit = await manager.api.patch(`/api/workorders/${created.body.id}`, { priority: "low" });
    expectError(edit, "CONFLICT");
  });

  /* ------------------------------------------------------------------------ */
  /* Material                                                                 */
  /* ------------------------------------------------------------------------ */

  it("registra material com baixa única vinculada a ordem", async () => {
    const created = await openWorkOrder({ title: "Higienizar os banheiros do 2º andar" });

    const used = await tech.api.post<{ movements: { id: string }[]; idempotentReplay: boolean }>(
      `/api/workorders/${created.body.id}/materials`,
      {
        requestKey: "material-os-000001",
        fromLocationId: structure.warehouseId,
        items: [
          { productId: aguaId, qty: 3 },
          { productId: cafeId, qty: 1 },
        ],
      },
    );
    expect(used.status).toBe(201);
    expect(used.body.movements.length).toBe(2);
    expect(used.body.idempotentReplay).toBe(false);

    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(17_000);
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(9_000);

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.materials.length).toBe(2);
    expect(detail.body.workOrder.materialQtyMilli).toBe(4_000);
    expect(detail.body.workOrder.materialItemCount).toBe(2);
    expect(detail.body.events.some((e) => e.type === "material_use")).toBe(true);

    // O material aparece no histórico de estoque com o vínculo da ordem.
    const stored = await countRows(
      "SELECT COUNT(*) AS total FROM movements WHERE ref_type = 'work_order' AND ref_id = ? AND type = 'maintenance_use'",
      [created.body.id],
    );
    expect(stored).toBe(2);

    const replay = await tech.api.post<{ idempotentReplay: boolean }>(
      `/api/workorders/${created.body.id}/materials`,
      {
        requestKey: "material-os-000001",
        fromLocationId: structure.warehouseId,
        items: [
          { productId: aguaId, qty: 3 },
          { productId: cafeId, qty: 1 },
        ],
      },
    );
    expect(replay.body.idempotentReplay).toBe(true);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(17_000);
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(9_000);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM work_order_events WHERE work_order_id = ? AND type = 'material_use'", [
        created.body.id,
      ]),
    ).toBe(1);
  });

  it("marca aguardando material sem baixar estoque quando falta saldo", async () => {
    const created = await openWorkOrder({ title: "Trocar o filtro da máquina de café" });

    const insufficient = await tech.api.post(
      `/api/workorders/${created.body.id}/materials`,
      {
        requestKey: "material-os-sem-saldo",
        fromLocationId: structure.warehouseId,
        items: [{ productId: aguaId, qty: 500 }],
        markWaitingOnFailure: true,
      },
    );
    expectError(insufficient, "INSUFFICIENT_STOCK");

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.status).toBe("waiting_material");
    expect(detail.body.materials.length).toBe(0);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(20_000);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM movements WHERE ref_type = 'work_order' AND ref_id = ?", [
        created.body.id,
      ]),
    ).toBe(0);

    // Ao chegar material, a OS volta sozinha para execução.
    const used = await tech.api.post(`/api/workorders/${created.body.id}/materials`, {
      requestKey: "material-os-depois-do-saldo",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 2 }],
    });
    expect(used.status).toBe(201);

    const after = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(after.body.workOrder.status).toBe("in_progress");
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(18_000);
  });

  it("recusa material em ordem concluída ou cancelada", async () => {
    const done = await openWorkOrder({ title: "Serviço concluído para teste" });
    await manager.api.post(`/api/workorders/${done.body.id}/close`, { result: "Serviço executado e validado." });
    const afterDone = await tech.api.post(`/api/workorders/${done.body.id}/materials`, {
      requestKey: "material-os-concluida",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 1 }],
    });
    expectError(afterDone, "CONFLICT");

    const cancelled = await openWorkOrder({ title: "Serviço cancelado para teste" });
    await manager.api.post(`/api/workorders/${cancelled.body.id}/cancel`, { reason: "Serviço suspenso pelo cliente" });
    const afterCancel = await tech.api.post(`/api/workorders/${cancelled.body.id}/materials`, {
      requestKey: "material-os-cancelada",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 1 }],
    });
    expectError(afterCancel, "CONFLICT");

    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(20_000);
  });

  /* ------------------------------------------------------------------------ */
  /* Conclusão e cancelamento                                                 */
  /* ------------------------------------------------------------------------ */

  it("conclui sem exigir material e registra resultado", async () => {
    const created = await openWorkOrder({ title: "Ajustar a fechadura da sala de arquivo" });
    await tech.api.post(`/api/workorders/${created.body.id}/status`, { status: "in_progress" });

    const withoutResult = await manager.api.post(`/api/workorders/${created.body.id}/close`, { result: "ok" });
    expectError(withoutResult, "VALIDATION_ERROR");

    const closed = await manager.api.post(`/api/workorders/${created.body.id}/close`, {
      result: "Fechadura alinhada e testada com a chave mestra.",
    });
    expect(closed.status).toBe(200);

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.status).toBe("done");
    expect(detail.body.workOrder.result).toContain("Fechadura alinhada");
    expect(detail.body.workOrder.finishedAt).toBeTruthy();

    const again = await manager.api.post(`/api/workorders/${created.body.id}/close`, {
      result: "Tentativa de concluir novamente.",
    });
    expectError(again, "CONFLICT");

    const reopen = await manager.api.post(`/api/workorders/${created.body.id}/status`, { status: "in_progress" });
    expectError(reopen, "CONFLICT");
  });

  it("cancela com motivo e exige permissão específica", async () => {
    const created = await openWorkOrder({ title: "Instalar suporte de projetor" });

    const byTech = await tech.api.post(`/api/workorders/${created.body.id}/cancel`, {
      reason: "Cancelamento tentado pelo técnico",
    });
    expectError(byTech, "FORBIDDEN");

    const cancelled = await manager.api.post(`/api/workorders/${created.body.id}/cancel`, {
      reason: "Equipamento será instalado por fornecedor externo",
    });
    expect(cancelled.status).toBe(200);

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${created.body.id}`);
    expect(detail.body.workOrder.status).toBe("cancelled");
    expect(detail.body.workOrder.cancelReason).toContain("fornecedor externo");

    const again = await manager.api.post(`/api/workorders/${created.body.id}/cancel`, {
      reason: "Segunda tentativa de cancelamento",
    });
    expectError(again, "CONFLICT");

    const denied = await countRows(
      "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'permission_denied' AND entity_id = 'workorders.cancel'",
    );
    expect(denied).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Filtros                                                                  */
  /* ------------------------------------------------------------------------ */

  it("filtra por status, prioridade, responsável, texto e minhas ordens", async () => {
    const a = await openWorkOrder({ title: "Trocar lâmpadas do galpão", assigneeId: tech.id, priority: "high" });
    const b = await openWorkOrder({ title: "Desentupir ralo da cozinha", priority: "urgent" });
    await openWorkOrder({ title: "Vistoria mensal do rooftop" });

    await manager.api.post(`/api/workorders/${a.body.id}/close`, { result: "Lâmpadas trocadas e testadas." });

    const openOnly = await manager.api.get<{ items: WorkOrder[] }>("/api/workorders?open=true");
    expect(openOnly.body.items.length).toBe(2);

    const urgent = await manager.api.get<{ items: WorkOrder[] }>("/api/workorders?priority=urgent");
    expect(urgent.body.items.map((w) => w.id)).toEqual([b.body.id]);

    const byAssignee = await manager.api.get<{ items: WorkOrder[] }>(`/api/workorders?assigneeId=${tech.id}`);
    expect(byAssignee.body.items.map((w) => w.id)).toEqual([a.body.id]);

    const byText = await manager.api.get<{ items: WorkOrder[] }>("/api/workorders?search=ralo");
    expect(byText.body.items.map((w) => w.id)).toEqual([b.body.id]);

    const mine = await tech.api.get<{ items: WorkOrder[] }>("/api/workorders?mine=true");
    expect(mine.body.items.map((w) => w.id)).toEqual([a.body.id]);

    const done = await manager.api.get<{ items: WorkOrder[] }>("/api/workorders?status=done");
    expect(done.body.items.map((w) => w.id)).toEqual([a.body.id]);
  });

  /* ------------------------------------------------------------------------ */
  /* Permissões                                                               */
  /* ------------------------------------------------------------------------ */

  it("exige permissão própria para cada etapa da ordem", async () => {
    const created = await openWorkOrder({ title: "Serviço com permissões controladas" });
    const requester = await createUser(admin, {
      name: "Solicitante",
      email: "solicitante@facil.test",
      roleId: await findRoleId("requester"),
    });

    const view = await requester.api.get(`/api/workorders/${created.body.id}`);
    expectError(view, "FORBIDDEN");

    const create = await requester.api.post("/api/workorders", { title: "Ordem criada sem permissão" });
    expectError(create, "FORBIDDEN");

    const execute = await requester.api.post(`/api/workorders/${created.body.id}/status`, { status: "in_progress" });
    expectError(execute, "FORBIDDEN");

    const material = await requester.api.post(`/api/workorders/${created.body.id}/materials`, {
      requestKey: "material-sem-permissao",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 1 }],
    });
    expectError(material, "FORBIDDEN");

    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(20_000);
  });

  /* ------------------------------------------------------------------------ */
  /* OS filha (F-10)                                                          */
  /* ------------------------------------------------------------------------ */

  it("abre OS filha vinculada à OS pai e mostra a árvore no detalhe", async () => {
    const parent = await manager.api.post<{ id: string; code: string }>("/api/workorders", {
      title: "Reforma do 3º andar",
      locationId: structure.roomId,
    });
    expect(parent.status).toBe(201);

    const child = await admin.api.post<{ id: string; code: string }>("/api/workorders", {
      title: "Instalação elétrica da sala 302",
      locationId: structure.roomId,
      parentWorkOrderId: parent.body.id,
    });
    expect(child.status).toBe(201);

    // Árvore na tela da OS: a pai lista a filha; a filha aponta a pai.
    const parentDetail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${parent.body.id}`);
    expect(parentDetail.body.parent).toBeNull();
    expect(parentDetail.body.children.map((item) => item.code)).toEqual([child.body.code]);
    expect(parentDetail.body.children[0]?.status).toBe("open");

    const childDetail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${child.body.id}`);
    expect(childDetail.body.parent?.code).toBe(parent.body.code);
    expect(childDetail.body.parent?.title).toBe("Reforma do 3º andar");
    expect(childDetail.body.children).toEqual([]);
    expect(childDetail.body.workOrder.parentWorkOrderId).toBe(parent.body.id);
    // O evento de criação registra a origem (linha do tempo da OS filha).
    expect(childDetail.body.events[0]?.body).toContain(parent.body.code);

    // A auditoria da criação guarda o vínculo.
    const audit = await queryOne<{ after_json: string }>(
      "SELECT after_json FROM audit_log WHERE entity_id = ? AND action = 'work_order.create'",
      [child.body.id],
    );
    expect(audit?.after_json).toContain(parent.body.id);

    // Técnico enxerga a OS, mas não a árvore (informação de gestão).
    const asTech = await tech.api.get<WorkOrderDetail>(`/api/workorders/${child.body.id}`);
    expect(asTech.status).toBe(200);
    expect(asTech.body.parent).toBeNull();
    expect(asTech.body.children).toEqual([]);

    // OS pai inexistente e OS pai cancelada recusam o vínculo.
    const missing = await admin.api.post("/api/workorders", {
      title: "OS sem pai existente",
      parentWorkOrderId: "00000000-0000-0000-0000-000000000000",
    });
    expect(missing.status).toBe(404);

    const cancelled = await manager.api.post(`/api/workorders/${parent.body.id}/cancel`, {
      reason: "Reforma adiada pelo condomínio",
    });
    expect(cancelled.status).toBe(200);

    const blocked = await admin.api.post<{ error?: { message?: string } }>("/api/workorders", {
      title: "OS filha de pai cancelada",
      parentWorkOrderId: parent.body.id,
    });
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.error?.message)).toContain("cancelada");
  });

  /* ------------------------------------------------------------------------ */
  /* Auxiliares do teste                                                      */
  /* ------------------------------------------------------------------------ */

  async function openWorkOrder(body: {
    title: string;
    description?: string;
    ticketId?: string;
    categoryId?: string;
    locationId?: string;
    assigneeId?: string;
    priority?: string;
    requiresMaterial?: boolean;
    plannedAt?: string;
  }) {
    return admin.api.post<{ id?: string; code?: string; idempotentReplay?: boolean }>("/api/workorders", {
      locationId: structure.roomId,
      ...body,
    });
  }
});

interface WorkOrder {
  id: string;
  code: string;
  ticketId: string | null;
  ticketCode: string | null;
  parentWorkOrderId: string | null;
  title: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  assigneeName: string | null;
  requiresMaterial: boolean;
  plannedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  cancelReason: string | null;
  checklistCount?: number;
  checklistDoneCount?: number;
  materialQtyMilli: number;
  materialItemCount: number;
}

interface ChecklistPhoto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  url: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  notes: string | null;
  order: number;
  done: boolean;
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string | null;
  createdByManager: boolean;
  createdAt: string;
  photos: ChecklistPhoto[];
}

interface RelatedWorkOrder {
  id: string;
  code: string;
  title: string;
  status: string;
  assigneeName: string | null;
}

interface WorkOrderDetail {
  workOrder: WorkOrder;
  events: {
    id: string;
    type: string;
    fromStatus: string | null;
    toStatus: string | null;
    body: string | null;
    userName: string;
  }[];
  checklist: ChecklistItem[];
  materials: { id: string; productId: string; qtyMilli: number }[];
  parent: RelatedWorkOrder | null;
  children: RelatedWorkOrder[];
}

/* -------------------------------------------------------------------------- */
/* Checklist do técnico (F-09)                                                */
/* -------------------------------------------------------------------------- */

/**
 * O técnico (ou o gestor) monta na própria OS a lista de etapas do serviço,
 * marca o que já executou, anexa foto por etapa e remove o que não usa mais --
 * sempre com histórico na linha do tempo e auditoria.
 */
describe("ordens de serviço: checklist do técnico", () => {
  let admin: Actor;
  let structure: Structure;
  let tech: Actor;
  let manager: Actor;
  let woId: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    tech = await createUser(admin, {
      name: "Técnico Silva",
      email: "tecnico@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });
    manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });

    const created = await admin.api.post<{ id: string }>("/api/workorders", {
      title: "Trocar luminárias do corredor",
      locationId: structure.roomId,
      assigneeId: tech.id,
    });
    expect(created.status).toBe(201);
    woId = created.body.id;
  });

  it("técnico cria, conclui, reabre e remove etapas com histórico e auditoria", async () => {
    const first = await tech.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Desligar o quadro do corredor",
    });
    expect(first.status).toBe(201);
    const second = await tech.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Trocar as luminárias queimadas",
    });
    expect(second.status).toBe(201);

    let detail = await tech.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    expect(detail.body.checklist.length).toBe(2);
    expect(detail.body.checklist[0]?.label).toBe("Desligar o quadro do corredor");
    expect(detail.body.checklist[0]?.order).toBe(1);
    expect(detail.body.checklist[0]?.done).toBe(false);
    expect(detail.body.checklist[0]?.createdByName).toBe("Técnico Silva");
    expect(detail.body.workOrder.checklistCount).toBe(2);
    expect(detail.body.workOrder.checklistDoneCount).toBe(0);

    const done = await tech.api.patch(`/api/workorders/${woId}/checklist/${first.body.id}`, { done: true });
    expect(done.status).toBe(200);

    detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    const concluded = detail.body.checklist.find((item) => item.id === first.body.id)!;
    expect(concluded.done).toBe(true);
    expect(concluded.doneByName).toBe("Técnico Silva");
    expect(concluded.doneAt).not.toBeNull();
    expect(detail.body.workOrder.checklistDoneCount).toBe(1);

    // A linha do tempo registra a conclusão e a auditoria guarda antes/depois.
    const event = await queryOne<{ body: string }>(
      `SELECT body FROM work_order_events
        WHERE work_order_id = ? AND type = 'checklist'
        ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [woId],
    );
    expect(event?.body).toContain("Etapa concluída no checklist");
    expect(
      await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'work_order.checklist_add'"),
    ).toBe(2);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'work_order.checklist_update' AND result = 'success'",
      ),
    ).toBe(1);

    // Reabrir limpa quem concluiu e quando.
    const reopen = await tech.api.patch(`/api/workorders/${woId}/checklist/${first.body.id}`, { done: false });
    expect(reopen.status).toBe(200);
    detail = await tech.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    const reopened = detail.body.checklist.find((item) => item.id === first.body.id)!;
    expect(reopened.done).toBe(false);
    expect(reopened.doneByName).toBeNull();
    expect(reopened.doneAt).toBeNull();

    // Remover tira a etapa do checklist e deixa rastro na auditoria.
    const removed = await tech.api.delete(`/api/workorders/${woId}/checklist/${second.body.id}`);
    expect(removed.status).toBe(200);
    detail = await tech.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    expect(detail.body.checklist.length).toBe(1);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'work_order.checklist_remove'"),
    ).toBe(1);
  });

  it("fotos por etapa aparecem no checklist e saem junto com o item removido", async () => {
    const item = await tech.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Fotografar o quadro antes da troca",
    });
    expect(item.status).toBe(201);

    const form = new FormData();
    form.set("file", new File([new Uint8Array(512).fill(68)], "antes.png", { type: "image/png" }));
    form.set("entityType", "work_order_checklist_item");
    form.set("entityId", item.body.id);
    const uploaded = await tech.api.postRaw<{ id: string }>("/api/attachments", form);
    expect(uploaded.status).toBe(201);

    const detail = await tech.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    const photo = detail.body.checklist[0]?.photos[0];
    expect(photo?.filename).toBe("antes.png");
    expect(photo?.url).toBe(`/api/attachments/${uploaded.body.id}`);

    // Gestor (e qualquer perfil que enxerga a OS) baixa a foto pelo anexo.
    const download = await manager.api.fetchRaw("GET", `/api/attachments/${uploaded.body.id}`);
    expect(download.status).toBe(200);

    // Remover a etapa apaga as fotos dela: nenhum anexo órfão.
    const removed = await tech.api.delete(`/api/workorders/${woId}/checklist/${item.body.id}`);
    expect(removed.status).toBe(200);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM attachments WHERE entity_type = 'work_order_checklist_item'",
      ),
    ).toBe(0);
    const after = await tech.api.fetchRaw("GET", `/api/attachments/${uploaded.body.id}`);
    expect(after.status).toBe(404);
  });

  it("quem só acompanha a OS vê o checklist, mas não edita", async () => {
    const item = await tech.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Conferir o estoque de lâmpadas",
    });
    expect(item.status).toBe(201);

    const stock = await createUser(admin, {
      name: "Estoquista",
      email: "estoque@facil.test",
      roleId: await findRoleId("stock_keeper"),
    });

    const view = await stock.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    expect(view.status).toBe(200);
    expect(view.body.checklist.length).toBe(1);

    expectError(
      await stock.api.post(`/api/workorders/${woId}/checklist`, { label: "Etapa sem permissão" }),
      "FORBIDDEN",
    );
    expectError(
      await stock.api.patch(`/api/workorders/${woId}/checklist/${item.body.id}`, { done: true }),
      "FORBIDDEN",
    );
    expectError(await stock.api.delete(`/api/workorders/${woId}/checklist/${item.body.id}`), "FORBIDDEN");

    const untouched = await admin.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    expect(untouched.body.checklist[0]?.done).toBe(false);
  });

  it("avisa o responsável quando outra pessoa adiciona uma etapa", async () => {
    const added = await manager.api.post(`/api/workorders/${woId}/checklist`, {
      label: "Desligar o disjuntor geral",
    });
    expect(added.status).toBe(201);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'work_order_checklist'",
        [tech.id],
      ),
    ).toBe(1);

    // O próprio técnico mexendo no checklist dele não gera aviso.
    const own = await tech.api.post(`/api/workorders/${woId}/checklist`, {
      label: "Separar as lâmpadas novas",
    });
    expect(own.status).toBe(201);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'work_order_checklist'",
        [tech.id],
      ),
    ).toBe(1);
  });

  it("ordem cancelada não recebe novas etapas", async () => {
    const item = await tech.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Etapa criada antes do cancelamento",
    });
    expect(item.status).toBe(201);

    const cancelled = await admin.api.post(`/api/workorders/${woId}/cancel`, { reason: "Serviço duplicado" });
    expect(cancelled.status).toBe(200);

    const blocked = await tech.api.post(`/api/workorders/${woId}/checklist`, { label: "Etapa depois do cancelamento" });
    expectError(blocked, "CONFLICT");
  });

  it("conclusão é bloqueada enquanto houver etapa criada pelo gerente de facilities", async () => {
    const managerItem = await manager.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Apertar os terminais do disjuntor geral",
    });
    expect(managerItem.status).toBe(201);

    // O detalhe marca o item do gerente como obrigatório e o do técnico como opcional.
    const detail = await tech.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    const managerRow = detail.body.checklist.find((item) => item.id === managerItem.body.id)!;
    const techRow = await tech.api.post<{ id: string }>(`/api/workorders/${woId}/checklist`, {
      label: "Etapa opcional criada pelo próprio técnico",
    });
    const detail2 = await tech.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    const techItem = detail2.body.checklist.find((item) => item.id === techRow.body.id)!;
    expect(managerRow.createdByManager).toBe(true);
    expect(techItem.createdByManager).toBe(false);

    // Com a etapa do gerente pendente, a conclusão é recusada — mesmo com a do técnica marcada.
    await tech.api.patch(`/api/workorders/${woId}/checklist/${techRow.body.id}`, { done: true });
    const blocked = await tech.api.post(`/api/workorders/${woId}/close`, {
      result: "Serviço executado com sucesso.",
    });
    expectError(blocked, "CONFLICT");
    const blockedRow = await queryOne<{ status: string }>(
      "SELECT status FROM work_orders WHERE id = ?",
      [woId],
    );
    expect(blockedRow?.status).toBe("open");

    // Marcar a etapa do gerente desbloqueia a conclusão.
    const unblocked = await tech.api.patch(`/api/workorders/${woId}/checklist/${managerItem.body.id}`, {
      done: true,
    });
    expect(unblocked.status).toBe(200);
    const closed = await tech.api.post(`/api/workorders/${woId}/close`, {
      result: "Serviço executado com sucesso.",
    });
    expect(closed.status).toBe(200);
    const closedRow = await queryOne<{ status: string }>(
      "SELECT status FROM work_orders WHERE id = ?",
      [woId],
    );
    expect(closedRow?.status).toBe("done");
  });

  it("etapa criada por admin não bloqueia a conclusão (só gerente de facilities)", async () => {
    await admin.api.post(`/api/workorders/${woId}/checklist`, { label: "Etapa criada pelo admin" });

    const detail = await admin.api.get<WorkOrderDetail>(`/api/workorders/${woId}`);
    const adminItem = detail.body.checklist.find((item) => item.label === "Etapa criada pelo admin")!;
    expect(adminItem.createdByManager).toBe(false);

    const closed = await admin.api.post(`/api/workorders/${woId}/close`, {
      result: "Serviço executado com sucesso.",
    });
    expect(closed.status).toBe(200);
  });
});
