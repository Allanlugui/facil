import type { Context } from "hono";
import type { ZodType } from "zod";
import type { ApiErrorBody } from "@shared/types";
import type { AppEnv } from "./types";

/**
 * Erro de dominio. Toda resposta de erro da API passa por aqui para garantir
 * um formato único e não vazar detalhes internos (stack, SQL) ao cliente.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Autenticação necessária.") =>
  new ApiError(401, "UNAUTHORIZED", message);

export const forbidden = (
  message = "Você não tem permissão para executar esta ação.",
  details?: unknown,
) => new ApiError(403, "FORBIDDEN", message, details);

/**
 * Sessão válida, mas o usuário ainda precisa trocar a senha. Código próprio
 * para o frontend levar direto a tela de troca em vez de mostrar erro genérico.
 */
export const passwordChangeRequired = () =>
  new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "É necessário alterar a senha antes de continuar.");

export const notFound = (message = "Registro não encontrado.") => new ApiError(404, "NOT_FOUND", message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "CONFLICT", message, details);

export const unprocessable = (message: string, details?: unknown) =>
  new ApiError(422, "VALIDATION_ERROR", message, details);

export function json<T>(c: Context, data: T, status = 200): Response {
  return c.json(data as never, status as never);
}

/**
 * Válida o corpo JSON da requisição com Zod. Em caso de falha devolve 422 com
 * a lista de campos inválidos, o que o frontend usa para exibir mensagens úteis.
 */
export async function parseBody<T>(c: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Corpo da requisição deve ser JSON válido.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join(".") || "(raiz)",
      message: i.message,
    }));
    throw unprocessable("Dados inválidos.", issues);
  }
  return result.data;
}

/** Válida a query string com Zod convertendo os tipos necessários. */
export function parseQuery<T>(c: Context<AppEnv>, schema: ZodType<T>): T {
  const obj: Record<string, string | string[]> = {};
  const url = new URL(c.req.url);
  for (const [key, value] of url.searchParams.entries()) {
    if (key in obj) {
      const prev = obj[key];
      obj[key] = Array.isArray(prev) ? [...prev, value] : [prev as string, value];
    } else {
      obj[key] = value;
    }
  }
  const result = schema.safeParse(obj);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join(".") || "(raiz)",
      message: i.message,
    }));
    throw unprocessable("Parâmetros de consulta inválidos.", issues);
  }
  return result.data;
}

export function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}
