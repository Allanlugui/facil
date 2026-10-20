import { env, SELF } from "cloudflare:test";

/**
 * Utilitarios dos testes de integração.
 *
 * Os testes falam HTTP com o Worker real (via `SELF.fetch`), usando o D1 do
 * Miniflare com as migrações aplicadas. Nada aqui simula o banco: triggers,
 * CHECKs, UNIQUEs e transações rodam de verdade.
 */

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export class Api {
  private cookies = new Map<string, string>();

  async request<T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string>; rawBody?: BodyInit } = {},
  ): Promise<ApiResult<T>> {
    const headers = new Headers(options.headers ?? {});
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }

    let body: BodyInit | undefined;
    if (options.rawBody !== undefined) {
      body = options.rawBody;
    } else if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(options.body);
    }

    const response = await SELF.fetch(`https://facil.test${path}`, { method, headers, body });
    this.captureCookies(response);

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    return { status: response.status, body: parsed as T, headers: response.headers };
  }

  private captureCookies(response: Response): void {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter((value): value is string => Boolean(value));

    for (const header of setCookies) {
      const pair = header.split(";")[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  get<T = unknown>(path: string) {
    return this.request<T>("GET", path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body: body ?? {} });
  }

  /** POST com corpo bruto (FormData, bytes): o content-type fica a cargo do corpo. */
  postRaw<T = unknown>(path: string, rawBody: BodyInit) {
    return this.request<T>("POST", path, { rawBody });
  }

  /** Resposta crua, sem parser de JSON -- usada para conteúdo binário. */
  async fetchRaw(method: string, path: string): Promise<Response> {
    const headers = new Headers();
    if (this.cookies.size > 0) {
      headers.set(
        "cookie",
        [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    return SELF.fetch(`https://facil.test${path}`, { method, headers });
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PATCH", path, { body: body ?? {} });
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("PUT", path, { body: body ?? {} });
  }

  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }

  clearSession(): void {
    this.cookies.clear();
  }
}

export interface Actor {
  api: Api;
  id: string;
  email: string;
  password: string;
  name: string;
}

export const ADMIN_PASSWORD = "FacilTest#2026";
export const DEFAULT_PASSWORD = "ComumTest#2026";

/* -------------------------------------------------------------------------- */
/* Banco                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Limpa tudo o que e dado operacional e mantem apenas os dados de referência
 * (permissões, papeis, unidades de medida, tipos de local, categorias de ticket,
 * configurações). Garante que cada teste começa de um estado conhecido sem
 * precisar reaplicar migrações.
 */
export async function resetDatabase(): Promise<void> {
  // A ordem respeita as chaves estrangeiras: itens que referenciam movimentos
  // (recebimento de compra, consumo, ajuste de inventário) saem antes deles.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM support_messages"),
    env.DB.prepare("DELETE FROM support_requests"),
    env.DB.prepare("DELETE FROM support_articles"),
    env.DB.prepare("DELETE FROM email_outbox"),
    env.DB.prepare("DELETE FROM attachments"),
    env.DB.prepare("DELETE FROM notifications"),
    env.DB.prepare("DELETE FROM audit_log"),
    env.DB.prepare("DELETE FROM inventory_counts"),
    env.DB.prepare("DELETE FROM inventory_items"),
    env.DB.prepare("DELETE FROM inventories"),
    env.DB.prepare("DELETE FROM consumption_items"),
    env.DB.prepare("DELETE FROM consumption_records"),
    env.DB.prepare("DELETE FROM purchase_receipt_items"),
    env.DB.prepare("DELETE FROM purchase_receipts"),
    env.DB.prepare("DELETE FROM movements"),
    env.DB.prepare("DELETE FROM stock"),
    env.DB.prepare("DELETE FROM purchase_request_items"),
    env.DB.prepare("DELETE FROM purchase_requests"),
    env.DB.prepare("DELETE FROM work_order_events"),
    env.DB.prepare("DELETE FROM work_orders"),
    env.DB.prepare("DELETE FROM ticket_comments"),
    env.DB.prepare("DELETE FROM tickets"),
    env.DB.prepare("DELETE FROM user_location_scopes"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("UPDATE settings SET updated_by = NULL"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM products"),
    env.DB.prepare("DELETE FROM product_categories"),
    env.DB.prepare("DELETE FROM suppliers"),
    env.DB.prepare("DELETE FROM locations"),
    env.DB.prepare("DELETE FROM units"),
    env.DB.prepare("UPDATE counters SET value = 0"),
  ]);
}

export async function countRows(sql: string, params: unknown[] = []): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...params).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await env.DB.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
}

export async function stockMilli(productId: string, locationId: string): Promise<number> {
  const row = await queryOne<{ qty_milli: number }>(
    "SELECT qty_milli FROM stock WHERE product_id = ? AND location_id = ?",
    [productId, locationId],
  );
  return row?.qty_milli ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Contas e estrutura                                                         */
/* -------------------------------------------------------------------------- */

/** Cria o administrador inicial pela tela de setup (fluxo real de primeira execução). */
export async function setupAdmin(options: { createStarterStructure?: boolean } = {}): Promise<Actor> {
  const api = new Api();
  const email = "admin@facil.test";
  const response = await api.post<{ user?: { id: string }; id?: string }>("/api/auth/setup", {
    companyName: "Empresa Teste",
    name: "Administrador Teste",
    email,
    password: ADMIN_PASSWORD,
    createStarterStructure: options.createStarterStructure ?? true,
  });

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(`Falha no setup inicial: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const me = await api.get<{ user: { id: string } }>("/api/auth/me");
  const id = me.body?.user?.id;
  if (!id) throw new Error("Setup não retornou sessão autenticada.");

  return { api, id, email, password: ADMIN_PASSWORD, name: "Administrador Teste" };
}

export async function login(email: string, password: string): Promise<Api> {
  const api = new Api();
  const response = await api.post("/api/auth/login", { email, password });
  if (response.status !== 200) {
    throw new Error(`Login falhou para ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return api;
}

/** Cria usuário com papel e devolve um cliente já autenticado com ele. */
export async function createUser(
  admin: Actor,
  options: { name: string; email: string; roleId: string; password?: string; mustChangePassword?: boolean },
): Promise<Actor> {
  const password = options.password ?? DEFAULT_PASSWORD;
  const created = await admin.api.post<{ id: string }>("/api/users/users", {
    name: options.name,
    email: options.email,
    roleId: options.roleId,
    password,
    mustChangePassword: options.mustChangePassword ?? false,
  });
  if (created.status !== 201) {
    throw new Error(`Falha ao criar usuário ${options.email}: ${created.status} ${JSON.stringify(created.body)}`);
  }

  const api = await login(options.email, password);
  return { api, id: created.body.id, email: options.email, password, name: options.name };
}

export interface Structure {
  unitId: string;
  warehouseId: string;
  roomId: string;
  roomPath: string;
}

async function locationTypeId(code: string): Promise<string> {
  const row = await queryOne<{ id: string }>("SELECT id FROM location_types WHERE code = ?", [code]);
  if (!row) throw new Error(`Tipo de local ${code} não encontrado no banco de referência.`);
  return row.id;
}

/** Estrutura mínima: 1 unidade, 1 almoxarifado e 1 sala. */
export async function createStructure(admin: Actor): Promise<Structure> {
  const unit = await admin.api.post<{ id: string }>("/api/structure/units", {
    name: "Unidade Teste",
    code: "UNT",
  });
  if (unit.status !== 201) throw new Error(`Falha ao criar unidade: ${JSON.stringify(unit.body)}`);
  const unitId = unit.body.id;

  const warehouse = await admin.api.post<{ id: string }>("/api/structure/locations", {
    unitId,
    name: "Almoxarifado",
    code: "ALM-01",
    typeId: await locationTypeId("almoxarifado"),
  });
  if (warehouse.status !== 201) throw new Error(`Falha ao criar almoxarifado: ${JSON.stringify(warehouse.body)}`);

  const room = await admin.api.post<{ id: string }>("/api/structure/locations", {
    unitId,
    name: "Sala 101",
    code: "SALA-101",
    typeId: await locationTypeId("sala"),
    parentId: null,
  });
  if (room.status !== 201) throw new Error(`Falha ao criar sala: ${JSON.stringify(room.body)}`);

  const roomDetail = await admin.api.get<{ location: { path: string } }>(
    `/api/structure/locations/${room.body.id}`,
  );

  return {
    unitId,
    warehouseId: warehouse.body.id,
    roomId: room.body.id,
    roomPath: roomDetail.body?.location?.path ?? "",
  };
}

export async function createProduct(
  admin: Actor,
  options: {
    name: string;
    sku?: string;
    uomId?: string;
    minQty?: number;
    categoryId?: string;
    tracksStock?: boolean;
  },
): Promise<string> {
  const uomId = options.uomId ?? (await findUomId("UN"));
  const created = await admin.api.post<{ id: string }>("/api/catalog/products", {
    name: options.name,
    sku: options.sku ?? null,
    uomId,
    minQty: options.minQty ?? 0,
    categoryId: options.categoryId ?? null,
    tracksStock: options.tracksStock ?? true,
  });
  if (created.status !== 201) throw new Error(`Falha ao criar produto: ${JSON.stringify(created.body)}`);
  return created.body.id;
}

/**
 * Cria saldo inicial de um produto no local indicado (entrada por devolução,
 * usada nos testes como carga inicial). O identificador de requisição e
 * derivado do produto + local, o que torna a chamada repetível.
 */
export async function seedStock(
  actor: Actor,
  locationId: string,
  productId: string,
  qty: number,
): Promise<void> {
  const response = await actor.api.post("/api/stock/movements", {
    type: "return",
    requestKey: `carga-${productId}-${locationId}-${qty}`,
    toLocationId: locationId,
    reason: "Carga inicial de estoque",
    items: [{ productId, qty }],
  });
  if (response.status !== 201) {
    throw new Error(`Falha ao criar saldo inicial: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

/** Retirada de estoque do origem para o destino informado. */
export async function issueStock(
  actor: Actor,
  fromLocationId: string,
  toLocationId: string,
  productId: string,
  qty: number,
): Promise<void> {
  const response = await actor.api.post("/api/stock/movements", {
    type: "issue",
    requestKey: `retirada-${productId}-${fromLocationId}-${qty}`,
    fromLocationId,
    toLocationId,
    items: [{ productId, qty }],
  });
  if (response.status !== 201) {
    throw new Error(`Falha ao retirar estoque: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

export async function findUomId(code: string): Promise<string> {
  const row = await queryOne<{ id: string }>("SELECT id FROM uoms WHERE code = ?", [code]);
  if (!row) throw new Error(`Unidade de medida ${code} não encontrada no banco de referência.`);
  return row.id;
}

export async function findCategoryId(code: string): Promise<string> {
  const row = await queryOne<{ id: string }>("SELECT id FROM product_categories WHERE code = ?", [code]);
  if (!row) throw new Error(`Categoria ${code} não encontrada.`);
  return row.id;
}

export async function findRoleId(code: string): Promise<string> {
  const row = await queryOne<{ id: string }>("SELECT id FROM roles WHERE code = ?", [code]);
  if (!row) throw new Error(`Papel ${code} não encontrado.`);
  return row.id;
}

/** Espera a resposta ser erro com o código informado (mensagem amigável). */
export function expectError(result: ApiResult<{ error?: { code?: string; message?: string } }>, code?: string): void {
  if (result.status < 400) {
    throw new Error(`Esperava erro, recebeu ${result.status}: ${JSON.stringify(result.body)}`);
  }
  if (code && result.body?.error?.code !== code) {
    throw new Error(`Esperava código ${code}, recebeu ${result.body?.error?.code}: ${JSON.stringify(result.body)}`);
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
