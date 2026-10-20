/**
 * Regras compartilhadas de arquivo (anexos).
 *
 * As listas de tipo ficam num lugar só para o módulo de anexos e a Central de
 * Suporte não divergirem. A lista "pública" é deliberadamente menor (D-18):
 * uploads sem sessão (link/token de acompanhamento) aceitam apenas imagem,
 * PDF e texto; documentos de escritório entram só por quem está autenticado.
 */

export const ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-excel",
];

export const PUBLIC_ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf",
  "text/plain",
  "text/csv",
];

export function mimeAllowed(prefixes: string[], mimeType: string): boolean {
  return prefixes.some((prefix) => mimeType.startsWith(prefix));
}

/** Tamanho legível para mensagens e e-mails ("1,2 MB", "300 KB"). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
