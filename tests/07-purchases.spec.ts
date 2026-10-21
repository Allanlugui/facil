import { beforeEach, describe, expect, it } from "vitest";
import {
  assert,
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  findUomId,
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
 * Cenários 19 a 22 da especificação: solicitação de compra, autoaprovação
 * bloqueada, decisão com aprovação parcial, pedido com fornecedor e preço,
 * recebimento total/parcial sem entrada dupla e cancelamento.
 */
describe("compras: solicitação, aprovação, pedido e recebimento", () => {
  let admin: Actor;
  let structure: Structure;
  let aguaId: string;
  let cafeId: string;
  let supplierId: string;
  let buyer: Actor;
  let manager: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    aguaId = await createProduct(admin, { name: "Água 500ml", sku: "AGU-500" });
    cafeId = await createProduct(admin, { name: "Café 500g", sku: "CAF-500" });
    await seedStock(admin, structure.warehouseId, aguaId, 10);

    const created = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Distribuidora Central",
      doc: "12.345.678/0001-90",
      contactName: "Marcos",
      phone: "(11) 4002-8922",
    });
    assert(created.status === 201, `Falha ao criar fornecedor: ${created.status}`);
    supplierId = created.body.id;

    buyer = await createUser(admin, {
      name: "Comprador Souza",
      email: "comprador@facil.test",
      roleId: await findRoleId("buyer"),
    });
    manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Solicitação                                                              */
  /* ------------------------------------------------------------------------ */

  it("cria a solicitação como rascunho e envia para aprovação", async () => {
    const created = await buyer.api.post<{ id: string; code: string; status: string }>(
      "/api/purchases",
      {
        workflowVersion: 1,
        locationId: structure.warehouseId,
        justification: "Reposição do estoque de água para outubro",
        priority: "high",
        desiredDate: "2026-10-30",
        items: [{ productId: aguaId, qty: 40, notes: "Garrafas de 500ml" }],
      },
    );
    expect(created.status).toBe(201);
    expect(created.body.code).toBe("SC-2026-000001");
    expect(created.body.status).toBe("draft");

    const draft = await buyer.api.get<RequestDetail>(`/api/purchases/${created.body.id}`);
    expect(draft.status).toBe(200);
    expect(draft.body.request.requesterName).toBe(buyer.name);
    expect(draft.body.request.priority).toBe("high");
    expect(draft.body.items.length).toBe(1);
    expect(draft.body.items[0]?.qtyMilli).toBe(40_000);
    expect(draft.body.items[0]?.status).toBe("pending");

    const edited = await buyer.api.patch(`/api/purchases/${created.body.id}`, {
      justification: "Reposição do estoque de água para outubro e novembro",
      items: [{ itemId: draft.body.items[0]!.id, qty: 60 }],
    });
    expect(edited.status).toBe(200);

    const submitted = await buyer.api.post<{ status: string }>(
      `/api/purchases/${created.body.id}/submit`,
      {},
    );
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("pending_approval");

    const again = await buyer.api.post(`/api/purchases/${created.body.id}/submit`, {});
    expectError(again, "CONFLICT");

    // Quem pode aprovar recebe o aviso; o solicitante não e notificado por si mesmo.
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'purchase_pending_approval'",
        [manager.id],
      ),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'purchase_pending_approval'",
        [buyer.id],
      ),
    ).toBe(0);
  });

  it("cria direto para aprovação e recusa itens sem identificação", async () => {
    const direct = await buyer.api.post<{ status: string }>("/api/purchases", {
      workflowVersion: 1,
      justification: "Compra urgente de café",
      submit: true,
      items: [{ productId: cafeId, qty: 12 }],
    });
    expect(direct.status).toBe(201);
    expect(direct.body.status).toBe("pending_approval");

    const emptyItems = await buyer.api.post("/api/purchases", {
      workflowVersion: 1,
      items: [],
    });
    expectError(emptyItems, "VALIDATION_ERROR");

    const zeroQty = await buyer.api.post("/api/purchases", {
      workflowVersion: 1,
      items: [{ productId: aguaId, qty: 0 }],
    });
    expectError(zeroQty, "VALIDATION_ERROR");

    const unknownProduct = await buyer.api.post("/api/purchases", {
      workflowVersion: 1,
      items: [{ productId: "produto-inexistente", qty: 5 }],
    });
    expectError(unknownProduct, "BAD_REQUEST");

    const unidentified = await buyer.api.post("/api/purchases", {
      workflowVersion: 1,
      items: [{ qty: 5 }],
    });
    expectError(unidentified, "BAD_REQUEST");

    // Item sem produto no catálogo, mas descrito, é aceito: a cotação resolve.
    const described = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      items: [{ description: "Bebedouro industrial inox", qty: 2, uomId: await findUomId("UN") }],
    });
    expect(described.status).toBe(201);
  });

  /* ------------------------------------------------------------------------ */
  /* Decisão                                                                  */
  /* ------------------------------------------------------------------------ */

  it("bloqueia a autoaprovação e exige a permissão de aprovação", async () => {
    const request = await createRequest({ productId: aguaId, qty: 20 }, true);
    const items = await itemsOf(request);

    const byBuyer = await buyer.api.post(`/api/purchases/${request}/decide`, { decision: "approved" });
    expectError(byBuyer, "CONFLICT");
    expect(await statusOf(request)).toBe("pending_approval");

    // O próprio gerente também não aprova a solicitação que ele mesmo abriu.
    const own = await manager.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      justification: "Compra aberta pelo gerente",
      submit: true,
      items: [{ productId: cafeId, qty: 5 }],
    });
    const ownDecide = await manager.api.post(`/api/purchases/${own.body.id}/decide`, {
      decision: "approved",
    });
    expectError(ownDecide, "CONFLICT");

    const approved = await manager.api.post(`/api/purchases/${request}/decide`, {
      decision: "approved",
      notes: "Dentro do orçamento aprovado",
    });
    expect(approved.status).toBe(200);
    expect(await statusOf(request)).toBe("approved");

    const stored = await queryOne<{ qty_approved_milli: number; status: string }>(
      "SELECT qty_approved_milli, status FROM purchase_request_items WHERE id = ?",
      [items[0]!.id],
    );
    expect(stored?.status).toBe("approved");
    expect(stored?.qty_approved_milli).toBe(20_000);

    const approvalRow = await queryOne<{ approved_by: string | null; approved_at: string | null }>(
      "SELECT approved_by, approved_at FROM purchase_requests WHERE id = ?",
      [request],
    );
    expect(approvalRow?.approved_by).toBe(manager.id);
    expect(approvalRow?.approved_at).toBeTruthy();

    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'purchase_approved'",
        [buyer.id],
      ),
    ).toBe(1);
  });

  it("aprova quantidade parcial e rejeita itens com justificativa", async () => {
    const partial = await createRequest({ productId: aguaId, qty: 40 }, true);
    const partialItems = await itemsOf(partial);

    const approved = await manager.api.post(`/api/purchases/${partial}/decide`, {
      decision: "approved",
      notes: "Verba liberada apenas para metade",
      items: [{ itemId: partialItems[0]!.id, qtyApproved: 20 }],
    });
    expect(approved.status).toBe(200);

    const stored = await queryOne<{ qty_milli: number; qty_approved_milli: number; status: string }>(
      "SELECT qty_milli, qty_approved_milli, status FROM purchase_request_items WHERE id = ?",
      [partialItems[0]!.id],
    );
    expect(stored?.qty_milli).toBe(40_000);
    expect(stored?.qty_approved_milli).toBe(20_000);
    expect(stored?.status).toBe("approved");

    const aboveRequested = await manager.api.post(`/api/purchases/${partial}/decide`, {
      decision: "approved",
      items: [{ itemId: partialItems[0]!.id, qtyApproved: 999 }],
    });
    expectError(aboveRequested, "BAD_REQUEST");

    const rejected = await createRequest({ productId: cafeId, qty: 10 }, true);
    const rejectedItems = await itemsOf(rejected);
    const decision = await manager.api.post(`/api/purchases/${rejected}/decide`, {
      decision: "rejected",
      notes: "Fornecedor sem contrato vigente",
      items: [
        {
          itemId: rejectedItems[0]!.id,
          status: "rejected",
          notes: "Aguardar renovação do contrato",
        },
      ],
    });
    expect(decision.status).toBe(200);

    const after = await queryOne<{ status: string; notes: string | null }>(
      "SELECT status, notes FROM purchase_request_items WHERE id = ?",
      [rejectedItems[0]!.id],
    );
    expect(after?.status).toBe("rejected");
    expect(after?.notes).toContain("renovação");
  });

  /* ------------------------------------------------------------------------ */
  /* Pedido                                                                   */
  /* ------------------------------------------------------------------------ */

  it("registra pedido com fornecedor, quantidade e preço unitário", async () => {
    const request = await createRequest({ productId: aguaId, qty: 30 }, true);
    const items = await itemsOf(request);

    // Ainda não aprovada: não existe pedido.
    const tooEarly = await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered: 30 }],
    });
    expectError(tooEarly, "CONFLICT");

    await manager.api.post(`/api/purchases/${request}/decide`, { decision: "approved" });

    const unknownSupplier = await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId: "fornecedor-inexistente",
      items: [{ itemId: items[0]!.id, qtyOrdered: 30 }],
    });
    expectError(unknownSupplier, "NOT_FOUND");

    // Pedido acima do aprovado e recusado (ainda antes de virar pedido).
    const aboveApproved = await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered: 40 }],
    });
    expectError(aboveApproved, "BAD_REQUEST");

    const ordered = await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      orderRef: "PED-4471",
      items: [{ itemId: items[0]!.id, qtyOrdered: 30, unitPrice: 4.25 }],
    });
    expect(ordered.status).toBe(200);

    const stored = await queryOne<{
      status: string;
      qty_ordered_milli: number;
      unit_price_cents: number;
      supplier_id: string;
      order_ref: string;
    }>(
      "SELECT status, qty_ordered_milli, unit_price_cents, supplier_id, order_ref FROM purchase_request_items WHERE id = ?",
      [items[0]!.id],
    );
    expect(stored?.status).toBe("ordered");
    expect(stored?.qty_ordered_milli).toBe(30_000);
    expect(stored?.unit_price_cents).toBe(425);
    expect(stored?.supplier_id).toBe(supplierId);
    expect(stored?.order_ref).toBe("PED-4471");
    expect(await statusOf(request)).toBe("ordered");

    const detail = await buyer.api.get<RequestDetail>(`/api/purchases/${request}`);
    expect(detail.body.items[0]?.supplierName).toBe("Distribuidora Central");
    expect(detail.body.items[0]?.unitPriceCents).toBe(425);
  });

  it("recusa pedido de fornecedor inativo", async () => {
    const request = await createRequest({ productId: aguaId, qty: 10 }, true);
    const items = await itemsOf(request);
    await manager.api.post(`/api/purchases/${request}/decide`, { decision: "approved" });

    await admin.api.patch(`/api/catalog/suppliers/${supplierId}`, { isActive: false });
    const refused = await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered: 10 }],
    });
    expectError(refused, "BAD_REQUEST");
  });

  /* ------------------------------------------------------------------------ */
  /* Recebimento                                                              */
  /* ------------------------------------------------------------------------ */

  it("recebe parcialmente e conclui, somando ao estoque exatamente o recebido", async () => {
    const request = await approveAndOrdered({ productId: aguaId, qty: 30 }, 30, 4.25);
    const items = await itemsOf(request);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(10_000);

    const partial = await buyer.api.post<{ receipt: { id: string; code: string } }>(
      `/api/purchases/${request}/receipts`,
      {
        requestKey: "recebimento-2026-10-0001",
        locationId: structure.warehouseId,
        documentRef: "NF-e 12345",
        items: [{ requestItemId: items[0]!.id, receivedQty: 18 }],
      },
    );
    expect(partial.status).toBe(201);
    expect(partial.body.receipt.code).toBe("REC-2026-000001");
    expect(await statusOf(request)).toBe("partially_received");
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(28_000);

    const itemRow = await queryOne<{ status: string; qty_received_milli: number }>(
      "SELECT status, qty_received_milli FROM purchase_request_items WHERE id = ?",
      [items[0]!.id],
    );
    expect(itemRow?.status).toBe("partially_received");
    expect(itemRow?.qty_received_milli).toBe(18_000);

    const movement = await queryOne<{
      type: string;
      qty_milli: number;
      to_location_id: string;
      unit_cost_cents: number;
      counterparty: string;
      ref_type: string;
      ref_id: string;
    }>(
      "SELECT type, qty_milli, to_location_id, unit_cost_cents, counterparty, ref_type, ref_id FROM movements WHERE ref_type = 'purchase_receipt' AND ref_id = ?",
      [partial.body.receipt.id],
    );
    expect(movement?.type).toBe("purchase_receipt");
    expect(movement?.qty_milli).toBe(18_000);
    expect(movement?.to_location_id).toBe(structure.warehouseId);
    expect(movement?.unit_cost_cents).toBe(425);
    expect(movement?.counterparty).toBe("NF-e 12345");

    // Recebimento acima do pendente e recusado.
    const above = await buyer.api.post(`/api/purchases/${request}/receipts`, {
      requestKey: "recebimento-2026-10-0002",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 20 }],
    });
    expectError(above, "BAD_REQUEST");
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(28_000);

    const remaining = await buyer.api.post(`/api/purchases/${request}/receipts`, {
      requestKey: "recebimento-2026-10-0003",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 12, hasDiscrepancy: true, discrepancyNote: "2 caixas amassadas" }],
    });
    expect(remaining.status).toBe(201);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(40_000);
    expect(await statusOf(request)).toBe("received");

    const receipts = await buyer.api.get<{
      items: { code: string; lines: { hasDiscrepancy: boolean; qtyMilli: number }[] }[];
    }>(`/api/purchases/${request}/receipts`);
    expect(receipts.body.items.length).toBe(2);
    const lines = receipts.body.items.flatMap((r) => r.lines);
    expect(lines.length).toBe(2);
    expect(lines.reduce((sum, line) => sum + line.qtyMilli, 0)).toBe(30_000);
    expect(lines.filter((line) => line.hasDiscrepancy).length).toBe(1);

    const afterReceived = await buyer.api.post(`/api/purchases/${request}/receipts`, {
      requestKey: "recebimento-2026-10-0004",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 1 }],
    });
    expectError(afterReceived, "CONFLICT");
  });

  it("não duplica a entrada ao reenviar a mesma confirmação de recebimento", async () => {
    const request = await approveAndOrdered({ productId: aguaId, qty: 20 }, 20, 3);
    const items = await itemsOf(request);

    const payload = {
      requestKey: "recebimento-idempotente-01",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 20 }],
    };

    const first = await buyer.api.post<{ receipt: { id: string }; idempotentReplay: boolean }>(
      `/api/purchases/${request}/receipts`,
      payload,
    );
    expect(first.status).toBe(201);
    expect(first.body.idempotentReplay).toBe(false);

    const second = await buyer.api.post<{ receipt: { id: string }; idempotentReplay: boolean }>(
      `/api/purchases/${request}/receipts`,
      payload,
    );
    expect(second.status).toBe(200);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.receipt.id).toBe(first.body.receipt.id);

    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(30_000);
    expect(await countRows("SELECT COUNT(*) AS total FROM purchase_receipts")).toBe(1);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM movements WHERE type = 'purchase_receipt'", []),
    ).toBe(1);
  });

  it("recusa receber item sem produto cadastrado e itens repetidos", async () => {
    const request = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      justification: "Compra de bebedouro novo",
      submit: true,
      items: [{ description: "Bebedouro industrial inox", qty: 2, uomId: await findUomId("UN") }],
    });
    await manager.api.post(`/api/purchases/${request.body.id}/decide`, { decision: "approved" });
    const items = await itemsOf(request.body.id);

    await buyer.api.post(`/api/purchases/${request.body.id}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered: 2 }],
    });

    const withoutProduct = await buyer.api.post(`/api/purchases/${request.body.id}/receipts`, {
      requestKey: "recebimento-sem-produto",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 2 }],
    });
    expectError(withoutProduct, "BAD_REQUEST");
    expect(await countRows("SELECT COUNT(*) AS total FROM purchase_receipts")).toBe(0);

    // Item repetido na mesma confirmação: somar as quantidades.
    const duplicate = await buyer.api.post(`/api/purchases/${request.body.id}/receipts`, {
      requestKey: "recebimento-item-repetido",
      locationId: structure.warehouseId,
      items: [
        { requestItemId: items[0]!.id, receivedQty: 1 },
        { requestItemId: items[0]!.id, receivedQty: 1 },
      ],
    });
    expectError(duplicate, "BAD_REQUEST");
  });

  it("cadastra produto na hora do recebimento e mantem o alerta até completar o cadastro", async () => {
    const request = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      justification: "Compra emergencial de peça fora do catálogo",
      submit: true,
      items: [{ description: "Válvula de retenção 3/4", qty: 4 }],
    });
    await manager.api.post(`/api/purchases/${request.body.id}/decide`, { decision: "approved" });
    const items = await itemsOf(request.body.id);
    await buyer.api.post(`/api/purchases/${request.body.id}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered: 4 }],
    });

    const receipt = await buyer.api.post<{
      receipt: { code: string };
      createdProducts: { id: string; name: string; catalogStatus: string }[];
    }>(`/api/purchases/${request.body.id}/receipts`, {
      requestKey: "recebimento-cadastro-rapido",
      locationId: structure.warehouseId,
      items: [
        {
          requestItemId: items[0]!.id,
          receivedQty: 4,
          newProduct: { name: "Válvula de retenção 3/4" },
        },
      ],
    });
    expect(receipt.status).toBe(201);
    expect(receipt.body.createdProducts).toHaveLength(1);
    const productId = receipt.body.createdProducts[0]!.id;
    expect(receipt.body.createdProducts[0]!.catalogStatus).toBe("incomplete");

    // Produto nasceu incompleto, entrou no estoque e o item aponta para ele.
    const product = await admin.api.get<{ product: { name: string; catalogStatus: string } }>(
      `/api/catalog/products/${productId}`,
    );
    expect(product.body.product.catalogStatus).toBe("incomplete");
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM movements WHERE product_id = ? AND type = 'purchase_receipt'",
        [productId],
      ),
    ).toBe(1);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM products WHERE id = ? AND catalog_status = 'incomplete'", [
        productId,
      ]),
    ).toBe(1);

    // Alerta visível para quem cuida do catálogo + notificação de correção.
    const alerts = await admin.api.get<{ incompleteProductCount: number }>("/api/dashboard/alerts");
    expect(alerts.body.incompleteProductCount).toBe(1);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM notifications WHERE type = 'product_incomplete'"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'product.quick_register'"),
    ).toBe(1);

    // Concluir o cadastro zera o alerta.
    const completed = await admin.api.patch(`/api/catalog/products/${productId}`, {
      catalogStatus: "complete",
      categoryId: null,
    });
    expect(completed.status).toBe(200);
    const alertsAfter = await admin.api.get<{ incompleteProductCount: number }>("/api/dashboard/alerts");
    expect(alertsAfter.body.incompleteProductCount).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* Cancelamento                                                             */
  /* ------------------------------------------------------------------------ */

  it("cancela rascunho e recusa cancelar o que já foi recebido", async () => {
    const draft = await createRequest({ productId: aguaId, qty: 5 }, false);
    const cancelled = await buyer.api.post(`/api/purchases/${draft}/cancel`, {
      reason: "Solicitação aberta por engano",
    });
    expect(cancelled.status).toBe(200);
    expect(await statusOf(draft)).toBe("cancelled");
    expect(
      await queryAll<{ status: string }>(
        "SELECT status FROM purchase_request_items WHERE request_id = ?",
        [draft],
      ).then((rows) => rows.every((r) => r.status === "cancelled")),
    ).toBe(true);

    const again = await buyer.api.post(`/api/purchases/${draft}/cancel`, {
      reason: "Segunda tentativa de cancelamento",
    });
    expectError(again, "CONFLICT");

    const request = await approveAndOrdered({ productId: aguaId, qty: 10 }, 10, 2);
    const items = await itemsOf(request);
    await buyer.api.post(`/api/purchases/${request}/receipts`, {
      requestKey: "recebimento-para-cancelamento",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 4 }],
    });

    const partialCancel = await buyer.api.post(`/api/purchases/${request}/cancel`, {
      reason: "Tentativa de cancelar após recebimento parcial",
    });
    expectError(partialCancel, "CONFLICT");

    const received = await approveAndOrdered({ productId: aguaId, qty: 6 }, 6, 2);
    const receivedItems = await itemsOf(received);
    await buyer.api.post(`/api/purchases/${received}/receipts`, {
      requestKey: "recebimento-completo-cancelamento",
      locationId: structure.warehouseId,
      items: [{ requestItemId: receivedItems[0]!.id, receivedQty: 6 }],
    });
    const fullCancel = await buyer.api.post(`/api/purchases/${received}/cancel`, {
      reason: "Tentativa de cancelar compra já recebida",
    });
    expectError(fullCancel, "CONFLICT");
  });

  /* ------------------------------------------------------------------------ */
  /* Auditoria, permissões e filtros                                          */
  /* ------------------------------------------------------------------------ */

  it("registra a trilha completa na auditoria", async () => {
    const request = await createRequest({ productId: aguaId, qty: 12 }, false);
    const items = await itemsOf(request);
    await buyer.api.post(`/api/purchases/${request}/submit`, {});
    await manager.api.post(`/api/purchases/${request}/decide`, { decision: "approved" });
    await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered: 12, unitPrice: 5 }],
    });
    await buyer.api.post(`/api/purchases/${request}/receipts`, {
      requestKey: "recebimento-auditoria",
      locationId: structure.warehouseId,
      items: [{ requestItemId: items[0]!.id, receivedQty: 12 }],
    });

    const actions = await queryAll<{ action: string; actor_name: string }>(
      `SELECT action, actor_name FROM audit_log
        WHERE module = 'purchases' ORDER BY created_at, id`,
    );
    const byAction = new Map(actions.map((a) => [a.action, a.actor_name]));
    expect(byAction.get("purchase_request.create")).toBe(buyer.name);
    expect(byAction.get("purchase_request.submit")).toBe(buyer.name);
    expect(byAction.get("purchase_request.approved")).toBe(manager.name);
    expect(byAction.get("purchase_request.order")).toBe(buyer.name);
    expect(byAction.get("purchase_receipt.confirm")).toBe(buyer.name);
  });

  it("exige a permissão de cada etapa do fluxo", async () => {
    const requester = await createUser(admin, {
      name: "Solicitante",
      email: "solicitante@facil.test",
      roleId: await findRoleId("requester"),
    });
    const request = await createRequest({ productId: aguaId, qty: 4 }, true);

    const view = await requester.api.get("/api/purchases");
    expectError(view, "FORBIDDEN");

    const create = await requester.api.post("/api/purchases", {
      workflowVersion: 1,
      items: [{ productId: aguaId, qty: 1 }],
    });
    expectError(create, "FORBIDDEN");

    const approve = await buyer.api.post(`/api/purchases/${request}/decide`, { decision: "approved" });
    expectError(approve, "CONFLICT");

    const receive = await requester.api.post(`/api/purchases/${request}/receipts`, {
      requestKey: "recebimento-sem-permissao",
      locationId: structure.warehouseId,
      items: [{ requestItemId: (await itemsOf(request))[0]!.id, receivedQty: 1 }],
    });
    expectError(receive, "FORBIDDEN");

    const order = await requester.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      items: [{ itemId: (await itemsOf(request))[0]!.id, qtyOrdered: 1 }],
    });
    expectError(order, "FORBIDDEN");

    const denied = await queryAll<{ entity_id: string }>(
      `SELECT entity_id FROM audit_log WHERE action = 'permission_denied' ORDER BY entity_id`,
    );
    expect(denied.map((d) => d.entity_id)).toEqual([
      "purchases.create",
      "purchases.order",
      "purchases.receive",
      "purchases.view",
    ]);
  });

  it("filtra a lista por status, texto, solicitante e pendência de aprovação", async () => {
    const pending = await createRequest({ productId: aguaId, qty: 5 }, true);
    const draft = await createRequest({ productId: cafeId, qty: 7 }, false);
    const ordered = await approveAndOrdered({ productId: cafeId, qty: 9 }, 9, 3);

    const byStatus = await buyer.api.get<{ items: RequestListItem[] }>("/api/purchases?status=draft");
    expect(byStatus.body.items.map((r) => r.id)).toEqual([draft]);

    const pendingOnly = await buyer.api.get<{ items: RequestListItem[] }>(
      "/api/purchases?pendingApproval=true",
    );
    expect(pendingOnly.body.items.map((r) => r.id)).toEqual([pending]);

    const byText = await buyer.api.get<{ items: RequestListItem[] }>("/api/purchases?search=SC-2026");
    expect(byText.body.items.length).toBe(3);

    const byRequester = await buyer.api.get<{ total: number }>(`/api/purchases?requesterId=${buyer.id}`);
    expect(byRequester.body.total).toBe(3);

    const byLocation = await buyer.api.get<{ total: number }>(
      `/api/purchases?locationId=${structure.warehouseId}`,
    );
    expect(byLocation.body.total).toBe(3);

    const received = await buyer.api.get<{ total: number }>("/api/purchases?status=received");
    expect(received.body.total).toBe(0);

    const detail = await buyer.api.get<RequestDetail>(`/api/purchases/${ordered}`);
    expect(detail.body.request.status).toBe("ordered");
  });

  /* ------------------------------------------------------------------------ */
  /* Política de aprovação                                                    */
  /* ------------------------------------------------------------------------ */

  it("aprova automaticamente quando a política dispensa aprovação", async () => {
    const updated = await admin.api.patch("/api/settings", {
      values: { "purchases.require_approval": "false" },
    });
    expect(updated.status).toBe(200);

    try {
      const created = await buyer.api.post<{ id: string; status: string }>("/api/purchases", {
      workflowVersion: 1,
        justification: "Material de baixo valor",
        submit: true,
        items: [{ productId: aguaId, qty: 3 }],
      });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe("approved");

      const items = await itemsOf(created.body.id);
      const stored = await queryOne<{ status: string; qty_approved_milli: number }>(
        "SELECT status, qty_approved_milli FROM purchase_request_items WHERE id = ?",
        [items[0]!.id],
      );
      expect(stored?.status).toBe("approved");
      expect(stored?.qty_approved_milli).toBe(3_000);

      // A decisão automática fica registrada com o motivo, nunca silenciosa.
      const audit = await queryOne<{ action: string; reason: string | null }>(
        `SELECT action, reason FROM audit_log WHERE entity_id = ? AND action = 'purchase_request.auto_approved'`,
        [created.body.id],
      );
      expect(audit?.action).toBe("purchase_request.auto_approved");
      expect(audit?.reason).toContain("purchases.require_approval");

      // Ninguem e notificado para aprovar o que já está aprovado.
      expect(
        await countRows(
          "SELECT COUNT(*) AS total FROM notifications WHERE type = 'purchase_pending_approval'",
        ),
      ).toBe(0);

      // Sem aprovação pendente, o pedido sai direto.
      const ordered = await buyer.api.post(`/api/purchases/${created.body.id}/order`, {
        supplierId,
        items: [{ itemId: items[0]!.id, qtyOrdered: 3, unitPrice: 4.5 }],
      });
      expect(ordered.status).toBe(200);

      // Volta ao rascunho para o fluxo normal.
      const draft = await buyer.api.post<{ id: string; status: string }>("/api/purchases", {
      workflowVersion: 1,
        items: [{ productId: cafeId, qty: 2 }],
      });
      expect(draft.body.status).toBe("draft");
      const submitted = await buyer.api.post<{ status: string }>(
        `/api/purchases/${draft.body.id}/submit`,
        {},
      );
      expect(submitted.body.status).toBe("approved");
    } finally {
      const restored = await admin.api.patch("/api/settings", {
        values: { "purchases.require_approval": "true" },
      });
      assert(restored.status === 200, "Não foi possível restaurar a política de aprovação.");
    }

    const afterRestore = await buyer.api.post<{ id: string; status: string }>("/api/purchases", {
      workflowVersion: 1,
      justification: "Voltando ao fluxo com aprovação",
      submit: true,
      items: [{ productId: cafeId, qty: 1 }],
    });
    expect(afterRestore.body.status).toBe("pending_approval");
  });

  /* ------------------------------------------------------------------------ */
  /* Cotação (F-01/F-02)                                                      */
  /* ------------------------------------------------------------------------ */

  it("F-01/F-02: item em cotação passa por propostas, aprovação do gestor e vira pedido", async () => {
    const created = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Compra mista: reposição e upgrade",
      submit: true,
      items: [
        { productId: aguaId, qty: 10 },
        { productId: cafeId, qty: 4 },
      ],
    });
    const requestId = created.body.id;
    const itemRows = await queryAll<{ id: string; product_id: string | null }>(
      "SELECT id, product_id FROM purchase_request_items WHERE request_id = ?",
      [requestId],
    );
    const aguaItemId = itemRows.find((row) => row.product_id === aguaId)!.id;
    const cafeItemId = itemRows.find((row) => row.product_id === cafeId)!.id;

    // O gestor aprova marcando um item como compra direta e o outro para cotação.
    const decided = await manager.api.post<{ status: string }>(`/api/purchases/${requestId}/decide`, {
      decision: "approved",
      items: [
        { itemId: aguaItemId, purchaseMode: "direct" },
        { itemId: cafeItemId, purchaseMode: "quote" },
      ],
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe("quoting");
    expect(await statusOf(requestId)).toBe("quoting");

    const storedModes = await queryAll<{ id: string; purchase_mode: string | null }>(
      "SELECT id, purchase_mode FROM purchase_request_items WHERE request_id = ?",
      [requestId],
    );
    const modeById = new Map(storedModes.map((row) => [row.id, row.purchase_mode]));
    expect(modeById.get(aguaItemId)).toBe("direct");
    expect(modeById.get(cafeItemId)).toBe("quote");

    // Enquanto a cotação está aberta, o pedido é bloqueado.
    const blocked = await buyer.api.post(`/api/purchases/${requestId}/order`, {
      supplierId,
      items: [{ itemId: aguaItemId, qtyOrdered: 10 }],
    });
    expectError(blocked, "CONFLICT");

    // Comprador registra duas propostas de fornecedores diferentes.
    const secondSupplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Suprimentos Norte",
    });
    expect(secondSupplier.status).toBe(201);
    const quoteA = await buyer.api.post<{ id: string; code: string }>(`/api/purchases/${requestId}/quotes`, {
      supplierId,
      items: [
        { itemId: aguaItemId, unitPrice: 4.5 },
        { itemId: cafeItemId, unitPrice: 18.9 },
      ],
    });
    expect(quoteA.status).toBe(201);
    expect(quoteA.body.code).toBe("COT-2026-000001");

    const quoteB = await buyer.api.post<{ id: string }>(`/api/purchases/${requestId}/quotes`, {
      supplierId: secondSupplier.body.id,
      items: [
        { itemId: aguaItemId, unitPrice: 4.2 },
        { itemId: cafeItemId, unitPrice: 17.5 },
      ],
    });
    expect(quoteB.status).toBe(201);

    // Repetir o fornecedor atualiza a proposta existente em vez de duplicar.
    const replacement = await buyer.api.post<{ id: string }>(`/api/purchases/${requestId}/quotes`, {
      supplierId,
      items: [{ itemId: cafeItemId, unitPrice: 18.5 }],
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body.id).toBe(quoteA.body.id);

    const detail = await buyer.api.get<RequestDetail>(`/api/purchases/${requestId}`);
    expect(detail.body.quotes.length).toBe(2);
    const updatedQuote = detail.body.quotes.find((quote) => quote.id === quoteA.body.id);
    expect(updatedQuote?.items.length).toBe(1);
    expect(updatedQuote?.items[0]?.unitPriceCents).toBe(1850);

    // Devolve a cotação ao gestor; quem aprova recebe o aviso.
    const returned = await buyer.api.post(`/api/purchases/${requestId}/quotes/return`, {});
    expect(returned.status).toBe(200);
    expect(await statusOf(requestId)).toBe("quote_returned");
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'purchase_quote_returned'",
        [manager.id],
      ),
    ).toBe(1);

    // Proposta enviada depois da devolução volta a solicitação para "em cotação".
    const lateQuote = await buyer.api.post(`/api/purchases/${requestId}/quotes`, {
      supplierId,
      items: [{ itemId: cafeItemId, unitPrice: 18.4 }],
    });
    expect(lateQuote.status).toBe(200);
    expect(await statusOf(requestId)).toBe("quoting");
    await buyer.api.post(`/api/purchases/${requestId}/quotes/return`, {});

    // Gestor aprova a proposta do segundo fornecedor; a outra é marcada.
    const approvedQuote = await manager.api.post(`/api/purchases/${requestId}/quotes/${quoteB.body.id}/approve`, {
      notes: "Melhor valor no conjunto",
    });
    expect(approvedQuote.status).toBe(200);
    expect(await statusOf(requestId)).toBe("quote_approved");
    const quoteStatuses = await queryAll<{ id: string; status: string }>(
      "SELECT id, status FROM purchase_quotes WHERE request_id = ?",
      [requestId],
    );
    const quoteStatusById = new Map(quoteStatuses.map((row) => [row.id, row.status]));
    expect(quoteStatusById.get(quoteB.body.id)).toBe("approved");
    expect(quoteStatusById.get(quoteA.body.id)).toBe("rejected");
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'purchase_quote_approved'",
        [buyer.id],
      ),
    ).toBe(1);

    // O pedido exige o fornecedor da proposta aprovada...
    const wrongSupplier = await buyer.api.post(`/api/purchases/${requestId}/order`, {
      supplierId,
      items: [{ itemId: aguaItemId, qtyOrdered: 10 }],
    });
    expectError(wrongSupplier, "CONFLICT");

    // ...e herda o preço cotado quando o pedido não informa valor.
    const ordered = await buyer.api.post(`/api/purchases/${requestId}/order`, {
      supplierId: secondSupplier.body.id,
      items: [
        { itemId: aguaItemId, qtyOrdered: 10 },
        { itemId: cafeItemId, qtyOrdered: 4 },
      ],
    });
    expect(ordered.status).toBe(200);

    const priced = await queryAll<{ id: string; unit_price_cents: number | null }>(
      "SELECT id, unit_price_cents FROM purchase_request_items WHERE request_id = ?",
      [requestId],
    );
    const priceById = new Map(priced.map((row) => [row.id, row.unit_price_cents]));
    expect(priceById.get(aguaItemId)).toBe(420);
    expect(priceById.get(cafeItemId)).toBe(1750);
  });

  it("F-02: recusa da proposta devolve a cotação e aprovação 100% direta segue para pedido", async () => {
    // Aprovação sem itens em cotação continua indo direto para "aprovada".
    const direct = await createRequest({ productId: aguaId, qty: 5 }, true);
    const directItems = await itemsOf(direct);
    const approvedDirect = await manager.api.post<{ status: string }>(`/api/purchases/${direct}/decide`, {
      decision: "approved",
      items: [{ itemId: directItems[0]!.id, purchaseMode: "direct" }],
    });
    expect(approvedDirect.status).toBe(200);
    expect(approvedDirect.body.status).toBe("approved");
    const directMode = await queryOne<{ purchase_mode: string | null }>(
      "SELECT purchase_mode FROM purchase_request_items WHERE id = ?",
      [directItems[0]!.id],
    );
    expect(directMode?.purchase_mode).toBe("direct");
    const orderedDirect = await buyer.api.post(`/api/purchases/${direct}/order`, {
      supplierId,
      items: [{ itemId: directItems[0]!.id, qtyOrdered: 5, unitPrice: 4.5 }],
    });
    expect(orderedDirect.status).toBe(200);

    // Recusar a proposta devolvida manda a cotação de volta ao comprador.
    const request = await createRequest({ productId: cafeId, qty: 2 }, true);
    const items = await itemsOf(request);
    await manager.api.post(`/api/purchases/${request}/decide`, {
      decision: "approved",
      items: [{ itemId: items[0]!.id, purchaseMode: "quote" }],
    });
    expect(await statusOf(request)).toBe("quoting");

    const quote = await buyer.api.post<{ id: string }>(`/api/purchases/${request}/quotes`, {
      supplierId,
      items: [{ itemId: items[0]!.id, unitPrice: 20 }],
    });
    expect(quote.status).toBe(201);
    await buyer.api.post(`/api/purchases/${request}/quotes/return`, {});
    expect(await statusOf(request)).toBe("quote_returned");

    const rejected = await manager.api.post(`/api/purchases/${request}/quotes/${quote.body.id}/reject`, {
      notes: "Valor acima do praticado; buscar nova proposta",
    });
    expect(rejected.status).toBe(200);
    expect(await statusOf(request)).toBe("quoting");
    const quoteRow = await queryOne<{ status: string }>("SELECT status FROM purchase_quotes WHERE id = ?", [
      quote.body.id,
    ]);
    expect(quoteRow?.status).toBe("rejected");
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND type = 'purchase_quote_rejected'",
        [buyer.id],
      ),
    ).toBe(1);

    // Proposta de cotação sem item nenhum é recusada na validação.
    const empty = await buyer.api.post(`/api/purchases/${request}/quotes`, { supplierId, items: [] });
    expectError(empty, "VALIDATION_ERROR");

    // Devolver sem nenhuma proposta registrada é bloqueado.
    const returnWithoutQuotes = await buyer.api.post(`/api/purchases/${request}/quotes/return`, {});
    expectError(returnWithoutQuotes, "BAD_REQUEST");
  });

  it("F-05: a linha do tempo cobre o ciclo completo, incluindo as propostas", async () => {
    // Ciclo direto: criar já enviando, aprovar, pedir e receber.
    const direct = await approveAndOrdered({ productId: aguaId, qty: 10 }, 10, 4);
    const directItems = await itemsOf(direct);
    const received = await buyer.api.post(`/api/purchases/${direct}/receipts`, {
      requestKey: "linha-do-tempo-01",
      locationId: structure.warehouseId,
      items: [{ requestItemId: directItems[0]!.id, receivedQty: 10 }],
    });
    expect(received.status).toBe(201);

    const detail = await buyer.api.get<RequestDetail>(`/api/purchases/${direct}`);
    expect(detail.status).toBe(200);
    const actions = detail.body.timeline.map((event) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "purchase_request.create",
        "purchase_request.approved",
        "purchase_request.order",
        "purchase_receipt.confirm",
      ]),
    );
    // A ordem real é preservada: o recebimento vem depois do pedido.
    expect(actions.indexOf("purchase_receipt.confirm")).toBeGreaterThan(actions.indexOf("purchase_request.order"));
    const orderEvent = detail.body.timeline.find((event) => event.action === "purchase_request.order");
    expect(orderEvent?.supplierId).toBe(supplierId);
    const receiptEvent = detail.body.timeline.find((event) => event.action === "purchase_receipt.confirm");
    expect(receiptEvent?.code).toMatch(/^REC-/);

    // Ciclo com cotação: a linha do tempo registra cada proposta e a escolha.
    const secondSupplier = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name: "Papelaria Norte",
    });
    expect(secondSupplier.status).toBe(201);
    const quoted = await createRequest({ productId: cafeId, qty: 2 }, true);
    const quotedItems = await itemsOf(quoted);
    await manager.api.post(`/api/purchases/${quoted}/decide`, {
      decision: "approved",
      items: [{ itemId: quotedItems[0]!.id, purchaseMode: "quote" }],
    });
    const first = await buyer.api.post<{ id: string }>(`/api/purchases/${quoted}/quotes`, {
      supplierId,
      items: [{ itemId: quotedItems[0]!.id, unitPrice: 21 }],
    });
    const second = await buyer.api.post<{ id: string }>(`/api/purchases/${quoted}/quotes`, {
      supplierId: secondSupplier.body.id,
      items: [{ itemId: quotedItems[0]!.id, unitPrice: 18.5 }],
    });
    await buyer.api.post(`/api/purchases/${quoted}/quotes/return`, {});
    await manager.api.post(`/api/purchases/${quoted}/quotes/${second.body.id}/approve`, {});

    const quotedDetail = await buyer.api.get<RequestDetail>(`/api/purchases/${quoted}`);
    const quotedActions = quotedDetail.body.timeline.map((event) => event.action);
    expect(quotedActions).toEqual(
      expect.arrayContaining([
        "purchase_request.create",
        "purchase_request.approved",
        "purchase_quote.create",
        "purchase_quote.return",
        "purchase_quote.approve",
      ]),
    );
    const quoteCreates = quotedDetail.body.timeline.filter((event) => event.action === "purchase_quote.create");
    expect(quoteCreates.length).toBe(2);
    expect(quoteCreates.every((event) => (event.code ?? "").startsWith("COT-"))).toBe(true);
    const approvedEvent = quotedDetail.body.timeline.find((event) => event.action === "purchase_quote.approve");
    expect(approvedEvent?.entityId).toBe(second.body.id);
    expect(approvedEvent?.supplierId).toBe(secondSupplier.body.id);
    // A proposta aprovada é a segunda; a primeira fica registrada.
    expect(first.body.id).not.toBe(second.body.id);
  });

  it("F-06: uso direto entra e sai no mesmo recebimento, com justificativa", async () => {
    const created = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Compra com uso direto parcial",
      submit: true,
      items: [
        { productId: aguaId, qty: 10 },
        { productId: cafeId, qty: 4 },
      ],
    });
    const requestId = created.body.id;
    const itemRows = await queryAll<{ id: string; product_id: string | null }>(
      "SELECT id, product_id FROM purchase_request_items WHERE request_id = ?",
      [requestId],
    );
    const aguaItem = itemRows.find((row) => row.product_id === aguaId)!.id;
    const cafeItem = itemRows.find((row) => row.product_id === cafeId)!.id;

    await manager.api.post(`/api/purchases/${requestId}/decide`, { decision: "approved" });
    const ordered = await buyer.api.post(`/api/purchases/${requestId}/order`, {
      supplierId,
      items: [
        { itemId: aguaItem, qtyOrdered: 10, unitPrice: 4 },
        { itemId: cafeItem, qtyOrdered: 4, unitPrice: 17.5 },
      ],
    });
    expect(ordered.status).toBe(200);

    // Uso direto sem justificativa é recusado antes de qualquer movimentação.
    const missingReason = await buyer.api.post(`/api/purchases/${requestId}/receipts`, {
      requestKey: "uso-direto-sem-motivo",
      locationId: structure.warehouseId,
      items: [{ requestItemId: aguaItem, receivedQty: 10, directUse: true }],
    });
    expectError(missingReason, "BAD_REQUEST");
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(10_000);

    // Água entra e sai (uso direto); café segue o fluxo normal.
    const received = await buyer.api.post<{ receipt: { id: string; code: string } }>(
      `/api/purchases/${requestId}/receipts`,
      {
        requestKey: "uso-direto-com-motivo",
        locationId: structure.warehouseId,
        directUseReason: "Entregue direto à equipe de manutenção para o reparo do 3º andar",
        items: [
          { requestItemId: aguaItem, receivedQty: 10, directUse: true },
          { requestItemId: cafeItem, receivedQty: 4 },
        ],
      },
    );
    expect(received.status).toBe(201);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(10_000);
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(4_000);
    expect(await statusOf(requestId)).toBe("received");

    const movements = await queryAll<{
      type: string;
      product_id: string;
      qty_milli: number;
      from_location_id: string | null;
      to_location_id: string | null;
      reason: string | null;
    }>(
      `SELECT type, product_id, qty_milli, from_location_id, to_location_id, reason
         FROM movements WHERE ref_type = 'purchase_receipt' AND ref_id = ? ORDER BY rowid`,
      [received.body.receipt.id],
    );
    expect(movements.length).toBe(3);
    expect(movements.map((movement) => movement.type)).toEqual([
      "purchase_receipt",
      "purchase_receipt",
      "consumption",
    ]);
    const exit = movements[2]!;
    expect(exit.product_id).toBe(aguaId);
    expect(exit.qty_milli).toBe(10_000);
    expect(exit.from_location_id).toBe(structure.warehouseId);
    expect(exit.reason).toContain("Uso direto no recebimento REC-");
    expect(exit.reason).toContain("reparo do 3º andar");

    // O detalhe expõe a marca de uso direto no recebimento.
    const detail = await buyer.api.get<RequestDetail>(`/api/purchases/${requestId}`);
    const receiptRow = detail.body.receipts.find((row) => row.id === received.body.receipt.id);
    expect(receiptRow?.directUseCount).toBe(1);

    // Reenvio da mesma confirmação não duplica entrada nem saída.
    const replay = await buyer.api.post<{ idempotentReplay: boolean }>(
      `/api/purchases/${requestId}/receipts`,
      {
        requestKey: "uso-direto-com-motivo",
        locationId: structure.warehouseId,
        directUseReason: "Entregue direto à equipe de manutenção para o reparo do 3º andar",
        items: [
          { requestItemId: aguaItem, receivedQty: 10, directUse: true },
          { requestItemId: cafeItem, receivedQty: 4 },
        ],
      },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(10_000);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM movements WHERE ref_type = 'purchase_receipt' AND ref_id = ?",
        [received.body.receipt.id],
      ),
    ).toBe(3);
  });

  /* ------------------------------------------------------------------------ */
  /* Auxiliares do teste                                                      */
  /* ------------------------------------------------------------------------ */

  async function createRequest(
    item: { productId?: string; description?: string; qty: number },
    submit: boolean,
  ): Promise<string> {
    const created = await buyer.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 1,
      locationId: structure.warehouseId,
      justification: "Reposição de estoque",
      submit,
      items: [item],
    });
    if (created.status !== 201) {
      throw new Error(`Falha ao criar solicitação: ${created.status} ${JSON.stringify(created.body)}`);
    }
    return created.body.id;
  }

  async function approveAndOrdered(
    item: { productId: string; qty: number },
    qtyOrdered: number,
    unitPrice: number,
  ): Promise<string> {
    const request = await createRequest(item, true);
    const items = await itemsOf(request);
    const approved = await manager.api.post(`/api/purchases/${request}/decide`, { decision: "approved" });
    assert(approved.status === 200, `Falha ao aprovar: ${approved.status}`);
    const ordered = await buyer.api.post(`/api/purchases/${request}/order`, {
      supplierId,
      items: [{ itemId: items[0]!.id, qtyOrdered, unitPrice }],
    });
    assert(ordered.status === 200, `Falha ao registrar pedido: ${ordered.status}`);
    return request;
  }

  async function itemsOf(requestId: string): Promise<RequestItem[]> {
    const detail = await buyer.api.get<RequestDetail>(`/api/purchases/${requestId}`);
    if (detail.status !== 200) {
      throw new Error(`Falha ao ler solicitação: ${detail.status} ${JSON.stringify(detail.body)}`);
    }
    return detail.body.items;
  }

  async function statusOf(requestId: string): Promise<string> {
    const row = await queryOne<{ status: string }>("SELECT status FROM purchase_requests WHERE id = ?", [
      requestId,
    ]);
    assert(row, `Solicitação ${requestId} não encontrada.`);
    return row.status;
  }
});

interface RequestItem {
  id: string;
  qtyMilli: number;
  qtyApprovedMilli: number | null;
  qtyOrderedMilli: number | null;
  qtyReceivedMilli: number;
  status: string;
  unitPriceCents: number | null;
  supplierName: string | null;
}

interface RequestListItem {
  id: string;
  code: string;
  status: string;
}

interface RequestDetail {
  request: RequestListItem & { priority: string; requesterName: string; justification: string | null };
  items: RequestItem[];
  receipts: { id: string; code: string; directUseCount: number }[];
  quotes: {
    id: string;
    code: string;
    status: string;
    supplierName: string;
    items: { requestItemId: string; unitPriceCents: number; qtyMilli: number }[];
  }[];
  timeline: {
    at: string;
    action: string;
    actor: string;
    entityId: string | null;
    code: string | null;
    supplierId: string | null;
    orderRef: string | null;
    note: string | null;
  }[];
}
