import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  assert,
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  queryAll,
  queryOne,
  resetDatabase,
  setupAdmin,
  stockMilli,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Cenários 1, 2, 3, 4, 15, 16 e 19 da especificação: entrada única por
 * recebimento, baixa com rastro de usuário, bloqueio de saldo insuficiente,
 * estoque nunca negativo, reposição não contabilizada como consumo e saldos
 * consistentes após operações sucessivas.
 */
describe("estoque: movimentações, saldo e integridade", () => {
  let admin: Actor;
  let structure: Structure;
  let papelId: string;
  let aguaId: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    papelId = await createProduct(admin, { name: "Papel Toalha", sku: "PAP-001", minQty: 10 });
    aguaId = await createProduct(admin, { name: "Água Mineral 500ml", sku: "AGU-500" });
  });

  it("registra entrada de estoque uma única vez por requisição", async () => {
    const key = "entrada-inicial-0001";
    const first = await admin.api.post<{ movements: { id: string; idempotentReplay: boolean }[] }>(
      "/api/stock/movements",
      {
        type: "return",
        requestKey: key,
        toLocationId: structure.warehouseId,
        reason: "Carga inicial de estoque",
        items: [{ productId: papelId, qty: 40 }],
      },
    );
    expect(first.status).toBe(201);
    expect(first.body.idempotentReplay).toBe(false);
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(40_000);

    // Reenvio da mesma requisição (timeout, duplo clique): não duplica a entrada.
    const replay = await admin.api.post<{ idempotentReplay: boolean }>("/api/stock/movements", {
      type: "return",
      requestKey: key,
      toLocationId: structure.warehouseId,
      reason: "Carga inicial de estoque",
      items: [{ productId: papelId, qty: 40 }],
    });
    expect(replay.status).toBe(201);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(40_000);
    expect(await countRows("SELECT COUNT(*) AS total FROM movements")).toBe(1);
  });

  it("baixa material registrando usuário, motivo e saldo resultante", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 30);

    const issue = await admin.api.post<{ movements: { id: string }[] }>("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-evento-0001",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      reason: "Evento no auditório",
      items: [{ productId: papelId, qty: 12.5 }],
    });
    expect(issue.status).toBe(201);
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(17_500);

    const movement = await queryOne<{
      user_id: string;
      type: string;
      qty_milli: number;
      reason: string;
      from_location_id: string;
      to_location_id: string;
    }>("SELECT user_id, type, qty_milli, reason, from_location_id, to_location_id FROM movements ORDER BY created_at DESC LIMIT 1");
    assert(movement, "movimentação não registrada");
    expect(movement.user_id).toBe(admin.id);
    expect(movement.type).toBe("issue");
    expect(movement.qty_milli).toBe(12_500);
    expect(movement.reason).toBe("Evento no auditório");
    expect(movement.from_location_id).toBe(structure.warehouseId);

    const audit = await queryOne<{ actor_id: string; action: string }>(
      "SELECT actor_id, action FROM audit_log WHERE action = 'movement.issue' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audit?.actor_id).toBe(admin.id);
  });

  it("impede saída maior que o saldo disponível e mantem o saldo intacto", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 5);

    const blocked = await admin.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-excedente-001",
      fromLocationId: structure.warehouseId,
      items: [{ productId: papelId, qty: 8 }],
    });
    expectError(blocked, "INSUFFICIENT_STOCK");

    expect(await stockMilli(papelId, structure.warehouseId)).toBe(5_000);
    expect(await countRows("SELECT COUNT(*) AS total FROM movements WHERE type = 'issue'")).toBe(0);

    // Nem por transferência: origem sem saldo não pode ficar negativa.
    const transfer = await admin.api.post("/api/stock/movements", {
      type: "transfer",
      requestKey: "transferencia-sem-saldo",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      items: [{ productId: papelId, qty: 6 }],
    });
    expectError(transfer, "INSUFFICIENT_STOCK");
  });

  it("bloqueia estoque negativo no próprio banco (trigger), não apenas na aplicação", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 3);

    let blockedByDatabase = false;
    try {
      await env.DB.prepare(`UPDATE stock SET qty_milli = -1 WHERE product_id = ? AND location_id = ?`)
        .bind(papelId, structure.warehouseId)
        .run();
    } catch (error) {
      blockedByDatabase = /INSUFFICIENT_STOCK|no negative/i.test(String(error));
    }
    expect(blockedByDatabase).toBe(true);
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(3_000);

    let insertBlocked = false;
    try {
      await env.DB.prepare(
        `INSERT INTO stock (product_id, location_id, qty_milli, updated_at) VALUES (?,?,?,?)`,
      )
        .bind(aguaId, structure.warehouseId, -500, new Date().toISOString())
        .run();
    } catch (error) {
      insertBlocked = /INSUFFICIENT_STOCK|no negative/i.test(String(error));
    }
    expect(insertBlocked).toBe(true);
  });

  it("não contabiliza reposição de água como consumo", async () => {
    await seedStock(admin, structure.warehouseId, aguaId, 200);

    // Reposição: leva água do almoxarifado para a sala. Destino != consumo efetivo.
    const replenish = await admin.api.post<{ movements: { id: string }[] }>("/api/stock/movements", {
      type: "replenish",
      requestKey: "reposicao-agua-sala101",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      counterparty: "Sala 101",
      items: [{ productId: aguaId, qty: 24 }],
    });
    expect(replenish.status).toBe(201);

    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(176_000);
    expect(await stockMilli(aguaId, structure.roomId)).toBe(24_000);

    // Nenhum lançamento de consumo foi criado automaticamente.
    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_records")).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_items")).toBe(0);

    const movements = await queryAll<{ type: string }>("SELECT type FROM movements ORDER BY occurred_at");
    // Apenas a carga inicial e a reposição: nenhuma movimentação de consumo.
    expect(movements.map((m) => m.type).sort()).toEqual(["replenish", "return"]);
    expect(movements.some((m) => m.type === "consumption")).toBe(false);
  });

  it("transfere entre locais preservando o total", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 50);

    const transfer = await admin.api.post("/api/stock/movements", {
      type: "transfer",
      requestKey: "transferencia-sala-001",
      fromLocationId: structure.warehouseId,
      toLocationId: structure.roomId,
      items: [{ productId: papelId, qty: 20 }],
    });
    expect(transfer.status).toBe(201);

    const warehouse = await stockMilli(papelId, structure.warehouseId);
    const room = await stockMilli(papelId, structure.roomId);
    expect(warehouse).toBe(30_000);
    expect(room).toBe(20_000);

    const total = await queryOne<{ total: number }>(
      "SELECT COALESCE(SUM(qty_milli), 0) AS total FROM stock WHERE product_id = ?",
      [papelId],
    );
    expect(total?.total).toBe(50_000);
  });

  it("reverte movimentação sem apagar o lançamento original", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 40);

    const issue = await admin.api.post<{ movements: { id: string }[] }>("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-para-corrigir-01",
      fromLocationId: structure.warehouseId,
      items: [{ productId: papelId, qty: 10 }],
    });
    const movementId = issue.body.movements[0]!.id;
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(30_000);

    const reversal = await admin.api.post<{ movement: { id: string; type: string } }>(
      `/api/stock/movements/${movementId}/reverse`,
      { reason: "Lançamento em duplicidade", requestKey: "reversao-saida-0001" },
    );
    expect(reversal.status).toBe(201);
    expect(reversal.body.movement.type).toBe("correction");
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(40_000);

    // O lançamento original continua existindo, com o vínculo da correção.
    const original = await queryOne<{ id: string; type: string }>("SELECT id, type FROM movements WHERE id = ?", [
      movementId,
    ]);
    expect(original).not.toBeNull();
    expect(original?.type).toBe("issue");

    const link = await queryOne<{ reverses_movement_id: string }>(
      "SELECT reverses_movement_id FROM movements WHERE id = ?",
      [reversal.body.movement.id],
    );
    expect(link?.reverses_movement_id).toBe(movementId);

    const again = await admin.api.post(`/api/stock/movements/${movementId}/reverse`, {
      reason: "Tentativa repetida",
      requestKey: "reversao-saida-0002",
    });
    expectError(again, "CONFLICT");
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(40_000);
  });

  it("respeita o escopo de local do usuário", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 20);

    const papelEstoque = await findRoleId("stock_keeper");
    const keeper = await createUser(admin, {
      name: "Estoquista Escopado",
      email: "escopo@facil.test",
      roleId: papelEstoque,
    });
    const scoped = await admin.api.put(`/api/users/users/${keeper.id}/location-scopes`, {
      locationIds: [structure.roomId],
    });
    expect(scoped.status).toBe(200);

    const blocked = await keeper.api.post("/api/stock/movements", {
      type: "issue",
      requestKey: "saida-fora-do-escopo",
      fromLocationId: structure.warehouseId,
      items: [{ productId: papelId, qty: 1 }],
    });
    expectError(blocked, "FORBIDDEN");

    // Também não enxerga o saldo do local fora do escopo.
    const balances = await keeper.api.get<{ items: { locationId: string }[] }>("/api/stock");
    expect(balances.status).toBe(200);
    expect(balances.body.items.every((item) => item.locationId === structure.roomId)).toBe(true);
  });

  it("bloqueia tipos de movimentação que só podem nascer em outros módulos", async () => {
    const forbiddenType = await admin.api.post("/api/stock/movements", {
      type: "consumption",
      requestKey: "consumo-direto-invalido",
      fromLocationId: structure.warehouseId,
      items: [{ productId: papelId, qty: 1 }],
    });
    expectError(forbiddenType, "BAD_REQUEST");

    const receiptType = await admin.api.post("/api/stock/movements", {
      type: "purchase_receipt",
      requestKey: "recebimento-direto-invalido",
      toLocationId: structure.warehouseId,
      items: [{ productId: papelId, qty: 1 }],
    });
    expectError(receiptType, "BAD_REQUEST");
  });

  it("mantem saldo e relatórios coerentes após operações sucessivas", async () => {
    await seedStock(admin, structure.warehouseId, papelId, 100);

    const operations = [
      { type: "transfer", from: structure.warehouseId, to: structure.roomId, qty: 25 },
      { type: "issue", from: structure.roomId, to: null, qty: 5 },
      { type: "replenish", from: structure.warehouseId, to: structure.roomId, qty: 10 },
      { type: "loss", from: structure.warehouseId, to: null, qty: 3 },
    ];

    for (const [index, operation] of operations.entries()) {
      const response = await admin.api.post("/api/stock/movements", {
        type: operation.type,
        requestKey: `sequencia-operacao-${index}`,
        fromLocationId: operation.from,
        toLocationId: operation.to,
        reason: operation.type === "loss" ? "Material avariado" : null,
        items: [{ productId: papelId, qty: operation.qty }],
      });
      expect(response.status).toBe(201);
    }

    const warehouse = await stockMilli(papelId, structure.warehouseId);
    const room = await stockMilli(papelId, structure.roomId);
    expect(warehouse).toBe(62_000); // 100 - 25 - 10 - 3
    expect(room).toBe(30_000); // 25 - 5 + 10

    // Reconstrução do saldo a partir das movimentações tem de bater exatamente.
    const rebuilt = await queryAll<{ location_id: string; qty: number }>(
      `SELECT location_id, SUM(delta) AS qty FROM (
          SELECT to_location_id AS location_id, qty_milli AS delta FROM movements WHERE to_location_id IS NOT NULL
          UNION ALL
          SELECT from_location_id AS location_id, -qty_milli AS delta FROM movements WHERE from_location_id IS NOT NULL
       ) GROUP BY location_id`,
    );
    const byLocation = new Map(rebuilt.map((row) => [row.location_id, row.qty]));
    expect(byLocation.get(structure.warehouseId)).toBe(warehouse);
    expect(byLocation.get(structure.roomId)).toBe(room);

    const report = await admin.api.get<{ totals: { qtyMilli: number } }>("/api/reports/stock");
    expect(report.status).toBe(200);
    expect(report.body.totals.qtyMilli).toBe(warehouse + room);

    const movements = await admin.api.get<{ total: number }>("/api/reports/movements");
    expect(movements.status).toBe(200);
    // Carga inicial + as operações da sequência.
    expect(movements.body.total).toBe(operations.length + 1);
  });

  it("busca aproximada encontra produtos por trecho, sem acento e com vários termos", async () => {
    await createProduct(admin, { name: "Água Sanitária 1L", sku: "AGU-SAN" });
    await createProduct(admin, { name: "Detergente Neutro 500ml", sku: "DET-NEU" });

    // Sem acento e com espaço: "agua sanit" encontra "Água Sanitária 1L".
    const semAcento = await admin.api.get<{ items: { name: string }[] }>(
      "/api/catalog/products?search=agua%20sanit",
    );
    expect(semAcento.status).toBe(200);
    expect(semAcento.body.items.some((item) => item.name === "Água Sanitária 1L")).toBe(true);

    // Termos em qualquer ordem: "neutro detergente" também encontra.
    const ordemInvertida = await admin.api.get<{ items: { name: string }[] }>(
      "/api/catalog/products?search=neutro%20detergente",
    );
    expect(ordemInvertida.body.items.some((item) => item.name === "Detergente Neutro 500ml")).toBe(
      true,
    );

    // Trecho no meio da palavra, digitado em maiúsculas.
    const trecho = await admin.api.get<{ items: { name: string }[] }>(
      "/api/catalog/products?search=ERGENTE",
    );
    expect(trecho.body.items.some((item) => item.name === "Detergente Neutro 500ml")).toBe(true);

    // Quem casa no início do nome vem primeiro.
    const ordenado = await admin.api.get<{ items: { name: string }[] }>(
      "/api/catalog/products?search=agua",
    );
    expect(ordenado.body.items.length).toBeGreaterThan(0);
    expect(ordenado.body.items[0]?.name.startsWith("Água")).toBe(true);
  });

  it("mantém o controle de estoque restrito aos perfis responsáveis", async () => {
    const tech = await createUser(admin, {
      name: "Técnico Sem Estoque",
      email: "tecnico.sem.estoque@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });
    const receptionist = await createUser(admin, {
      name: "Recepção Sem Estoque",
      email: "recepcao.sem.estoque@facil.test",
      roleId: await findRoleId("receptionist"),
    });

    // Leitura e movimentação manual negadas: o menu some por permissão, e a
    // API recusa quem chamar direto.
    expectError(await tech.api.get("/api/stock"), "FORBIDDEN");
    expectError(await receptionist.api.get("/api/stock"), "FORBIDDEN");
    expectError(
      await tech.api.post("/api/stock/movements", {
        type: "return",
        requestKey: "tecnico-entrada-negada",
        toLocationId: structure.warehouseId,
        reason: "Tentativa direta",
        items: [{ productId: papelId, qty: 1 }],
      }),
      "FORBIDDEN",
    );

    // O consumo continua disponível para o técnico.
    const consumption = await tech.api.post("/api/consumption", {
      requestKey: "tecnico-consumo-0001",
      periodStart: "2026-01-05",
      periodEnd: "2026-01-11",
      locationId: structure.roomId,
      items: [{ productId: aguaId, qty: 1 }],
    });
    expect(consumption.status).toBe(201);

    // O responsável pelo estoque mantém o acesso completo.
    const keeper = await createUser(admin, {
      name: "Estoquista Padrão",
      email: "estoquista.padrao@facil.test",
      roleId: await findRoleId("stock_keeper"),
    });
    expect((await keeper.api.get("/api/stock")).status).toBe(200);
  });
});

/** Cria saldo inicial de um produto no local indicado. */
async function seedStock(actor: Actor, locationId: string, productId: string, qty: number): Promise<void> {
  const response = await actor.api.post("/api/stock/movements", {
    type: "return",
    requestKey: `carga-${productId}-${locationId}-${qty}`.slice(0, 60),
    toLocationId: locationId,
    reason: "Carga inicial de estoque",
    items: [{ productId, qty }],
  });
  if (response.status !== 201) {
    throw new Error(`Falha ao criar saldo inicial: ${response.status} ${JSON.stringify(response.body)}`);
  }
}
