import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assert,
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
  stockMilli,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Configurações que mudam o comportamento real do sistema.
 *
 * Cada teste altera uma configuração e observa o efeito na operação -- um
 * ajuste que não muda nada seria funcionalidade morta exibida na tela de
 * configurações. Os valores padrão são restaurados depois de cada teste.
 */
describe("configurações: efeito real na operação", () => {
  let admin: Actor;
  let structure: Structure;

  const DEFAULTS: Record<string, string> = {
    "company.name": "Empresa Teste",
    "company.timezone": "America/Sao_Paulo",
    "stock.allow_negative": "false",
    "stock.low_stock_scope": "per_location",
    "consumption.periodicity": "weekly",
    "inventory.periodicity": "monthly",
    "purchases.require_approval": "true",
    "attachments.max_bytes": "20971520",
    "mail.enabled": "false",
    "mail.provider": "none",
    "mail.api_key": "",
    "mail.from": "suporte@facil.local",
    "mail.relay_url": "",
    "mail.relay_secret": "",
    "mail.gmail_app_password": "",
    "ui.theme": "classico",
  };

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
  });

  afterEach(async () => {
    const restored = await admin.api.patch("/api/settings", { values: DEFAULTS });
    assert(restored.status === 200, `Não foi possível restaurar as configurações: ${restored.status}`);
  });

  /* ------------------------------------------------------------------------ */
  /* Catálogo e validação                                                     */
  /* ------------------------------------------------------------------------ */

  it("lista o catálogo, exige permissão e recusa chave desconhecida", async () => {
    const list = await admin.api.get<{ items: { key: string; value: string; definition: unknown }[] }>(
      "/api/settings",
    );
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(Object.keys(DEFAULTS).length);
    expect(list.body.items.every((item) => item.definition !== null)).toBe(true);
    expect(list.body.items.find((i) => i.key === "company.timezone")?.value).toBe("America/Sao_Paulo");

    const manager = await createUser(admin, {
      name: "Gerente",
      email: "gerente@facil.test",
      roleId: await findRoleId("facilities_manager"),
    });
    const forbidden = await manager.api.patch("/api/settings", {
      values: { "company.name": "Outra Empresa" },
    });
    expectError(forbidden, "FORBIDDEN");

    const unknown = await admin.api.patch("/api/settings", { values: { "chave.inexistente": "x" } });
    expectError(unknown, "BAD_REQUEST");

    const empty = await admin.api.patch("/api/settings", { values: {} });
    expectError(empty, "VALIDATION_ERROR");

    expect(await countRows("SELECT COUNT(*) AS total FROM audit_log WHERE action = 'permission_denied'")).toBe(1);
  });

  it("válida tipo, opções e fuso horário antes de gravar", async () => {
    const booleanInvalid = await admin.api.patch("/api/settings", {
      values: { "stock.allow_negative": "talvez" },
    });
    expectError(booleanInvalid, "BAD_REQUEST");

    const enumInvalid = await admin.api.patch("/api/settings", {
      values: { "stock.low_stock_scope": "por_corredor" },
    });
    expectError(enumInvalid, "BAD_REQUEST");

    const integerInvalid = await admin.api.patch("/api/settings", {
      values: { "attachments.max_bytes": "muitos" },
    });
    expectError(integerInvalid, "BAD_REQUEST");

    const timezoneInvalid = await admin.api.patch("/api/settings", {
      values: { "company.timezone": "Horário de Brasilia" },
    });
    expectError(timezoneInvalid, "BAD_REQUEST");

    // O relay de e-mail recebe o segredo compartilhado; só HTTPS é aceito.
    const relayNotUrl = await admin.api.patch("/api/settings", {
      values: { "mail.relay_url": "script.google.com/macros" },
    });
    expectError(relayNotUrl, "BAD_REQUEST");

    const relayHttp = await admin.api.patch("/api/settings", {
      values: { "mail.relay_url": "http://inseguro.test/relay" },
    });
    expectError(relayHttp, "BAD_REQUEST");

    const relayValid = await admin.api.patch("/api/settings", {
      values: {
        "mail.relay_url": "https://script.google.com/macros/s/teste/exec",
        "mail.relay_secret": "segredo-de-teste",
      },
    });
    expect(relayValid.status).toBe(200);

    // Limpar as credenciais do relay é permitido (desliga o canal).
    const relayCleared = await admin.api.patch("/api/settings", {
      values: { "mail.relay_url": "", "mail.relay_secret": "" },
    });
    expect(relayCleared.status).toBe(200);

    // Gmail: a senha de app pode ser gravada (mesmo colada com espaços) e
    // limpa; valores vazios desligam o canal, como no relay.
    const gmailInvalid = await admin.api.patch("/api/settings", {
      values: { "mail.provider": "gmail-empresarial" },
    });
    expectError(gmailInvalid, "BAD_REQUEST");

    const gmailConfigured = await admin.api.patch("/api/settings", {
      values: {
        "mail.provider": "gmail",
        "mail.from": "conta@gmail.com",
        "mail.gmail_app_password": "abcd efgh ijkl mnop",
      },
    });
    expect(gmailConfigured.status).toBe(200);

    const gmailCleared = await admin.api.patch("/api/settings", {
      values: { "mail.gmail_app_password": "" },
    });
    expect(gmailCleared.status).toBe(200);

    const timezoneValid = await admin.api.patch("/api/settings", {
      values: { "company.timezone": "America/Manaus", "company.name": "Facil Facilities Ltda" },
    });
    expect(timezoneValid.status).toBe(200);

    const stored = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'company.timezone'",
    );
    expect(stored?.value).toBe("America/Manaus");

    // A alteração fica registrada com valor anterior e novo.
    const audit = await queryOne<{ after_json: string }>(
      `SELECT after_json FROM audit_log WHERE action = 'settings.update' AND after_json LIKE '%America/Manaus%'
        ORDER BY created_at DESC LIMIT 1`,
    );
    expect(audit?.after_json).toContain("America/Manaus");
    expect(audit?.after_json).toContain("America/Sao_Paulo");

    // Nada foi gravado nas tentativas inválidas.
    const stillDefault = await queryOne<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'attachments.max_bytes'",
    );
    expect(stillDefault?.value).toBe("20971520");
  });

  it("expoe empresa e fuso na sessão autenticada", async () => {
    const before = await admin.api.get<{ app: { companyName: string; timezone: string } }>("/api/auth/me");
    expect(before.status).toBe(200);
    expect(before.body.app.companyName).toBe("Empresa Teste");
    expect(before.body.app.timezone).toBe("America/Sao_Paulo");

    await admin.api.patch("/api/settings", {
      values: { "company.name": "Grupo Aurora", "company.timezone": "America/Belem" },
    });

    const after = await admin.api.get<{ app: { companyName: string; timezone: string } }>("/api/auth/me");
    expect(after.body.app.companyName).toBe("Grupo Aurora");
    expect(after.body.app.timezone).toBe("America/Belem");
  });

  /* ------------------------------------------------------------------------ */
  /* Categorias de ticket                                                     */
  /* ------------------------------------------------------------------------ */

  it("edição parcial de categoria de ticket preserva tipo padrão, ordem e situação", async () => {
    const created = await admin.api.post<{ id: string }>("/api/settings/ticket-categories", {
      name: "Jardinagem",
      code: "garden",
      defaultKind: "cleaning",
      sortOrder: 5,
    });
    expect(created.status).toBe(201);

    // Alternar a situação não pode zerar o tipo padrão nem a ordem.
    const toggled = await admin.api.patch(`/api/settings/ticket-categories/${created.body.id}`, {
      isActive: false,
    });
    expect(toggled.status).toBe(200);

    type CategoryList = {
      items: { id: string; defaultKind: string; sortOrder: number; isActive: boolean }[];
    };
    const listed = await admin.api.get<CategoryList>("/api/settings/ticket-categories");
    const item = listed.body.items.find((row) => row.id === created.body.id);
    assert(item, "categoria na lista");
    expect(item.isActive).toBe(false);
    expect(item.defaultKind).toBe("cleaning");
    expect(item.sortOrder).toBe(5);

    // Renomear uma categoria inativa não pode reativá-la.
    const renamed = await admin.api.patch(`/api/settings/ticket-categories/${created.body.id}`, {
      name: "Jardinagem e área externa",
    });
    expect(renamed.status).toBe(200);

    const listedAgain = await admin.api.get<CategoryList>("/api/settings/ticket-categories");
    const itemAgain = listedAgain.body.items.find((row) => row.id === created.body.id);
    assert(itemAgain, "categoria na lista após renomear");
    expect(itemAgain.isActive).toBe(false);
    expect(itemAgain.defaultKind).toBe("cleaning");
    expect(itemAgain.sortOrder).toBe(5);
  });

  /* ------------------------------------------------------------------------ */
  /* Estoque negativo                                                         */
  /* ------------------------------------------------------------------------ */

  it("stock.allow_negative libera saldo negativo e volta a bloquear", async () => {
    const productId = await createProduct(admin, { name: "Papel Toalha", sku: "PAP-TOALHA" });
    await seedStock(admin, structure.warehouseId, productId, 3);

    const blocked = await issue(5, "tentativa-sem-configuracao");
    expectError(blocked, "INSUFFICIENT_STOCK");
    expect(await stockMilli(productId, structure.warehouseId)).toBe(3_000);

    const enabled = await admin.api.patch("/api/settings", {
      values: { "stock.allow_negative": "true" },
    });
    expect(enabled.status).toBe(200);

    const allowed = await issue(5, "retirada-com-negativo-permitido");
    expect(allowed.status).toBe(201);
    expect(await stockMilli(productId, structure.warehouseId)).toBe(-2_000);

    const disabled = await admin.api.patch("/api/settings", {
      values: { "stock.allow_negative": "false" },
    });
    expect(disabled.status).toBe(200);

    const blockedAgain = await issue(1, "retirada-apos-reconfigurar");
    expectError(blockedAgain, "INSUFFICIENT_STOCK");
    expect(await stockMilli(productId, structure.warehouseId)).toBe(-2_000);

    // O saldo negativo e corrigível por entrada normal.
    await seedStock(admin, structure.warehouseId, productId, 4);
    expect(await stockMilli(productId, structure.warehouseId)).toBe(2_000);

    async function issue(qty: number, requestKey: string) {
      return admin.api.post("/api/stock/movements", {
        type: "issue",
        requestKey,
        fromLocationId: structure.warehouseId,
        toLocationId: structure.roomId,
        items: [{ productId, qty }],
      });
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Escopo do alerta de estoque mínimo                                       */
  /* ------------------------------------------------------------------------ */

  it("stock.low_stock_scope alterna entre alerta por local e por produto", async () => {
    // Produto A: 6 + 6 = 12 (abaixo do mínimo em cada local, acima no total).
    const divided = await createProduct(admin, { name: "Sabão Neutro", sku: "SAB-NEUTRO", minQty: 10 });
    await seedStock(admin, structure.warehouseId, divided, 6);
    await seedStock(admin, structure.roomId, divided, 6);
    // Produto B: 3 + 2 = 5 (abaixo do mínimo de qualquer forma).
    const scarce = await createProduct(admin, { name: "Álcool 70", sku: "ALC-70", minQty: 10 });
    await seedStock(admin, structure.warehouseId, scarce, 3);
    await seedStock(admin, structure.roomId, scarce, 2);

    const perLocation = await admin.api.get<LowStockResponse>("/api/reports/low-stock");
    expect(perLocation.status).toBe(200);
    expect(perLocation.body.scope).toBe("per_location");
    expect(perLocation.body.items.length).toBe(4);
    expect(perLocation.body.items.every((i) => i.locationId !== null)).toBe(true);

    const alertsPerLocation = await admin.api.get<{ lowStockCount: number }>("/api/dashboard/alerts");
    expect(alertsPerLocation.body.lowStockCount).toBe(4);
    const summaryPerLocation = await admin.api.get<{ stock: { lowStockScope: string } }>(
      "/api/dashboard/summary",
    );
    expect(summaryPerLocation.body.stock.lowStockScope).toBe("per_location");

    const global = await admin.api.patch("/api/settings", {
      values: { "stock.low_stock_scope": "global" },
    });
    expect(global.status).toBe(200);

    const aggregated = await admin.api.get<LowStockResponse>("/api/reports/low-stock");
    expect(aggregated.body.scope).toBe("global");
    expect(aggregated.body.items.length).toBe(1);
    const onlyScarce = aggregated.body.items[0]!;
    expect(onlyScarce.sku).toBe("ALC-70");
    expect(onlyScarce.qtyMilli).toBe(5_000);
    expect(onlyScarce.locationId).toBeNull();
    expect(onlyScarce.locationCount).toBe(2);
    expect(onlyScarce.shortageMilli).toBe(5_000);

    const alertsGlobal = await admin.api.get<{ lowStockCount: number }>("/api/dashboard/alerts");
    expect(alertsGlobal.body.lowStockCount).toBe(1);

    // A posição de estoque continua por local, mas o destaque segue o escopo.
    const position = await admin.api.get<{ scope: string; items: StockRow[] }>(
      "/api/reports/stock?onlyLow=true",
    );
    expect(position.body.scope).toBe("global");
    expect(position.body.items.length).toBe(2); // as duas linhas do produto B
    expect(position.body.items.every((i) => i.sku === "ALC-70" && i.isBelowMin)).toBe(true);

    const summaryGlobal = await admin.api.get<{
      stock: { lowStockScope: string; lowStock: { productId: string; totalQtyMilli: number }[] };
    }>("/api/dashboard/summary");
    expect(summaryGlobal.body.stock.lowStockScope).toBe("global");
    expect(summaryGlobal.body.stock.lowStock.length).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Periodicidade do inventário                                              */
  /* ------------------------------------------------------------------------ */

  it("inventory.periodicity define o rótulo do ciclo quando não informado", async () => {
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, "0");
    const day = String(today.getUTCDate()).padStart(2, "0");

    const monthly = await admin.api.post<{ periodLabel: string }>("/api/inventories", {
      locationId: structure.warehouseId,
    });
    expect(monthly.status).toBe(201);
    expect(monthly.body.periodLabel).toBe(`${year}-${month}`);

    await admin.api.patch("/api/settings", { values: { "inventory.periodicity": "daily" } });
    const daily = await admin.api.post<{ periodLabel: string }>("/api/inventories", {
      locationId: structure.roomId,
    });
    expect(daily.body.periodLabel).toBe(`${year}-${month}-${day}`);

    await admin.api.patch("/api/settings", { values: { "inventory.periodicity": "weekly" } });
    const third = await createLocation("Deposito externo");
    const weekly = await admin.api.post<{ periodLabel: string }>("/api/inventories", {
      locationId: third,
    });
    expect(weekly.body.periodLabel).toMatch(new RegExp(`^${year}-S\\d{2}$`));

    // Rótulo informado pelo usuário continua tendo prioridade.
    await admin.api.patch("/api/settings", { values: { "inventory.periodicity": "annual" } });
    const explicit = await admin.api.post<{ periodLabel: string }>("/api/inventories", {
      locationId: structure.roomId,
      periodLabel: "2026-10",
    });
    expectError(explicit, "CONFLICT"); // já existe ciclo aberto nesta sala
    const other = await createLocation("Deposito externo 2");
    const explicitOk = await admin.api.post<{ periodLabel: string }>("/api/inventories", {
      locationId: other,
      periodLabel: "2026-10",
    });
    expect(explicitOk.body.periodLabel).toBe("2026-10");

    async function createLocation(name: string) {
      const type = await queryOne<{ id: string }>(
        "SELECT id FROM location_types WHERE code = 'almoxarifado'",
      );
      const created = await admin.api.post<{ id: string }>("/api/structure/locations", {
        unitId: structure.unitId,
        typeId: type!.id,
        name,
      });
      assert(created.status === 201, `Falha ao criar local: ${created.status}`);
      return created.body.id;
    }
  });

  /* ------------------------------------------------------------------------ */
  /* Limite de anexo                                                          */
  /* ------------------------------------------------------------------------ */

  it("attachments.max_bytes limita o tamanho do anexo", async () => {
    const ticket = await admin.api.post<{ id: string }>("/api/tickets", {
      title: "Chamado com anexo de teste",
      locationId: structure.roomId,
    });
    expect(ticket.status).toBe(201);

    await admin.api.patch("/api/settings", { values: { "attachments.max_bytes": "10240" } });

    const tooBig = await upload(ticket.body.id, "foto.png", new Uint8Array(20480).fill(65));
    expectError(tooBig, "BAD_REQUEST");

    const empty = await upload(ticket.body.id, "vazio.txt", new Uint8Array(0));
    expectError(empty, "BAD_REQUEST");

    const notAllowed = await upload(ticket.body.id, "script.exe", new Uint8Array(100).fill(66), "application/x-msdownload");
    expectError(notAllowed, "BAD_REQUEST");
    const payload = new Uint8Array(700).fill(67);
    const ok = await upload(ticket.body.id, "croqui.txt", payload, "text/plain");
    expect(ok.status).toBe(201);

    const list = await admin.api.get<{ items: { id: string; filename: string; sizeBytes: number }[] }>(
      `/api/attachments?entityType=ticket&entityId=${ticket.body.id}`,
    );
    expect(list.body.items.length).toBe(1);
    expect(list.body.items[0]?.filename).toBe("croqui.txt");
    expect(list.body.items[0]?.sizeBytes).toBe(700);

    // O conteúdo e recuperado byte a byte.
    const download = await admin.api.fetchRaw("GET", `/api/attachments/${list.body.items[0]!.id}`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer()).length).toBe(700);

    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'attachment.upload' AND result = 'success'",
      ),
    ).toBe(1);

    async function upload(entityId: string, filename: string, bytes: Uint8Array, mimeType = "image/png") {
      const form = new FormData();
      form.set("file", new File([bytes], filename, { type: mimeType }));
      form.set("entityType", "ticket");
      form.set("entityId", entityId);
      return admin.api.postRaw("/api/attachments", form);
    }
  });
});

interface LowStockItem {
  productId: string;
  sku: string | null;
  locationId: string | null;
  locationCount: number | null;
  qtyMilli: number;
  minQtyMilli: number;
  shortageMilli: number;
}

interface LowStockResponse {
  scope: string;
  items: LowStockItem[];
}

interface StockRow {
  sku: string | null;
  locationId: string;
  qtyMilli: number;
  totalQtyMilli: number;
  isBelowMin: boolean;
}
