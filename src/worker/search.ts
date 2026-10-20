/**
 * Busca aproximada de texto (a seleção de produtos usa esta base).
 *
 * O estoque tem centenas de itens: em vez de um menu suspenso, o usuário digita
 * parte do nome ou do SKU e a lista filtra a cada letra. A comparação acontece
 * em três passos: minúsculas, sem acentos e por termos independentes (cada
 * palavra digitada precisa aparecer em algum lugar do texto — a ordem não
 * importa).
 *
 * O SQLite do D1 não tem `unaccent`, então o lado da coluna usa uma cadeia de
 * `replace(...)` gerada a partir do mesmo mapa de acentos do lado TS. Manter os
 * dois lados no mesmo arquivo evita que a busca em código e em SQL divirjam.
 */

/** Acentos do português mapeados para a letra-base (maiúsculas e minúsculas). */
const ACCENT_FOLD: ReadonlyArray<readonly [string, string]> = [
  ["á", "a"], ["à", "a"], ["â", "a"], ["ã", "a"], ["ä", "a"],
  ["Á", "a"], ["À", "a"], ["Â", "a"], ["Ã", "a"], ["Ä", "a"],
  ["é", "e"], ["è", "e"], ["ê", "e"], ["ë", "e"],
  ["É", "e"], ["È", "e"], ["Ê", "e"], ["Ë", "e"],
  ["í", "i"], ["ì", "i"], ["î", "i"], ["ï", "i"],
  ["Í", "i"], ["Ì", "i"], ["Î", "i"], ["Ï", "i"],
  ["ó", "o"], ["ò", "o"], ["ô", "o"], ["õ", "o"], ["ö", "o"],
  ["Ó", "o"], ["Ò", "o"], ["Ô", "o"], ["Õ", "o"], ["Ö", "o"],
  ["ú", "u"], ["ù", "u"], ["û", "u"], ["ü", "u"],
  ["Ú", "u"], ["Ù", "u"], ["Û", "u"], ["Ü", "u"],
  ["ç", "c"], ["Ç", "c"],
  ["ñ", "n"], ["Ñ", "n"],
];

/** Normaliza um texto digitado: minúsculas, sem acentos, espaços colapsados. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Divide a busca em termos normalizados (no máximo 5).
 *
 * Caracteres que o `LIKE` trataria como curinga (`%` e `_`) são removidos: o
 * usuário digita texto, não um padrão.
 */
export function searchTokens(query: string, maxTerms = 5): string[] {
  const normalized = normalizeSearchText(query).replace(/[%_\\]/g, "");
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean).slice(0, maxTerms);
}

/**
 * Expressão SQL que aplica a mesma normalização na coluna/expressão indicada.
 *
 * `lower()` do SQLite só dobra A-Z (não toca acentos), então o mapa cobre as
 * duas caixas explicitamente.
 */
export function sqlSearchExpression(column: string): string {
  let expression = `lower(${column})`;
  for (const [from, to] of ACCENT_FOLD) {
    expression = `replace(${expression}, '${from}', '${to}')`;
  }
  return expression;
}
