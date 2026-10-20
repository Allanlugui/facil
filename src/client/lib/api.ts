import type { ApiErrorBody } from "@shared/types";

/**
 * Cliente HTTP da API.
 *
 * Todas as respostas de erro do backend usam o mesmo formato
 * (`{ error: { code, message, details? } }`), então o cliente converte qualquer
 * falha em `ApiError` com código estável -- a interface decide o que mostrar sem
 * inspecionar texto de mensagem.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, error: ApiErrorBody["error"]) {
    super(error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = error.code;
    this.details = error.details;
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export function withParams(path: string, params?: Record<string, QueryValue>): string {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }

  const response = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: "same-origin",
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const error = (parsed as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error ?? {
        code: "UNKNOWN",
        message: `Falha na requisição (HTTP ${response.status}).`,
      },
    );
  }

  return parsed as T;
}

export const apiGet = <T>(path: string, params?: Record<string, QueryValue>): Promise<T> =>
  request<T>("GET", withParams(path, params));

export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>("POST", path, body ?? {});

export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>("PATCH", path, body ?? {});

export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>("PUT", path, body ?? {});

export const apiDelete = <T>(path: string): Promise<T> => request<T>("DELETE", path);

/** Upload de arquivo (multipart) -- usado pelos anexos. */
export const apiUpload = <T>(path: string, form: FormData): Promise<T> =>
  request<T>("POST", path, form);

/** Mensagem pronta para o usuário a partir de qualquer erro capturado. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
      const first = error.details[0] as { field?: string; message?: string } | undefined;
      if (first?.message) return first.message;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Erro inesperado ao falar com o servidor.";
}

/** Detalhes de validação por campo, para marcar os inputs do formulário. */
export function fieldErrors(error: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR" && Array.isArray(error.details)) {
    for (const issue of error.details as { field?: string; message?: string }[]) {
      const field = issue.field ?? "";
      if (field && issue.message && !map[field]) map[field] = issue.message;
    }
  }
  return map;
}

/** Baixa um CSV gerado pelo backend respeitando o nome enviado no cabeçalho. */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    let message = `Não foi possível exportar (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error?.message) message = body.error.message;
    } catch {
      // mantem a mensagem padrão
    }
    throw new ApiError(response.status, { code: "EXPORT_FAILED", message });
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
