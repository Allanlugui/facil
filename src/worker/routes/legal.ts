/**
 * LGPD - Rotas de API para registro de base legal e operações de tratamento
 * (Art. 7º, Lei 13.709/2018).
 *
 * Permissões:
 *  - legal.view: leitura de bases legais e operações de tratamento
 *  - legal.manage: criação, edição e desativação
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { badRequest, conflict, parseBody, parseQuery } from "../errors";
import {
  createDataProcessingOperation,
  createLegalBase,
  listDataProcessingOperations,
  listLegalBases,
  updateDataProcessingOperation,
  updateLegalBase,
} from "../legal";


const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas de validação                                                      */
/* -------------------------------------------------------------------------- */

const legalBaseCreateSchema = z.object({
  code: z.string().trim().min(1, "Informe o código da base legal.").max(40),
  name: z.string().trim().min(2, "Informe o nome da base legal.").max(160),
  description: z.string().trim().max(1000).nullish(),
  article_ref: z.string().trim().max(120).nullish(),
});

const legalBaseUpdateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da base legal.").max(160).nullish(),
  description: z.string().trim().max(1000).nullish(),
  article_ref: z.string().trim().max(120).nullish(),
  is_active: z.boolean().nullish(),
});

const dataProcessingOperationCreateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da operação.").max(160),
  description: z.string().trim().max(1000).nullish(),
  legal_base_id: z.string().trim().min(1, "Selecione uma base legal."),
  purpose: z.string().trim().min(5, "Informe a finalidade do tratamento.").max(2000),
  data_categories: z.array(z.string().trim().min(1)).min(1, "Informe ao menos uma categoria de dados."),
  data_subjects: z.array(z.string().trim().min(1)).min(1, "Informe ao menos uma categoria de titular."),
  retention_period: z.string().trim().max(200).nullish(),
  retention_justification: z.string().trim().max(1000).nullish(),
  controller: z.string().trim().max(200).nullish(),
  dpo_contact: z.string().trim().max(200).nullish(),
});

const dataProcessingOperationUpdateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da operação.").max(160).nullish(),
  description: z.string().trim().max(1000).nullish(),
  legal_base_id: z.string().trim().min(1, "Selecione uma base legal.").nullish(),
  purpose: z.string().trim().min(5, "Informe a finalidade do tratamento.").max(2000).nullish(),
  data_categories: z.array(z.string().trim().min(1)).min(1).nullish(),
  data_subjects: z.array(z.string().trim().min(1)).min(1).nullish(),
  retention_period: z.string().trim().max(200).nullish(),
  retention_justification: z.string().trim().max(1000).nullish(),
  controller: z.string().trim().max(200).nullish(),
  dpo_contact: z.string().trim().max(200).nullish(),
  is_active: z.boolean().nullish(),
});

const listQuery = z.object({
  page: z.string().optional().transform((v) => parseInt(v ?? "1", 10)).pipe(z.number().int().min(1)),
  pageSize: z.string().optional().transform((v) => parseInt(v ?? "25", 10)).pipe(z.number().int().min(1).max(200)),
  legal_base_id: z.string().optional(),
  is_active: z.string().optional().transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  search: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Bases legais                                                               */
/* -------------------------------------------------------------------------- */

router.get("/bases/catalog", requirePermission("legal.view"), async (c) => {
  const bases = await listLegalBases(c.env.DB);
  return c.json({ items: bases, total: bases.length });
});

router.post("/bases", requirePermission("legal.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, legalBaseCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  try {
    const created = await createLegalBase(c.env.DB, input, user.id, user.name, meta);
    return c.json({ item: created }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Já existe")) {
      throw conflict(err.message);
    }
    throw err;
  }
});

router.patch("/bases/:id", requirePermission("legal.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador da base legal é obrigatório.");
  const input = await parseBody(c, legalBaseUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateLegalBase(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

/* -------------------------------------------------------------------------- */
/* Operações de tratamento de dados pessoais                                  */
/* -------------------------------------------------------------------------- */

router.get("/operations", requirePermission("legal.view"), async (c) => {
  const { page, pageSize, legal_base_id, is_active, search } = parseQuery(c, listQuery);

  const { items, total } = await listDataProcessingOperations(
    c.env.DB,
    { page, pageSize },
    { legalBaseId: legal_base_id, isActive: is_active, search },
  );
  return c.json({ items, total });
});

router.post("/operations", requirePermission("legal.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, dataProcessingOperationCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const created = await createDataProcessingOperation(
    c.env.DB,
    input,
    user.id,
    user.name,
    meta,
  );
  return c.json({ item: created }, 201);
});

router.patch("/operations/:id", requirePermission("legal.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador da operação é obrigatório.");
  const input = await parseBody(c, dataProcessingOperationUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateDataProcessingOperation(
    c.env.DB,
    param,
    input,
    user.id,
    user.name,
    meta,
  );
  return c.json({ item: updated });
});

export default router;
