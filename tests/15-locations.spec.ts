import { describe, expect, it } from "vitest";
import { locationLabel } from "@shared/locations";

/**
 * F-16: locais homônimos em unidades diferentes apareciam idênticos nos
 * seletores e filtros. O rótulo junta o caminho do local com o nome da
 * unidade, que é o que diferencia os dois casos reais.
 */
describe("rótulo de local (F-16)", () => {
  it("acrescenta a unidade para distinguir homônimos", () => {
    expect(locationLabel({ path: "Almoxarifado Central", unitName: "Edifício Sede" })).toBe(
      "Almoxarifado Central — Edifício Sede",
    );
  });

  it("mantém o caminho quando a unidade não vem na resposta", () => {
    expect(locationLabel({ path: "Bloco A / Sala 101", unitName: null })).toBe(
      "Bloco A / Sala 101",
    );
    expect(locationLabel({ path: "Bloco A / Sala 101", unitName: "   " })).toBe(
      "Bloco A / Sala 101",
    );
  });
});
