import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  Api,
  assert,
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Fluxo corporativo (versao 2): gestor do setor -> direcao -> compras, com
 * envio direto, compra direta autorizada, adjudicacao item a item, pedidos por
 * fornecedor, recebimento vinculado ao pedido e outbox de integracao.
 *
 * O fluxo legado continua coberto por `07-purchases.spec.ts`; aqui o objetivo e
 * provar que as duas versoes convivem e que as permissoes separadas funcionam.
 */
describe("compras: fluxo corporativo v2, adjudicacao e integracoes", () => {
  let admin: Actor;
  let structure: Structure;
  let requester: Actor;
  let manager: Actor;
  let director: Actor;
  let purchasing: Actor;
  let buyer: Actor;
  let supplierA: string;
  let supplierB: string;
  let papelId: string;
  let canetaId: string;

  async function createSupplier(name: string): Promise<string> {
    const created = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name,
      doc: null,
      contactName: "Contato",
      phone: "(11) 4002-8922",
    });
    assert(created.status === 201, `Falha ao criar fornecedor: ${created.status}`);
    return created.body.id;
  }

  async function createRequest(
    actor: Actor,
    items: Array<{ productId: string; qty: number }>,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const created = await actor.api.post<{ id: string; status: string }>("/api/purchases", {
      workflowVersion: 2,
      locationId: structure.warehouseId,
      justification: "Reposicao do estoque",
      priority: "high",
      costCenterId: "cc_ope",
      glAccount: "4.2.01",
      budgetNotes: "Verba aprovada do trimestre",
      submit: true,
      items,
      ...extra,
    });
    assert(created.status === 201, `Falha ao criar solicitacao: ${created.status} ${JSON.stringify(created.body)}`);
    return created.body.id;
  }

  async function detail(actor: Actor, requestId: string) {
    const response = await actor.api.get<{
      request: {
        id: string;
        status: string;
        approvalStage: string;
        routing: string;
        workflowVersion: number;
        budgetStatus: string;
        financeStatus: string;
        costCenterId: string | null;
        managerApprovedBy: string | null;
        directionApprovedBy: string | null;
      };
      items: Array<{
        id: string;
        productId: string | null;
        status: string;
        purchaseMode: string;
        qtyMilli: number;
        qtyApprovedMilli: number | null;
      }>;
      quotes: Array<{ id: string; status: string; supplierId: string; items: Array<{ requestItemId: string }> }>;
      awards: Array<{ id: string; requestItemId: string; supplierId: string }>;
      orders: Array<{
        id: string;
        code: string;
        supplierId: string;
        totalCents: number;
        status: string;
        costCenterId: string | null;
        glAccount: string | null;
      }>;
    }>(`/api/purchases/${requestId}`);
    assert(response.status === 200, `Falha ao ler solicitacao: ${response.status}`);
    return response.body;
  }

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    papelId = await createProduct(admin, { name: "Papel A4", sku: "PAP-A4" });
    canetaId = await createProduct(admin, { name: "Caneta azul", sku: "CAN-AZ" });
    supplierA = await createSupplier("Fornecedor Alfa");
    supplierB = await createSupplier("Fornecedor Beta");

    requester = await createUser(admin, {
      name: "Solicitante",
      email: "solicitante@facil.test",
      roleId: await findRoleId("cleaning_lead"),
    });
    manager = await createUser(admin, {
      name: "Gerente do setor",
      email: "gerente.setor@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    director = await createUser(admin, {
      name: "Diretor de operacoes",
      email: "diretor@facil.test",
      roleId: await findRoleId("operations_director"),
    });
    purchasing = await createUser(admin, {
      name: "Gestor de compras",
      email: "gestor.compras@facil.test",
      roleId: await findRoleId("purchasing_manager"),
    });
    buyer = await createUser(admin, {
      name: "Comprador",
      email: "comprador.v2@facil.test",
      roleId: await findRoleId("buyer"),
    });
  });

  it("percorre gestor, direcao, cotacao, adjudicacao, pedido e recebimento", async () => {
    const requestId = await createRequest(requester, [{ productId: papelId, qty: 10 }]);

    const created = await detail(manager, requestId);
    expect(created.request.workflowVersion).toBe(2);
    expect(created.request.status).toBe("pending_approval");
    expect(created.request.approvalStage).toBe("manager");
    expect(created.request.costCenterId).toBe("cc_ope");
    const itemId = created.items[0]!.id;

    const managerDecision = await manager.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${requestId}/decide`,
      {
        decision: "approved",
        notes: "Necessidade confirmada.",
        items: [{ itemId, status: "approved", qtyApproved: 10, purchaseMode: "quote" }],
      },
    );
    expect(managerDecision.status).toBe(200);
    expect(managerDecision.body).toMatchObject({ status: "pending_approval", approvalStage: "direction" });

    const afterManager = await detail(director, requestId);
    expect(afterManager.request.managerApprovedBy).toBe(manager.id);
    expect(afterManager.request.budgetStatus).toBe("pending");

    const directionDecision = await director.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${requestId}/decide`,
      {
        decision: "approved",
        notes: "Orcamento aprovado.",
        items: [{ itemId, status: "approved", qtyApproved: 10, purchaseMode: "quote" }],
      },
    );
    expect(directionDecision.status).toBe(200);
    expect(directionDecision.body).toMatchObject({ status: "quoting", approvalStage: "buyer" });

    const quote = await buyer.api.post<{ id: string; code: string }>(`/api/purchases/${requestId}/quotes`, {
      supplierId: supplierA,
      notes: "Proposta unica.",
      items: [{ itemId, qty: 10, unitPrice: 12.5 }],
    });
    expect(quote.status).toBe(201);

    const returned = await buyer.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${requestId}/quotes/return`,
      {},
    );
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe("quote_returned");

    const award = await purchasing.api.post<{ status: string }>(`/api/purchases/${requestId}/award`, {
      notes: "Melhor preco e prazo.",
      awards: [{ itemId, quoteId: quote.body.id }],
    });
    expect(award.status).toBe(200);
    expect(award.body.status).toBe("quote_approved");

    const afterAward = await detail(buyer, requestId);
    expect(afterAward.request.approvalStage).toBe("buyer");
    expect(afterAward.awards).toHaveLength(1);
    expect(afterAward.awards[0]).toMatchObject({ requestItemId: itemId, supplierId: supplierA });

    const legacyOrder = await buyer.api.post(`/api/purchases/${requestId}/order`, {
      supplierId: supplierA,
      items: [{ itemId, qtyOrdered: 10, unitPrice: 12.5 }],
    });
    expectError(legacyOrder, "CONFLICT");

    const wrongPrice = await buyer.api.post(`/api/purchases/${requestId}/orders`, {
      orders: [
        {
          supplierId: supplierA,
          items: [{ itemId, qtyOrdered: 10, unitPrice: 13 }],
        },
      ],
    });
    expectError(wrongPrice, "CONFLICT");

    const orders = await buyer.api.post<{ orders: Array<{ id: string; code: string; totalCents: number }> }>(
      `/api/purchases/${requestId}/orders`,
      {
        notes: "Pedido unico.",
        orders: [
          {
            supplierId: supplierA,
            orderRef: "FORN-ALFA-1",
            items: [{ itemId, qtyOrdered: 10, unitPrice: 12.5 }],
          },
        ],
      },
    );
    expect(orders.status).toBe(201);
    expect(orders.body.orders).toHaveLength(1);
    expect(orders.body.orders[0]!.totalCents).toBe(12_500);

    const ordered = await detail(buyer, requestId);
    expect(ordered.request.status).toBe("ordered");
    expect(ordered.request.approvalStage).toBe("receipt");
    expect(ordered.request.financeStatus).toBe("committed");
    expect(ordered.orders).toHaveLength(1);
    const order = ordered.orders[0]!;
    expect(order).toMatchObject({
      supplierId: supplierA,
      status: "open",
      totalCents: 12_500,
      costCenterId: "cc_ope",
      glAccount: "4.2.01",
    });

    const receipt = await buyer.api.post<{ receipt: { id: string; code: string } }>(
      `/api/purchases/${requestId}/receipts`,
      {
        requestKey: `recebimento-${requestId}-1`,
        locationId: structure.warehouseId,
        purchaseOrderId: order.id,
        documentRef: "NF-100",
        items: [{ requestItemId: itemId, receivedQty: 10, unitPrice: 12.5 }],
      },
    );
    expect(receipt.status).toBe(201);

    const received = await detail(buyer, requestId);
    expect(received.request.status).toBe("received");
    expect(received.request.approvalStage).toBe("completed");
    expect(received.request.financeStatus).toBe("received");
    expect(received.orders[0]!.status).toBe("received");

    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM integration_outbox WHERE event_type = 'purchase_order.created'",
      ),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM integration_outbox WHERE event_type = 'goods_receipt.posted'",
      ),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM integration_outbox WHERE event_type = 'purchase_request.ordered'",
      ),
    ).toBe(1);
  });

  it("usa cotacao como destino padrao quando a decisao nao detalha os itens", async () => {
    const requestId = await createRequest(requester, [{ productId: papelId, qty: 10 }]);

    const managerDecision = await manager.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${requestId}/decide`,
      { decision: "approved", notes: "Necessidade confirmada." },
    );
    expect(managerDecision.status).toBe(200);
    expect(managerDecision.body).toMatchObject({ status: "pending_approval", approvalStage: "direction" });

    const afterManager = await detail(director, requestId);
    expect(afterManager.items[0]!.purchaseMode).toBe("quote");

    const directionDecision = await director.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${requestId}/decide`,
      { decision: "approved", notes: "Orcamento aprovado." },
    );
    expect(directionDecision.status).toBe(200);
    expect(directionDecision.body).toMatchObject({ status: "quoting", approvalStage: "buyer" });

    const afterDirection = await detail(buyer, requestId);
    expect(afterDirection.items[0]!.purchaseMode).toBe("quote");
    expect(afterDirection.items[0]!.status).toBe("approved");
  });

  it("divide a adjudicacao por item e recebe cada pedido separadamente", async () => {
    const requestId = await createRequest(requester, [
      { productId: papelId, qty: 10 },
      { productId: canetaId, qty: 5 },
    ]);

    const created = await detail(manager, requestId);
    expect(created.items).toHaveLength(2);
    const papelItem = created.items.find((item) => item.productId === papelId)!.id;
    const canetaItem = created.items.find((item) => item.productId === canetaId)!.id;

    const managerDecision = await manager.api.post(`/api/purchases/${requestId}/decide`, {
      decision: "approved",
      items: [
        { itemId: papelItem, status: "approved", qtyApproved: 10, purchaseMode: "quote" },
        { itemId: canetaItem, status: "approved", qtyApproved: 5, purchaseMode: "quote" },
      ],
    });
    expect(managerDecision.status, JSON.stringify(managerDecision.body)).toBe(200);

    const directionDecision = await director.api.post(`/api/purchases/${requestId}/decide`, {
      decision: "approved",
      items: [
        { itemId: papelItem, status: "approved", qtyApproved: 10, purchaseMode: "quote" },
        { itemId: canetaItem, status: "approved", qtyApproved: 5, purchaseMode: "quote" },
      ],
    });
    expect(directionDecision.status).toBe(200);

    const quoteA = await buyer.api.post<{ id: string }>(`/api/purchases/${requestId}/quotes`, {
      supplierId: supplierA,
      items: [
        { itemId: papelItem, qty: 10, unitPrice: 10 },
        { itemId: canetaItem, qty: 5, unitPrice: 100 },
      ],
    });
    const quoteB = await buyer.api.post<{ id: string }>(`/api/purchases/${requestId}/quotes`, {
      supplierId: supplierB,
      items: [
        { itemId: papelItem, qty: 10, unitPrice: 8 },
        { itemId: canetaItem, qty: 5, unitPrice: 90 },
      ],
    });
    expect(quoteA.status).toBe(201);
    expect(quoteB.status).toBe(201);

    const returned = await buyer.api.post(`/api/purchases/${requestId}/quotes/return`, {});
    expect(returned.status).toBe(200);

    // Cobertura incompleta e recusada: todo item em cotacao precisa de vencedor.
    const incomplete = await purchasing.api.post(`/api/purchases/${requestId}/award`, {
      awards: [{ itemId: papelItem, quoteId: quoteB.body.id }],
    });
    expectError(incomplete, "BAD_REQUEST");

    const awarded = await purchasing.api.post(`/api/purchases/${requestId}/award`, {
      awards: [
        { itemId: papelItem, quoteId: quoteB.body.id },
        { itemId: canetaItem, quoteId: quoteA.body.id },
      ],
    });
    expect(awarded.status).toBe(200);

    const afterAward = await detail(buyer, requestId);
    expect(afterAward.request.status).toBe("quote_approved");
    expect(afterAward.awards).toHaveLength(2);
    expect(afterAward.awards.find((award) => award.requestItemId === papelItem)?.supplierId).toBe(supplierB);
    expect(afterAward.awards.find((award) => award.requestItemId === canetaItem)?.supplierId).toBe(supplierA);

    const orders = await buyer.api.post<{ orders: Array<{ id: string; supplierId: string; totalCents: number }> }>(
      `/api/purchases/${requestId}/orders`,
      {
        orders: [
          {
            supplierId: supplierB,
            orderRef: "BETA-1",
            items: [{ itemId: papelItem, qtyOrdered: 10, unitPrice: 8 }],
          },
          {
            supplierId: supplierA,
            orderRef: "ALFA-1",
            items: [{ itemId: canetaItem, qtyOrdered: 5, unitPrice: 100 }],
          },
        ],
      },
    );
    expect(orders.status).toBe(201);
    expect(orders.body.orders).toHaveLength(2);
    expect(orders.body.orders.map((order) => order.totalCents).sort((a, b) => a - b)).toEqual([8_000, 50_000]);

    const betaOrder = orders.body.orders.find((order) => order.supplierId === supplierB)!;
    const alfaOrder = orders.body.orders.find((order) => order.supplierId === supplierA)!;
    expect(betaOrder).toBeTruthy();
    expect(alfaOrder).toBeTruthy();

    const firstReceipt = await buyer.api.post(`/api/purchases/${requestId}/receipts`, {
      requestKey: `recebimento-${requestId}-beta`,
      locationId: structure.warehouseId,
      purchaseOrderId: betaOrder.id,
      items: [{ requestItemId: papelItem, receivedQty: 10, unitPrice: 8 }],
    });
    expect(firstReceipt.status).toBe(201);

    const partial = await detail(buyer, requestId);
    expect(partial.request.status).toBe("partially_received");
    expect(partial.request.approvalStage).toBe("receipt");
    expect(partial.orders.find((order) => order.id === betaOrder.id)?.status).toBe("received");
    expect(partial.orders.find((order) => order.id === alfaOrder.id)?.status).toBe("open");

    const secondReceipt = await buyer.api.post(`/api/purchases/${requestId}/receipts`, {
      requestKey: `recebimento-${requestId}-alfa`,
      locationId: structure.warehouseId,
      purchaseOrderId: alfaOrder.id,
      items: [{ requestItemId: canetaItem, receivedQty: 5, unitPrice: 100 }],
    });
    expect(secondReceipt.status).toBe(201);

    const complete = await detail(buyer, requestId);
    expect(complete.request.status).toBe("received");
    expect(complete.request.approvalStage).toBe("completed");
    expect(complete.orders.every((order) => order.status === "received")).toBe(true);
  });

  it("envia direto a compras e autoriza compra direta sem cotacao", async () => {
    const requestId = await createRequest(requester, [{ productId: papelId, qty: 5 }]);
    const created = await detail(manager, requestId);

    const directToPurchasing = await manager.api.post<{ status: string; approvalStage: string; routing: string }>(
      `/api/purchases/${requestId}/decide`,
      {
        decision: "send_to_purchasing",
        notes: "Compra recorrente; pode ir direto para Compras.",
        items: [
          { itemId: created.items[0]!.id, status: "approved", qtyApproved: 5, purchaseMode: "direct" },
        ],
      },
    );
    expect(directToPurchasing.status).toBe(200);
    expect(directToPurchasing.body).toMatchObject({
      status: "pending_approval",
      approvalStage: "purchasing",
    });
    const routed = await detail(manager, requestId);
    expect(routed.request.routing).toBe("direct_to_purchasing");

    const authorized = await purchasing.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${requestId}/decide`,
      { decision: "authorize_direct", notes: "Compra direta autorizada." },
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toMatchObject({ status: "approved", approvalStage: "buyer" });

    const afterAuthorization = await detail(buyer, requestId);
    expect(afterAuthorization.request.budgetStatus).toBe("approved");
    expect(afterAuthorization.items[0]!.purchaseMode).toBe("direct");

    const orders = await buyer.api.post<{ orders: Array<{ id: string; totalCents: number }> }>(
      `/api/purchases/${requestId}/orders`,
      {
        orders: [
          {
            supplierId: supplierA,
            items: [{ itemId: afterAuthorization.items[0]!.id, qtyOrdered: 5, unitPrice: 20 }],
          },
        ],
      },
    );
    expect(orders.status).toBe(201);
    expect(orders.body.orders[0]!.totalCents).toBe(10_000);

    const final = await detail(buyer, requestId);
    expect(final.request.status).toBe("ordered");
    expect(final.request.approvalStage).toBe("receipt");
  });

  it("isola solicitacoes por solicitante e recebe ticket externo do ServiceNow", async () => {
    const otherRequester = await createUser(admin, {
      name: "Outro solicitante",
      email: "outro.solicitante@facil.test",
      roleId: await findRoleId("cleaning_lead"),
    });
    const requestId = await createRequest(requester, [{ productId: papelId, qty: 1 }]);

    const forbidden = await otherRequester.api.get(`/api/purchases/${requestId}`);
    expectError(forbidden, "FORBIDDEN");

    const visible = await admin.api.get(`/api/purchases/${requestId}`);
    expect(visible.status).toBe(200);

    const intake = new Api();
    const first = await intake.request<{ id: string; code: string; duplicate: boolean }>(
      "POST",
      "/api/intake/tickets",
      {
        headers: { "x-intake-key": "test-intake-key" },
        body: {
          source: "servicenow",
          externalRef: "INC0012345",
          title: "Ar-condicionado da sala 101 nao liga",
          description: "Chamado aberto pelo portal.",
          priority: "high",
          categoryCode: "climatização",
          locationCode: "SALA-101",
          requester: {
            name: "Maria Silva",
            email: "maria.silva@empresa.test",
            phone: "(11) 99999-0000",
          },
        },
      },
    );
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);

    const duplicate = await intake.request<{ id: string; code: string; duplicate: boolean }>(
      "POST",
      "/api/intake/tickets",
      {
        headers: { "x-intake-key": "test-intake-key" },
        body: {
          source: "servicenow",
          externalRef: "INC0012345",
          title: "Ar-condicionado da sala 101 nao liga",
          requester: { name: "Maria Silva", email: "maria.silva@empresa.test" },
        },
      },
    );
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ id: first.body.id, duplicate: true });

    const ticket = await queryOne<{
      source: string;
      external_ref: string;
      intake_name: string;
      intake_email: string;
      requester_id: string;
      location_id: string | null;
    }>("SELECT source, external_ref, intake_name, intake_email, requester_id, location_id FROM tickets WHERE id = ?", [
      first.body.id,
    ]);
    expect(ticket).toMatchObject({
      source: "servicenow",
      external_ref: "INC0012345",
      intake_name: "Maria Silva",
      intake_email: "maria.silva@empresa.test",
      requester_id: "user_intake",
    });
    expect(ticket?.location_id).toBe(structure.roomId);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM ticket_intake_events WHERE external_ref = 'INC0012345'"),
    ).toBe(2);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM integration_outbox WHERE event_type = 'ticket.intake.received'",
      ),
    ).toBe(1);
  });

  it("nao bloqueia a instalacao inicial por causa do usuario tecnico de intake", async () => {
    await resetDatabase();
    await env.DB.prepare(
      `INSERT INTO users
         (id, name, email, password_hash, password_salt, password_iterations, role_id,
          unit_id, employee_code, phone, job_title, notes, is_active, must_change_password,
          last_login_at, created_at, updated_at)
       VALUES
         ('user_intake', 'Integracao externa', 'intake@local.invalid', NULL, NULL, NULL,
          'role_requester', NULL, NULL, NULL, 'Canal externo',
          'Solicitante tecnico dos tickets recebidos por API. Nao utilize para login.',
          1, 0, NULL, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z')`,
    ).run();

    const publicApi = new Api();
    const status = await publicApi.get<{ needsSetup: boolean }>("/api/auth/setup-status");
    expect(status.status).toBe(200);
    expect(status.body.needsSetup).toBe(true);

    const created = await setupAdmin();
    expect(created.id).toBeTruthy();
    const after = await publicApi.get<{ needsSetup: boolean }>("/api/auth/setup-status");
    expect(after.body.needsSetup).toBe(false);
  });
});
