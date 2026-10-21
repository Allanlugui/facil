import { beforeEach, describe, expect, it } from "vitest";
import {
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  queryAll,
  queryOne,
  resetDatabase,
  seedStock,
  setupAdmin,
  stockMilli,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Cenários 23 a 27 da especificação: relatórios reais (posição, movimentos,
 * consumo, chamados, OS e compras), exportação em CSV, painel operacional,
 * trilha de auditoria consultável e notificações por usuário.
 */
describe("relatórios, painel, auditoria e notificações", () => {
  let admin: Actor;
  let structure: Structure;
  let cafeId: string;
  let aguaId: string;
  let papelId: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    cafeId = await createProduct(admin, { name: "Café 500g", sku: "CAF-500" });
    aguaId = await createProduct(admin, { name: "Água 500ml", sku: "AGU-500" });
    papelId = await createProduct(admin, { name: "Papel toalha", sku: "PAP-TOALHA", minQty: 20 });
    await seedStock(admin, structure.warehouseId, cafeId, 40);
    await seedStock(admin, structure.roomId, aguaId, 10);
    await seedStock(admin, structure.warehouseId, aguaId, 6);
    await seedStock(admin, structure.warehouseId, papelId, 5);
  });

  /* ------------------------------------------------------------------------ */
  /* Posição de estoque                                                       */
  /* ------------------------------------------------------------------------ */

  it("posição de estoque reflete movimentos e aceita filtros", async () => {
    const position = await admin.api.get<StockReport>("/api/reports/stock");
    expect(position.status).toBe(200);
    expect(position.body.scope).toBe("per_location");
    expect(position.body.items.length).toBe(4);
    expect(position.body.totals.qtyMilli).toBe(61_000);
    expect(row(position.body.items, "CAF-500", structure.warehouseId)?.qtyMilli).toBe(40_000);
    expect(row(position.body.items, "AGU-500", structure.roomId)?.qtyMilli).toBe(10_000);

    const byLocation = await admin.api.get<StockReport>(
      `/api/reports/stock?locationId=${structure.warehouseId}`,
    );
    expect(byLocation.body.items.length).toBe(3);
    expect(byLocation.body.totals.qtyMilli).toBe(51_000);

    const bySearch = await admin.api.get<StockReport>("/api/reports/stock?search=AGU");
    expect(bySearch.body.items.length).toBe(2);
    expect(bySearch.body.items.every((i) => i.sku === "AGU-500")).toBe(true);

    const lowOnly = await admin.api.get<StockReport>("/api/reports/stock?onlyLow=true");
    expect(lowOnly.body.items.map((i) => i.sku)).toEqual(["PAP-TOALHA"]);
    expect(lowOnly.body.items[0]?.isBelowMin).toBe(true);
    expect(lowOnly.body.items[0]?.qtyMilli).toBe(5_000);

    const inactiveFiltered = await admin.api.get<StockReport>("/api/reports/stock?activeOnly=true");
    expect(inactiveFiltered.body.items.length).toBe(4);

    const issue = await admin.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-relatorio-0001",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      items: [{ productId: cafeId, qty: 15 }],
    });
    expect(issue.status).toBe(201);

    const after = await admin.api.get<StockReport>("/api/reports/stock?search=CAF");
    expect(row(after.body.items, "CAF-500", structure.warehouseId)?.qtyMilli).toBe(25_000);
    expect(row(after.body.items, "CAF-500", structure.roomId)?.qtyMilli).toBe(15_000);

    // Transferência não muda o total, só a distribuição.
    const completed = await admin.api.get<StockReport>("/api/reports/stock");
    expect(completed.body.totals.qtyMilli).toBe(61_000);
    expect(position.body.items.every((i) => i.updatedAt)).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /* Movimentos                                                               */
  /* ------------------------------------------------------------------------ */

  it("relatório de movimentos filtra por tipo, produto, usuário, local e período", async () => {
    const keeper = await createUser(admin, {
      name: "Estoquista Nunes",
      email: "estoquista@facil.test",
      roleId: await findRoleId("stock_keeper"),
    });

    const issue = await admin.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-movimentos-0001",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      reason: "Reposição do bebedouro",
      items: [{ productId: cafeId, qty: 10 }],
    });
    expect(issue.status).toBe(201);

    const transfer = await keeper.api.post("/api/stock/movements", {
      type: "transfer",
      requestKey: "transferencia-movimentos-0001",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      items: [{ productId: papelId, qty: 2 }],
    });
    expect(transfer.status).toBe(201);

    const all = await admin.api.get<MovementReport>("/api/reports/movements");
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(6);
    expect(all.body.items.length).toBe(6);
    expect(all.body.items[0]?.sku).toBe("PAP-TOALHA");
    expect(all.body.items[0]?.userName).toBe(keeper.name);
    expect(all.body.items[0]?.fromLocationPath).toBeTruthy();

    const byType = new Map(all.body.byType.map((t) => [t.type, t]));
    expect(byType.get("issue")?.count).toBe(1);
    expect(byType.get("issue")?.qtyMilli).toBe(10_000);
    expect(byType.get("transfer")?.count).toBe(1);
    expect(byType.get("return")?.count).toBe(4);

    const issues = await admin.api.get<MovementReport>("/api/reports/movements?type=issue");
    expect(issues.body.total).toBe(1);
    expect(issues.body.items[0]?.productName).toBe("Café 500g");
    expect(issues.body.items[0]?.fromLocationPath).toBeTruthy();
    expect(issues.body.items[0]?.toLocationPath).toBeTruthy();

    const byProduct = await admin.api.get<MovementReport>(`/api/reports/movements?productId=${cafeId}`);
    expect(byProduct.body.total).toBe(2);

    const byUser = await admin.api.get<MovementReport>(`/api/reports/movements?userId=${keeper.id}`);
    expect(byUser.body.total).toBe(1);
    expect(byUser.body.items[0]?.type).toBe("transfer");

    const byLocation = await admin.api.get<MovementReport>(
      `/api/reports/movements?locationId=${structure.roomId}`,
    );
    // Toca a sala: carga inicial, saída de café e transferência de papel.
    expect(byLocation.body.total).toBe(3);

    const search = await admin.api.get<MovementReport>("/api/reports/movements?search=bebedouro");
    expect(search.body.total).toBe(1);

    const yearStart = "2000-01-01T00:00:00.000Z";
    const fullWindow = await admin.api.get<MovementReport>(
      `/api/reports/movements?from=${yearStart}&to=${new Date(Date.now() + 86_400_000).toISOString()}`,
    );
    expect(fullWindow.body.total).toBe(6);

    const pastWindow = await admin.api.get<MovementReport>(
      "/api/reports/movements?from=2020-01-01T00:00:00.000Z&to=2020-01-31T00:00:00.000Z",
    );
    expect(pastWindow.body.total).toBe(0);

    const invalid = await admin.api.get("/api/reports/movements?from=ontem");
    expectError(invalid, "BAD_REQUEST");

    const inverted = await admin.api.get(
      `/api/reports/movements?from=${new Date().toISOString()}&to=${yearStart}`,
    );
    expectError(inverted, "BAD_REQUEST");
  });

  /* ------------------------------------------------------------------------ */
  /* Consumo                                                                  */
  /* ------------------------------------------------------------------------ */

  it("relatório de consumo agrupa por dimensão e ignora lançamento cancelado", async () => {
    const now = new Date();
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const periodStart = isoDate(previousMonth);
    const periodEnd = isoDate(new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), 7)));

    const measured = await admin.api.post<{ id: string }>("/api/consumption", {
      requestKey: "consumo-relatorio-0001",
      periodStart,
      periodEnd,
      locationId: structure.roomId,
      scopeNote: "Andares 1 a 3",
      items: [{ productId: cafeId, qty: 7.5 }],
    });
    expect(measured.status).toBe(201);

    const cancelled = await admin.api.post<{ id: string }>("/api/consumption", {
      requestKey: "consumo-relatorio-0002",
      periodStart,
      periodEnd,
      locationId: structure.roomId,
      items: [{ productId: aguaId, qty: 20 }],
    });
    expect(cancelled.status).toBe(201);
    const cancel = await admin.api.post(`/api/consumption/${cancelled.body.id}/cancel`, {
      reason: "Lançamento em duplicidade",
      requestKey: "consumo-relatorio-0002-cancel",
    });
    expect(cancel.status).toBe(200);

    const report = await admin.api.get<ConsumptionReport>("/api/reports/consumption");
    expect(report.status).toBe(200);
    expect(report.body.groupBy).toBe("product");
    expect(report.body.totals.qtyMilli).toBe(7_500);
    expect(report.body.totals.recordCount).toBe(1);
    expect(report.body.groups.length).toBe(1);
    expect(report.body.groups[0]?.label).toBe("Café 500g");
    expect(report.body.groups[0]?.recordCount).toBe(1);
    expect(report.body.byPeriodicity[0]?.periodicity).toBe("weekly");

    const byLocation = await admin.api.get<ConsumptionReport>("/api/reports/consumption?groupBy=location");
    expect(byLocation.body.groups.length).toBe(1);
    expect(byLocation.body.groups[0]?.key).toBe(structure.roomId);

    const byDay = await admin.api.get<ConsumptionReport>("/api/reports/consumption?groupBy=day");
    expect(byDay.body.groups[0]?.label).toBe(periodEnd);
    const byMonth = await admin.api.get<ConsumptionReport>("/api/reports/consumption?groupBy=month");
    expect(byMonth.body.groups[0]?.label).toBe(periodEnd.slice(0, 7));

    const outside = await admin.api.get<ConsumptionReport>(
      "/api/reports/consumption?from=2020-01-01T00:00:00.000Z&to=2020-01-31T00:00:00.000Z",
    );
    expect(outside.body.totals.qtyMilli).toBe(0);
    expect(outside.body.totals.recordCount).toBe(0);

    const invalidGroup = await admin.api.get("/api/reports/consumption?groupBy=corredor");
    expectError(invalidGroup, "BAD_REQUEST");
  });

  /* ------------------------------------------------------------------------ */
  /* Chamados e ordens de serviço                                             */
  /* ------------------------------------------------------------------------ */

  it("relatório de chamados agrega status, categoria, prioridade e tempo de resolução", async () => {
    const hydraulics = await admin.api.post<{ id: string }>("/api/tickets", {
      title: "Vazamento na copa do 3º andar",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "high",
    });
    await admin.api.post<{ id: string }>("/api/tickets", {
      title: "Lâmpada queimada no corredor",
      categoryId: "tc_eletrica",
      locationId: structure.warehouseId,
      priority: "low",
    });
    const resolved = await admin.api.post<{ id: string }>("/api/tickets", {
      title: "Porta da sala de reunião travando",
      categoryId: "tc_mobiliario",
      locationId: structure.roomId,
      priority: "urgent",
    });
    const resolve = await admin.api.post(`/api/tickets/${resolved.body.id}/resolve`, {
      resolution: "Ajuste da dobradiça e lubrificação.",
    });
    expect(resolve.status).toBe(200);

    const report = await admin.api.get<TicketReport>("/api/reports/tickets");
    expect(report.status).toBe(200);
    const byStatus = new Map(report.body.byStatus.map((s) => [s.status, s.count]));
    expect(byStatus.get("open")).toBe(2);
    expect(byStatus.get("resolved")).toBe(1);
    const byCategory = new Map(report.body.byCategory.map((c) => [c.categoryName, c]));
    expect(byCategory.get("Hidráulica")?.count).toBe(1);
    expect(byCategory.get("Mobiliário")?.resolvedCount).toBe(1);
    const byPriority = new Map(report.body.byPriority.map((p) => [p.priority, p.count]));
    expect(byPriority.get("urgent")).toBe(1);
    expect(byPriority.get("high")).toBe(1);
    expect(byPriority.get("low")).toBe(1);
    expect(report.body.timing.resolvedCount).toBe(1);
    expect(report.body.timing.convertedCount).toBe(0);
    expect(report.body.timing.avgResolutionHours).toBeGreaterThanOrEqual(0);

    const byLocation = await admin.api.get<TicketReport>(
      `/api/reports/tickets?locationId=${structure.warehouseId}`,
    );
    expect(byLocation.body.byStatus.reduce((sum, s) => sum + s.count, 0)).toBe(1);

    // Chamado convertido sai de "open" e entra em "converted".
    const converted = await admin.api.post(`/api/tickets/${hydraulics.body.id}/convert`, {
      title: "Reparar vazamento da copa",
    });
    expect(converted.status).toBe(201);
    const after = await admin.api.get<TicketReport>("/api/reports/tickets");
    const statuses = new Map(after.body.byStatus.map((s) => [s.status, s.count]));
    expect(statuses.get("open")).toBe(1);
    expect(statuses.get("converted")).toBe(1);
  });

  it("relatório de ordens de serviço agrega status, responsável e material aplicado", async () => {
    const tech = await createUser(admin, {
      name: "Técnico Lima",
      email: "tecnico@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });
    const open = await admin.api.post<{ id: string; code: string }>("/api/workorders", {
      title: "Revisar bomba do reservatório",
      locationId: structure.roomId,
      assigneeId: tech.id,
      priority: "high",
    });
    expect(open.status).toBe(201);

    const second = await admin.api.post<{ id: string }>("/api/workorders", {
      title: "Pintura da guarita",
      locationId: structure.warehouseId,
    });
    expect(second.status).toBe(201);

    const started = await tech.api.post(`/api/workorders/${open.body.id}/status`, {
      status: "in_progress",
    });
    expect(started.status).toBe(200);

    const used = await tech.api.post(`/api/workorders/${open.body.id}/materials`, {
      requestKey: "material-os-relatorio-0001",
      fromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 2 }],
    });
    expect(used.status).toBe(201);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(4_000);

    const report = await admin.api.get<WorkOrderReport>("/api/reports/workorders");
    expect(report.status).toBe(200);
    const byStatus = new Map(report.body.byStatus.map((s) => [s.status, s.count]));
    expect(byStatus.get("in_progress")).toBe(1);
    expect(byStatus.get("open")).toBe(1);
    const byAssignee = new Map(report.body.byAssignee.map((a) => [a.assigneeName, a]));
    expect(byAssignee.get(tech.name)?.count).toBe(1);
    expect(byAssignee.get("Sem responsável")?.count).toBe(1);
    expect(report.body.materialsQtyMilli).toBe(2_000);
    expect(report.body.timing.avgCompletionHours).toBeNull();

    const scoped = await admin.api.get<WorkOrderReport>(
      `/api/reports/workorders?locationId=${structure.warehouseId}`,
    );
    expect(scoped.body.byStatus.reduce((sum, s) => sum + s.count, 0)).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Compras                                                                  */
  /* ------------------------------------------------------------------------ */

  it("relatório de compras soma pendências, recebimentos e valor", async () => {
    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const buyer = await createUser(admin, {
      name: "Comprador Souza",
      email: "comprador@facil.test",
      roleId: await findRoleId("buyer"),
    });
    const supplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Distribuidora Central",
    });
    expect(supplier.status).toBe(201);

    const request = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Reposição de água",
      submit: true,
      items: [{ productId: aguaId, qty: 20 }],
    });
    expect(request.status).toBe(201);
    const detail = await buyer.api.get<{ items: { id: string }[] }>(
      `/api/purchases/${request.body.id}`,
    );
    await manager.api.post(`/api/purchases/${request.body.id}/decide`, { decision: "approved" });
    const ordered = await buyer.api.post(`/api/purchases/${request.body.id}/order`, {
      supplierId: supplier.body.id,
      items: [{ itemId: detail.body.items[0]!.id, qtyOrdered: 20, unitPrice: 4.25 }],
    });
    expect(ordered.status).toBe(200);
    const receipt = await buyer.api.post(`/api/purchases/${request.body.id}/receipts`, {
      requestKey: "recebimento-relatorio-0001",
      locationId: structure.warehouseId,
      documentRef: "NF-e 987",
      items: [{ requestItemId: detail.body.items[0]!.id, receivedQty: 8 }],
    });
    expect(receipt.status).toBe(201);

    const report = await admin.api.get<PurchaseReport>("/api/reports/purchases");
    expect(report.status).toBe(200);
    const byStatus = new Map(report.body.byStatus.map((s) => [s.status, s.count]));
    expect(byStatus.get("partially_received")).toBe(1);
    expect(report.body.quantities.expectedQtyMilli).toBe(20_000);
    expect(report.body.quantities.receivedQtyMilli).toBe(8_000);
    expect(report.body.quantities.pendingQtyMilli).toBe(12_000);
    expect(report.body.receipts.count).toBe(1);
    expect(report.body.receipts.valueCents).toBe(3_400);
    expect(report.body.receipts.discrepancyCount).toBe(0);
    expect(report.body.bySupplier[0]?.supplierName).toBe("Distribuidora Central");
    expect(report.body.bySupplier[0]?.qtyMilli).toBe(8_000);
    // F-03: o pedido também aparece por fornecedor, com valor comprometido.
    expect(report.body.ordersBySupplier[0]?.supplierName).toBe("Distribuidora Central");
    expect(report.body.ordersBySupplier[0]?.qtyMilli).toBe(20_000);
    expect(report.body.ordersBySupplier[0]?.valueCents).toBe(8_500);
    // F-04: visão do ciclo por solicitação (sem cotação neste cenário).
    expect(report.body.quotes.total).toBe(0);
    expect(report.body.requests.length).toBe(1);
    expect(report.body.requests[0]?.requesterName).toBe("Comprador Souza");
    expect(report.body.requests[0]?.supplierNames).toBe("Distribuidora Central");
    expect(report.body.requests[0]?.orderedValueCents).toBe(8_500);
    expect(report.body.requests[0]?.receivedQtyMilli).toBe(8_000);
    expect(report.body.requests[0]?.receiptCount).toBe(1);

    const outside = await admin.api.get<PurchaseReport>(
      "/api/reports/purchases?from=2020-01-01T00:00:00.000Z&to=2020-01-31T00:00:00.000Z",
    );
    expect(outside.body.byStatus.length).toBe(0);

    // Data do calendário vale o dia inteiro: "até hoje" inclui o que aconteceu hoje.
    const today = new Date().toISOString().slice(0, 10);
    const dateOnly = await admin.api.get<PurchaseReport>(`/api/reports/purchases?to=${today}`);
    expect(dateOnly.status).toBe(200);
    expect(dateOnly.body.byStatus.length).toBe(1);
    expect(dateOnly.body.receipts.count).toBe(1);
    expect(dateOnly.body.requests.length).toBe(1);
  });

  it("F-03/F-04: cotações, fornecedor do pedido, filtro de situação e exportação ampliada", async () => {
    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const buyer = await createUser(admin, {
      name: "Comprador Souza",
      email: "comprador@facil.test",
      roleId: await findRoleId("buyer"),
    });
    const supplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Distribuidora Central",
    });
    const other = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Papelaria Norte",
    });
    expect(supplier.status).toBe(201);
    expect(other.status).toBe(201);

    // Solicitação em cotação com duas propostas: uma aprovada, a outra não escolhida.
    const quoted = await buyer.api.post<{ id: string; code: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Reposição de café",
      submit: true,
      items: [{ productId: cafeId, qty: 6 }],
    });
    expect(quoted.status).toBe(201);
    const detail = await buyer.api.get<{ items: { id: string }[] }>(`/api/purchases/${quoted.body.id}`);
    await manager.api.post(`/api/purchases/${quoted.body.id}/decide`, {
      decision: "approved",
      items: [{ itemId: detail.body.items[0]!.id, purchaseMode: "quote" }],
    });
    const firstQuote = await buyer.api.post<{ id: string }>(`/api/purchases/${quoted.body.id}/quotes`, {
      supplierId: supplier.body.id,
      items: [{ itemId: detail.body.items[0]!.id, unitPrice: 22 }],
    });
    const winQuote = await buyer.api.post<{ id: string; code: string }>(`/api/purchases/${quoted.body.id}/quotes`, {
      supplierId: other.body.id,
      items: [{ itemId: detail.body.items[0]!.id, unitPrice: 19.5 }],
    });
    expect(firstQuote.status).toBe(201);
    expect(winQuote.status).toBe(201);
    await buyer.api.post(`/api/purchases/${quoted.body.id}/quotes/return`, {});
    const approved = await manager.api.post(`/api/purchases/${quoted.body.id}/quotes/${winQuote.body.id}/approve`, {});
    expect(approved.status).toBe(200);
    const ordered = await buyer.api.post(`/api/purchases/${quoted.body.id}/order`, {
      supplierId: other.body.id,
      items: [{ itemId: detail.body.items[0]!.id, qtyOrdered: 6 }],
    });
    expect(ordered.status).toBe(200);

    const report = await admin.api.get<PurchaseReport>("/api/reports/purchases");
    expect(report.status).toBe(200);

    // F-04: cotações do período por situação.
    expect(report.body.quotes.total).toBe(2);
    const quotesByStatus = new Map(report.body.quotes.byStatus.map((entry) => [entry.status, entry.count]));
    expect(quotesByStatus.get("approved")).toBe(1);
    expect(quotesByStatus.get("rejected")).toBe(1);

    // F-03: onde está comprando -- fornecedor vencedor com valor herdado da proposta.
    const supplierRow = report.body.ordersBySupplier.find((row) => row.supplierName === "Papelaria Norte");
    expect(supplierRow?.itemCount).toBe(1);
    expect(supplierRow?.qtyMilli).toBe(6_000);
    expect(supplierRow?.valueCents).toBe(11_700);

    // F-04: ciclo completo por solicitação.
    const requestRow = report.body.requests.find((row) => row.code === quoted.body.code);
    expect(requestRow?.status).toBe("ordered");
    expect(requestRow?.requesterName).toBe("Comprador Souza");
    expect(requestRow?.itemCount).toBe(1);
    expect(requestRow?.quoteItemCount).toBe(1);
    expect(requestRow?.quoteCount).toBe(2);
    expect(requestRow?.supplierNames).toBe("Papelaria Norte");
    expect(requestRow?.orderedValueCents).toBe(11_700);
    expect(requestRow?.expectedQtyMilli).toBe(6_000);
    expect(requestRow?.receivedQtyMilli).toBe(0);

    // Filtro de situação: só a solicitação em pedido aparece.
    const filtered = await admin.api.get<PurchaseReport>("/api/reports/purchases?status=ordered");
    expect(filtered.body.requests.map((row) => row.code)).toEqual([quoted.body.code]);
    const receivedOnly = await admin.api.get<PurchaseReport>("/api/reports/purchases?status=received");
    expect(receivedOnly.body.requests.length).toBe(0);
    const invalid = await admin.api.get("/api/reports/purchases?status=inventado");
    expectError(invalid, "BAD_REQUEST");

    // Exportação ampliada: modo, cotação aprovada, referência, valor total e recebimento.
    const csv = await admin.api.fetchRaw("GET", "/api/reports/export?report=purchases");
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text).toContain("Modo;Cotação;Referência do pedido;Fornecedor;Preço unitário (R$);Valor total (R$);Último recebimento em");
    expect(text).toContain("Cotação");
    expect(text).toContain(winQuote.body.code);
    expect(text).toContain("Papelaria Norte");
    expect(text).toContain("117.00");

    // O filtro de situação também vale para a exportação.
    const filteredCsv = await admin.api.fetchRaw("GET", "/api/reports/export?report=purchases&status=received");
    expect(filteredCsv.status).toBe(200);
    expect((await filteredCsv.text()).trim().split(/\r?\n/).length).toBe(1);
    const invalidCsv = await admin.api.fetchRaw("GET", "/api/reports/export?report=purchases&status=inventado");
    expect(invalidCsv.status).toBe(400);
  });

  /* ------------------------------------------------------------------------ */
  /* Exportação CSV                                                           */
  /* ------------------------------------------------------------------------ */

  it("exporta CSV real e recusa relatório inexistente", async () => {
    const stock = await admin.api.fetchRaw("GET", "/api/reports/export?report=stock-position");
    expect(stock.status).toBe(200);
    expect(stock.headers.get("content-type")).toContain("text/csv");
    expect(stock.headers.get("content-disposition")).toContain("posicao-estoque");
    const stockCsv = await stock.text();
    // CSV separado por ponto e virgula, o formato que o Excel pt-BR abre direto.
    expect(stockCsv).toContain("Produto;SKU;");
    expect(stockCsv).toContain("Café 500g");
    expect(stockCsv).toContain("CAF-500");
    // Três produtos com saldo em duas linhas cada: 4 linhas de dados + cabecalho.
    expect(stockCsv.trim().split(/\r?\n/).length).toBe(5);

    const movements = await admin.api.fetchRaw("GET", "/api/reports/export?report=movements");
    expect(movements.status).toBe(200);
    const movementsCsv = await movements.text();
    expect(movementsCsv).toContain("Data;Tipo;Produto");
    expect(movementsCsv).toContain("Carga inicial de estoque");
    expect(movementsCsv.trim().split(/\r?\n/).length).toBe(5);

    const consumption = await admin.api.fetchRaw("GET", "/api/reports/export?report=consumption");
    expect(consumption.status).toBe(200);
    expect(await consumption.text()).toContain("Periodicidade");

    const unknown = await admin.api.get<{ error: { details: { available: string[] } } }>(
      "/api/reports/export?report=inventado",
    );
    expectError(unknown, "BAD_REQUEST");
    expect(unknown.body.error.details.available).toContain("inventory-variances");

    const requester = await createUser(admin, {
      name: "Solicitante",
      email: "solicitante@facil.test",
      roleId: await findRoleId("requester"),
    });
    const forbidden = await requester.api.get("/api/reports/export?report=stock-position");
    expectError(forbidden, "FORBIDDEN");
    expect(await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'permission_denied'")).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Painel                                                                   */
  /* ------------------------------------------------------------------------ */

  it("painel resume a operação real e mantem alertas coerentes", async () => {
    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const buyer = await createUser(admin, {
      name: "Comprador Souza",
      email: "comprador@facil.test",
      roleId: await findRoleId("buyer"),
    });
    const tech = await createUser(admin, {
      name: "Técnico Lima",
      email: "tecnico@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });

    // Chamado crítico em aberto.
    await admin.api.post("/api/tickets", {
      title: "Vazamento na copa do 3º andar",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "urgent",
    });
    // Ordem de serviço em execução.
    const order = await admin.api.post<{ id: string }>("/api/workorders", {
      title: "Revisar bomba do reservatório",
      locationId: structure.roomId,
      assigneeId: tech.id,
    });
    await tech.api.post(`/api/workorders/${order.body.id}/status`, { status: "in_progress" });
    // Solicitação de compra aguardando aprovação.
    await buyer.api.post("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      submit: true,
      items: [{ productId: cafeId, qty: 6 }],
    });
    // Inventário aberto no almoxarifado.
    const inventory = await admin.api.post<{ id: string }>("/api/inventories", {
      locationId: structure.warehouseId,
    });
    expect(inventory.status).toBe(201);
    // Consumo medido no período corrente.
    const today = isoDate(new Date());
    const consumption = await admin.api.post("/api/consumption", {
      requestKey: "consumo-painel-0001",
      periodStart: today,
      periodEnd: today,
      locationId: structure.roomId,
      items: [{ productId: cafeId, qty: 3 }],
    });
    expect(consumption.status).toBe(201);

    const summary = await admin.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.generatedAt).toBeTruthy();
    expect(summary.body.stock.itemCount).toBe(4);
    expect(summary.body.stock.totalQtyMilli).toBe(61_000);
    expect(summary.body.stock.locationCount).toBe(2);
    expect(summary.body.stock.lowStockScope).toBe("per_location");
    expect(summary.body.stock.lowStockCount).toBe(1);
    expect(summary.body.stock.lowStock[0]?.sku).toBe("PAP-TOALHA");
    expect(summary.body.stock.lowStock[0]?.locationId).toBe(structure.warehouseId);
    expect(summary.body.consumption.periodDays).toBe(30);
    expect(summary.body.consumption.qtyMilli).toBe(3_000);
    expect(summary.body.consumption.recordCount).toBe(1);
    expect(summary.body.tickets.openCount).toBe(1);
    expect(summary.body.tickets.criticalCount).toBe(1);
    expect(summary.body.workOrders.openCount).toBe(1);
    expect(summary.body.workOrders.inProgressCount).toBe(1);
    expect(summary.body.purchases.pendingApprovalCount).toBe(1);
    expect(summary.body.purchases.openRequestCount).toBe(1);
    expect(summary.body.inventories.openCount).toBe(1);
    // O admin também aprova compras: a solicitação enviada gera aviso para ele.
    expect(summary.body.notifications.unreadCount).toBe(1);
    expect(summary.body.recentMovements.length).toBe(4);
    expect(summary.body.recentMovements[0]?.productName).toBeTruthy();

    // O gerente tem uma notificação pendente de aprovação.
    const managerSummary = await manager.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(managerSummary.body.notifications.unreadCount).toBe(1);

    // --- Visões por perfil (F-20) ------------------------------------------
    // A gestão cria uma etapa obrigatória na OS do técnico: ela aparece como
    // ordem travada no painel de gestão e como pendência no painel do técnico.
    const checklistItem = await manager.api.post<{ id: string }>(
      `/api/workorders/${order.body.id}/checklist`,
      { label: "Conferir vedação da bomba" },
    );
    expect(checklistItem.status).toBe(201);

    const techSummary = await tech.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(techSummary.body.workOrders.mine.openCount).toBe(1);
    expect(techSummary.body.workOrders.mine.checklistPendingCount).toBe(1);
    expect(techSummary.body.workOrders.mineOpen.length).toBe(1);
    expect(techSummary.body.workOrders.mineOpen[0]?.id).toBe(order.body.id);
    expect(techSummary.body.workOrders.mineOpen[0]?.checklistManagerPending).toBe(1);
    // O técnico não aprova compras nem enxerga a fila de gestão.
    expect(techSummary.body.purchases.pendingApproval.length).toBe(0);
    expect(techSummary.body.workOrders.managerChecklistPending.length).toBe(0);

    const managerHome = await manager.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(managerHome.body.workOrders.managerChecklistPending.length).toBe(1);
    expect(managerHome.body.workOrders.managerChecklistPending[0]?.id).toBe(order.body.id);
    expect(managerHome.body.workOrders.managerChecklistPending[0]?.pendingCount).toBe(1);
    expect(managerHome.body.purchases.pendingApproval.length).toBe(1);
    expect(managerHome.body.purchases.pendingApproval[0]?.requesterName).toBe("Comprador Souza");

    // A administração também enxerga a fila (mesma visão de gestão).
    const adminHome = await admin.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(adminHome.body.purchases.pendingApproval.length).toBe(1);
    expect(adminHome.body.workOrders.managerChecklistPending.length).toBe(1);

    const alerts = await admin.api.get<{
      lowStockCount: number;
      waitingMaterialCount: number;
      criticalTicketCount: number;
      pendingApprovalCount: number;
    }>("/api/dashboard/alerts");
    expect(alerts.status).toBe(200);
    expect(alerts.body.lowStockCount).toBe(summary.body.stock.lowStockCount);
    expect(alerts.body.criticalTicketCount).toBe(1);
    expect(alerts.body.pendingApprovalCount).toBe(1);
    expect(alerts.body.waitingMaterialCount).toBe(0);
  });

  it("painel não expoe dados de outras áreas ao solicitante", async () => {
    const requester = await createUser(admin, {
      name: "Solicitante Painel",
      email: "solicitante.painel@facil.test",
      roleId: await findRoleId("requester"),
    });

    // Chamado urgente de outro usuário: não pode aparecer para o solicitante.
    await admin.api.post("/api/tickets", {
      title: "Chamado de outra pessoa",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "urgent",
    });
    // Chamado do próprio solicitante: este sim conta.
    const own = await requester.api.post<{ id: string }>("/api/tickets", {
      title: "Meu chamado",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "normal",
    });
    expect(own.status).toBe(201);

    const summary = await requester.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(summary.status).toBe(200);
    // Somente o chamado do próprio solicitante entra na contagem.
    expect(summary.body.tickets.openCount).toBe(1);
    expect(summary.body.tickets.criticalCount).toBe(0);
    // Blocos de áreas que ele não acessa ficam zerados (sem vazamento).
    expect(summary.body.workOrders.openCount).toBe(0);
    expect(summary.body.purchases.openRequestCount).toBe(0);
    expect(summary.body.inventories.openCount).toBe(0);
    expect(summary.body.stock.itemCount).toBe(0);
    expect(summary.body.stock.lowStockCount).toBe(0);
    expect(summary.body.consumption.recordCount).toBe(0);
    expect(summary.body.recentMovements.length).toBe(0);
    // Visão por perfil (F-20): a lista pessoal tem apenas o chamado dele e
    // nenhuma fila de outra área aparece (compras, OS, checklist de gestão).
    expect(summary.body.tickets.mine.length).toBe(1);
    expect(summary.body.tickets.mine[0]?.id).toBe(own.body.id);
    expect(summary.body.workOrders.mineOpen.length).toBe(0);
    expect(summary.body.workOrders.mine.openCount).toBe(0);
    expect(summary.body.purchases.pendingApproval.length).toBe(0);
    expect(summary.body.workOrders.managerChecklistPending.length).toBe(0);

    const alerts = await requester.api.get<{
      lowStockCount: number;
      waitingMaterialCount: number;
      criticalTicketCount: number;
      pendingApprovalCount: number;
    }>("/api/dashboard/alerts");
    expect(alerts.status).toBe(200);
    expect(alerts.body.lowStockCount).toBe(0);
    expect(alerts.body.waitingMaterialCount).toBe(0);
    expect(alerts.body.pendingApprovalCount).toBe(0);
    // O chamado urgente de outro usuário não dispara alerta para ele.
    expect(alerts.body.criticalTicketCount).toBe(0);
  });

  it("painel por perfil da fase 2: comprador, estoque, limpeza e recepcao", async () => {
    const buyer = await createUser(admin, {
      name: "Comprador Fase Dois",
      email: "comprador.fase2@facil.test",
      roleId: await findRoleId("buyer"),
    });
    const keeper = await createUser(admin, {
      name: "Estoque Fase Dois",
      email: "estoque.fase2@facil.test",
      roleId: await findRoleId("stock_keeper"),
    });
    const cleaner = await createUser(admin, {
      name: "Limpeza Fase Dois",
      email: "limpeza.fase2@facil.test",
      roleId: await findRoleId("cleaning_staff"),
    });
    const reception = await createUser(admin, {
      name: "Recepção Fase Dois",
      email: "recepcao.fase2@facil.test",
      roleId: await findRoleId("receptionist"),
    });

    /* --- Comprador: a fila dupla da rotina (registrar pedido e receber) ---- */
    const request = await buyer.api.post<{ id: string; code: string }>("/api/purchases", {
      workflowVersion: 1,
      justification: "Reposição de água para o andar",
      submit: true,
      items: [{ productId: aguaId, qty: 12 }],
    });
    expect(request.status).toBe(201);
    const decided = await admin.api.post(`/api/purchases/${request.body.id}/decide`, {
      decision: "approved",
    });
    expect(decided.status).toBe(200);

    const awaiting = await buyer.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(awaiting.body.purchases.awaitingOrder.length).toBe(1);
    expect(awaiting.body.purchases.awaitingOrder[0]?.id).toBe(request.body.id);
    expect(awaiting.body.purchases.awaitingOrder[0]?.code).toBe(request.body.code);
    // Sem permissão de estoque (0014), o comprador não enxerga saldos.
    expect(awaiting.body.stock.itemCount).toBe(0);
    expect(awaiting.body.stock.lowStockCount).toBe(0);
    expect(awaiting.body.recentMovements.length).toBe(0);

    const supplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Fornecedor Fase Dois",
    });
    expect(supplier.status).toBe(201);
    const detail = await buyer.api.get<{ items: { id: string }[] }>(
      `/api/purchases/${request.body.id}`,
    );
    const ordered = await buyer.api.post(`/api/purchases/${request.body.id}/order`, {
      supplierId: supplier.body.id,
      items: [{ itemId: detail.body.items[0]!.id, qtyOrdered: 12 }],
    });
    expect(ordered.status).toBe(200);

    const receiving = await buyer.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(receiving.body.purchases.awaitingOrder.length).toBe(0);
    expect(receiving.body.purchases.toReceive.length).toBe(1);
    expect(receiving.body.purchases.toReceive[0]?.id).toBe(request.body.id);
    expect(receiving.body.purchases.toReceive[0]?.status).toBe("ordered");

    /* --- Estoque: saldos e movimentações; sem filas de compra -------------- */
    const keeperHome = await keeper.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(keeperHome.body.stock.itemCount).toBe(4);
    expect(keeperHome.body.stock.lowStockCount).toBe(1);
    expect(keeperHome.body.recentMovements.length).toBe(4);
    // Sem permissão de pedido/recebimento, as listas não vazam para o estoque.
    expect(keeperHome.body.purchases.awaitingOrder.length).toBe(0);
    expect(keeperHome.body.purchases.toReceive.length).toBe(0);

    /* --- Limpeza: consumo e chamados próprios; nada de outras áreas -------- */
    const cleanerHome = await cleaner.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(cleanerHome.body.stock.itemCount).toBe(0);
    expect(cleanerHome.body.purchases.openRequestCount).toBe(0);
    expect(cleanerHome.body.workOrders.openCount).toBe(0);
    expect(cleanerHome.body.tickets.openCount).toBe(0);
    expect(cleanerHome.body.tickets.mine.length).toBe(0);

    /* --- Limpeza (líder e equipe) também abrem chamados de manutenção ------ */
    // Requisito do usuário (19/10/2026): liderança de limpeza e equipe precisam
    // conseguir abrir chamados de manutenção — não só acompanhar os próprios.
    const lead = await createUser(admin, {
      name: "Liderança Limpeza Fase Dois",
      email: "lider.limpeza.fase2@facil.test",
      roleId: await findRoleId("cleaning_lead"),
    });
    const leadTicket = await lead.api.post<{ id: string }>("/api/tickets", {
      title: "Lâmpada queimada no corredor do térreo",
      categoryId: "tc_eletrica",
      locationId: structure.roomId,
      priority: "normal",
    });
    expect(leadTicket.status).toBe(201);

    const cleaningTicket = await cleaner.api.post<{ id: string }>("/api/tickets", {
      title: "Falta sabão no banheiro térreo",
      categoryId: "tc_limpeza",
      locationId: structure.roomId,
      priority: "normal",
    });
    expect(cleaningTicket.status).toBe(201);

    const leadHome = await lead.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(leadHome.body.tickets.openCount).toBe(1);
    expect(leadHome.body.tickets.mine.length).toBe(1);
    expect(leadHome.body.tickets.mine[0]?.id).toBe(leadTicket.body.id);
    expect(leadHome.body.inventories.openCount).toBe(0);
    expect(leadHome.body.stock.itemCount).toBe(0);

    const cleanerAfter = await cleaner.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(cleanerAfter.body.tickets.openCount).toBe(1);
    expect(cleanerAfter.body.tickets.mine[0]?.id).toBe(cleaningTicket.body.id);

    /* --- Recepção: lança o consumo do posto e abre chamados (D-30) -------- */
    // Requisito do usuário (19/10/2026): a recepção também consome itens e
    // precisa lançar o que foi utilizado — mesmas condições da limpeza (0015).
    const todayReception = isoDate(new Date());
    const receptionConsumption = await reception.api.post<{ id: string }>("/api/consumption", {
      requestKey: "consumo-recepcao-0001",
      periodStart: todayReception,
      periodEnd: todayReception,
      locationId: structure.roomId,
      items: [{ productId: cafeId, qty: 2 }],
    });
    expect(receptionConsumption.status).toBe(201);

    const opened = await reception.api.post<{ id: string }>("/api/tickets", {
      title: "Catraca de entrada travando",
      categoryId: "tc_hidraulica",
      locationId: structure.roomId,
      priority: "normal",
    });
    expect(opened.status).toBe(201);

    const receptionHome = await reception.api.get<DashboardSummary>("/api/dashboard/summary");
    expect(receptionHome.body.tickets.openCount).toBe(1);
    expect(receptionHome.body.tickets.mine.length).toBe(1);
    expect(receptionHome.body.tickets.mine[0]?.id).toBe(opened.body.id);
    expect(receptionHome.body.stock.itemCount).toBe(0);
    expect(receptionHome.body.purchases.openRequestCount).toBe(0);
    expect(receptionHome.body.inventories.openCount).toBe(0);
    // O módulo de consumo aparece para a recepção (0015) com o lançamento do
    // próprio posto — o banco de cada teste nasce limpo.
    expect(receptionHome.body.consumption.periodDays).toBe(30);
    expect(receptionHome.body.consumption.recordCount).toBe(1);
    expect(receptionHome.body.consumption.qtyMilli).toBe(2_000);
  });

  /* ------------------------------------------------------------------------ */
  /* Auditoria                                                                */
  /* ------------------------------------------------------------------------ */

  it("auditoria expoe a trilha com filtros, paginação e histórico da entidade", async () => {
    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const requester = await createUser(admin, {
      name: "Solicitante",
      email: "solicitante@facil.test",
      roleId: await findRoleId("requester"),
    });

    const ticket = await admin.api.post<{ id: string }>("/api/tickets", {
      title: "Vazamento na copa do 3º andar",
      locationId: structure.roomId,
    });
    await admin.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-auditoria-0001",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      items: [{ productId: cafeId, qty: 4 }],
    });
    // Negação de permissão também entra na trilha.
    const denied = await requester.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-negada-0001",
      fromLocationId: structure.warehouseId,
      items: [{ productId: cafeId, qty: 1 }],
    });
    expectError(denied, "FORBIDDEN");

    const all = await admin.api.get<AuditPage>("/api/audit?pageSize=100");
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(8);
    expect(all.body.page).toBe(1);
    expect(all.body.pageSize).toBe(100);
    expect(all.body.items.every((i) => i.createdAt)).toBe(true);
    expect(all.body.items.every((i) => i.actorName)).toBe(true);

    const stockOnly = await admin.api.get<AuditPage>("/api/audit?module=stock");
    expect(stockOnly.body.items.length).toBeGreaterThanOrEqual(2);
    expect(stockOnly.body.items.every((i) => i.module === "stock")).toBe(true);

    const byAction = await admin.api.get<AuditPage>("/api/audit?action=ticket.create");
    expect(byAction.body.items.length).toBe(1);
    expect(byAction.body.items[0]?.entityId).toBe(ticket.body.id);
    expect(byAction.body.items[0]?.after).toMatchObject({ code: expect.any(String) });

    const byEntity = await admin.api.get<AuditPage>(
      `/api/audit?entityType=ticket&entityId=${ticket.body.id}`,
    );
    expect(byEntity.body.items.length).toBe(1);

    const byActor = await admin.api.get<AuditPage>(`/api/audit?actorId=${requester.id}&result=failure`);
    expect(byActor.body.items.length).toBe(1);
    expect(byActor.body.items[0]?.action).toBe("permission_denied");
    expect(byActor.body.items[0]?.entityId).toBe("stock.issue");
    expect(byActor.body.items[0]?.entityType).toBe("permission");
    expect(byActor.body.items[0]?.result).toBe("failure");

    const bySearch = await admin.api.get<AuditPage>("/api/audit?search=Administrador");
    expect(bySearch.body.items.length).toBeGreaterThanOrEqual(1);
    expect(bySearch.body.items.every((i) => i.actorName === admin.name)).toBe(true);

    const paginated = await admin.api.get<AuditPage>("/api/audit?pageSize=2");
    expect(paginated.body.items.length).toBe(2);
    const secondPage = await admin.api.get<AuditPage>("/api/audit?pageSize=2&page=2");
    expect(secondPage.body.items[0]?.id).not.toBe(paginated.body.items[0]?.id);

    const invalidDate = await admin.api.get("/api/audit?from=ontem");
    expectError(invalidDate, "BAD_REQUEST");

    const facets = await admin.api.get<{ modules: { module: string; count: number }[]; actions: { module: string; action: string; count: number }[] }>(
      "/api/audit/facets",
    );
    expect(facets.status).toBe(200);
    expect(facets.body.modules.find((m) => m.module === "stock")?.count).toBeGreaterThanOrEqual(2);
    expect(
      facets.body.actions.find((a) => a.module === "auth" && a.action === "setup")?.count,
    ).toBeGreaterThanOrEqual(1);
    expect(
      facets.body.actions.find((a) => a.module === "stock" && a.action === "movement.issue")?.count,
    ).toBe(1);

    const history = await admin.api.get<{ items: AuditEntry[] }>(`/api/audit/entity/ticket/${ticket.body.id}`);
    expect(history.status).toBe(200);
    expect(history.body.items.length).toBe(1);
    expect(history.body.items[0]?.action).toBe("ticket.create");

    // Gerente consulta; solicitante não tem permissão.
    const managerView = await manager.api.get<AuditPage>("/api/audit?pageSize=1");
    expect(managerView.status).toBe(200);
    const requesterView = await requester.api.get("/api/audit");
    expectError(requesterView, "FORBIDDEN");
  });

  /* ------------------------------------------------------------------------ */
  /* Notificações                                                             */
  /* ------------------------------------------------------------------------ */

  it("notificações são privadas por usuário e podem ser lidas e removidas", async () => {
    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const buyer = await createUser(admin, {
      name: "Comprador Souza",
      email: "comprador@facil.test",
      roleId: await findRoleId("buyer"),
    });

    const request = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Reposição de café",
      submit: true,
      items: [{ productId: cafeId, qty: 3 }],
    });
    expect(request.status).toBe(201);

    const listed = await manager.api.get<NotificationPage>("/api/notifications");
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    const notification = listed.body.items[0]!;
    expect(notification.type).toBe("purchase_pending_approval");
    expect(notification.title).toContain("aguarda aprovação");
    expect(notification.link).toBe(`/compras/${request.body.id}`);
    expect(notification.entityType).toBe("purchase_request");
    expect(notification.entityId).toBe(request.body.id);
    expect(notification.readAt).toBeNull();

    // A caixa do comprador esta vazia: nada vaza entre usuários.
    const buyerBox = await buyer.api.get<NotificationPage>("/api/notifications");
    expect(buyerBox.body.total).toBe(0);
    const buyerUnread = await buyer.api.get<{ count: number }>("/api/notifications/unread-count");
    expect(buyerUnread.body.count).toBe(0);

    const unreadBefore = await manager.api.get<{ count: number }>("/api/notifications/unread-count");
    expect(unreadBefore.body.count).toBe(1);

    // Outro usuário não marca como lida a notificação alheia.
    const foreign = await buyer.api.post(`/api/notifications/${notification.id}/read`, {});
    expectError(foreign, "NOT_FOUND");

    const read = await manager.api.post(`/api/notifications/${notification.id}/read`, {});
    expect(read.status).toBe(200);
    const unreadAfter = await manager.api.get<{ count: number }>("/api/notifications/unread-count");
    expect(unreadAfter.body.count).toBe(0);

    // A leitura e idempotente.
    const readAgain = await manager.api.post(`/api/notifications/${notification.id}/read`, {});
    expect(readAgain.status).toBe(200);

    const unreadOnly = await manager.api.get<NotificationPage>("/api/notifications?unread=true");
    expect(unreadOnly.body.total).toBe(0);
    const byType = await manager.api.get<NotificationPage>(
      "/api/notifications?type=purchase_pending_approval",
    );
    expect(byType.body.total).toBe(1);

    const removed = await manager.api.delete(`/api/notifications/${notification.id}`);
    expect(removed.status).toBe(200);
    const removedAgain = await manager.api.delete(`/api/notifications/${notification.id}`);
    expectError(removedAgain, "NOT_FOUND");
    // A caixa do gerente fica vazia; a do admin (outro aprovador) não e afetada.
    expect(
      await countRows("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?", [manager.id]),
    ).toBe(0);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?", [admin.id]),
    ).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Aprovação em lote e leitura de rascunho na lista de compras              */
  /* ------------------------------------------------------------------------ */

  it("envia em lote e le a lista de compras com pendência e texto", async () => {
    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const buyer = await createUser(admin, {
      name: "Comprador Souza",
      email: "comprador@facil.test",
      roleId: await findRoleId("buyer"),
    });

    const draft = await buyer.api.post<{ id: string; code: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Compra avulsa de água",
      items: [{ productId: aguaId, qty: 4 }],
    });
    expect(draft.status).toBe(201);

    const draftList = await buyer.api.get<{ items: { id: string; status: string; requesterName: string }[] }>(
      "/api/purchases?status=draft",
    );
    expect(draftList.body.items.length).toBe(1);
    expect(draftList.body.items[0]?.requesterName).toBe(buyer.name);

    const submitted = await buyer.api.post(`/api/purchases/${draft.body.id}/submit`, {});
    expect(submitted.status).toBe(200);

    const pending = await manager.api.get<{ items: { id: string; status: string }[] }>(
      "/api/purchases?pendingApproval=true",
    );
    expect(pending.body.items.map((r) => r.id)).toEqual([draft.body.id]);

    const bySearch = await manager.api.get<{ total: number }>(
      `/api/purchases?search=${draft.body.code}`,
    );
    expect(bySearch.body.total).toBe(1);

    const audit = await queryAll<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = ?",
      [draft.body.id],
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      "purchase_request.create",
      "purchase_request.submit",
    ]);

    const requestRow = await queryOne<{ status: string; updated_at: string | null }>(
      "SELECT status, updated_at FROM purchase_requests WHERE id = ?",
      [draft.body.id],
    );
    expect(requestRow?.status).toBe("pending_approval");
    expect(requestRow?.updated_at).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function row(items: StockRow[], sku: string, locationId: string): StockRow | undefined {
  return items.find((i) => i.sku === sku && i.locationId === locationId);
}

interface StockRow {
  productId: string;
  productName: string;
  sku: string | null;
  locationId: string;
  locationName: string;
  qtyMilli: number;
  totalQtyMilli: number;
  minQtyMilli: number;
  isBelowMin: boolean;
  isZero: boolean;
  updatedAt: string;
}

interface StockReport {
  scope: string;
  items: StockRow[];
  totals: { lines: number; qtyMilli: number };
}

interface MovementReport {
  items: {
    id: string;
    type: string;
    qtyMilli: number;
    productName: string;
    sku: string | null;
    fromLocationPath: string | null;
    toLocationPath: string | null;
    userName: string;
    fromLocationId?: string | null;
  }[];
  byType: { type: string; count: number; qtyMilli: number }[];
  total: number;
}

interface ConsumptionReport {
  period: { from: string; to: string };
  groupBy: string;
  groups: { key: string | null; label: string | null; qtyMilli: number; recordCount: number }[];
  byPeriodicity: { periodicity: string; recordCount: number; qtyMilli: number }[];
  totals: { qtyMilli: number; recordCount: number };
}

interface TicketReport {
  byStatus: { status: string; count: number }[];
  byCategory: { categoryName: string; count: number; resolvedCount: number }[];
  byPriority: { priority: string; count: number }[];
  byLocation: { locationName: string; count: number }[];
  timing: { avgResolutionHours: number | null; resolvedCount: number; convertedCount: number };
}

interface WorkOrderReport {
  byStatus: { status: string; count: number }[];
  byAssignee: { assigneeName: string; count: number; doneCount: number }[];
  timing: { avgCompletionHours: number | null };
  materialsQtyMilli: number;
}

interface PurchaseReport {
  byStatus: { status: string; count: number }[];
  quantities: { expectedQtyMilli: number; receivedQtyMilli: number; pendingQtyMilli: number };
  receipts: { count: number; valueCents: number; discrepancyCount: number };
  bySupplier: { supplierName: string; receiptCount: number; qtyMilli: number }[];
  quotes: { total: number; byStatus: { status: string; count: number }[] };
  ordersBySupplier: { supplierName: string; itemCount: number; qtyMilli: number; valueCents: number }[];
  requests: {
    id: string;
    code: string;
    status: string;
    requesterName: string;
    itemCount: number;
    quoteItemCount: number;
    quoteCount: number;
    supplierNames: string | null;
    orderedValueCents: number;
    expectedQtyMilli: number;
    receivedQtyMilli: number;
    receiptCount: number;
  }[];
}

interface DashboardSummary {
  generatedAt: string;
  stock: {
    itemCount: number;
    totalQtyMilli: number;
    locationCount: number;
    lowStockCount: number;
    lowStockScope: string;
    lowStock: { productId: string; sku: string | null; locationId: string | null; qtyMilli: number }[];
  };
  consumption: { periodDays: number; qtyMilli: number; recordCount: number };
  tickets: {
    openCount: number;
    pendingCount: number;
    criticalCount: number;
    resolvedLast30Days: number;
    mine: { id: string; code: string; title: string; status: string }[];
  };
  workOrders: {
    openCount: number;
    inProgressCount: number;
    waitingMaterialCount: number;
    doneLast30Days: number;
    mineOpenCount: number;
    mine: {
      openCount: number;
      waitingMaterialCount: number;
      doneLast30Days: number;
      checklistPendingCount: number;
    };
    mineOpen: {
      id: string;
      code: string;
      status: string;
      checklistPending: number;
      checklistManagerPending: number;
    }[];
    managerChecklistPending: { id: string; code: string; pendingCount: number }[];
  };
  purchases: {
    pendingApprovalCount: number;
    orderedCount: number;
    partiallyReceivedCount: number;
    openRequestCount: number;
    pendingApproval: { id: string; code: string; requesterName: string }[];
    awaitingOrder: { id: string; code: string; requesterName: string }[];
    toReceive: { id: string; code: string; status: string; requesterName: string }[];
  };
  inventories: { openCount: number };
  notifications: { unreadCount: number };
  recentMovements: { id: string; productName: string }[];
}

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorName: string;
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  result: string;
  reason: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

interface NotificationPage {
  items: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    entityType: string | null;
    entityId: string | null;
    readAt: string | null;
    createdAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
}
