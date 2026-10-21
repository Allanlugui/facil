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
  setupAdmin,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Fluxo de compras v3 (por setor): gestor do setor -> responsavel de Compras ->
 * comprador -> estoque com nota fiscal. As solicitacoes v1/v2 continuam
 * cobertas por 07 e 18; aqui o foco e a convivencia e as novas regras.
 */
describe("compras v3: setores, autorizacao, cotacao/orcamento e nota fiscal", () => {
  let admin: Actor;
  let structure: Structure;
  let requester: Actor;
  let manager: Actor;
  let otherManager: Actor;
  let purchasing: Actor;
  let buyer: Actor;
  let stock: Actor;
  let supplierA: string;
  let supplierB: string;
  let productId: string;

  const LIMPEZA = "dept_lim";
  const MANUTENCAO = "dept_man";
  const COMPRAS = "dept_compras";

  async function createSupplier(name: string): Promise<string> {
    const created = await admin.api.post<{ id: string }>("/api/catalog/suppliers", {
      name,
      doc: null,
      contactName: "Contato",
      phone: "(11) 4002-8922",
    });
    expect(created.status).toBe(201);
    return created.body.id;
  }

  async function createRequest(extra: Record<string, unknown> = {}): Promise<{ id: string; itemId: string }> {
    const created = await requester.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      departmentId: LIMPEZA,
      purchaseMode: "quote",
      paymentMethodId: "pay_invoice",
      paymentTerms: "30 dias apos a nota fiscal",
      locationId: structure.warehouseId,
      justification: "Reposicao do setor de limpeza",
      priority: "normal",
      submit: true,
      items: [{ productId, qty: 10 }],
      ...extra,
    });
    expect(created.status).toBe(201);
    const detail = await manager.api.get<{
      items: Array<{ id: string }>;
    }>(`/api/purchases/${created.body.id}`);
    expect(detail.status).toBe(200);
    return { id: created.body.id, itemId: detail.body.items[0]!.id };
  }

  async function managerApprove(id: string): Promise<void> {
    const response = await manager.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${id}/decide`,
      { decision: "approved", notes: "Necessidade confirmada." },
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "pending_approval", approvalStage: "purchasing" });
  }

  async function purchasingAuthorize(
    id: string,
    body: Record<string, unknown> = {},
  ): Promise<void> {
    const response = await purchasing.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${id}/decide`,
      {
        decision: "approved",
        purchaseMode: "quote",
        paymentMethodId: "pay_invoice",
        notes: "Autorizado pelo setor de Compras.",
        ...body,
      },
    );
    expect(response.status).toBe(200);
  }

  async function quote(
    id: string,
    itemId: string,
    supplierId: string,
    unitPrice: number,
  ): Promise<string> {
    const response = await buyer.api.post<{ id: string }>(`/api/purchases/${id}/quotes`, {
      supplierId,
      paymentMethodId: "pay_invoice",
      items: [{ itemId, qty: 10, unitPrice }],
    });
    expect(response.status).toBe(201);
    return response.body.id;
  }

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    productId = await createProduct(admin, { name: "Detergente", sku: "DET-01" });
    supplierA = await createSupplier("Fornecedor Alfa");
    supplierB = await createSupplier("Fornecedor Beta");

    requester = await createUser(admin, {
      name: "Solicitante da limpeza",
      email: "solicitante.v3@facil.test",
      roleId: await findRoleId("cleaning_lead"),
      departmentId: LIMPEZA,
    });
    manager = await createUser(admin, {
      name: "Gestor da limpeza",
      email: "gestor.limpeza@facil.test",
      roleId: await findRoleId("facilities_manager"),
      departmentId: LIMPEZA,
      managedDepartmentIds: [LIMPEZA, MANUTENCAO],
    });
    otherManager = await createUser(admin, {
      name: "Gestor da manutencao",
      email: "gestor.manutencao@facil.test",
      roleId: await findRoleId("facilities_manager"),
      departmentId: MANUTENCAO,
      managedDepartmentIds: [MANUTENCAO],
    });
    purchasing = await createUser(admin, {
      name: "Responsavel de compras",
      email: "responsavel.compras@facil.test",
      roleId: await findRoleId("purchasing_manager"),
      departmentId: COMPRAS,
      managedDepartmentIds: [COMPRAS],
    });
    buyer = await createUser(admin, {
      name: "Comprador",
      email: "comprador.v3@facil.test",
      roleId: await findRoleId("buyer"),
      departmentId: COMPRAS,
    });
    stock = await createUser(admin, {
      name: "Responsavel pelo estoque",
      email: "estoque.v3@facil.test",
      roleId: await findRoleId("stock_keeper"),
      departmentId: COMPRAS,
    });
  });

  it("percorre gestor, autorizacao, duas cotacoes, pedido e recebimento com nota", async () => {
    const { id, itemId } = await createRequest();

    const detail = await manager.api.get<{
      request: {
        status: string;
        approvalStage: string;
        flowRevision: number;
        departmentName: string | null;
        paymentMethodName: string | null;
        paymentTerms: string | null;
      };
    }>(`/api/purchases/${id}`);
    expect(detail.body.request).toMatchObject({
      status: "pending_approval",
      approvalStage: "manager",
      flowRevision: 3,
      departmentName: "Limpeza e conservacao",
      paymentMethodName: "Faturado 30 dias",
      paymentTerms: "30 dias apos a nota fiscal",
    });

    // A visao resumida repete o filtro de visibilidade em tres subconsultas;
    // cada uma precisa receber os proprios parametros.
    const overview = await requester.api.get<{ openCount: number }>("/api/purchases/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.openCount).toBe(1);

    // Outro gestor nao aprova setor alheio e a mensagem diz a quem pedir.
    const forbidden = await otherManager.api.post(`/api/purchases/${id}/decide`, {
      decision: "approved",
    });
    expectError(forbidden, "FORBIDDEN");
    expect(JSON.stringify(forbidden.body)).toContain("gestor do setor");

    await managerApprove(id);
    const afterManager = await buyer.api.get<{ request: { approvalStage: string } }>(`/api/purchases/${id}`);
    expect(afterManager.body.request.approvalStage).toBe("purchasing");

    // Comprador nao autoriza a compra.
    const buyerCannotAuthorize = await buyer.api.post(`/api/purchases/${id}/decide`, {
      decision: "approved",
      purchaseMode: "quote",
      paymentMethodId: "pay_invoice",
    });
    expect(buyerCannotAuthorize.status).toBeGreaterThanOrEqual(400);

    await purchasingAuthorize(id);
    const quoting = await buyer.api.get<{ request: { status: string; approvalStage: string } }>(
      `/api/purchases/${id}`,
    );
    expect(quoting.body.request).toMatchObject({ status: "quoting", approvalStage: "buyer" });

    const quoteA = await quote(id, itemId, supplierA, 12.5);
    const onlyOne = await buyer.api.post(`/api/purchases/${id}/quotes/return`, {});
    expectError(onlyOne, "BAD_REQUEST");
    expect(JSON.stringify(onlyOne.body)).toContain("duas propostas");

    const quoteB = await quote(id, itemId, supplierB, 13.9);
    const returned = await buyer.api.post<{ status: string }>(`/api/purchases/${id}/quotes/return`, {});
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe("quote_returned");

    const approved = await purchasing.api.post<{ status: string }>(
      `/api/purchases/${id}/quotes/${quoteA}/approve`,
      { notes: "Melhor preco." },
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("quote_approved");

    const afterApproval = await buyer.api.get<{
      request: { approvalStage: string; purchasingAuthorizedBy: string | null };
      quotes: Array<{ id: string; status: string }>;
      awards: Array<{ requestItemId: string; supplierId: string }>;
    }>(`/api/purchases/${id}`);
    expect(afterApproval.body.request.approvalStage).toBe("buyer");
    expect(afterApproval.body.request.purchasingAuthorizedBy).toBe(purchasing.id);
    expect(afterApproval.body.quotes.find((quote) => quote.id === quoteA)?.status).toBe("approved");
    expect(afterApproval.body.quotes.find((quote) => quote.id === quoteB)?.status).toBe("rejected");
    expect(afterApproval.body.awards).toEqual([
      expect.objectContaining({ requestItemId: itemId, supplierId: supplierA }),
    ]);

    const orders = await buyer.api.post<{ orders: Array<{ id: string; totalCents: number }> }>(
      `/api/purchases/${id}/orders`,
      {
        orders: [
          {
            supplierId: supplierA,
            orderRef: "FORN-ALFA-V3",
            items: [{ itemId, qtyOrdered: 10, unitPrice: 12.5 }],
          },
        ],
      },
    );
    expect(orders.status).toBe(201);
    expect(orders.body.orders[0]!.totalCents).toBe(12_500);
    const orderId = orders.body.orders[0]!.id;

    const payment = await queryOne<{ payment_method_id: string | null; payment_terms: string | null }>(
      "SELECT payment_method_id, payment_terms FROM purchase_orders WHERE id = ?",
      [orderId],
    );
    expect(payment).toMatchObject({
      payment_method_id: "pay_invoice",
      payment_terms: "30 dias apos a nota fiscal",
    });

    // O pedido tem observacao propria; a aprovacao de Compras continua sendo
    // a ultima decisao registrada na ficha da solicitacao.
    const afterOrder = await buyer.api.get<{ request: { approvalNotes: string | null } }>(
      `/api/purchases/${id}`,
    );
    expect(afterOrder.body.request.approvalNotes).toBe("Melhor preco.");

    const receipt = await stock.api.post<{ receipt: { id: string } }>(
      `/api/purchases/${id}/receipts`,
      {
        requestKey: `recebimento-v3-${id}`,
        locationId: structure.warehouseId,
        purchaseOrderId: orderId,
        documentRef: "NF-900",
        invoiceNumber: "12345",
        invoiceSeries: "1",
        invoiceDate: "2026-10-21",
        invoiceTotal: 125,
        items: [{ requestItemId: itemId, receivedQty: 10, unitPrice: 12.5 }],
      },
    );
    expect(receipt.status).toBe(201);

    const received = await buyer.api.get<{
      request: { status: string; approvalStage: string };
      receipts: Array<{
        invoiceNumber: string | null;
        invoiceSeries: string | null;
        invoiceDate: string | null;
        invoiceTotalCents: number | null;
      }>;
      orders: Array<{ status: string }>;
    }>(`/api/purchases/${id}`);
    expect(received.body.request).toMatchObject({ status: "received", approvalStage: "completed" });
    expect(received.body.orders[0]!.status).toBe("received");
    expect(received.body.receipts[0]).toMatchObject({
      invoiceNumber: "12345",
      invoiceSeries: "1",
      invoiceDate: "2026-10-21",
      invoiceTotalCents: 12_500,
    });

    // Quem precisa agir recebeu aviso no sistema e e-mail.
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE type = 'purchase_pending_approval'",
      ),
    ).toBeGreaterThan(0);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM email_outbox WHERE kind = 'purchase_workflow'"),
    ).toBeGreaterThan(0);
  });

  it("orcamento aceita um fornecedor e recusa o segundo antes do envio", async () => {
    const { id, itemId } = await createRequest({ purchaseMode: "budget" });
    await managerApprove(id);
    await purchasingAuthorize(id, { purchaseMode: "budget" });

    await quote(id, itemId, supplierA, 10);
    const second = await buyer.api.post(`/api/purchases/${id}/quotes`, {
      supplierId: supplierB,
      items: [{ itemId, qty: 10, unitPrice: 9.5 }],
    });
    expectError(second, "CONFLICT");
    expect(JSON.stringify(second.body)).toContain("orçamento");

    const returned = await buyer.api.post<{ status: string }>(`/api/purchases/${id}/quotes/return`, {});
    expect(returned.status).toBe(200);
    expect(returned.body.status).toBe("quote_returned");
  });

  it("compra direta dispensa cotacao, mas respeita a forma de pagamento", async () => {
    const blocked = await requester.api.post("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      departmentId: LIMPEZA,
      purchaseMode: "direct",
      paymentMethodId: "pay_advance",
      submit: true,
      items: [{ productId, qty: 2 }],
    });
    expectError(blocked, "BAD_REQUEST");
    expect(JSON.stringify(blocked.body)).toContain("exige cotação");

    const { id, itemId } = await createRequest({ purchaseMode: "direct", paymentMethodId: "pay_transfer" });
    await managerApprove(id);

    const authorized = await purchasing.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${id}/decide`,
      {
        decision: "authorize_direct",
        purchaseMode: "direct",
        paymentMethodId: "pay_transfer",
      },
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toMatchObject({ status: "approved", approvalStage: "buyer" });

    // Compra direta nao cria cotacao nem adjudicacao.
    const detail = await buyer.api.get<{
      quotes: unknown[];
      awards: unknown[];
    }>(`/api/purchases/${id}`);
    expect(detail.body.quotes).toHaveLength(0);
    expect(detail.body.awards).toHaveLength(0);

    const order = await buyer.api.post(`/api/purchases/${id}/orders`, {
      orders: [
        {
          supplierId: supplierA,
          items: [{ itemId, qtyOrdered: 2, unitPrice: 30 }],
        },
      ],
    });
    expect(order.status).toBe(201);
  });

  it("recusa de proposta devolve ao comprador sem perder a cotacao", async () => {
    const { id, itemId } = await createRequest();
    await managerApprove(id);
    await purchasingAuthorize(id);
    const quoteA = await quote(id, itemId, supplierA, 11);
    await quote(id, itemId, supplierB, 12);

    const returned = await buyer.api.post(`/api/purchases/${id}/quotes/return`, {});
    expect(returned.status).toBe(200);

    // Sem permissao de autorizacao, nem o proprio comprador aprova a proposta.
    const buyerCannotApprove = await buyer.api.post(`/api/purchases/${id}/quotes/${quoteA}/approve`, {});
    expect(buyerCannotApprove.status).toBeGreaterThanOrEqual(400);

    const rejected = await purchasing.api.post<{ status: string }>(
      `/api/purchases/${id}/quotes/${quoteA}/reject`,
      { notes: "Prazo muito longo." },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("quoting");

    const request = await queryOne<{ status: string; approval_stage: string }>(
      "SELECT status, approval_stage FROM purchase_requests WHERE id = ?",
      [id],
    );
    expect(request).toMatchObject({ status: "quoting", approval_stage: "buyer" });
  });
});
