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

/**
 * Tipos que nunca podem ser exibidos inline: SVG é um documento e executa
 * script no mesmo origin, então um upload com `image/svg+xml` viraria XSS
 * armazenado. HTML/XHTML já não passam pelas listas, mas ficam explícitos.
 */
const BLOCKED_MIME_TYPES = new Set([
  "image/svg+xml",
  "image/svg",
  "text/html",
  "application/xhtml+xml",
]);

/** Remove parâmetros (`; charset=...`), espaços e caixa alta do MIME. */
export function normalizeMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

export function mimeAllowed(prefixes: string[], mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized || BLOCKED_MIME_TYPES.has(normalized)) return false;
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Imagens raster, PDF e texto podem abrir no navegador; o resto (Office,
 * formatos exóticos) baixa como anexo. SVG nunca entra nesta lista.
 */
const INLINE_SAFE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

export function attachmentDisposition(mimeType: string): "inline" | "attachment" {
  return INLINE_SAFE_MIME_TYPES.has(normalizeMimeType(mimeType)) ? "inline" : "attachment";
}

/** Tamanho legível para mensagens e e-mails ("1,2 MB", "300 KB"). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
