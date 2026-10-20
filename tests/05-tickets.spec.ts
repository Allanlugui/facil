import { beforeEach, describe, expect, it } from "vitest";
import {
  assert,
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
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Cenários 15 a 18 da especificação: abertura e acompanhamento de chamados,
 * visibilidade restrita, comentários internos, atribuição, resolução imediata,
 * conversão em ordem de serviço e material utilizado no atendimento.
 */
describe("tickets: chamados, atendimento e conversão em OS", () => {
  let admin: Actor;
  let structure: Structure;
  let aguaId: string;
  let requesterRole: string;
  let techRole: string;
  let managerRole: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    aguaId = await createProduct(admin, { name: "Água 500ml", sku: "AGU-500" });
    await seedStock(admin, structure.warehouseId, aguaId, 50);
    requesterRole = await findRoleId("requester");
    techRole = await findRoleId("maintenance_tech");
    managerRole = await findRoleId("facilities_manager");
  });

  /* ------------------------------------------------------------------------ */
  /* Abertura e consulta                                                      */
  /* ------------------------------------------------------------------------ */

  it("abre o chamado com código sequencial, prioridade e trilha de auditoria", async () => {
    const created = await admin.api.post<{ id: string; code: string }>("/api/tickets", {
      title: "Vazamento na copa do 3º andar",
      description: "Água escorrendo sob a pia há dois dias.",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "high",
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("TCK-2026-000001");

    const ticket = await admin.api.get<Ticket>("/api/tickets");
    expect(ticket.status).toBe(200);
    expect(ticket.body.total).toBe(1);
    expect(ticket.body.items[0]?.status).toBe("open");
    expect(ticket.body.items[0]?.priority).toBe("high");
    expect(ticket.body.items[0]?.categoryName).toBe("Hidráulica");
    expect(ticket.body.items[0]?.requesterName).toBe(admin.name);

    const audit = await countRows(
      "SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'ticket.create'",
      [created.body.id],
    );
    expect(audit).toBe(1);
  });

  it("válida titulo, categoria e local informados", async () => {
    const shortTitle = await admin.api.post("/api/tickets", { title: "abc" });
    expectError(shortTitle, "VALIDATION_ERROR");

    const unknownCategory = await admin.api.post("/api/tickets", {
      title: "Categoria inexistente",
      categoryId: "tc_inexistente",
    });
    expectError(unknownCategory, "NOT_FOUND");

    const unknownLocation = await admin.api.post("/api/tickets", {
      title: "Local inexistente",
      locationId: "loc-inexistente",
    });
    expectError(unknownLocation, "NOT_FOUND");

    const invalidPriority = await admin.api.post("/api/tickets", {
      title: "Prioridade inválida",
      priority: "urgentissima",
    });
    expectError(invalidPriority, "VALIDATION_ERROR");

    expect(await countRows("SELECT COUNT(*) AS total FROM tickets")).toBe(0);
  });

  it("cada solicitante enxerga apenas os próprios chamados", async () => {
    const ana = await createRequester("Ana Solicitante", "ana@facil.test");
    const bruno = await createRequester("Bruno Solicitante", "bruno@facil.test");

    const ticketAna = await openTicket(ana, "Lâmpada queimada na recepção");
    await openTicket(bruno, "Cadeira quebrada na sala 2");

    const listAna = await ana.api.get<{ total: number; items: Ticket[] }>("/api/tickets");
    expect(listAna.status).toBe(200);
    expect(listAna.body.total).toBe(1);
    expect(listAna.body.items[0]?.id).toBe(ticketAna.body.id);

    const detailOfOther = await ana.api.get(`/api/tickets/${(await firstTicketId(bruno))}`);
    expectError(detailOfOther, "FORBIDDEN");

    // Quem tem `tickets.view_all` enxerga tudo.
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const listTech = await técnico.api.get<{ total: number }>("/api/tickets");
    expect(listTech.body.total).toBe(2);
  });

  it("libera o chamado para quem passa a ser responsável por ele", async () => {
    const ana = await createRequester("Ana Solicitante", "ana@facil.test");
    const ticket = await openTicket(ana, "Ar-condicionado sem gelar na sala 1");

    const bruno = await createRequester("Bruno Solicitante", "bruno@facil.test");
    const before = await bruno.api.get(`/api/tickets/${ticket.body.id}`);
    expectError(before, "FORBIDDEN");

    const manager = await createStaff("Gerente", "gerente@facil.test", managerRole);
    const assigned = await manager.api.post(`/api/tickets/${ticket.body.id}/assign`, {
      assigneeId: bruno.id,
    });
    expect(assigned.status).toBe(200);

    const after = await bruno.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    expect(after.status).toBe(200);
    expect(after.body.ticket.assigneeId).toBe(bruno.id);
    expect(after.body.ticket.status).toBe("in_progress");

    const notifications = await countRows(
      "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'ticket_assigned'",
      [bruno.id],
    );
    expect(notifications).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Comentários e histórico                                                  */
  /* ------------------------------------------------------------------------ */

  it("registra comentário interno sem expo-lo ao solicitante", async () => {
    const ana = await createRequester("Ana Solicitante", "ana@facil.test");
    const ticket = await openTicket(ana, "Pia entupida no banheiro");

    const manager = await createStaff("Gerente", "gerente@facil.test", managerRole);
    await manager.api.post(`/api/tickets/${ticket.body.id}/comments`, {
      body: "Chamado encaminhado para a equipe de manutenção.",
    });
    await manager.api.post(`/api/tickets/${ticket.body.id}/comments`, {
      body: "Fornecedor cobra visita mínima; negociar orçamento antes de agendar.",
      isInternal: true,
    });

    const asAna = await ana.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    expect(asAna.status).toBe(200);
    expect(asAna.body.comments.length).toBe(1);
    expect(asAna.body.comments[0]?.isInternal).toBe(false);

    const asManager = await manager.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    expect(asManager.body.comments.length).toBe(2);

    // O histórico de auditoria registra comentários e mudanças de estado.
    const detail = await manager.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    const actions = detail.body.history.map((h) => h.action);
    expect(actions).toContain("ticket.create");
    expect(actions.filter((a) => a === "ticket.comment").length).toBe(2);
  });

  /* ------------------------------------------------------------------------ */
  /* Atribuição, resolução e cancelamento                                     */
  /* ------------------------------------------------------------------------ */

  it("recusa designar responsável inativo e reatribuir chamado encerrado", async () => {
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const manager = await createStaff("Gerente", "gerente@facil.test", managerRole);
    const ticket = await openTicket(manager, "Luz piscando na escada");

    await admin.api.patch(`/api/users/users/${técnico.id}`, { isActive: false });
    const inactive = await manager.api.post(`/api/tickets/${ticket.body.id}/assign`, {
      assigneeId: técnico.id,
    });
    expectError(inactive, "BAD_REQUEST");

    const unknown = await manager.api.post(`/api/tickets/${ticket.body.id}/assign`, {
      assigneeId: "usuario-inexistente",
    });
    expectError(unknown, "NOT_FOUND");

    await manager.api.post(`/api/tickets/${ticket.body.id}/assign`, { assigneeId: manager.id });
    await manager.api.post(`/api/tickets/${ticket.body.id}/resolve`, {
      resolution: "Lâmpada trocada e teste de 24h realizado.",
    });

    const reassign = await manager.api.post(`/api/tickets/${ticket.body.id}/assign`, {
      assigneeId: manager.id,
    });
    expectError(reassign, "CONFLICT");
  });

  it("resolve o chamado direto, sem ordem de serviço, e avisa o solicitante", async () => {
    const ana = await createRequester("Ana Solicitante", "ana@facil.test");
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const ticket = await openTicket(ana, "Trocar o refil de sabão do banheiro");

    const withoutPermission = await ana.api.post(`/api/tickets/${ticket.body.id}/resolve`, {
      resolution: "Resolvido por conta própria",
    });
    expectError(withoutPermission, "FORBIDDEN");

    const resolved = await técnico.api.post<{ status: string }>(`/api/tickets/${ticket.body.id}/resolve`, {
      resolution: "Refil substituido e área limpa.",
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("resolved");

    const detail = await técnico.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    expect(detail.body.ticket.status).toBe("resolved");
    expect(detail.body.ticket.resolvedBy).toBe(técnico.id);
    expect(detail.body.ticket.resolvedAt).toBeTruthy();
    expect(detail.body.ticket.resolution).toContain("Refil substituido");

    const notify = await countRows(
      "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'ticket_resolved'",
      [ana.id],
    );
    expect(notify).toBe(1);

    const again = await técnico.api.post(`/api/tickets/${ticket.body.id}/resolve`, {
      resolution: "Tentativa de resolver duas vezes.",
    });
    expectError(again, "CONFLICT");
  });

  it("permite aguardar material e retomar o atendimento", async () => {
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const ticket = await openTicket(técnico, "Vazamento no bebedouro");

    const waiting = await técnico.api.post<{ status: string }>(`/api/tickets/${ticket.body.id}/resolve`, {
      resolution: "Aguardando a chegada da válvula de reposição.",
      status: "waiting_material",
    });
    expect(waiting.status).toBe(200);
    expect(waiting.body.status).toBe("waiting_material");

    const detail = await técnico.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    expect(detail.body.ticket.status).toBe("waiting_material");
    expect(detail.body.ticket.resolvedAt).toBeNull();

    const resumed = await técnico.api.patch(`/api/tickets/${ticket.body.id}`, { status: "in_progress" });
    expect(resumed.status).toBe(200);

    const finished = await técnico.api.post(`/api/tickets/${ticket.body.id}/resolve`, {
      resolution: "Válvula trocada e vazamento eliminado.",
    });
    expect(finished.status).toBe(200);

    const invalid = await técnico.api.patch(`/api/tickets/${ticket.body.id}`, { status: "in_progress" });
    expectError(invalid, "CONFLICT");
  });

  it("atualização parcial do chamado preserva a prioridade definida", async () => {
    const técnico = await createTech("Técnico Prado", "tecnico.prado@facil.test");
    const created = await técnico.api.post<{ id: string }>("/api/tickets", {
      title: "Ar-condicionado da sala de reuniões",
      locationId: structure.roomId,
      priority: "high",
    });
    expect(created.status).toBe(201);

    // Mover o status não pode reaplicar o default "normal" da prioridade.
    const moved = await técnico.api.patch(`/api/tickets/${created.body.id}`, { status: "in_progress" });
    expect(moved.status).toBe(200);

    const detail = await técnico.api.get<TicketDetail>(`/api/tickets/${created.body.id}`);
    expect(detail.body.ticket.status).toBe("in_progress");
    expect(detail.body.ticket.priority).toBe("high");
  });

  it("cancela o chamado com motivo e congela o estado", async () => {
    const manager = await createStaff("Gerente", "gerente@facil.test", managerRole);
    const ana = await createRequester("Ana Solicitante", "ana@facil.test");

    const openedTwice = await openTicket(ana, "Quadro de avisos torto");
    const withoutPermission = await ana.api.post(`/api/tickets/${openedTwice.body.id}/cancel`, {
      reason: "Desisti do pedido",
    });
    expectError(withoutPermission, "FORBIDDEN");

    const cancelled = await manager.api.post(`/api/tickets/${openedTwice.body.id}/cancel`, {
      reason: "Solicitação duplicada de outro chamado",
    });
    expect(cancelled.status).toBe(200);

    const detail = await manager.api.get<TicketDetail>(`/api/tickets/${openedTwice.body.id}`);
    expect(detail.body.ticket.status).toBe("cancelled");
    expect(detail.body.ticket.cancelReason).toContain("duplicada");

    const again = await manager.api.post(`/api/tickets/${openedTwice.body.id}/cancel`, {
      reason: "Segunda tentativa de cancelamento",
    });
    expectError(again, "CONFLICT");

    // Chamado resolvido também não pode ser cancelado.
    const other = await openTicket(ana, "Trocar a fechadura da sala 4");
    await manager.api.post(`/api/tickets/${other.body.id}/resolve`, { resolution: "Fechadura trocada." });
    const cancelResolved = await manager.api.post(`/api/tickets/${other.body.id}/cancel`, {
      reason: "Cancelamento após resolução",
    });
    expectError(cancelResolved, "CONFLICT");
  });

  /* ------------------------------------------------------------------------ */
  /* Conversão em ordem de serviço                                            */
  /* ------------------------------------------------------------------------ */

  it("converte o chamado em ordem de serviço sem duplicar a ordem", async () => {
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const ana = await createRequester("Ana Solicitante", "ana@facil.test");
    const ticket = await openTicket(ana, "Porta da sala de servidores não fecha", "tc_estrutura");

    const converted = await técnico.api.post<{ workOrder: { id: string; code: string; status: string }; idempotentReplay: boolean }>(
      `/api/tickets/${ticket.body.id}/convert`,
      { assigneeId: técnico.id, requiresMaterial: true, plannedAt: "2026-10-20T13:00:00.000Z" },
    );
    expect(converted.status).toBe(201);
    expect(converted.body.idempotentReplay).toBe(false);
    expect(converted.body.workOrder.code).toBe("OS-2026-000001");
    expect(converted.body.workOrder.status).toBe("open");

    const detail = await técnico.api.get<TicketDetail>(`/api/tickets/${ticket.body.id}`);
    expect(detail.body.ticket.status).toBe("converted");
    expect(detail.body.ticket.workOrderId).toBe(converted.body.workOrder.id);
    expect(detail.body.history.some((h) => h.action === "ticket.convert")).toBe(true);

    const workOrder = await admin.api.get<{ workOrder: { ticketId: string; requiresMaterial: boolean; plannedAt: string | null; description: string | null } }>(
      `/api/workorders/${converted.body.workOrder.id}`,
    );
    expect(workOrder.status).toBe(200);
    expect(workOrder.body.workOrder.ticketId).toBe(ticket.body.id);
    expect(workOrder.body.workOrder.requiresMaterial).toBe(true);
    expect(workOrder.body.workOrder.plannedAt).toBe("2026-10-20T13:00:00.000Z");

    const events = await countRows(
      "SELECT COUNT(*) AS total FROM work_order_events WHERE work_order_id = ? AND type = 'created'",
      [converted.body.workOrder.id],
    );
    expect(events).toBe(1);

    // Reenvio da conversão devolve a MESMA ordem, sem criar outra.
    const replay = await técnico.api.post<{ workOrder: { id: string }; idempotentReplay: boolean }>(
      `/api/tickets/${ticket.body.id}/convert`,
      {},
    );
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.workOrder.id).toBe(converted.body.workOrder.id);
    expect(await countRows("SELECT COUNT(*) AS total FROM work_orders")).toBe(1);
  });

  it("recusa converter chamado resolvido ou cancelado", async () => {
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const manager = await createStaff("Gerente", "gerente@facil.test", managerRole);

    const resolved = await openTicket(manager, "Trocar a lâmpada do corredor");
    await técnico.api.post(`/api/tickets/${resolved.body.id}/resolve`, { resolution: "Lâmpada substituida." });
    const convertResolved = await técnico.api.post(`/api/tickets/${resolved.body.id}/convert`, {});
    expectError(convertResolved, "CONFLICT");

    const cancelled = await openTicket(manager, "Pintar a sala de reunião");
    await manager.api.post(`/api/tickets/${cancelled.body.id}/cancel`, { reason: "Serviço suspenso pela diretoria" });
    const convertCancelled = await técnico.api.post(`/api/tickets/${cancelled.body.id}/convert`, {});
    expectError(convertCancelled, "CONFLICT");

    expect(await countRows("SELECT COUNT(*) AS total FROM work_orders")).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* Material utilizado                                                       */
  /* ------------------------------------------------------------------------ */

  it("registra material usado no chamado com baixa única de estoque", async () => {
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const ticket = await openTicket(técnico, "Repor água na copa do 2º andar");

    const used = await técnico.api.post<{ movements: { id: string; idempotentReplay: boolean }[] }>(
      `/api/tickets/${ticket.body.id}/materials`,
      {
        requestKey: "material-ticket-000001",
        fromLocationId: structure.warehouseId,
        items: [{ productId: aguaId, qty: 6 }],
      },
    );
    expect(used.status).toBe(201);
    expect(used.body.movements.length).toBe(1);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(44_000);

    const movement = await admin.api.get<{ items: { id: string; qtyMilli: number }[] }>(
      `/api/tickets/${ticket.body.id}/materials`,
    );
    expect(movement.body.items.length).toBe(1);
    expect(movement.body.items[0]?.id).toBe(used.body.movements[0]?.id);
    expect(movement.body.items[0]?.qtyMilli).toBe(6_000);

    const stored = await countRows(
      "SELECT COUNT(*) AS total FROM movements WHERE ref_type = 'ticket' AND ref_id = ? AND type = 'maintenance_use'",
      [ticket.body.id],
    );
    expect(stored).toBe(1);

    // Reenvio idêntico não desconta de novo.
    const replay = await técnico.api.post<{ idempotentReplay: boolean }>(
      `/api/tickets/${ticket.body.id}/materials`,
      {
        requestKey: "material-ticket-000001",
        fromLocationId: structure.warehouseId,
        items: [{ productId: aguaId, qty: 6 }],
      },
    );
    expect(replay.status).toBe(201);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(44_000);
  });

  it("recusa material sem saldo e em chamado convertido", async () => {
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");
    const ticket = await openTicket(técnico, "Limpeza pesada do deposito");

    const insufficient = await técnico.api.post(`/api/tickets/${ticket.body.id}/materials`, {
      requestKey: "material-sem-saldo-01",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 999 }],
    });
    expectError(insufficient, "INSUFFICIENT_STOCK");
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(50_000);
    expect(await countRows("SELECT COUNT(*) AS total FROM movements WHERE ref_type = 'ticket'")).toBe(0);

    await técnico.api.post(`/api/tickets/${ticket.body.id}/convert`, {});
    const converted = await técnico.api.post(`/api/tickets/${ticket.body.id}/materials`, {
      requestKey: "material-ticket-convertido",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 2 }],
    });
    expectError(converted, "CONFLICT");
  });

  /* ------------------------------------------------------------------------ */
  /* Filtros e ordenação                                                      */
  /* ------------------------------------------------------------------------ */

  it("filtra e ordena a lista por prioridade, status, texto é responsável", async () => {
    const manager = await createStaff("Gerente", "gerente@facil.test", managerRole);
    const técnico = await createTech("Técnico Silva", "tecnico@facil.test");

    const urgente = await openTicket(manager, "Falta de energia no 5º andar", "tc_eletrica", "urgent");
    await openTicket(manager, "Limpeza da copa", "tc_limpeza", "low");
    const vazamento = await openTicket(manager, "Vazamento no teto do auditório", "tc_hidraulica", "normal");
    await manager.api.post(`/api/tickets/${vazamento.body.id}/assign`, { assigneeId: técnico.id });
    await manager.api.post(`/api/tickets/${urgente.body.id}/resolve`, { resolution: "Gerador acionado." });

    const byPriority = await manager.api.get<{ items: Ticket[] }>("/api/tickets?priority=urgent");
    expect(byPriority.body.items.length).toBe(1);
    expect(byPriority.body.items[0]?.id).toBe(urgente.body.id);

    const byStatus = await manager.api.get<{ items: Ticket[] }>("/api/tickets?status=in_progress");
    expect(byStatus.body.items.map((t) => t.id)).toEqual([vazamento.body.id]);

    const openOnly = await manager.api.get<{ total: number }>("/api/tickets?open=true");
    expect(openOnly.body.total).toBe(2);

    const byCategory = await manager.api.get<{ items: Ticket[] }>("/api/tickets?categoryId=tc_hidraulica");
    expect(byCategory.body.items.length).toBe(1);

    const byText = await manager.api.get<{ items: Ticket[] }>("/api/tickets?search=audit");
    expect(byText.body.items.map((t) => t.id)).toEqual([vazamento.body.id]);

    const byAssignee = await manager.api.get<{ items: Ticket[] }>(`/api/tickets?assigneeId=${técnico.id}`);
    expect(byAssignee.body.items.map((t) => t.id)).toEqual([vazamento.body.id]);

    const byRequester = await manager.api.get<{ total: number }>(`/api/tickets?requesterId=${manager.id}`);
    expect(byRequester.body.total).toBe(3);

    // Ordenação: urgente primeiro; entre os demais, em andamento antes de aberto.
    const firstPage = await manager.api.get<{ items: Ticket[] }>("/api/tickets");
    expect(firstPage.body.items.map((t) => t.id)).toEqual([
      urgente.body.id,
      vazamento.body.id,
      ...firstPage.body.items.filter((t) => t.priority === "low").map((t) => t.id),
    ]);
  });

  /* ------------------------------------------------------------------------ */
  /* Anexos (F-08)                                                             */
  /* ------------------------------------------------------------------------ */

  it("anexo de documento em chamado fica com a gestão; técnico anexa foto (F-08)", async () => {
    const requester = await createRequester("Requisitante F08", "f08.requester@teste.local");
    const tech = await createTech("Técnico F08", "f08.tech@teste.local");
    const manager = await createStaff("Gerente F08", "f08.manager@teste.local", managerRole);

    const ticket = await openTicket(requester, "Vazamento na copa");

    // Técnico executante: documento bloqueado no servidor, não só na interface.
    const pdf = new FormData();
    pdf.set("file", new File([new Uint8Array(256)], "orcamento.pdf", { type: "application/pdf" }));
    pdf.set("entityType", "ticket");
    pdf.set("entityId", ticket.body.id);
    const asTechPdf = await tech.api.postRaw<{ error?: { message?: string } }>("/api/attachments", pdf);
    expect(asTechPdf.status).toBe(403);
    expect(String(asTechPdf.body.error?.message)).toContain("Documentos em chamados");

    // A foto (evidência de campo) continua permitida para quem enxerga o chamado.
    const photo = new FormData();
    photo.set("file", new File([new Uint8Array(256)], "antes.jpg", { type: "image/jpeg" }));
    photo.set("entityType", "ticket");
    photo.set("entityId", ticket.body.id);
    const asTechPhoto = await tech.api.postRaw<{ id: string }>("/api/attachments", photo);
    expect(asTechPhoto.status).toBe(201);

    // Gestão anexa o documento sem restrição.
    const asManager = new FormData();
    asManager.set("file", new File([new Uint8Array(256)], "orcamento.pdf", { type: "application/pdf" }));
    asManager.set("entityType", "ticket");
    asManager.set("entityId", ticket.body.id);
    const managerUpload = await manager.api.postRaw<{ id: string }>("/api/attachments", asManager);
    expect(managerUpload.status).toBe(201);

    expect(
      await countRows("SELECT COUNT(*) AS total FROM attachments WHERE entity_type = 'ticket'"),
    ).toBe(2);
  });

  /* ------------------------------------------------------------------------ */
  /* Auxiliares do teste                                                      */
  /* ------------------------------------------------------------------------ */

  async function createRequester(name: string, email: string): Promise<Actor> {
    return createUser(admin, { name, email, roleId: requesterRole });
  }

  async function createTech(name: string, email: string): Promise<Actor> {
    return createUser(admin, { name, email, roleId: techRole });
  }

  async function createStaff(name: string, email: string, roleId: string): Promise<Actor> {
    return createUser(admin, { name, email, roleId });
  }

  async function openTicket(
    actor: Actor,
    title: string,
    categoryId = "tc_limpeza",
    priority: "low" | "normal" | "high" | "urgent" = "normal",
  ) {
    const created = await actor.api.post<{ id: string; code: string }>("/api/tickets", {
      title,
      description: `Detalhes do chamado: ${title}.`,
      categoryId,
      locationId: structure.roomId,
      priority,
    });
    if (created.status !== 201) {
      throw new Error(`Falha ao abrir chamado: ${created.status} ${JSON.stringify(created.body)}`);
    }
    return created;
  }

  async function firstTicketId(actor: Actor): Promise<string> {
    const list = await actor.api.get<{ items: Ticket[] }>("/api/tickets");
    const first = list.body.items[0];
    assert(first, "Nenhum ticket encontrado para o usuário.");
    return first.id;
  }
});

interface Ticket {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  categoryName: string | null;
  requesterName: string;
  assigneeId: string | null;
  workOrderId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  cancelReason: string | null;
}

interface TicketDetail {
  ticket: Ticket;
  comments: { id: string; body: string; isInternal: boolean }[];
  materials: { movementId: string }[];
  history: { id: string; action: string; actorName: string }[];
}
