import { beforeEach, describe, expect, it } from "vitest";
import {
  assert,
  countRows,
  createProduct,
  createStructure,
  expectError,
  queryAll,
  queryOne,
  resetDatabase,
  setupAdmin,
  stockMilli,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Cenários 5, 6, 7, 8 e 20 da especificação: consumo semanal preservado,
 * reposição de água não vira consumo, medição não desconta duas vezes,
 * cancelamento devolve o saldo e reenvio não duplica o lançamento.
 */
describe("consumo: períodos, baixa única e cancelamento", () => {
  let admin: Actor;
  let structure: Structure;
  let cafeId: string;
  let aguaId: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    cafeId = await createProduct(admin, { name: "Café 500g", sku: "CAF-500" });
    aguaId = await createProduct(admin, { name: "Água 500ml", sku: "AGU-500" });
    await seedStock(admin, structure.warehouseId, cafeId, 40);
    await seedStock(admin, structure.warehouseId, aguaId, 300);
  });

  it("registra consumo semanal preservando período, quantidade e usuário", async () => {
    const created = await admin.api.post<{ id: string; code: string; stockDeducted: boolean }>("/api/consumption", {
      requestKey: "consumo-semana-36-2026",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-07",
      scopeNote: "Andares 1 a 3",
      locationId: structure.roomId,
      items: [{ productId: cafeId, qty: 7.5 }],
    });
    expect(created.status).toBe(201);
    expect(created.body.stockDeducted).toBe(false);
    expect(created.body.code).toBe("CON-2026-000001");

    const record = await queryOne<{
      period_start: string;
      period_end: string;
      created_by: string;
      status: string;
      scope_note: string;
    }>("SELECT period_start, period_end, created_by, status, scope_note FROM consumption_records WHERE id = ?", [
      created.body.id,
    ]);
    assert(record, "lançamento não gravado");
    expect(record.period_start).toBe("2026-09-01");
    expect(record.period_end).toBe("2026-09-07");
    expect(record.created_by).toBe(admin.id);
    expect(record.status).toBe("registered");
    expect(record.scope_note).toBe("Andares 1 a 3");

    const item = await queryOne<{ qty_milli: number; location_id: string; movement_id: string | null }>(
      "SELECT qty_milli, location_id, movement_id FROM consumption_items WHERE consumption_id = ?",
      [created.body.id],
    );
    expect(item?.qty_milli).toBe(7_500);
    expect(item?.location_id).toBe(structure.roomId);
    expect(item?.movement_id).toBeNull();

    // Medição não mexe em saldo.
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(40_000);

    const report = await admin.api.get<{ totals: { qtyMilli: number } }>(
      "/api/reports/consumption?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z",
    );
    expect(report.status).toBe(200);
    expect(report.body.totals.qtyMilli).toBe(7_500);
  });

  it("não duplica o lançamento quando a mesma requisição e reenviada", async () => {
    const payload = {
      requestKey: "consumo-reenvio-0001",
      periodStart: "2026-09-08",
      periodEnd: "2026-09-14",
      locationId: structure.roomId,
      items: [{ productId: cafeId, qty: 5 }],
    };

    const first = await admin.api.post<{ id: string; idempotentReplay: boolean }>("/api/consumption", payload);
    expect(first.status).toBe(201);
    expect(first.body.idempotentReplay).toBe(false);

    const second = await admin.api.post<{ id: string; idempotentReplay: boolean }>("/api/consumption", payload);
    expect(second.status).toBe(200);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.id).toBe(first.body.id);

    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_records")).toBe(1);
    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_items")).toBe(1);
  });

  it("desconta o estoque uma única vez quando o consumo gera baixa", async () => {
    const payload = {
      requestKey: "consumo-com-baixa-001",
      periodStart: "2026-09-15",
      periodEnd: "2026-09-21",
      locationId: structure.roomId,
      deductFromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 48 }],
    };

    const first = await admin.api.post<{ id: string; stockDeducted: boolean; movements: string[] }>(
      "/api/consumption",
      payload,
    );
    expect(first.status).toBe(201);
    expect(first.body.stockDeducted).toBe(true);
    expect(first.body.movements.length).toBe(1);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(252_000);

    // Reenvio idêntico: não desconta de novo.
    const replay = await admin.api.post<{ id: string; idempotentReplay: boolean; movements: string[] }>(
      "/api/consumption",
      payload,
    );
    expect(replay.status).toBe(200);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.movements).toEqual(first.body.movements);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(252_000);
    expect(await countRows("SELECT COUNT(*) AS total FROM movements WHERE type = 'consumption'")).toBe(1);

    // O item aponta para o movimento que gerou a baixa: não existe consumo sem baixa.
    const item = await queryOne<{ movement_id: string | null; qty_milli: number }>(
      "SELECT movement_id, qty_milli FROM consumption_items WHERE consumption_id = ?",
      [first.body.id],
    );
    expect(item?.movement_id).toBe(first.body.movements[0]);
    expect(item?.qty_milli).toBe(48_000);
  });

  it("não desconta duas vezes o mesmo material entre medição e baixa", async () => {
    // A baixa acontece no lançamento com `deductFromLocationId`; a medição
    // posterior do mesmo período NÃO pode gerar uma segunda saída de estoque.
    const withDeduction = await admin.api.post<{ id: string }>("/api/consumption", {
      requestKey: "consumo-baixa-e-medicao-1",
      periodStart: "2026-09-22",
      periodEnd: "2026-09-28",
      locationId: structure.roomId,
      deductFromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 24 }],
    });
    expect(withDeduction.status).toBe(201);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(276_000);

    const measurementOnly = await admin.api.post<{ id: string; stockDeducted: boolean }>("/api/consumption", {
      requestKey: "consumo-baixa-e-medicao-2",
      periodStart: "2026-09-22",
      periodEnd: "2026-09-28",
      locationId: structure.roomId,
      items: [{ productId: aguaId, qty: 24 }],
    });
    expect(measurementOnly.status).toBe(201);
    expect(measurementOnly.body.stockDeducted).toBe(false);

    // Saldo inalterado pela medição e um único movimento de consumo.
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(276_000);
    expect(await countRows("SELECT COUNT(*) AS total FROM movements WHERE type = 'consumption'")).toBe(1);

    const report = await admin.api.get<{ totals: { qtyMilli: number } }>(
      "/api/reports/consumption?from=2026-09-22T00:00:00.000Z&to=2026-09-28T23:59:59.000Z",
    );
    // Duas medições valem 24 cada (48) mas o estoque só caiu uma vez.
    expect(report.body.totals.qtyMilli).toBe(48_000);
  });

  it("recusa a mesma medição duas vezes no mesmo lançamento", async () => {
    const duplicated = await admin.api.post("/api/consumption", {
      requestKey: "consumo-item-duplicado",
      periodStart: "2026-09-29",
      periodEnd: "2026-10-05",
      locationId: structure.roomId,
      items: [
        { productId: cafeId, qty: 3 },
        { productId: cafeId, qty: 2 },
      ],
    });
    expectError(duplicated, "BAD_REQUEST");
    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_records")).toBe(0);
  });

  it("bloqueia baixa sem saldo mantendo o lançamento fora do banco", async () => {
    const blocked = await admin.api.post("/api/consumption", {
      requestKey: "consumo-sem-saldo-0001",
      periodStart: "2026-10-06",
      periodEnd: "2026-10-12",
      locationId: structure.roomId,
      deductFromLocationId: structure.roomId, // sala esta vazia
      items: [{ productId: aguaId, qty: 10 }],
    });
    expectError(blocked, "INSUFFICIENT_STOCK");

    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_records")).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS total FROM consumption_items")).toBe(0);
    expect(await countRows("SELECT COUNT(*) AS total FROM movements WHERE type = 'consumption'")).toBe(0);
  });

  it("cancela o lançamento devolvendo o estoque sem apagar histórico", async () => {
    const created = await admin.api.post<{ id: string; movements: string[] }>("/api/consumption", {
      requestKey: "consumo-para-cancelar-1",
      periodStart: "2026-10-13",
      periodEnd: "2026-10-19",
      locationId: structure.roomId,
      deductFromLocationId: structure.warehouseId,
      items: [{ productId: aguaId, qty: 30 }],
    });
    expect(created.status).toBe(201);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(270_000);

    const cancel = await admin.api.post<{ reversedMovements: number }>(
      `/api/consumption/${created.body.id}/cancel`,
      { reason: "Lançamento feito em duplicidade pela equipe", requestKey: "cancela-consumo-0001" },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.reversedMovements).toBe(1);
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(300_000);

    const record = await queryOne<{ status: string; cancel_reason: string; cancelled_at: string }>(
      "SELECT status, cancel_reason, cancelled_at FROM consumption_records WHERE id = ?",
      [created.body.id],
    );
    expect(record?.status).toBe("cancelled");
    expect(record?.cancel_reason).toContain("duplicidade");
    expect(record?.cancelled_at).toBeTruthy();

    // O movimento original continua existindo; a correção aponta para ele.
    const movements = await queryAll<{ type: string; reverses_movement_id: string | null }>(
      "SELECT type, reverses_movement_id FROM movements WHERE ref_id = ? ORDER BY occurred_at",
      [created.body.id],
    );
    expect(movements.map((m) => m.type).sort()).toEqual(["consumption", "correction"]);
    const correction = movements.find((m) => m.type === "correction");
    expect(correction?.reverses_movement_id).toBe(created.body.movements[0]);

    // Cancelar de novo e recusado explicitamente.
    const again = await admin.api.post(`/api/consumption/${created.body.id}/cancel`, {
      reason: "Tentativa repetida de cancelamento",
      requestKey: "cancela-consumo-0002",
    });
    expectError(again, "CONFLICT");
    expect(await stockMilli(aguaId, structure.warehouseId)).toBe(300_000);
  });

  it("não conta lançamento cancelado nos relatórios de consumo", async () => {
    const created = await admin.api.post<{ id: string }>("/api/consumption", {
      requestKey: "consumo-cancelado-rel-01",
      periodStart: "2026-10-20",
      periodEnd: "2026-10-26",
      locationId: structure.roomId,
      items: [{ productId: cafeId, qty: 9 }],
    });
    expect(created.status).toBe(201);

    let report = await admin.api.get<{ totals: { qtyMilli: number; recordCount: number } }>(
      "/api/reports/consumption?from=2026-10-20T00:00:00.000Z&to=2026-10-26T23:59:59.000Z",
    );
    expect(report.body.totals.qtyMilli).toBe(9_000);

    await admin.api.post(`/api/consumption/${created.body.id}/cancel`, {
      reason: "Período incorreto informado",
      requestKey: "cancela-consumo-0003",
    });

    report = await admin.api.get<{ totals: { qtyMilli: number; recordCount: number } }>(
      "/api/reports/consumption?from=2026-10-20T00:00:00.000Z&to=2026-10-26T23:59:59.000Z",
    );
    expect(report.body.totals.qtyMilli).toBe(0);
    expect(report.body.totals.recordCount).toBe(0);
  });

  it("agrupa o consumo por local, produto e dia", async () => {
    await admin.api.post("/api/consumption", {
      requestKey: "consumo-agrupado-0001",
      periodStart: "2026-10-27",
      periodEnd: "2026-11-02",
      locationId: structure.roomId,
      items: [
        { productId: cafeId, qty: 4 },
        { productId: aguaId, qty: 20 },
      ],
    });

    const byProduct = await admin.api.get<{ groups: { key: string; qtyMilli: number }[] }>(
      "/api/reports/consumption?groupBy=product",
    );
    expect(byProduct.status).toBe(200);
    expect(byProduct.body.groups.map((g) => g.qtyMilli).sort((a, b) => a - b)).toEqual([4_000, 20_000]);

    const byLocation = await admin.api.get<{ groups: { key: string; qtyMilli: number }[] }>(
      "/api/reports/consumption?groupBy=location",
    );
    expect(byLocation.status).toBe(200);
    expect(byLocation.body.groups.length).toBe(1);
    expect(byLocation.body.groups[0]?.key).toBe(structure.roomId);
    expect(byLocation.body.groups[0]?.qtyMilli).toBe(24_000);

    const byDay = await admin.api.get<{ groups: { key: string }[] }>("/api/reports/consumption?groupBy=day");
    expect(byDay.status).toBe(200);
    expect(byDay.body.groups.length).toBeGreaterThan(0);

    const invalid = await admin.api.get("/api/reports/consumption?groupBy=invalido");
    expectError(invalid, "BAD_REQUEST");
  });

  it("exporta o consumo em CSV com separador e valores legíveis", async () => {
    await admin.api.post("/api/consumption", {
      requestKey: "consumo-export-000001",
      periodStart: "2026-11-03",
      periodEnd: "2026-11-09",
      locationId: structure.roomId,
      items: [{ productId: cafeId, qty: 6 }],
    });

    const csv = await admin.api.request("GET", "/api/reports/export?report=consumption&format=csv");
    expect(csv.status).toBe(200);
    expect(String(csv.headers.get("content-type"))).toContain("text/csv");
    const text = String(csv.body);
    expect(text).toContain("Período inicial;Período final;Lançamento;Local;Periodicidade");
    expect(text).toContain("Café 500g");
    expect(text).toContain("6.000");
    expect(text).toContain("medição");
  });
});

/** Cria saldo inicial de um produto no local indicado. */
async function seedStock(actor: Actor, locationId: string, productId: string, qty: number): Promise<void> {
  const response = await actor.api.post("/api/stock/movements", {
    type: "return",
    requestKey: `carga-${productId}-${locationId}`,
    toLocationId: locationId,
    reason: "Carga inicial de estoque",
    items: [{ productId, qty }],
  });
  if (response.status !== 201) {
    throw new Error(`Falha ao criar saldo inicial: ${response.status} ${JSON.stringify(response.body)}`);
  }
}
