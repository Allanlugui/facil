import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import { THEME_IDS } from "@shared/themes";
import type { AppEnv } from "../types";
import { currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, insertStatement, oneRow, updateStatement } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Configurações gerais                                                       */
/* -------------------------------------------------------------------------- */

interface SettingDefinition {
  key: string;
  description: string;
  type: "string" | "boolean" | "enum" | "integer";
  options?: string[];
  min?: number;
  max?: number;
  /** Credencial: nunca volta no GET, nunca aparece na auditoria. */
  secret?: boolean;
  /**
   * Grupo exibido na tela de Configurações (aba/seção). Os identificadores são
   * combinados com `SETTINGS_SECTIONS` no cliente; valor fora da lista cai em
   * "Outros" na interface.
   */
  section: string;
}

/**
 * Catálogo de configurações editáveis. Chaves fora desta lista não podem ser
 * gravadas pela API -- evita que valores arbitrarios entrem em `settings` e
 * passem a influenciar regras de negócio sem revisão.
 */
export const SETTINGS_CATALOG: SettingDefinition[] = [
  {
    key: "ui.theme",
    description: "Tema padrão da interface do sistema",
    type: "enum",
    options: [...THEME_IDS],
    section: "aparencia",
  },
  { key: "company.name", description: "Nome exibido no topo da aplicação", type: "string", section: "geral" },
  { key: "company.timezone", description: "Fuso horário de apresentação", type: "string", section: "geral" },
  {
    key: "stock.allow_negative",
    description: "Permitir estoque negativo (não recomendado)",
    type: "boolean",
    section: "estoque",
  },
  {
    key: "stock.low_stock_scope",
    description: "Escopo do alerta de estoque mínimo",
    type: "enum",
    options: ["per_location", "global"],
    section: "estoque",
  },
  {
    key: "consumption.periodicity",
    description: "Periodicidade padrão dos lançamentos de consumo",
    type: "enum",
    options: ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "custom"],
    section: "consumo",
  },
  {
    key: "inventory.periodicity",
    description: "Periodicidade padrão do inventário",
    type: "enum",
    options: ["daily", "weekly", "biweekly", "monthly", "quarterly", "annual", "custom"],
    section: "consumo",
  },
  {
    key: "purchases.require_approval",
    description: "Exigir aprovação antes de comprar",
    type: "boolean",
    section: "compras",
  },
  { key: "mail.enabled", description: "Habilitar envio de e-mails de suporte", type: "boolean", section: "suporte" },
  {
    key: "mail.provider",
    description: "Provedor de envio de e-mails (none, resend, brevo, relay, gmail)",
    type: "enum",
    options: ["none", "resend", "brevo", "relay", "gmail"],
    section: "suporte",
  },
  {
    key: "mail.api_key",
    description: "Chave de API do provedor de e-mail",
    type: "string",
    secret: true,
    section: "suporte",
  },
  {
    key: "mail.from",
    description: "Remetente dos e-mails de suporte (no Gmail, o próprio endereço Gmail)",
    type: "string",
    section: "suporte",
  },
  {
    key: "mail.gmail_app_password",
    description: "Senha de app do Gmail (16 letras; espaços são ignorados)",
    type: "string",
    secret: true,
    section: "suporte",
  },
  {
    key: "mail.relay_url",
    description: "URL do relay de e-mail (Web App do Apps Script ou webhook compatível)",
    type: "string",
    section: "suporte",
  },
  {
    key: "mail.relay_secret",
    description: "Segredo compartilhado com o relay de e-mail",
    type: "string",
    secret: true,
    section: "suporte",
  },
  {
    key: "attachments.max_bytes",
    description: "Tamanho máximo de anexo em bytes (R2 no suporte; D1 nos demais módulos)",
    type: "integer",
    min: 10240,
    max: 52428800,
    section: "anexos",
  },
  {
    key: "captcha.enabled",
    description: "Habilitar captcha (Turnstile) no login e na abertura de chamados públicos",
    type: "boolean",
    section: "suporte",
  },
  {
    key: "captcha.site_key",
    description: "Chave pública (site key) do provedor de captcha",
    type: "string",
    section: "suporte",
  },
  {
    key: "captcha.secret_key",
    description: "Chave secreta (secret key) do provedor de captcha",
    type: "string",
    secret: true,
    section: "suporte",
  },
];

const CATALOG_BY_KEY = new Map(SETTINGS_CATALOG.map((item) => [item.key, item]));

router.get("/", requirePermission(PERMISSIONS.SETTINGS_VIEW), async (c) => {
  const user = currentUser(c);
  const includeHidden = url10Flag(c.req.url, "includeHidden") && user.permissions.has(PERMISSIONS.SETTINGS_MANAGE);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT key, value, description, updated_at, updated_by FROM settings ORDER BY key`,
  );
  const known = new Set(SETTINGS_CATALOG.map((item) => item.key));

  return c.json({
    items: rows
      .filter((row) => includeHidden || known.has(String(row.key)))
      .map((row) => {
        const definition = CATALOG_BY_KEY.get(String(row.key)) ?? null;
        return {
          key: String(row.key),
          // Credenciais nunca saem da API; o cliente só sabe se há valor.
          value: definition?.secret ? "" : String(row.value),
          hasValue: String(row.value).length > 0,
          secret: Boolean(definition?.secret),
          description: row.description ? String(row.description) : null,
          definition,
          updatedAt: String(row.updated_at),
          updatedBy: row.updated_by ? String(row.updated_by) : null,
        };
      }),
  });
});

function url10Flag(url: string, name: string): boolean {
  return new URL(url).searchParams.get(name) === "true";
}

const updateBody = z.object({
  values: z.record(z.string().min(1), z.string().max(2000)).refine((obj) => Object.keys(obj).length > 0, {
    message: "Informe ao menos uma configuração.",
  }),
});

/**
 * Atualiza configurações em lote. Somente chaves conhecidas, com valor
 * validado conforme o tipo. Toda alteração vai para o log de auditoria com
 * valor anterior e novo.
 */
router.patch("/", requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, updateBody);
  const ts = nowIso();
  const info = clientInfo(c);

  const statements: D1PreparedStatement[] = [];
  const changes: { key: string; from: string | null; to: string }[] = [];

  for (const [key, rawValue] of Object.entries(body.values)) {
    const definition = CATALOG_BY_KEY.get(key);
    if (!definition) throw badRequest(`Configuração desconhecida: ${key}.`);
    const value = normalizeSettingValue(definition, rawValue);

    const existing = await oneRow<{ value: string }>(c.env.DB, `SELECT value FROM settings WHERE key = ?`, [key]);
    // Auditoria é lida por mais gente que a tela de configurações: credencial
    // entra apenas como estado ("configurado/alterado/removido"), nunca o valor.
    const auditFrom = definition.secret
      ? existing?.value
        ? "[configurado]"
        : ""
      : (existing?.value ?? null);
    const auditTo = definition.secret ? (value === "" ? "[removido]" : "[alterado]") : value;
    changes.push({ key, from: auditFrom, to: auditTo });

    if (existing) {
      statements.push(
        c.env.DB
          .prepare(`UPDATE settings SET value = ?, updated_at = ?, updated_by = ? WHERE key = ?`)
          .bind(value, ts, user.id, key),
      );
    } else {
      statements.push(
        insertStatement(c.env.DB, "settings", {
          key,
          value,
          description: definition.description,
          updated_at: ts,
          updated_by: user.id,
        }),
      );
    }
  }

  statements.push(
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "settings",
      action: "settings.update",
      entityType: "settings",
      after: { changes },
      ...info,
    }),
  );

  await c.env.DB.batch(statements);
  return c.json({ ok: true, changes });
});

function normalizeSettingValue(definition: SettingDefinition, raw: string): string {
  const value = raw.trim();
  switch (definition.type) {
    case "boolean": {
      const normalized = value.toLowerCase();
      if (["true", "1", "sim", "yes"].includes(normalized)) return "true";
      if (["false", "0", "não", "no"].includes(normalized)) return "false";
      throw badRequest(`A configuração ${definition.key} aceita apenas true ou false.`, { received: raw });
    }
    case "enum": {
      if (!definition.options?.includes(value)) {
        throw badRequest(`A configuração ${definition.key} aceita: ${definition.options?.join(", ")}.`, {
          received: raw,
        });
      }
      return value;
    }
    case "integer": {
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) throw badRequest(`A configuração ${definition.key} exige um número inteiro.`);
      if (definition.min !== undefined && parsed < definition.min) {
        throw badRequest(`O valor mínimo para ${definition.key} e ${definition.min}.`);
      }
      if (definition.max !== undefined && parsed > definition.max) {
        throw badRequest(`O valor máximo para ${definition.key} e ${definition.max}.`);
      }
      return String(parsed);
    }
    default: {
      // Credenciais e endereços de e-mail aceitam vazio de propósito: limpar o
      // valor desliga o canal sem exigir trocar o provedor.
      const mayBeEmpty = ["mail.api_key", "mail.relay_url", "mail.relay_secret", "mail.gmail_app_password"];
      if (value.length === 0 && !mayBeEmpty.includes(definition.key)) {
        throw badRequest(`A configuração ${definition.key} não pode ficar vazia.`);
      }
      if (definition.key === "company.timezone") assertIanaTimeZone(value);
      if (definition.key === "mail.relay_url" && value !== "") assertHttpsUrl(value);
      return value;
    }
  }
}

/**
 * `company.timezone` é usado para formatar datas na interface. Um valor
 * inválido quebraria a exibição de todos os horários, então ele e conferido na
 * gravação contra a base de fusos do próprio runtime.
 */
function assertIanaTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
  } catch {
    throw badRequest(`O fuso horário "${value}" não e um identificador IANA válido.`, {
      example: "America/Sao_Paulo",
    });
  }
}

/**
 * O relay recebe o segredo compartilhado em cada chamada; exigir HTTPS evita
 * que a credencial trafegue em claro. O Web App do Apps Script já é HTTPS.
 */
function assertHttpsUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw badRequest(`O valor de mail.relay_url não é uma URL válida.`, {
      example: "https://script.google.com/macros/s/.../exec",
    });
  }
  if (parsed.protocol !== "https:") {
    throw badRequest(`O valor de mail.relay_url precisa começar com https://.`);
  }
}

/** Le uma configuração com valor padrão. Usado por outros módulos. */
export async function getSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  const row = await oneRow<{ value: string }>(db, `SELECT value FROM settings WHERE key = ?`, [key]);
  return row?.value ?? fallback;
}

/* -------------------------------------------------------------------------- */
/* Categorias de ticket                                                       */
/* -------------------------------------------------------------------------- */

const categoryBody = z.object({
  name: z.string().trim().min(3, "Informe o nome da categoria.").max(80),
  code: z.string().trim().max(40).nullish(),
  defaultKind: z.enum(["cleaning", "maintenance", "other"]).optional().default("maintenance"),
  description: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional().default(100),
  isActive: z.boolean().optional().default(true),
});

/**
 * Atualização parcial de categoria. Sem `.partial()` de propósito: o partial
 * do zod reaplicaria os defaults da criação e um PATCH de isActive apagaria
 * defaultKind/sortOrder — e renomear uma categoria inativa a reativaria.
 */
const categoryPatchBody = z.object({
  name: z.string().trim().min(3, "Informe o nome da categoria.").max(80).optional(),
  code: z.string().trim().max(40).nullish(),
  defaultKind: z.enum(["cleaning", "maintenance", "other"]).optional(),
  description: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

router.get("/ticket-categories", requirePermission(PERMISSIONS.SETTINGS_VIEW), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, name, code, default_kind, description, sort_order, is_active, created_at, updated_at
       FROM ticket_categories ORDER BY sort_order, name`,
  );
  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      code: row.code ? String(row.code) : null,
      defaultKind: String(row.default_kind),
      description: row.description ? String(row.description) : null,
      sortOrder: Number(row.sort_order),
      isActive: Number(row.is_active) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
  });
});

router.post("/ticket-categories", requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, categoryBody);
  await assertCategoryNameFree(c.env.DB, body.name, null);

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "ticket_categories", {
      id,
      name: body.name,
      code: body.code ?? null,
      default_kind: body.defaultKind,
      description: body.description ?? null,
      sort_order: body.sortOrder,
      is_active: body.isActive ? 1 : 0,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "settings",
      action: "ticket_category.create",
      entityType: "ticket_category",
      entityId: id,
      after: { name: body.name, defaultKind: body.defaultKind },
      ...info,
    }),
  ]);

  return c.json({ id }, 201);
});

router.patch("/ticket-categories/:id", requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, categoryPatchBody);

  const existing = await oneRow<{ id: string; name: string; is_active: number }>(
    c.env.DB,
    `SELECT id, name, is_active FROM ticket_categories WHERE id = ?`,
    [id],
  );
  if (!existing) throw notFound("Categoria não encontrada.");
  if (body.name) await assertCategoryNameFree(c.env.DB, body.name, id);

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "ticket_categories", id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.code !== undefined ? { code: body.code ?? null } : {}),
      ...(body.defaultKind !== undefined ? { default_kind: body.defaultKind } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { is_active: body.isActive ? 1 : 0 } : {}),
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "settings",
      action: "ticket_category.update",
      entityType: "ticket_category",
      entityId: id,
      before: { name: existing.name, isActive: existing.is_active === 1 },
      after: body,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

async function assertCategoryNameFree(db: D1Database, name: string, ignoreId: string | null): Promise<void> {
  const row = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM ticket_categories WHERE lower(name) = lower(?) AND (? IS NULL OR id != ?)`,
    [name, ignoreId, ignoreId],
  );
  if (row) throw conflict("Já existe uma categoria com este nome.");
}

export default router;
