import { beforeEach, describe, expect, it } from "vitest";
import {
  assert,
  countRows,
  createProduct,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  issueStock,
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
 * Cenários 9 a 14 da especificação: ciclo de inventário com congelamento de
 * saldo, contagem, contagem repetida, ajuste pela diferença, itens pendentes e
 * dispensados, fechamento com exceção justificada e reabertura.
 */
describe("inventário: contagem, ajuste, fechamento e reabertura", () => {
  let admin: Actor;
  let structure: Structure;
  let cafeId: string;
  let papelId: string;
  let sabaoId: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);
    cafeId = await createProduct(admin, { name: "Café 500g", sku: "CAF-500" });
    papelId = await createProduct(admin, { name: "Papel Higiênico", sku: "PAP-001" });
    // Produto sem saldo, mas com estoque mínimo: entra no ciclo para conferir o zero.
    sabaoId = await createProduct(admin, { name: "Sabão Líquido", sku: "SAB-001", minQty: 5 });
    await seedStock(admin, structure.warehouseId, cafeId, 30);
    await seedStock(admin, structure.warehouseId, papelId, 10);
  });

  /* ------------------------------------------------------------------------ */
  /* Abertura                                                                 */
  /* ------------------------------------------------------------------------ */

  it("congela o saldo do sistema e inclui produtos com mínimo e sem saldo", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    expect(opened.status).toBe(201);
    expect(opened.body.code).toBe("INV-2026-000001");
    expect(opened.body.itemCount).toBe(3);

    const items = await listItems(opened.body.id);
    expect(items.length).toBe(3);

    const café = itemOf(items, cafeId);
    expect(café.systemQtyMilli).toBe(30_000);
    expect(café.countedQtyMilli).toBeNull();
    expect(café.status).toBe("pending");

    // O sabão não tem saldo, mas tem mínimo: precisa ser conferido.
    const sabão = itemOf(items, sabaoId);
    expect(sabão.systemQtyMilli).toBe(0);

    // Congelamento: movimentar depois da abertura não altera o snapshot.
    await issueStock(admin, structure.warehouseId, structure.roomId, cafeId, 5);
    const after = itemOf(await listItems(opened.body.id), cafeId);
    expect(after.systemQtyMilli).toBe(30_000);
    expect(after.liveQtyMilli).toBe(25_000);

    const counter = await queryOne<{ total: number }>(
      "SELECT COUNT(*) AS total FROM inventory_items WHERE inventory_id = ?",
      [opened.body.id],
    );
    expect(counter?.total).toBe(3);
  });

  it("recusa dois inventários abertos no mesmo local e em local inativo", async () => {
    await openInventory(structure.warehouseId, "2026-10");

    const duplicated = await openInventory(structure.warehouseId, "2026-11");
    expectError(duplicated, "CONFLICT");

    // Outro local continua livre.
    const otherLocation = await openInventory(structure.roomId, "2026-10");
    expect(otherLocation.status).toBe(201);

    // Local inativo não pode receber inventário.
    const deactivate = await admin.api.patch(`/api/structure/locations/${structure.roomId}`, { isActive: false });
    expect(deactivate.status).toBe(200);
    const closed = await admin.api.post(`/api/inventories/${otherLocation.body.id}/close`, { force: true, forceReason: "Encerrando ciclo do teste" });
    expect(closed.status).toBe(200);
    const inactive = await openInventory(structure.roomId, "2026-11");
    expectError(inactive, "BAD_REQUEST");
  });

  it("marca o produto inativo sem remove-lo do ciclo", async () => {
    const product = await createProduct(admin, { name: "Produto Descontinuado", sku: "DES-001" });
    await seedStock(admin, structure.warehouseId, product, 4);
    await admin.api.patch(`/api/catalog/products/${product}`, { isActive: false });

    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), product);
    expect(item.isInactiveProduct).toBe(true);
    expect(item.productActive).toBe(false);
    expect(item.systemQtyMilli).toBe(4_000);

    // O item continua contável e ajustável, para o saldo antigo não ficar fantasma.
    const counted = await countItem(opened.body.id, item.id, 4);
    expect(counted.status).toBe(200);
  });

  /* ------------------------------------------------------------------------ */
  /* Contagem                                                                 */
  /* ------------------------------------------------------------------------ */

  it("registra a contagem sem divergência e não gera movimento", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), cafeId);

    const counted = await countItem(opened.body.id, item.id, 30);
    expect(counted.status).toBe(200);
    expect(counted.body.differenceMilli).toBe(0);
    expect(counted.body.status).toBe("counted");

    // Sem diferença, o ajuste apenas encerra o item -- nenhum movimento novo.
    const adjusted = await adjustItem(opened.body.id, item.id, "Conferência sem divergência");
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.appliedDeltaMilli).toBe(0);
    expect(adjusted.body.movementId).toBeNull();

    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(30_000);
    expect(await movementsOf(opened.body.id)).toBe(0);

    const updated = itemOf(await listItems(opened.body.id), cafeId);
    expect(updated.status).toBe("adjusted");
  });

  it("preserva o histórico ao contar o mesmo item duas vezes", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), papelId);

    await countItem(opened.body.id, item.id, 8, "Primeira contagem da equipe");
    const recount = await countItem(opened.body.id, item.id, 9.5, "Recontagem conferida pelo líder");
    expect(recount.status).toBe(200);
    expect(recount.body.differenceMilli).toBe(-500);
    expect(recount.body.status).toBe("divergent");

    const counts = await queryAll<{
      is_correction: number;
      counted_qty_milli: number;
      system_qty_milli: number;
      superseded_by: string | null;
      justification: string | null;
    }>(
      `SELECT is_correction, counted_qty_milli, system_qty_milli, superseded_by, justification
         FROM inventory_counts WHERE inventory_item_id = ? ORDER BY counted_at, id`,
      [item.id],
    );
    expect(counts.length).toBe(2);
    // Nada e apagado: a primeira contagem fica marcada como superada pela segunda.
    expect(counts[0]?.counted_qty_milli).toBe(8_000);
    expect(counts[0]?.is_correction).toBe(0);
    expect(counts[0]?.superseded_by).not.toBeNull();
    expect(counts[1]?.is_correction).toBe(1);
    expect(counts[1]?.superseded_by).toBeNull();
    expect(counts[0]?.system_qty_milli).toBe(10_000);

    const audit = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action IN ('inventory.count','inventory.recount')`,
      [item.id],
    );
    expect(audit?.total).toBe(2);
  });

  it("exige justificativa no ajuste e recusa ajustar sem contagem prévia", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), cafeId);

    const beforeCount = await admin.api.post(`/api/inventories/${opened.body.id}/items/${item.id}/adjust`, {
      justification: "Ajuste sem contagem prévia",
    });
    expectError(beforeCount, "CONFLICT");

    await countItem(opened.body.id, item.id, 28);

    const withoutReason = await admin.api.post(`/api/inventories/${opened.body.id}/items/${item.id}/adjust`, {
      justification: "ab",
    });
    expectError(withoutReason, "VALIDATION_ERROR");
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(30_000);
  });

  /* ------------------------------------------------------------------------ */
  /* Ajuste                                                                   */
  /* ------------------------------------------------------------------------ */

  it("aplica a diferença contra o saldo real do momento do ajuste", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), cafeId);

    // O saldo muda depois do congelamento: a diferença precisa considerar o
    // saldo atual, não o do snapshot, para não ressuscitar estoque consumido.
    await issueStock(admin, structure.warehouseId, structure.roomId, cafeId, 10);
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(20_000);

    const counted = await countItem(opened.body.id, item.id, 25);
    expect(counted.body.differenceMilli).toBe(-5_000); // contra o snapshot de 30

    const adjusted = await adjustItem(opened.body.id, item.id, "Diferença apurada na contagem de outubro");
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.appliedDeltaMilli).toBe(5_000); // 25 reais - 20 no sistema
    expect(adjusted.body.movementId).toBeTruthy();
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(25_000);

    const movement = await queryOne<{ type: string; qty_milli: number; from_location_id: string | null; to_location_id: string | null; reason: string }>(
      "SELECT type, qty_milli, from_location_id, to_location_id, reason FROM movements WHERE id = ?",
      [adjusted.body.movementId],
    );
    expect(movement?.type).toBe("inventory_adjust");
    expect(movement?.qty_milli).toBe(5_000);
    expect(movement?.from_location_id).toBeNull();
    expect(movement?.to_location_id).toBe(structure.warehouseId);
    expect(movement?.reason).toContain("Diferença apurada");

    const updated = itemOf(await listItems(opened.body.id), cafeId);
    expect(updated.status).toBe("adjusted");
    expect(updated.adjustmentMovementId).toBe(adjusted.body.movementId);
    expect(updated.adjustmentDeltaMilli).toBe(5_000);
  });

  it("desconta quando a contagem física e menor que o saldo", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), papelId);

    await countItem(opened.body.id, item.id, 7);
    const adjusted = await adjustItem(opened.body.id, item.id, "Faltaram três pacotes no estoque");
    expect(adjusted.body.appliedDeltaMilli).toBe(-3_000);
    expect(await stockMilli(papelId, structure.warehouseId)).toBe(7_000);

    const movement = await queryOne<{ from_location_id: string | null; to_location_id: string | null }>(
      "SELECT from_location_id, to_location_id FROM movements WHERE id = ?",
      [adjusted.body.movementId],
    );
    expect(movement?.from_location_id).toBe(structure.warehouseId);
    expect(movement?.to_location_id).toBeNull();
  });

  it("não duplica o ajuste do mesmo item", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), cafeId);
    await countItem(opened.body.id, item.id, 26);

    const first = await adjustItem(opened.body.id, item.id, "Ajuste de outubro");
    expect(first.status).toBe(200);

    const second = await adjustItem(opened.body.id, item.id, "Tentativa de ajuste repetido");
    expectError(second, "CONFLICT");
    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(26_000);
    expect(await movementsOf(opened.body.id)).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Dispensa, fechamento e reabertura                                        */
  /* ------------------------------------------------------------------------ */

  it("dispensa item com motivo e recusa dispensar o que já foi contado", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const items = await listItems(opened.body.id);
    const sabão = itemOf(items, sabaoId);
    const café = itemOf(items, cafeId);

    const withoutReason = await admin.api.post(`/api/inventories/${opened.body.id}/items/${sabão.id}/skip`, {
      reason: "abc",
    });
    expectError(withoutReason, "VALIDATION_ERROR");

    const skipped = await admin.api.post(`/api/inventories/${opened.body.id}/items/${sabão.id}/skip`, {
      reason: "Produto fora de uso neste ciclo",
    });
    expect(skipped.status).toBe(200);
    expect(itemOf(await listItems(opened.body.id), sabaoId).status).toBe("skipped");

    await countItem(opened.body.id, café.id, 30);
    const refused = await admin.api.post(`/api/inventories/${opened.body.id}/items/${café.id}/skip`, {
      reason: "Tentativa de dispensar item contado",
    });
    expectError(refused, "CONFLICT");
  });

  it("bloqueia o fechamento com pendências e exige justificativa na exceção", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const items = await listItems(opened.body.id);

    const pending = await admin.api.post(`/api/inventories/${opened.body.id}/close`, {});
    expectError(pending, "CONFLICT");

    const forcedWithoutReason = await admin.api.post(`/api/inventories/${opened.body.id}/close`, { force: true });
    expectError(forcedWithoutReason, "BAD_REQUEST");

    await countItem(opened.body.id, itemOf(items, cafeId).id, 30);
    await countItem(opened.body.id, itemOf(items, papelId).id, 10);

    // Sabão ficou pendente: fechar exige a exceção justificada.
    const forced = await admin.api.post<{ closedWithPending: number }>(`/api/inventories/${opened.body.id}/close`, {
      force: true,
      forceReason: "Produto sem saldo e sem movimentação; conferido no próximo ciclo",
    });
    expect(forced.status).toBe(200);
    expect(forced.body.closedWithPending).toBe(1);

    const audit = await queryOne<{ action: string; reason: string | null }>(
      `SELECT action, reason FROM audit_log WHERE entity_id = ? AND module = 'inventory' AND action LIKE 'inventory.close%'
        ORDER BY created_at DESC LIMIT 1`,
      [opened.body.id],
    );
    expect(audit?.action).toBe("inventory.close_with_exception");
    expect(audit?.reason).toContain("próximo ciclo");
  });

  it("exige ajuste da divergência antes de fechar", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const items = await listItems(opened.body.id);
    await countItem(opened.body.id, itemOf(items, cafeId).id, 28);
    await countItem(opened.body.id, itemOf(items, papelId).id, 10);
    await admin.api.post(`/api/inventories/${opened.body.id}/items/${itemOf(items, sabaoId).id}/skip`, {
      reason: "Sem saldo neste ciclo",
    });

    const blocked = await admin.api.post(`/api/inventories/${opened.body.id}/close`, {});
    expectError(blocked, "CONFLICT");

    await adjustItem(opened.body.id, itemOf(items, cafeId).id, "Divergência de dois quilos apurada");

    const closed = await admin.api.post<{ closedWithPending: number; closedWithUnadjusted: number }>(
      `/api/inventories/${opened.body.id}/close`,
      {},
    );
    expect(closed.status).toBe(200);
    expect(closed.body.closedWithPending).toBe(0);
    expect(closed.body.closedWithUnadjusted).toBe(0);

    const inventory = await queryOne<{ status: string; closed_by: string; closed_at: string }>(
      "SELECT status, closed_by, closed_at FROM inventories WHERE id = ?",
      [opened.body.id],
    );
    expect(inventory?.status).toBe("closed");
    expect(inventory?.closed_by).toBe(admin.id);
    expect(inventory?.closed_at).toBeTruthy();
  });

  it("reabre o ciclo registrando o motivo e permitindo nova contagem", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const items = await listItems(opened.body.id);
    for (const item of items) {
      await countItem(opened.body.id, item.id, itemOf(items, item.productId).systemQtyMilli / 1000);
    }
    const closed = await admin.api.post(`/api/inventories/${opened.body.id}/close`, {});
    expect(closed.status).toBe(200);

    const reopen = await admin.api.post<{ reopenCount: number }>(`/api/inventories/${opened.body.id}/reopen`, {
      reason: "Contagem do sabão ficou incorreta e precisa ser refeita",
    });
    expect(reopen.status).toBe(200);
    expect(reopen.body.reopenCount).toBe(1);

    // Um ciclo já aberto não pode ser reaberto de novo.
    const reopenOpenInventory = await admin.api.post(`/api/inventories/${opened.body.id}/reopen`, {
      reason: "Tentativa de reabrir ciclo já aberto",
    });
    expectError(reopenOpenInventory, "CONFLICT");

    const inventory = await queryOne<{ status: string; reopen_count: number; closed_at: string | null }>(
      "SELECT status, reopen_count, closed_at FROM inventories WHERE id = ?",
      [opened.body.id],
    );
    expect(inventory?.status).toBe("open");
    expect(inventory?.reopen_count).toBe(1);
    expect(inventory?.closed_at).toBeNull();

    // Contagens anteriores continuam valendo; o ciclo aceita novas contagens.
    const antes = await itemOf(await listItems(opened.body.id), cafeId);
    expect(antes.countedQtyMilli).toBe(30_000);
    const recount = await countItem(opened.body.id, itemOf(items, cafeId).id, 29, "Recontagem após reabertura");
    expect(recount.status).toBe(200);

    const audit = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'inventory.reopen'`,
      [opened.body.id],
    );
    expect(audit?.total).toBe(1);
  });

  it("inclui produtos criados depois da abertura pelo sincronismo de itens", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    expect((await listItems(opened.body.id)).length).toBe(3);

    const novo = await createProduct(admin, { name: "Desinfetante", sku: "DES-002" });
    await seedStock(admin, structure.warehouseId, novo, 6);

    const synced = await admin.api.post<{ added: number }>(`/api/inventories/${opened.body.id}/sync-items`, {});
    expect(synced.status).toBe(200);
    expect(synced.body.added).toBe(1);

    const item = itemOf(await listItems(opened.body.id), novo);
    expect(item.systemQtyMilli).toBe(6_000);
    expect(item.status).toBe("pending");

    // Repetir o sincronismo não duplica itens.
    const again = await admin.api.post<{ added: number }>(`/api/inventories/${opened.body.id}/sync-items`, {});
    expect(again.body.added).toBe(0);
  });

  /* ------------------------------------------------------------------------ */
  /* Relatório e permissões                                                   */
  /* ------------------------------------------------------------------------ */

  it("resume o ciclo no relatório de fechamento", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const items = await listItems(opened.body.id);
    await countItem(opened.body.id, itemOf(items, cafeId).id, 28);
    await countItem(opened.body.id, itemOf(items, papelId).id, 12);
    await admin.api.post(`/api/inventories/${opened.body.id}/items/${itemOf(items, sabaoId).id}/skip`, {
      reason: "Produto sem movimentação",
    });
    await adjustItem(opened.body.id, itemOf(items, cafeId).id, "Divergência apurada");

    const report = await admin.api.get<{
      summary: {
        totalItems: number;
        pending: number;
        divergent: number;
        adjusted: number;
        skipped: number;
        excessItems: number;
        shortageItems: number;
        totalExcessMilli: number;
        totalShortageMilli: number;
        appliedAdjustmentMilli: number;
      };
      counters: { name: string }[];
    }>(`/api/inventories/${opened.body.id}/report`);

    expect(report.status).toBe(200);
    expect(report.body.summary.totalItems).toBe(3);
    expect(report.body.summary.pending).toBe(0);
    expect(report.body.summary.divergent).toBe(1); // papel com +2
    expect(report.body.summary.adjusted).toBe(1);
    expect(report.body.summary.skipped).toBe(1);
    expect(report.body.summary.excessItems).toBe(1);
    expect(report.body.summary.totalExcessMilli).toBe(2_000);
    expect(report.body.summary.shortageItems).toBe(1);
    expect(report.body.summary.totalShortageMilli).toBe(-2_000);
    expect(report.body.summary.appliedAdjustmentMilli).toBe(-2_000);
    expect(report.body.counters.map((c) => c.name)).toEqual([admin.name]);
  });

  it("exige permissão própria para abrir, contar, ajustar e fechar", async () => {
    const opened = await openInventory(structure.warehouseId, "2026-10");
    const item = itemOf(await listItems(opened.body.id), cafeId);

    const lead = await createUser(admin, {
      name: "Líder de Limpeza",
      email: "lider@facil.test",
      roleId: await findRoleId("cleaning_lead"),
    });

    // Pode conferir itens (inventory.count).
    const counted = await lead.api.post(`/api/inventories/${opened.body.id}/items/${item.id}/count`, {
      countedQty: 29,
    });
    expect(counted.status).toBe(200);

    // Não pode abrir, ajustar nem fechar.
    const open = await lead.api.post("/api/inventories", {
      locationId: structure.roomId,
      periodLabel: "2026-10",
    });
    expectError(open, "FORBIDDEN");
    const adjust = await lead.api.post(`/api/inventories/${opened.body.id}/items/${item.id}/adjust`, {
      justification: "Ajuste tentado pelo líder",
    });
    expectError(adjust, "FORBIDDEN");
    const close = await lead.api.post(`/api/inventories/${opened.body.id}/close`, {});
    expectError(close, "FORBIDDEN");

    expect(await stockMilli(cafeId, structure.warehouseId)).toBe(30_000);

    // Toda negação fica registrada na auditoria.
    const denied = await queryAll<{ entity_id: string; result: string }>(
      `SELECT entity_id, result FROM audit_log WHERE action = 'permission_denied' ORDER BY created_at`,
    );
    expect(denied.length).toBe(3);
    expect(denied.map((d) => d.entity_id).sort()).toEqual([
      "inventory.adjust",
      "inventory.close",
      "inventory.create",
    ]);
    expect(denied.every((d) => d.result === "failure")).toBe(true);
  });

  /* ------------------------------------------------------------------------ */
  /* Auxiliares do teste                                                      */
  /* ------------------------------------------------------------------------ */

  async function openInventory(locationId: string, periodLabel: string) {
    return admin.api.post<{ id: string; code: string; itemCount: number }>("/api/inventories", {
      locationId,
      periodLabel,
    });
  }

  async function listItems(inventoryId: string) {
    const response = await admin.api.get<{ items: InventoryItem[] }>(`/api/inventories/${inventoryId}/items`);
    if (response.status !== 200) {
      throw new Error(`Falha ao listar itens: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.items;
  }

  async function countItem(inventoryId: string, itemId: string, countedQty: number, justification?: string) {
    return admin.api.post<{ differenceMilli: number; status: string; systemQtyMilli: number }>(
      `/api/inventories/${inventoryId}/items/${itemId}/count`,
      { countedQty, justification: justification ?? null },
    );
  }

  async function adjustItem(inventoryId: string, itemId: string, justification: string) {
    return admin.api.post<{ appliedDeltaMilli: number; movementId: string | null; status: string }>(
      `/api/inventories/${inventoryId}/items/${itemId}/adjust`,
      { justification },
    );
  }

  async function movementsOf(inventoryId: string) {
    return countRows("SELECT COUNT(*) AS total FROM movements WHERE ref_type = 'inventory' AND ref_id = ?", [
      inventoryId,
    ]);
  }
});

interface InventoryItem {
  id: string;
  productId: string;
  systemQtyMilli: number;
  countedQtyMilli: number | null;
  differenceMilli: number | null;
  liveQtyMilli: number;
  status: string;
  productActive: boolean;
  isInactiveProduct: boolean;
  adjustmentMovementId: string | null;
  adjustmentDeltaMilli: number | null;
}

function itemOf(items: InventoryItem[], productId: string): InventoryItem {
  const item = items.find((i) => i.productId === productId);
  assert(item, `Item do produto ${productId} não encontrado no inventário.`);
  return item;
}
