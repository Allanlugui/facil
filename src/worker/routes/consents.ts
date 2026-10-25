/**
 * LGPD - Rotas de API para titulares de dados e consentimentos (Art. 8º,
 * Lei 13.709/2018).
 *
 * Permissões:
 *  - consent.view: leitura de titulares e consentimentos
 *  - consent.manage: criação, edição e revogação
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { badRequest, conflict, parseBody, parseQuery } from "../errors";
import {
  createConsent,
  createDataSubject,
  listConsents,
  listConsentsForSubject,
  listDataSubjects,
  revokeConsent,
  updateConsent,
  updateDataSubject,
} from "../consents";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas de validação                                                      */
/* -------------------------------------------------------------------------- */

const dataSubjectCreateSchema = z.object({
  code: z.string().trim().min(1, "Informe o código do titular.").max(40),
  name: z.string().trim().min(2, "Informe o nome do titular.").max(160),
  email: z.string().trim().email().max(200).nullish(),
  document: z.string().trim().max(30).nullish(),
  role: z.string().trim().max(40).nullish().default("cliente"),
});

const dataSubjectUpdateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do titular.").max(160).nullish(),
  email: z.string().trim().email().max(200).nullish(),
  document: z.string().trim().max(30).nullish(),
  role: z.string().trim().max(40).nullish(),
  is_active: z.boolean().nullish(),
});

const consentCreateSchema = z.object({
  data_subject_id: z.string().trim().min(1, "Selecione o titular."),
  operation_id: z.string().trim().min(1, "Selecione a operação de tratamento."),
  legal_base_id: z.string().trim().min(1, "Selecione a base legal."),
  medium: z.enum(["written", "electronic", "verbal", "form"]),
  text_version: z.string().trim().min(1, "Informe a versão do texto apresentado.").max(100),
  highlighted_clause: z.boolean(),
  ip_address: z.string().trim().max(60).nullish(),
  user_agent: z.string().trim().max(300).nullish(),
});

const consentUpdateSchema = z.object({
  medium: z.enum(["written", "electronic", "verbal", "form"]).nullish(),
  text_version: z.string().trim().min(1).max(100).nullish(),
  highlighted_clause: z.boolean().nullish(),
  ip_address: z.string().trim().max(60).nullish(),
  user_agent: z.string().trim().max(300).nullish(),
});

const consentRevokeSchema = z.object({
  revocation_reason: z.string().trim().max(500).nullish(),
});

const listConsentsQuery = z.object({
  page: z.string().optional().transform((v) => parseInt(v ?? "1", 10)).pipe(z.number().int().min(1)),
  pageSize: z.string().optional().transform((v) => parseInt(v ?? "25", 10)).pipe(z.number().int().min(1).max(200)),
  data_subject_id: z.string().optional(),
  operation_id: z.string().optional(),
  status: z.string().optional(),
  medium: z.string().optional(),
  search: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Titulares de dados                                                         */
/* -------------------------------------------------------------------------- */

router.get("/subjects", requirePermission("consent.view"), async (c) => {
  const subjects = await listDataSubjects(c.env.DB);
  return c.json({ items: subjects, total: subjects.length });
});

router.post("/subjects", requirePermission("consent.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, dataSubjectCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  try {
    const created = await createDataSubject(c.env.DB, input, user.id, user.name, meta);
    return c.json({ item: created }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Já existe")) {
      throw conflict(err.message);
    }
    throw err;
  }
});

router.patch("/subjects/:id", requirePermission("consent.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador do titular é obrigatório.");
  const input = await parseBody(c, dataSubjectUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateDataSubject(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

/* -------------------------------------------------------------------------- */
/* Consentimentos                                                             */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission("consent.view"), async (c) => {
  const { page, pageSize, data_subject_id, operation_id, status, medium, search } =
    parseQuery(c, listConsentsQuery);

  const { items, total } = await listConsents(c.env.DB, { page, pageSize }, {
    search,
    ...(data_subject_id ? { dataSubjectId: data_subject_id } : {}),
    ...(operation_id ? { operationId: operation_id } : {}),
    ...(status ? { status } : {}),
    ...(medium ? { medium } : {}),
  });
  return c.json({ items, total });
});

router.get("/subjects/:subjectId/consents", requirePermission("consent.view"), async (c) => {
  const { subjectId } = c.req.param();
  if (!subjectId || !subjectId.trim()) throw badRequest("Identificador do titular é obrigatório.");
  const items = await listConsentsForSubject(c.env.DB, subjectId);
  return c.json({ items, total: items.length });
});

router.post("/", requirePermission("consent.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, consentCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const created = await createConsent(c.env.DB, input, user.id, user.name, meta);
  return c.json({ item: created }, 201);
});

router.patch("/:id", requirePermission("consent.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador do consentimento é obrigatório.");
  const input = await parseBody(c, consentUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateConsent(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

router.post("/:id/revoke", requirePermission("consent.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador do consentimento é obrigatório.");
  const input = await parseBody(c, consentRevokeSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const revoked = await revokeConsent(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: revoked });
});

export default router;
