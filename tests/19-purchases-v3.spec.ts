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
 * Fluxo de compras v3 (por setor): solicitacao -> triagem do comprador ->
 * aprovacao/refinamento do gestor de Compras -> comprador -> estoque com nota
 * fiscal. As solicitacoes v1/v2 continuam cobertas por 07 e 18; aqui o foco e
 * a convivencia e as novas regras.
 */
describe("compras v3: triagem, aprovacao de Compras, cotacao/orcamento e nota fiscal", () => {
  let admin: Actor;
  let structure: Structure;
  let requester: Actor;
  let manager: Actor;
  let purchasing: Actor;
  let buyer: Actor;
  let stock: Actor;
  let supplierA: string;
  let supplierB: string;
  let productId: string;
  let uomId: string;
  let costCenterId: string;
  let costCenterCode: string;

  const LIMPEZA = "dept_lim";
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
    const created = await requester.api.post<{ id: string; approvalStage: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      locationId: structure.warehouseId,
      justification: "Reposicao do setor de limpeza",
      priority: "normal",
      submit: true,
      items: [{ productId, qty: 10 }],
      ...extra,
    });
    expect(created.status).toBe(201);
    expect(created.body.approvalStage).toBe("triage");
    const detail = await buyer.api.get<{
      items: Array<{ id: string }>;
    }>(`/api/purchases/${created.body.id}`);
    expect(detail.status).toBe(200);
    return { id: created.body.id, itemId: detail.body.items[0]!.id };
  }

  async function triageForward(id: string, body: Record<string, unknown> = {}): Promise<void> {
    const response = await buyer.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${id}/decide`,
      {
        decision: "forward",
        notes: "Itens conferidos na triagem.",
        ...body,
      },
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
        paymentTerms: "30 dias apos a nota fiscal",
        costCenterId,
        glAccount: "4.02.001",
        notes: "Autorizado pelo setor de Compras.",
        ...body,
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.approvalStage).toBe("buyer");
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

    const uom = await queryOne<{ id: string }>("SELECT id FROM uoms WHERE code = 'UN' LIMIT 1");
    expect(uom?.id).toBeTruthy();
    uomId = uom!.id;
    const costCenter = await queryOne<{ id: string; code: string }>(
      "SELECT id, code FROM cost_centers WHERE is_active = 1 ORDER BY code LIMIT 1",
    );
    expect(costCenter?.id).toBeTruthy();
    costCenterId = costCenter!.id;
    costCenterCode = costCenter!.code;

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
      managedDepartmentIds: [LIMPEZA, "dept_man"],
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

  it("percorre triagem, aprovacao, duas cotacoes, pedido e recebimento com nota", async () => {
    const { id, itemId } = await createRequest();

    const detail = await buyer.api.get<{
      request: {
        status: string;
        approvalStage: string;
        flowRevision: number;
        departmentName: string | null;
        paymentMethodName: string | null;
        paymentTerms: string | null;
        triageCompletedAt: string | null;
      };
    }>(`/api/purchases/${id}`);
    expect(detail.body.request).toMatchObject({
      status: "pending_approval",
      approvalStage: "triage",
      flowRevision: 3,
      departmentName: "Limpeza e conservacao",
      // O solicitante nao escolhe forma de pagamento: Compras define na aprovacao.
      paymentMethodName: null,
      paymentTerms: null,
      triageCompletedAt: null,
    });

    // A visao resumida repete o filtro de visibilidade em tres subconsultas;
    // cada uma precisa receber os proprios parametros.
    const overview = await requester.api.get<{ openCount: number; queues: { triage: number } }>(
      "/api/purchases/overview",
    );
    expect(overview.status).toBe(200);
    expect(overview.body.openCount).toBe(1);
    expect(overview.body.queues.triage).toBe(1);

    // O gestor do setor nao participa mais do fluxo v3: a triagem e de Compras.
    const managerCannotTriage = await manager.api.post(`/api/purchases/${id}/decide`, {
      decision: "forward",
    });
    expect(managerCannotTriage.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(managerCannotTriage.body)).toContain("permissão");

    await triageForward(id);
    const afterTriage = await buyer.api.get<{
      request: { approvalStage: string; triageCompletedAt: string | null; triageCompletedByName: string | null };
    }>(`/api/purchases/${id}`);
    expect(afterTriage.body.request.approvalStage).toBe("purchasing");
    expect(afterTriage.body.request.triageCompletedAt).toBeTruthy();
    expect(afterTriage.body.request.triageCompletedByName).toBe("Comprador");

    // Comprador nao autoriza a compra.
    const buyerCannotAuthorize = await buyer.api.post(`/api/purchases/${id}/decide`, {
      decision: "approved",
      purchaseMode: "quote",
      paymentMethodId: "pay_invoice",
    });
    expect(buyerCannotAuthorize.status).toBeGreaterThanOrEqual(400);

    await purchasingAuthorize(id);
    const quoting = await buyer.api.get<{
      request: {
        status: string;
        approvalStage: string;
        paymentMethodName: string | null;
        paymentTerms: string | null;
        costCenterId: string | null;
        costCenterCode: string | null;
        glAccount: string | null;
      };
    }>(`/api/purchases/${id}`);
    expect(quoting.body.request).toMatchObject({
      status: "quoting",
      approvalStage: "buyer",
      paymentMethodName: "Faturado 30 dias",
      paymentTerms: "30 dias apos a nota fiscal",
      costCenterId,
      costCenterCode,
      glAccount: "4.02.001",
    });

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

    // O pedido tem observacao propria; a aprovacao da proposta continua sendo
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
    const { id, itemId } = await createRequest();
    await triageForward(id);
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
    // A forma de pagamento entra na aprovacao de Compras: adiantamento exige
    // cotacao/orcamento e bloqueia a compra direta.
    const blocked = await createRequest();
    await triageForward(blocked.id);
    const blockedAuthorization = await purchasing.api.post(`/api/purchases/${blocked.id}/decide`, {
      decision: "approved",
      purchaseMode: "direct",
      paymentMethodId: "pay_advance",
    });
    expectError(blockedAuthorization, "BAD_REQUEST");
    expect(JSON.stringify(blockedAuthorization.body)).toContain("exige cotação");

    const { id, itemId } = await createRequest();
    await triageForward(id);

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
    await triageForward(id);
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

  it("triagem cadastra produto, ajusta o item e o gestor refina quantidade e centro de custo", async () => {
    const created = await requester.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      locationId: structure.warehouseId,
      justification: "Compra de panos para o setor",
      priority: "normal",
      submit: true,
      items: [{ description: "Panos multiuso", qty: 5, uomId }],
    });
    expect(created.status).toBe(201);

    const initial = await buyer.api.get<{
      items: Array<{
        id: string;
        productId: string | null;
        description: string | null;
        qtyMilli: number;
      }>;
    }>(`/api/purchases/${created.body.id}`);
    const item = initial.body.items[0]!;
    expect(item.productId).toBeNull();
    expect(item.qtyMilli).toBe(5000);

    // O comprador tem catalog.manage e pode cadastrar o produto na triagem.
    const product = await buyer.api.post<{ id: string }>("/api/catalog/products", {
      name: "Pano multiuso 40x40",
      uomId,
      tracksStock: true,
    });
    expect(product.status).toBe(201);

    await triageForward(created.body.id, {
      items: [
        {
          itemId: item.id,
          qty: 6,
          description: "Pano multiuso 40x40",
          productId: product.body.id,
          uomId,
        },
      ],
    });

    const afterTriage = await buyer.api.get<{
      items: Array<{
        id: string;
        productId: string | null;
        productName: string | null;
        description: string | null;
        qtyMilli: number;
      }>;
    }>(`/api/purchases/${created.body.id}`);
    expect(afterTriage.body.items[0]).toMatchObject({
      productId: product.body.id,
      productName: "Pano multiuso 40x40",
      description: "Pano multiuso 40x40",
      qtyMilli: 6000,
    });

    await purchasingAuthorize(created.body.id, {
      items: [
        {
          itemId: item.id,
          qtyApproved: 4,
          purchaseMode: "quote",
          notes: "Aprovado 4 unidades.",
        },
      ],
    });

    const afterApproval = await buyer.api.get<{
      request: { approvalStage: string; costCenterId: string | null; glAccount: string | null };
      items: Array<{
        id: string;
        qtyMilli: number;
        qtyApprovedMilli: number | null;
        purchaseMode: string | null;
        notes: string | null;
      }>;
    }>(`/api/purchases/${created.body.id}`);
    expect(afterApproval.body.request).toMatchObject({
      approvalStage: "buyer",
      costCenterId,
      glAccount: "4.02.001",
    });
    expect(afterApproval.body.items[0]).toMatchObject({
      qtyMilli: 6000,
      qtyApprovedMilli: 4000,
      purchaseMode: "quote",
      notes: "Aprovado 4 unidades.",
    });
  });

  it("triagem remove item, mas nao deixa a solicitacao sem item ativo", async () => {
    const created = await requester.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      locationId: structure.warehouseId,
      justification: "Reposicao com dois itens",
      priority: "normal",
      submit: true,
      items: [
        { productId, qty: 1 },
        { productId, qty: 2 },
      ],
    });
    expect(created.status).toBe(201);

    const detail = await buyer.api.get<{ items: Array<{ id: string; qtyMilli: number }> }>(
      `/api/purchases/${created.body.id}`,
    );
    const [first, second] = detail.body.items;
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();

    const empty = await buyer.api.post(`/api/purchases/${created.body.id}/decide`, {
      decision: "forward",
      items: detail.body.items.map((item) => ({ itemId: item.id, remove: true })),
    });
    expect(empty.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(empty.body)).toContain("ao menos um item");

    await triageForward(created.body.id, {
      items: [
        { itemId: first!.id, remove: true },
        { itemId: second!.id, qty: 3 },
      ],
    });

    const after = await buyer.api.get<{
      items: Array<{ id: string; status: string; qtyMilli: number }>;
    }>(`/api/purchases/${created.body.id}`);
    expect(after.body.items.find((item) => item.id === first!.id)?.status).toBe("cancelled");
    expect(after.body.items.find((item) => item.id === second!.id)).toMatchObject({
      status: "pending",
      qtyMilli: 3000,
    });
  });

  it("comprador nao tria a propria solicitacao; gestor de Compras pode assumir", async () => {
    const created = await buyer.api.post<{ id: string; approvalStage: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      locationId: structure.warehouseId,
      justification: "Compra solicitada pelo proprio comprador",
      priority: "normal",
      submit: true,
      items: [{ productId, qty: 1 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.approvalStage).toBe("triage");

    const own = await buyer.api.post(`/api/purchases/${created.body.id}/decide`, {
      decision: "forward",
    });
    expect(own.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(own.body)).toContain("própria");

    const assumed = await purchasing.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${created.body.id}/decide`,
      { decision: "forward", notes: "Triagem assumida pelo gestor de Compras." },
    );
    expect(assumed.status).toBe(200);
    expect(assumed.body).toMatchObject({ status: "pending_approval", approvalStage: "purchasing" });
  });

  it("gestor de Compras solicita alinhamento sem sair da etapa e depois autoriza", async () => {
    const { id } = await createRequest();
    await triageForward(id);

    const withoutNote = await purchasing.api.post(`/api/purchases/${id}/decide`, {
      decision: "request_alignment",
    });
    expectError(withoutNote, "BAD_REQUEST");
    expect(JSON.stringify(withoutNote.body)).toContain("alinhado");

    const alignmentNote = "Confirmar a marca e a quantidade com o solicitante antes de autorizar.";
    const alignment = await purchasing.api.post<{ status: string; approvalStage: string }>(
      `/api/purchases/${id}/decide`,
      { decision: "request_alignment", notes: alignmentNote },
    );
    expect(alignment.status).toBe(200);
    expect(alignment.body).toMatchObject({
      status: "pending_approval",
      approvalStage: "purchasing",
    });

    const detail = await purchasing.api.get<{
      request: {
        approvalNotes: string | null;
        triageCompletedAt: string | null;
        approvalStage: string;
      };
      timeline: Array<{ action: string }>;
    }>(`/api/purchases/${id}`);
    expect(detail.body.request).toMatchObject({
      approvalNotes: alignmentNote,
      approvalStage: "purchasing",
    });
    expect(detail.body.request.triageCompletedAt).toBeTruthy();
    expect(detail.body.timeline.some((event) => event.action === "purchase_request.alignment_requested")).toBe(
      true,
    );

    // O pedido de alinhamento avisa o solicitante e fica registrado no outbox.
    expect(
      await countRows("SELECT COUNT(*) AS total FROM notifications WHERE type = 'purchase_pending_approval'"),
    ).toBeGreaterThan(0);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM email_outbox WHERE kind = 'purchase_workflow'"),
    ).toBeGreaterThan(0);

    // Depois do alinhamento externo, o gestor segue o fluxo normal.
    await purchasingAuthorize(id);
  });

  it("recebimento vincula item fora do catalogo a produto existente e mantem o vinculo", async () => {
    const created = await requester.api.post<{ id: string }>("/api/purchases", {
      workflowVersion: 2,
      flowRevision: 3,
      locationId: structure.warehouseId,
      justification: "Panos para o setor de limpeza",
      priority: "normal",
      submit: true,
      items: [{ description: "Panos multiuso 40x40", qty: 3, uomId }],
    });
    expect(created.status).toBe(201);

    const initial = await buyer.api.get<{
      items: Array<{ id: string; productId: string | null; uomId: string | null }>;
    }>(`/api/purchases/${created.body.id}`);
    const item = initial.body.items[0]!;
    expect(item.productId).toBeNull();

    await triageForward(created.body.id);
    await purchasingAuthorize(created.body.id, {
      purchaseMode: "direct",
      paymentMethodId: "pay_transfer",
    });

    const order = await buyer.api.post(`/api/purchases/${created.body.id}/orders`, {
      orders: [
        {
          supplierId: supplierA,
          items: [{ itemId: item.id, qtyOrdered: 3, unitPrice: 20 }],
        },
      ],
    });
    expect(order.status).toBe(201);

    const receipt = await stock.api.post<{ receipt: { id: string } }>(
      `/api/purchases/${created.body.id}/receipts`,
      {
        requestKey: `recebimento-normalizado-${created.body.id}`,
        locationId: structure.warehouseId,
        invoiceNumber: "NF-777",
        invoiceDate: "2026-10-21",
        items: [
          {
            requestItemId: item.id,
            receivedQty: 3,
            unitPrice: 20,
            productId,
          },
        ],
      },
    );
    expect(receipt.status).toBe(201);

    const after = await buyer.api.get<{
      request: { status: string };
      items: Array<{
        id: string;
        productId: string | null;
        productName: string | null;
        uomId: string | null;
        qtyReceivedMilli: number;
      }>;
    }>(`/api/purchases/${created.body.id}`);
    expect(after.body.request.status).toBe("received");
    expect(after.body.items[0]).toMatchObject({
      productId,
      productName: "Detergente",
      uomId,
      qtyReceivedMilli: 3000,
    });

    const movement = await queryOne<{ product_id: string; qty_milli: number }>(
      "SELECT product_id, qty_milli FROM movements WHERE type = 'purchase_receipt' AND product_id = ? ORDER BY created_at DESC LIMIT 1",
      [productId],
    );
    expect(movement).toMatchObject({ product_id: productId, qty_milli: 3000 });
  });
});
