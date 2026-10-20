/**
 * Rótulos de local (F-16).
 *
 * O `path` de um local é a hierarquia DENTRO da unidade (ex.: "Bloco A / Sala
 * 101") — dois locais homônimos em unidades diferentes ficavam idênticos nos
 * seletores. O rótulo abaixo acrescenta a unidade, que é o que os diferencia.
 */
export function locationLabel(location: { path: string; unitName: string | null }): string {
  const unit = location.unitName?.trim();
  return unit ? `${location.path} — ${unit}` : location.path;
}
