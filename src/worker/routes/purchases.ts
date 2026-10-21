import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import { PURCHASE_STATUS_LABEL } from "@shared/types";
import type { AppContext, AppEnv } from "../types";
import { assertLocationAllowed, currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow, updateStatement } from "../db";
import { badRequest, conflict, notFound, parseBody } from "../errors";
import { assertPurchaseVisible, purchaseVisibility } from "../purchase-access";
import { outboxStatement } from "../outbox";
import { recordMovements, type MovementRequest } from "../stock";
import { notificationStatement, notificationStatements, usersWithPermission } from "../notify";
import { buildCode, nextCounter, nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas                                                                   */
/* -------------------------------------------------------------------------- */

const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const DECISION_LABEL: Record<string, string> = {
  approved: "aprovada",
  rejected: "rejeitada",
  quoting: "em cotação",
  purchasing: "em compra",
};

/** Texto registrado quando a política dispensa a aprovação formal. */
const AUTO_APPROVAL_NOTE =
  "Aprovação automática: a configuração `purchases.require_approval` esta desativada.";

/**
 * Política de aprovação configurada em `settings.purchases.require_approval`.
 * Desativada, a solicitação enviada já entra aprovada -- e a decisão fica
 * registrada na auditoria, nunca silenciosa.
 */
async function approvalRequired(db: D1Database): Promise<boolean> {
  const row = await oneRow<{ value: string }>(
    db,
    `SELECT value FROM settings WHERE key = 'purchases.require_approval'`,
  );
  return row?.value !== "false";
}

const requestItemSchema = z.object({
  productId: z.string().trim().min(1).nullish(),
  description: z.string().trim().max(300).nullish(),
  qty: z.number().finite().positive("Informe uma quantidade maior que zero."),
  uomId: z.string().trim().min(1).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

const createBody = z.object({
  locationId: z.string().trim().min(1).nullish(),
  justification: z.string().trim().max(1000).nullish(),
  priority: prioritySchema.optional().default("normal"),
  desiredDate: z.string().trim().max(20).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /**
   * 1 = fluxo legado (uma aprovação); 2 = fluxo corporativo em duas etapas.
   * O padrão é 2 para todo cliente novo. Testes e integrações antigas podem
   * declarar 1 explicitamente durante a migração.
   */
  workflowVersion: z.union([z.literal(1), z.literal(2)]).optional().default(2),
  costCenterId: z.string().trim().min(1).nullish(),
  glAccount: z.string().trim().max(40).nullish(),
  budgetNotes: z.string().trim().max(1000).nullish(),
  items: z
    .array(requestItemSchema)
    .min(1, "Inclua ao menos um item.")
    .max(100, "Limite de 100 itens por solicitação."),
  /** Rascunho não entra na fila de aprovação. */
  submit: z.boolean().optional().default(false),
});

const updateBody = z.object({
  locationId: z.string().trim().min(1).nullish(),
  justification: z.string().trim().max(1000).nullish(),
  priority: prioritySchema.optional(),
  desiredDate: z.string().trim().max(20).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  costCenterId: z.string().trim().min(1).nullish(),
  glAccount: z.string().trim().max(40).nullish(),
  budgetNotes: z.string().trim().max(1000).nullish(),
});

const decideBody = z.object({
  decision: z.enum([
    "approved",
    "rejected",
    "quoting",
    "purchasing",
    "send_to_purchasing",
    "send_to_direction",
    "authorize_direct",
  ]),
  notes: z.string().trim().max(1000).nullish(),
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        status: z.enum(["approved", "rejected", "cancelled"]).optional(),
        qtyApproved: z.number().finite().nonnegative().optional(),
        /** F-01: direta ou cotação; sem marcação o item segue a cotação. */
        purchaseMode: z.enum(["direct", "quote"]).optional(),
        notes: z.string().trim().max(500).nullish(),
      }),
    )
    .max(100)
    .optional(),
});

const quoteBody = z.object({
  supplierId: z.string().trim().min(1, "Selecione o fornecedor."),
  notes: z.string().trim().max(1000).nullish(),
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        unitPrice: z.number().finite().nonnegative("Informe o preço unitário da proposta."),
        qty: z.number().finite().positive("Quantidade inválida na proposta.").optional(),
        notes: z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, "Inclua ao menos um item na proposta.")
    .max(100),
});

const quoteDecisionBody = z.object({
  notes: z.string().trim().max(1000).nullish(),
});

const orderBody = z.object({
  supplierId: z.string().trim().min(1, "Selecione o fornecedor."),
  orderRef: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  items: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        qtyOrdered: z.number().finite().positive("Informe uma quantidade maior que zero."),
        unitPrice: z.number().finite().nonnegative("Preço inválido.").optional(),
      }),
    )
    .min(1, "Selecione ao menos um item para pedido.")
    .max(100),
});

const awardBody = z.object({
  notes: z.string().trim().max(1000).nullish(),
  awards: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        quoteId: z.string().trim().min(1),
        qty: z.number().finite().positive().optional(),
        notes: z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, "Selecione ao menos um item para adjudicar.")
    .max(100),
});

const multiOrderBody = z.object({
  notes: z.string().trim().max(1000).nullish(),
  orders: z
    .array(
      z.object({
        supplierId: z.string().trim().min(1, "Selecione o fornecedor."),
        orderRef: z.string().trim().max(80).nullish(),
        notes: z.string().trim().max(1000).nullish(),
        items: z
          .array(
            z.object({
              itemId: z.string().trim().min(1),
              qtyOrdered: z.number().finite().positive("Informe uma quantidade maior que zero."),
              unitPrice: z.number().finite().nonnegative("Preço inválido.").optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
    )
    .min(1, "Inclua ao menos um pedido.")
    .max(30),
});

const receiptBody = z.object({
  requestKey: z.string().trim().min(8, "Identificador de requisição inválido.").max(120),
  locationId: z.string().trim().min(1, "Informe o local de destino do material."),
  purchaseOrderId: z.string().trim().min(1).nullish(),
  receivedAt: z.string().trim().max(40).nullish(),
  documentRef: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /**
   * F-06 (uso direto): justificativa única do recebimento quando um ou mais
   * itens entram e já saem para uso -- a saída vira movimentação de consumo no
   * mesmo lote, mantendo o rastro contábil de entrada e saída.
   */
  directUseReason: z.string().trim().max(500).nullish(),
  items: z
    .array(
      z.object({
        requestItemId: z.string().trim().min(1, "Selecione o item da solicitação."),
        receivedQty: z.number().finite().positive("Informe a quantidade recebida."),
        unitPrice: z.number().finite().nonnegative().optional(),
        hasDiscrepancy: z.boolean().optional().default(false),
        discrepancyNote: z.string().trim().max(500).nullish(),
        notes: z.string().trim().max(500).nullish(),
        /** F-06: este item do recebimento segue direto para uso. */
        directUse: z.boolean().optional().default(false),
        /**
         * Cadastro rápido: item sem produto no catálogo pode ser recebido
         * criando o produto aqui mesmo, apenas com o nome. Ele nasce marcado
         * como incompleto até a correção no catálogo.
         */
        newProduct: z
          .object({
            name: z.string().trim().min(2, "Informe o nome do produto.").max(160),
            uomId: z.string().trim().min(1).nullish(),
          })
          .nullish(),
      }),
    )
    .min(1, "Informe ao menos um item recebido.")
    .max(100),
});

const cancelBody = z.object({
  reason: z.string().trim().min(5, "Explique o motivo do cancelamento.").max(500),
});

/* -------------------------------------------------------------------------- */
/* Consultas                                                                  */
/* -------------------------------------------------------------------------- */

const REQUEST_SELECT = `
  SELECT r.id, r.code, r.requester_id, r.location_id, r.justification, r.priority, r.status,
         r.desired_date, r.approved_by, r.approved_at, r.approval_notes, r.cancel_reason,
         r.notes, r.created_at, r.updated_at,
         r.workflow_version, r.approval_stage, r.routing, r.budget_status, r.budget_notes,
         r.cost_center_id, r.gl_account, r.external_ref, r.finance_status,
         r.manager_approved_by, r.manager_approved_at,
         r.direction_approved_by, r.direction_approved_at,
         r.direct_authorized_by, r.direct_authorized_at,
         l.name AS location_name, l.path AS location_path,
         rq.name AS requester_name,
         ap.name AS approved_by_name,
         cc.code AS cost_center_code, cc.name AS cost_center_name,
         mg.name AS manager_approved_by_name,
         dg.name AS direction_approved_by_name,
         da.name AS direct_authorized_by_name,
         (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = r.id) AS item_count,
         (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = r.id AND i.status = 'pending') AS pending_item_count,
         (SELECT COUNT(*) FROM purchase_request_items i WHERE i.request_id = r.id AND i.purchase_mode = 'quote'
           AND i.status NOT IN ('rejected','cancelled')) AS quote_item_count,
         (SELECT COUNT(*) FROM purchase_quotes q WHERE q.request_id = r.id AND q.status IN ('registered','approved')) AS quote_count,
         (SELECT COUNT(*) FROM purchase_receipts rc WHERE rc.request_id = r.id AND rc.status = 'confirmed') AS receipt_count,
         (SELECT COALESCE(SUM(i.qty_received_milli), 0) FROM purchase_request_items i
           WHERE i.request_id = r.id) AS received_qty_milli,
         (SELECT COALESCE(SUM(COALESCE(i.qty_ordered_milli, i.qty_approved_milli, i.qty_milli)), 0)
            FROM purchase_request_items i WHERE i.request_id = r.id) AS expected_qty_milli,
         (SELECT COALESCE(SUM(mo.qty_milli), 0) FROM movements mo
           WHERE mo.ref_type = 'purchase_receipt'
             AND mo.ref_id IN (SELECT rc2.id FROM purchase_receipts rc2 WHERE rc2.request_id = r.id)) AS stocked_qty_milli
    FROM purchase_requests r
    LEFT JOIN locations l ON l.id = r.location_id
    JOIN users rq ON rq.id = r.requester_id
    LEFT JOIN users ap ON ap.id = r.approved_by
    LEFT JOIN cost_centers cc ON cc.id = r.cost_center_id
    LEFT JOIN users mg ON mg.id = r.manager_approved_by
    LEFT JOIN users dg ON dg.id = r.direction_approved_by
    LEFT JOIN users da ON da.id = r.direct_authorized_by`;

router.get("/", requirePermission(PERMISSIONS.PURCHASES_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const status = url.searchParams.get("status")?.trim();
  const priority = url.searchParams.get("priority")?.trim();
  const requesterId = url.searchParams.get("requesterId")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const pendingApproval = url.searchParams.get("pendingApproval") === "true";
  const stage = url.searchParams.get("stage")?.trim();
  const mine = url.searchParams.get("mine") === "true";
  const visibility = purchaseVisibility(user, "r");
  if (visibility.clause) {
    clauses.push(visibility.clause);
    params.push(...visibility.params);
  }

  if (status) {
    clauses.push("r.status = ?");
    params.push(status);
  }
  if (stage) {
    clauses.push("r.approval_stage = ?");
    params.push(stage);
  }
  if (mine) {
    clauses.push("r.requester_id = ?");
    params.push(user.id);
  }
  if (pendingApproval) {
    clauses.push("r.status = 'pending_approval'");
    if (!stage) {
      // Cada perfil vê a fila da etapa que pode decidir; o legado continua
      // aparecendo para quem aprova a solicitação.
      if (user.permissions.has(PERMISSIONS.PURCHASES_AUTHORIZE) && !user.permissions.has(PERMISSIONS.PURCHASES_APPROVE)) {
        clauses.push("r.approval_stage = 'direction'");
      } else if (user.permissions.has(PERMISSIONS.PURCHASES_DIRECT) && !user.permissions.has(PERMISSIONS.PURCHASES_APPROVE)) {
        clauses.push("r.approval_stage = 'purchasing'");
      } else {
        clauses.push("r.approval_stage IN ('manager','direction','purchasing')");
      }
    }
  }
  if (priority) {
    clauses.push("r.priority = ?");
    params.push(priority);
  }
  if (requesterId) {
    clauses.push("r.requester_id = ?");
    params.push(requesterId);
  }
  if (search) {
    clauses.push("(r.code LIKE ? OR COALESCE(r.justification,'') LIKE ? OR COALESCE(r.notes,'') LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM purchase_requests r ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${REQUEST_SELECT} ${where}
      ORDER BY CASE r.status WHEN 'pending_approval' THEN 0 WHEN 'draft' THEN 1
                             WHEN 'partially_received' THEN 2 WHEN 'ordered' THEN 3 ELSE 4 END,
               CASE r.approval_stage WHEN 'manager' THEN 0 WHEN 'direction' THEN 1
                                     WHEN 'purchasing' THEN 2 WHEN 'award' THEN 3 ELSE 4 END,
               r.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  return c.json({ items: rows.map(mapRequest), total, page: page.page, pageSize: page.pageSize });
});

/**
 * Visão financeira e filas do fluxo corporativo. Os números respeitam a mesma
 * visibilidade da lista: solicitante vê o que é seu; gestor/direção/compras
 * veem a fila inteira dentro do escopo de local.
 */
router.get("/overview", requirePermission(PERMISSIONS.PURCHASES_VIEW), async (c) => {
  const user = currentUser(c);
  const visibility = purchaseVisibility(user, "r");
  const where = visibility.clause ? `WHERE ${visibility.clause}` : "";

  const counts = await oneRow<Record<string, number>>(
    c.env.DB,
    `SELECT
       SUM(CASE WHEN r.status = 'pending_approval' AND r.approval_stage = 'manager' THEN 1 ELSE 0 END) AS manager_queue,
       SUM(CASE WHEN r.status = 'pending_approval' AND r.approval_stage = 'direction' THEN 1 ELSE 0 END) AS direction_queue,
       SUM(CASE WHEN r.status = 'pending_approval' AND r.approval_stage = 'purchasing' THEN 1 ELSE 0 END) AS purchasing_queue,
       SUM(CASE WHEN r.status IN ('approved','quoting','quote_approved') AND r.approval_stage = 'buyer' THEN 1 ELSE 0 END) AS buyer_queue,
       SUM(CASE WHEN r.status = 'quote_returned' THEN 1 ELSE 0 END) AS award_queue,
       SUM(CASE WHEN r.status IN ('ordered','partially_received') THEN 1 ELSE 0 END) AS receipt_queue,
       SUM(CASE WHEN r.status = 'quoting' THEN 1 ELSE 0 END) AS quoting_count,
       SUM(CASE WHEN r.status NOT IN ('received','cancelled','rejected') THEN 1 ELSE 0 END) AS open_count,
       COUNT(*) AS total_count
     FROM purchase_requests r ${where}`,
    visibility.params,
  );

  const financial = await oneRow<Record<string, number>>(
    c.env.DB,
    `SELECT
       COALESCE((SELECT SUM(po.total_cents) FROM purchase_orders po
                  JOIN purchase_requests r ON r.id = po.request_id
                  ${where ? `${where} AND` : "WHERE"} po.status <> 'cancelled'), 0) AS committed_cents,
       COALESCE((SELECT SUM(poi.qty_milli * poi.unit_price_cents / 1000)
                   FROM purchase_order_items poi
                   JOIN purchase_orders po ON po.id = poi.order_id
                   JOIN purchase_requests r ON r.id = po.request_id
                  ${where ? `${where} AND` : "WHERE"} po.status <> 'cancelled'), 0) AS ordered_value_cents,
       COALESCE((SELECT SUM(i.qty_approved_milli * COALESCE(i.unit_price_cents, 0) / 1000)
                   FROM purchase_request_items i
                   JOIN purchase_requests r ON r.id = i.request_id
                  ${where ? `${where} AND` : "WHERE"} i.status = 'approved'), 0) AS approved_value_cents`,
    visibility.params,
  );

  const costCenters = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name FROM cost_centers WHERE is_active = 1 ORDER BY code`,
  );

  return c.json({
    queues: {
      manager: Number(counts?.manager_queue ?? 0),
      direction: Number(counts?.direction_queue ?? 0),
      purchasing: Number(counts?.purchasing_queue ?? 0),
      buyer: Number(counts?.buyer_queue ?? 0),
      award: Number(counts?.award_queue ?? 0),
      receipt: Number(counts?.receipt_queue ?? 0),
      quoting: Number(counts?.quoting_count ?? 0),
    },
    openCount: Number(counts?.open_count ?? 0),
    totalCount: Number(counts?.total_count ?? 0),
    financial: {
      committedCents: Number(financial?.committed_cents ?? 0),
      orderedValueCents: Number(financial?.ordered_value_cents ?? 0),
      approvedValueCents: Number(financial?.approved_value_cents ?? 0),
    },
    costCenters: costCenters.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
    })),
  });
});

router.get("/cost-centers", requirePermission(PERMISSIONS.PURCHASES_VIEW), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, code, name FROM cost_centers WHERE is_active = 1 ORDER BY code`,
  );
  return c.json({
    items: rows.map((row) => ({ id: String(row.id), code: String(row.code), name: String(row.name) })),
  });
});

const REQUEST_ITEM_SELECT = `
  SELECT i.id, i.request_id, i.product_id, i.description, i.qty_milli, i.uom_id,
         i.qty_approved_milli, i.qty_ordered_milli, i.qty_received_milli,
         i.supplier_id, i.order_ref, i.unit_price_cents, i.purchase_mode, i.status, i.notes,
         p.name AS product_name, p.sku,
         COALESCE(u2.code, u.code) AS uom_code,
         s.name AS supplier_name
    FROM purchase_request_items i
    LEFT JOIN products p ON p.id = i.product_id
    LEFT JOIN uoms u ON u.id = i.uom_id
    LEFT JOIN products p2 ON p2.id = i.product_id
    LEFT JOIN uoms u2 ON u2.id = p2.uom_id
    LEFT JOIN suppliers s ON s.id = i.supplier_id`;

router.get("/:id", requirePermission(PERMISSIONS.PURCHASES_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<Record<string, unknown>>(c.env.DB, `${REQUEST_SELECT} WHERE r.id = ?`, [id]);
  if (!row) throw notFound("Solicitação de compra não encontrada.");
  assertPurchaseVisible(user, {
    requester_id: String(row.requester_id),
    location_id: row.location_id ? String(row.location_id) : null,
  });

  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${REQUEST_ITEM_SELECT} WHERE i.request_id = ? ORDER BY i.created_at, i.id`,
    [id],
  );

  const receipts = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT rc.id, rc.code, rc.received_at, rc.document_ref, rc.notes, rc.status, rc.cancel_reason,
            rc.received_by, u.name AS received_by_name, s.name AS supplier_name,
            (SELECT COUNT(*) FROM purchase_receipt_items ri WHERE ri.receipt_id = rc.id) AS item_count,
            (SELECT COALESCE(SUM(ri.qty_milli), 0) FROM purchase_receipt_items ri WHERE ri.receipt_id = rc.id) AS qty_milli,
            (SELECT COUNT(*) FROM purchase_receipt_items ri WHERE ri.receipt_id = rc.id AND ri.has_discrepancy = 1) AS discrepancy_count,
            (SELECT COUNT(*) FROM movements m
               WHERE m.ref_type = 'purchase_receipt' AND m.ref_id = rc.id AND m.type = 'consumption') AS direct_use_count
       FROM purchase_receipts rc
       JOIN users u ON u.id = rc.received_by
       LEFT JOIN suppliers s ON s.id = rc.supplier_id
      WHERE rc.request_id = ?
      ORDER BY rc.received_at DESC`,
    [id],
  );

  // Linha do tempo (F-05): derivada da auditoria, que grava cada passo na mesma
  // transacao da operacao -- criacao, decisoes, propostas, pedido, cancelamento
  // e recebimentos aparecem na ordem real, com autor e horario.
  const timeline = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.created_at, a.actor_name, a.action, a.entity_type, a.entity_id, a.reason, a.after_json
       FROM audit_log a
      WHERE a.module = 'purchases'
        AND (
          (a.entity_type = 'purchase_request' AND a.entity_id = ?)
          OR (a.entity_type = 'purchase_quote'
              AND a.entity_id IN (SELECT q.id FROM purchase_quotes q WHERE q.request_id = ?))
          OR (a.entity_type = 'purchase_receipt'
              AND a.entity_id IN (SELECT rc2.id FROM purchase_receipts rc2 WHERE rc2.request_id = ?))
          OR (a.entity_type = 'purchase_order'
              AND a.entity_id IN (SELECT po.id FROM purchase_orders po WHERE po.request_id = ?))
        )
      ORDER BY a.created_at, a.rowid
      LIMIT 200`,
    [id, id, id, id],
  );

  // Propostas de cotação (F-02) com os valores por item, para comparação e
  // aprovação pelo gestor direto na tela da solicitação.
  const quotes = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT q.id, q.code, q.supplier_id, q.status, q.notes,
            q.created_by, q.approved_by, q.approved_at, q.approval_notes,
            q.created_at, q.updated_at,
            s.name AS supplier_name,
            cu.name AS created_by_name,
            au.name AS approved_by_name
       FROM purchase_quotes q
       JOIN suppliers s ON s.id = q.supplier_id
       JOIN users cu ON cu.id = q.created_by
       LEFT JOIN users au ON au.id = q.approved_by
      WHERE q.request_id = ?
      ORDER BY q.created_at, q.id`,
    [id],
  );

  const quoteItems = quotes.length
    ? await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT qi.id, qi.quote_id, qi.request_item_id, qi.qty_milli, qi.unit_price_cents, qi.notes,
                i.description AS item_description,
                p.name AS product_name, p.sku, COALESCE(u2.code, u.code) AS uom_code
           FROM purchase_quote_items qi
           JOIN purchase_request_items i ON i.id = qi.request_item_id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN uoms u ON u.id = i.uom_id
           LEFT JOIN products p2 ON p2.id = i.product_id
           LEFT JOIN uoms u2 ON u2.id = p2.uom_id
          WHERE qi.quote_id IN (${quotes.map(() => "?").join(",")})
          ORDER BY qi.created_at, qi.id`,
        quotes.map((q) => String(q.id)),
      )
    : [];

  const quoteItemsByQuote = new Map<string, Record<string, unknown>[]>();
  for (const item of quoteItems) {
    const key = String(item.quote_id);
    const list = quoteItemsByQuote.get(key) ?? [];
    list.push({
      id: String(item.id),
      requestItemId: String(item.request_item_id),
      qtyMilli: Number(item.qty_milli),
      unitPriceCents: Number(item.unit_price_cents),
      notes: item.notes ? String(item.notes) : null,
      productName: item.product_name ? String(item.product_name) : null,
      sku: item.sku ? String(item.sku) : null,
      description: item.item_description ? String(item.item_description) : null,
      uomCode: item.uom_code ? String(item.uom_code) : null,
    });
    quoteItemsByQuote.set(key, list);
  }

  const awards = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.request_item_id, a.quote_id, a.supplier_id, a.qty_milli,
            a.unit_price_cents, a.awarded_by, a.awarded_at, a.notes,
            s.name AS supplier_name, q.code AS quote_code,
            u.name AS awarded_by_name,
            i.description AS item_description,
            p.name AS product_name, p.sku,
            COALESCE(u2.code, uu.code) AS uom_code
       FROM purchase_awards a
       JOIN suppliers s ON s.id = a.supplier_id
       JOIN purchase_quotes q ON q.id = a.quote_id
       JOIN users u ON u.id = a.awarded_by
       JOIN purchase_request_items i ON i.id = a.request_item_id
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN uoms uu ON uu.id = i.uom_id
       LEFT JOIN products p2 ON p2.id = i.product_id
       LEFT JOIN uoms u2 ON u2.id = p2.uom_id
      WHERE a.request_id = ?
      ORDER BY a.awarded_at, a.id`,
    [id],
  );

  const orders = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT po.id, po.code, po.supplier_id, po.order_ref, po.status, po.currency,
            po.total_cents, po.cost_center_id, po.gl_account, po.external_system,
            po.external_id, po.external_status, po.sync_status, po.sync_error,
            po.notes, po.created_by, po.created_at, po.updated_at,
            s.name AS supplier_name, u.name AS created_by_name,
            (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.order_id = po.id) AS item_count,
            (SELECT COALESCE(SUM(poi.qty_milli), 0) FROM purchase_order_items poi
              WHERE poi.order_id = po.id) AS qty_milli
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN users u ON u.id = po.created_by
      WHERE po.request_id = ?
      ORDER BY po.created_at, po.id`,
    [id],
  );

  const orderItems = orders.length
    ? await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT poi.id, poi.order_id, poi.request_item_id, poi.qty_milli,
                poi.unit_price_cents, poi.received_qty_milli, poi.notes,
                i.description AS item_description,
                p.name AS product_name, p.sku,
                COALESCE(u2.code, uu.code) AS uom_code
           FROM purchase_order_items poi
           JOIN purchase_request_items i ON i.id = poi.request_item_id
           LEFT JOIN products p ON p.id = i.product_id
           LEFT JOIN uoms uu ON uu.id = i.uom_id
           LEFT JOIN products p2 ON p2.id = i.product_id
           LEFT JOIN uoms u2 ON u2.id = p2.uom_id
          WHERE poi.order_id IN (${orders.map(() => "?").join(",")})
          ORDER BY poi.created_at, poi.id`,
        orders.map((order) => String(order.id)),
      )
    : [];

  const orderItemsByOrder = new Map<string, Record<string, unknown>[]>();
  for (const item of orderItems) {
    const key = String(item.order_id);
    const list = orderItemsByOrder.get(key) ?? [];
    list.push({
      id: String(item.id),
      requestItemId: String(item.request_item_id),
      productName: item.product_name ? String(item.product_name) : null,
      sku: item.sku ? String(item.sku) : null,
      description: item.item_description ? String(item.item_description) : null,
      uomCode: item.uom_code ? String(item.uom_code) : null,
      qtyMilli: Number(item.qty_milli),
      unitPriceCents: Number(item.unit_price_cents),
      receivedQtyMilli: Number(item.received_qty_milli ?? 0),
      notes: item.notes ? String(item.notes) : null,
    });
    orderItemsByOrder.set(key, list);
  }

  return c.json({
    request: mapRequest(row),
    items: items.map(mapRequestItem),
    quotes: quotes.map((q) => {
      const qItems = quoteItemsByQuote.get(String(q.id)) ?? [];
      return {
        id: String(q.id),
        code: String(q.code),
        supplierId: String(q.supplier_id),
        supplierName: String(q.supplier_name),
        status: String(q.status),
        notes: q.notes ? String(q.notes) : null,
        createdBy: String(q.created_by),
        createdByName: String(q.created_by_name),
        approvedBy: q.approved_by ? String(q.approved_by) : null,
        approvedByName: q.approved_by_name ? String(q.approved_by_name) : null,
        approvedAt: q.approved_at ? String(q.approved_at) : null,
        approvalNotes: q.approval_notes ? String(q.approval_notes) : null,
        createdAt: String(q.created_at),
        updatedAt: String(q.updated_at),
        items: qItems,
        totalCents: qItems.reduce(
          (sum, line) => sum + Math.round((Number(line.unitPriceCents) * Number(line.qtyMilli)) / 1000),
          0,
        ),
      };
    }),
    receipts: receipts.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      receivedAt: String(r.received_at),
      receivedBy: String(r.received_by),
      receivedByName: String(r.received_by_name),
      supplierName: r.supplier_name ? String(r.supplier_name) : null,
      documentRef: r.document_ref ? String(r.document_ref) : null,
      notes: r.notes ? String(r.notes) : null,
      status: String(r.status),
      cancelReason: r.cancel_reason ? String(r.cancel_reason) : null,
      itemCount: Number(r.item_count ?? 0),
      qtyMilli: Number(r.qty_milli ?? 0),
      discrepancyCount: Number(r.discrepancy_count ?? 0),
      directUseCount: Number(r.direct_use_count ?? 0),
    })),
    awards: awards.map((award) => ({
      id: String(award.id),
      requestItemId: String(award.request_item_id),
      quoteId: String(award.quote_id),
      quoteCode: String(award.quote_code),
      supplierId: String(award.supplier_id),
      supplierName: String(award.supplier_name),
      qtyMilli: Number(award.qty_milli),
      unitPriceCents: Number(award.unit_price_cents),
      awardedBy: String(award.awarded_by),
      awardedByName: String(award.awarded_by_name),
      awardedAt: String(award.awarded_at),
      notes: award.notes ? String(award.notes) : null,
      productName: award.product_name ? String(award.product_name) : null,
      sku: award.sku ? String(award.sku) : null,
      description: award.item_description ? String(award.item_description) : null,
      uomCode: award.uom_code ? String(award.uom_code) : null,
    })),
    orders: orders.map((order) => ({
      id: String(order.id),
      code: String(order.code),
      supplierId: String(order.supplier_id),
      supplierName: String(order.supplier_name),
      orderRef: order.order_ref ? String(order.order_ref) : null,
      status: String(order.status),
      currency: String(order.currency),
      totalCents: Number(order.total_cents),
      costCenterId: order.cost_center_id ? String(order.cost_center_id) : null,
      glAccount: order.gl_account ? String(order.gl_account) : null,
      externalSystem: order.external_system ? String(order.external_system) : null,
      externalId: order.external_id ? String(order.external_id) : null,
      externalStatus: order.external_status ? String(order.external_status) : null,
      syncStatus: String(order.sync_status),
      syncError: order.sync_error ? String(order.sync_error) : null,
      notes: order.notes ? String(order.notes) : null,
      createdBy: String(order.created_by),
      createdByName: String(order.created_by_name),
      createdAt: String(order.created_at),
      updatedAt: String(order.updated_at),
      itemCount: Number(order.item_count ?? 0),
      qtyMilli: Number(order.qty_milli ?? 0),
      items: orderItemsByOrder.get(String(order.id)) ?? [],
    })),
    timeline: timeline.map((entry) => {
      let after: Record<string, unknown> = {};
      try {
        after = entry.after_json ? (JSON.parse(String(entry.after_json)) as Record<string, unknown>) : {};
      } catch {
        after = {};
      }
      return {
        at: String(entry.created_at),
        actor: String(entry.actor_name),
        action: String(entry.action),
        entityId: entry.entity_id ? String(entry.entity_id) : null,
        code: typeof after.code === "string" ? after.code : null,
        supplierId: typeof after.supplierId === "string" ? after.supplierId : null,
        orderRef: typeof after.orderRef === "string" ? after.orderRef : null,
        note: entry.reason ? String(entry.reason) : null,
      };
    }),
  });
});

router.get("/:id/receipts", requirePermission(PERMISSIONS.PURCHASES_VIEW), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  const receipts = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT rc.id, rc.code, rc.received_at, rc.document_ref, rc.notes, rc.status,
            rc.received_by, u.name AS received_by_name
       FROM purchase_receipts rc JOIN users u ON u.id = rc.received_by
      WHERE rc.request_id = ? ORDER BY rc.received_at DESC`,
    [id],
  );
  if (receipts.length === 0) return c.json({ items: [] });

  const ids = receipts.map((r) => String(r.id));
  const items = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT ri.id, ri.receipt_id, ri.request_item_id, ri.product_id, ri.qty_milli,
            ri.to_location_id, ri.movement_id, ri.has_discrepancy, ri.discrepancy_note, ri.notes,
            p.name AS product_name, p.sku, u.code AS uom_code,
            l.name AS location_name, l.path AS location_path
       FROM purchase_receipt_items ri
       LEFT JOIN products p ON p.id = ri.product_id
       LEFT JOIN uoms u ON u.id = p.uom_id
       LEFT JOIN locations l ON l.id = ri.to_location_id
      WHERE ri.receipt_id IN (${ids.map(() => "?").join(",")})
      ORDER BY ri.created_at`,
    ids,
  );

  const byReceipt = new Map<string, unknown[]>();
  for (const item of items) {
    const key = String(item.receipt_id);
    const list = byReceipt.get(key) ?? [];
    list.push({
      id: String(item.id),
      requestItemId: item.request_item_id ? String(item.request_item_id) : null,
      productId: item.product_id ? String(item.product_id) : null,
      productName: item.product_name ? String(item.product_name) : null,
      sku: item.sku ? String(item.sku) : null,
      uomCode: item.uom_code ? String(item.uom_code) : null,
      qtyMilli: Number(item.qty_milli),
      toLocationId: item.to_location_id ? String(item.to_location_id) : null,
      locationName: item.location_name ? String(item.location_name) : null,
      locationPath: item.location_path ? String(item.location_path) : null,
      movementId: item.movement_id ? String(item.movement_id) : null,
      hasDiscrepancy: Number(item.has_discrepancy) === 1,
      discrepancyNote: item.discrepancy_note ? String(item.discrepancy_note) : null,
      notes: item.notes ? String(item.notes) : null,
    });
    byReceipt.set(key, list);
  }

  return c.json({
    items: receipts.map((r) => ({
      id: String(r.id),
      code: String(r.code),
      receivedAt: String(r.received_at),
      receivedBy: String(r.received_by),
      receivedByName: String(r.received_by_name),
      documentRef: r.document_ref ? String(r.document_ref) : null,
      notes: r.notes ? String(r.notes) : null,
      status: String(r.status),
      lines: byReceipt.get(String(r.id)) ?? [],
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Solicitação                                                                */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission(PERMISSIONS.PURCHASES_CREATE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, createBody);

  assertLocationAllowed(user, body.locationId ?? null);
  if (body.locationId) await assertLocationActive(c.env.DB, body.locationId);
  if (body.costCenterId) await assertCostCenterActive(c.env.DB, body.costCenterId);
  await assertItemsReference(c.env.DB, body.items);

  const id = uuid();
  const ts = nowIso();
  const code = buildCode("SC", await nextCounter(c.env.DB, "purchase_request"));
  const autoApproved = body.submit && !(await approvalRequired(c.env.DB));
  const status = body.submit ? (autoApproved ? "approved" : "pending_approval") : "draft";
  const approvalStage = status === "draft" ? "manager" : autoApproved ? "buyer" : "manager";
  const info = clientInfo(c);

  const itemStatements = body.items.map((item) =>
    insertStatement(c.env.DB, "purchase_request_items", {
      id: uuid(),
      request_id: id,
      product_id: item.productId ?? null,
      description: item.description ?? null,
      qty_milli: Math.round(item.qty * 1000),
      uom_id: item.uomId ?? null,
      qty_received_milli: 0,
      status: autoApproved ? "approved" : "pending",
      qty_approved_milli: autoApproved ? Math.round(item.qty * 1000) : null,
      purchase_mode: autoApproved ? "direct" : null,
      notes: item.notes ?? null,
      created_at: ts,
      updated_at: ts,
    }),
  );

  await c.env.DB.batch([
    insertStatement(c.env.DB, "purchase_requests", {
      id,
      code,
      requester_id: user.id,
      location_id: body.locationId ?? null,
      justification: body.justification ?? null,
      priority: body.priority,
      status,
      desired_date: body.desiredDate ?? null,
      approval_notes: autoApproved ? AUTO_APPROVAL_NOTE : null,
      approved_at: autoApproved ? ts : null,
      notes: body.notes ?? null,
      workflow_version: body.workflowVersion,
      approval_stage: approvalStage,
      routing: "standard",
      budget_status: autoApproved ? "not_required" : "pending",
      budget_notes: body.budgetNotes ?? null,
      cost_center_id: body.costCenterId ?? null,
      gl_account: body.glAccount ?? null,
      finance_status: autoApproved ? "pending" : "not_required",
      created_at: ts,
      updated_at: ts,
    }),
    ...itemStatements,
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: autoApproved ? "purchase_request.auto_approved" : "purchase_request.create",
      entityType: "purchase_request",
      entityId: id,
      after: {
        code,
        status,
        approvalStage,
        workflowVersion: body.workflowVersion,
        itemCount: body.items.length,
        autoApproved,
      },
      reason: autoApproved ? AUTO_APPROVAL_NOTE : null,
      ...info,
    }),
  ]);

  // Criar já enviando para aprovação precisa avisar quem aprova -- sem isso a
  // solicitação ficaria pendente e invisível até alguém abrir a lista.
  if (status === "pending_approval") {
    await notifyApprovers(c.env.DB, {
      requestId: id,
      code,
      justification: body.justification ?? null,
      requesterId: user.id,
      requesterName: user.name,
      createdAt: ts,
    });
  }

  return c.json({ id, code, status, approvalStage, workflowVersion: body.workflowVersion }, 201);
});

router.patch("/:id", requirePermission(PERMISSIONS.PURCHASES_CREATE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, updateBody);

  const before = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, before);
  if (!["draft", "pending_approval"].includes(before.status)) {
    throw conflict(`Uma solicitação ${before.status} não pode ser editada.`);
  }
  if (before.requester_id !== user.id && !user.permissions.has(PERMISSIONS.PURCHASES_APPROVE)) {
    throw conflict("Somente o solicitante ou um aprovador pode editar esta solicitação.");
  }
  if (body.locationId) {
    assertLocationAllowed(user, body.locationId);
    await assertLocationActive(c.env.DB, body.locationId);
  }
  if (body.costCenterId) await assertCostCenterActive(c.env.DB, body.costCenterId);

  const ts = nowIso();
  const updated = {
    ...(body.locationId !== undefined ? { location_id: body.locationId ?? null } : {}),
    ...(body.justification !== undefined ? { justification: body.justification ?? null } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.desiredDate !== undefined ? { desired_date: body.desiredDate ?? null } : {}),
    ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
    ...(body.costCenterId !== undefined ? { cost_center_id: body.costCenterId ?? null } : {}),
    ...(body.glAccount !== undefined ? { gl_account: body.glAccount ?? null } : {}),
    ...(body.budgetNotes !== undefined ? { budget_notes: body.budgetNotes ?? null } : {}),
    updated_at: ts,
  };

  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "purchase_requests", id, updated),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_request.update",
      entityType: "purchase_request",
      entityId: id,
      before: { priority: before.priority, status: before.status },
      after: updated,
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

router.post("/:id/submit", requirePermission(PERMISSIONS.PURCHASES_CREATE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.status !== "draft") throw conflict(`Somente rascunhos podem ser enviados para aprovação.`);
  if (request.requester_id !== user.id && !user.permissions.has(PERMISSIONS.PURCHASES_APPROVE)) {
    throw conflict("Somente o solicitante pode enviar esta solicitação.");
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const autoApproved = !(await approvalRequired(c.env.DB));
  const nextStatus = autoApproved ? "approved" : "pending_approval";
  const nextStage = autoApproved ? "buyer" : "manager";

  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: nextStatus,
      approval_stage: nextStage,
      budget_status: autoApproved ? "not_required" : "pending",
      ...(autoApproved
        ? { approval_notes: AUTO_APPROVAL_NOTE, approved_at: ts, finance_status: "pending" }
        : {}),
      updated_at: ts,
    }),
    ...(autoApproved
      ? [
          c.env.DB
            .prepare(
              `UPDATE purchase_request_items
                  SET status = 'approved',
                      qty_approved_milli = COALESCE(qty_approved_milli, qty_milli),
                      purchase_mode = 'direct',
                      updated_at = ?
                WHERE request_id = ? AND status = 'pending'`,
            )
            .bind(ts, id),
        ]
      : []),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: autoApproved ? "purchase_request.auto_approved" : "purchase_request.submit",
      entityType: "purchase_request",
      entityId: id,
      before: { status: "draft" },
      after: { status: nextStatus, approvalStage: nextStage, autoApproved },
      reason: autoApproved ? AUTO_APPROVAL_NOTE : null,
      ...info,
    }),
  ];

  // Avisa quem pode aprovar. Não notifica o próprio solicitante -- nem quando a
  // política já aprovou a solicitação automaticamente.
  if (!autoApproved) {
    await notifyApprovers(c.env.DB, {
      requestId: id,
      code: request.code,
      justification: request.justification ?? null,
      requesterId: user.id,
      requesterName: user.name,
      createdAt: ts,
    });
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true, status: nextStatus, approvalStage: nextStage });
});

/**
 * Avisa todos que podem aprovar compras, exceto o próprio solicitante, em uma
 * única transação. Quem aprova recebe o mesmo aviso tanto ao enviar um rascunho
 * quanto ao criar a solicitação já enviada.
 */
async function notifyApprovers(
  db: D1Database,
  input: {
    requestId: string;
    code: string;
    justification: string | null;
    requesterId: string;
    requesterName: string;
    createdAt: string;
  },
): Promise<void> {
  const approvers = (await usersWithPermission(db, PERMISSIONS.PURCHASES_APPROVE)).filter(
    (approverId) => approverId !== input.requesterId,
  );
  if (approvers.length === 0) return;

  await db.batch(
    notificationStatements(db, approvers, {
      type: "purchase_pending_approval",
      title: `Solicitação ${input.code} aguarda aprovação`,
      body: input.justification ?? `Solicitação de ${input.requesterName}.`,
      link: `/compras/${input.requestId}`,
      entityType: "purchase_request",
      entityId: input.requestId,
      createdAt: input.createdAt,
    }),
  );
}

/**
 * Decisão da solicitação. Aprovar/rejeitar exige `purchases.approve`; mudar
 * para cotação/compra exige `purchases.order`. Nenhuma decisão apaga itens:
 * itens rejeitados permanecem visíveis com o status e a justificativa.
 */
router.post("/:id/decide", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, decideBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.workflow_version === 2) {
    return handleWorkflowDecision(c, request, body);
  }
  if (["received", "cancelled"].includes(request.status)) {
    throw conflict(`Uma solicitação ${request.status} não pode receber novas decisões.`);
  }
  if (body.decision === "approved" || body.decision === "rejected") {
    if (!user.permissions.has(PERMISSIONS.PURCHASES_APPROVE)) {
      throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_APPROVE}.`);
    }
    if (request.requester_id === user.id && !user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
      throw conflict("Você não pode aprovar a sua própria solicitação.");
    }
  } else if (!user.permissions.has(PERMISSIONS.PURCHASES_ORDER)) {
    throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_ORDER}.`);
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [];

  for (const item of body.items ?? []) {
    const existing = await oneRow<{ id: string; qty_milli: number; status: string }>(
      c.env.DB,
      `SELECT id, qty_milli, status FROM purchase_request_items WHERE id = ? AND request_id = ?`,
      [item.itemId, id],
    );
    if (!existing) throw notFound(`Item ${item.itemId} não pertence a esta solicitação.`);
    if (existing.status === "received") continue;

    const approvedMilli =
      item.qtyApproved !== undefined ? Math.round(item.qtyApproved * 1000) : undefined;
    if (approvedMilli !== undefined && approvedMilli > existing.qty_milli) {
      throw badRequest("A quantidade aprovada não pode ser maior que a quantidade solicitada.");
    }

    statements.push(
      updateStatement(c.env.DB, "purchase_request_items", item.itemId, {
        ...(item.status !== undefined ? { status: item.status } : {}),
        ...(approvedMilli !== undefined ? { qty_approved_milli: approvedMilli } : {}),
        ...(item.purchaseMode !== undefined ? { purchase_mode: item.purchaseMode } : {}),
        ...(item.notes !== undefined ? { notes: item.notes ?? null } : {}),
        updated_at: ts,
      }),
    );
  }

  // Rejeitar a solicitação inteira marca os itens ainda pendentes como rejeitados.
  if (body.decision === "rejected" && !body.items?.length) {
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE purchase_request_items SET status = 'rejected', updated_at = ?
            WHERE request_id = ? AND status IN ('pending','approved')`,
        )
        .bind(ts, id),
    );
  }
  // Aprovar a solicitação aprova os itens pendentes: um item "pendente" dentro
  // de uma solicitação aprovada seria contraditório (e travaria pedido e
  // recebimento). Quantidades ajustadas item a item continuam valendo, porque a
  // atualização usa COALESCE sobre o valor já definido na decisão.
  if (body.decision === "approved") {
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE purchase_request_items
              SET status = 'approved',
                  qty_approved_milli = COALESCE(qty_approved_milli, qty_milli),
                  purchase_mode = COALESCE(purchase_mode, 'direct'),
                  updated_at = ?
            WHERE request_id = ? AND status = 'pending'`,
        )
        .bind(ts, id),
    );
  }
  // Mover para cotação marca os itens sem divisão como "cotação": o comprador
  // precisa saber quais itens exigem proposta de fornecedor.
  if (body.decision === "quoting") {
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE purchase_request_items
              SET purchase_mode = COALESCE(purchase_mode, 'quote'), updated_at = ?
            WHERE request_id = ? AND status NOT IN ('rejected','cancelled','received')`,
        )
        .bind(ts, id),
    );
  }

  // F-01: aprovação com item marcado para cotação segue como "em cotação" -- a
  // bola fica com o comprador até registrar propostas e devolver ao gestor.
  let effectiveStatus: string = body.decision;
  if (body.decision === "approved") {
    const hasQuoteItems =
      (body.items ?? []).some((item) => item.purchaseMode === "quote") ||
      (await countRows(
        c.env.DB,
        `SELECT COUNT(*) FROM purchase_request_items
          WHERE request_id = ? AND purchase_mode = 'quote' AND status NOT IN ('rejected','cancelled')`,
        [id],
      )) > 0;
    if (hasQuoteItems) effectiveStatus = "quoting";
  }

  statements.push(
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: effectiveStatus,
      approval_notes: body.notes ?? null,
      ...(body.decision === "approved" || body.decision === "rejected"
        ? { approved_by: user.id, approved_at: ts }
        : {}),
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: `purchase_request.${body.decision}`,
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status },
      after: { status: effectiveStatus, itemDecisions: body.items ?? [] },
      reason: body.notes ?? null,
      ...info,
    }),
  );

  if (request.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: request.requester_id,
        type: `purchase_${effectiveStatus}`,
        title:
          body.decision === "approved" && effectiveStatus === "quoting"
            ? `Solicitação ${request.code}: aprovada para cotação`
            : `Solicitação ${request.code}: ${DECISION_LABEL[body.decision]}`,
        body: body.notes ?? null,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: effectiveStatus });
});

/* -------------------------------------------------------------------------- */
/* Cotação (F-02)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Registro de proposta de fornecedor durante a cotação. O comprador envia o
 * preço por item; reenviar a mesma proposta (mesmo fornecedor) substitui os
 * valores -- o código COT permanece e a auditoria registra a alteração.
 */
/**
 * Decisão do fluxo corporativo (workflow 2).
 *
 * Etapas:
 *  manager     -> gestor do setor aprova a necessidade ou envia direto a Compras;
 *  direction   -> direção analisa orçamento e autoriza;
 *  purchasing  -> gestor de compras autoriza compra direta ou devolve à direção;
 *  buyer       -> comprador cota, adjudica e pede;
 *  award       -> adjudicação item a item;
 *  receipt     -> recebimento e entrada no estoque.
 *
 * A aprovação é sempre de outra pessoa: o solicitante não decide a própria
 * compra e a direção não pode ser a mesma pessoa que aprovou como gestor.
 */
async function handleWorkflowDecision(
  c: AppContext,
  request: RequestRow,
  body: z.infer<typeof decideBody>,
): Promise<Response> {
  const user = currentUser(c);
  const id = request.id;
  const ts = nowIso();
  const info = clientInfo(c);
  const stage = request.approval_stage;

  if (["received", "cancelled", "rejected"].includes(request.status) || stage === "completed") {
    throw conflict(`Uma solicitação ${request.status} não pode receber novas decisões.`);
  }

  const itemRows = await allRows<{
    id: string;
    qty_milli: number;
    qty_approved_milli: number | null;
    status: string;
    purchase_mode: string | null;
  }>(
    c.env.DB,
    `SELECT id, qty_milli, qty_approved_milli, status, purchase_mode
       FROM purchase_request_items WHERE request_id = ?`,
    [id],
  );
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const finalItems = new Map(
    itemRows.map((row) => [
      row.id,
      {
        status: row.status,
        mode: row.purchase_mode,
        qtyApproved: row.qty_approved_milli,
      },
    ]),
  );

  for (const item of body.items ?? []) {
    const existing = itemById.get(item.itemId);
    if (!existing) throw notFound(`Item ${item.itemId} não pertence a esta solicitação.`);
    if (["received", "cancelled"].includes(existing.status)) continue;
    const qtyApproved =
      item.qtyApproved !== undefined ? Math.round(item.qtyApproved * 1000) : undefined;
    if (qtyApproved !== undefined && qtyApproved > existing.qty_milli) {
      throw badRequest("A quantidade aprovada não pode ser maior que a quantidade solicitada.");
    }
    const current = finalItems.get(item.itemId)!;
    finalItems.set(item.itemId, {
      status: item.status ?? current.status,
      mode: item.purchaseMode ?? current.mode,
      qtyApproved: qtyApproved ?? current.qtyApproved,
    });
  }

  const itemStatements: D1PreparedStatement[] = [];
  const applyItemDecision = (modeFallback: "direct" | "quote") => {
    for (const item of body.items ?? []) {
      const existing = itemById.get(item.itemId);
      if (!existing || ["received", "cancelled"].includes(existing.status)) continue;
      const qtyApproved =
        item.qtyApproved !== undefined ? Math.round(item.qtyApproved * 1000) : undefined;
      itemStatements.push(
        updateStatement(c.env.DB, "purchase_request_items", item.itemId, {
          ...(item.status !== undefined ? { status: item.status } : {}),
          ...(qtyApproved !== undefined ? { qty_approved_milli: qtyApproved } : {}),
          ...(item.purchaseMode !== undefined ? { purchase_mode: item.purchaseMode } : {}),
          ...(item.notes !== undefined ? { notes: item.notes ?? null } : {}),
          updated_at: ts,
        }),
      );
    }
    // Itens pendentes que não receberam decisão individual seguem a decisão
    // coletiva da etapa.
    itemStatements.push(
      c.env.DB
        .prepare(
          `UPDATE purchase_request_items
              SET status = 'approved',
                  qty_approved_milli = COALESCE(qty_approved_milli, qty_milli),
                  purchase_mode = COALESCE(purchase_mode, ?),
                  updated_at = ?
            WHERE request_id = ? AND status = 'pending'`,
        )
        .bind(modeFallback, ts, id),
    );
  };
  const applyRejection = () => {
    for (const item of body.items ?? []) {
      const existing = itemById.get(item.itemId);
      if (!existing || existing.status === "received") continue;
      itemStatements.push(
        updateStatement(c.env.DB, "purchase_request_items", item.itemId, {
          status: item.status === "cancelled" ? "cancelled" : "rejected",
          updated_at: ts,
        }),
      );
    }
    itemStatements.push(
      c.env.DB
        .prepare(
          `UPDATE purchase_request_items
              SET status = 'rejected', updated_at = ?
            WHERE request_id = ? AND status IN ('pending','approved')`,
        )
        .bind(ts, id),
    );
  };

  const statements: D1PreparedStatement[] = [];
  let nextStatus = request.status;
  let nextStage = stage;
  let routingPatch: "standard" | "direct_to_purchasing" | null = null;
  let auditAction = `purchase_request.${body.decision}`;
  let eventType: string | null = null;

  if (stage === "manager") {
    if (!user.permissions.has(PERMISSIONS.PURCHASES_APPROVE)) {
      throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_APPROVE}.`);
    }
    if (request.requester_id === user.id && !user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
      throw conflict("Você não pode aprovar a sua própria solicitação.");
    }
    if (body.decision === "approved") {
      // Sem decisão individual, o caminho padrão é cotação. Compra direta é
      // uma escolha explícita do gestor ou da triagem de Compras.
      applyItemDecision("quote");
      nextStage = "direction";
      nextStatus = "pending_approval";
      auditAction = "purchase_request.approved";
      eventType = "purchase_request.manager_approved";
      statements.push(
        ...notificationStatements(
          c.env.DB,
          (await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_AUTHORIZE)).filter(
            (approverId) => approverId !== user.id && approverId !== request.requester_id,
          ),
          {
            type: "purchase_pending_direction",
            title: `Solicitação ${request.code} aguarda análise da Direção`,
            body: body.notes ?? request.justification,
            link: `/compras/${id}`,
            entityType: "purchase_request",
            entityId: id,
            createdAt: ts,
          },
        ),
      );
    } else if (body.decision === "send_to_purchasing") {
      // A triagem decide entre devolver à Direção (cotação) ou autorizar a
      // compra direta; o item nasce no caminho padrão de cotação.
      applyItemDecision("quote");
      nextStage = "purchasing";
      nextStatus = "pending_approval";
      auditAction = "purchase_request.send_to_purchasing";
      eventType = "purchase_request.sent_to_purchasing";
      const recipients = new Set([
        ...(await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_AWARD)),
        ...(await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_DIRECT)),
      ]);
      statements.push(
        ...notificationStatements(
          c.env.DB,
          [...recipients].filter((recipient) => recipient !== user.id && recipient !== request.requester_id),
          {
            type: "purchase_sent_to_purchasing",
            title: `Solicitação ${request.code} enviada diretamente a Compras`,
            body: body.notes ?? request.justification,
            link: `/compras/${id}`,
            entityType: "purchase_request",
            entityId: id,
            createdAt: ts,
          },
        ),
      );
    } else if (body.decision === "rejected") {
      applyRejection();
      nextStatus = "rejected";
      nextStage = "completed";
      auditAction = "purchase_request.rejected";
      eventType = "purchase_request.rejected";
    } else {
      throw conflict("O gestor do setor só pode aprovar, rejeitar ou enviar diretamente a Compras.");
    }
  } else if (stage === "direction") {
    if (!user.permissions.has(PERMISSIONS.PURCHASES_AUTHORIZE)) {
      throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_AUTHORIZE}.`);
    }
    if (request.requester_id === user.id && !user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
      throw conflict("Você não pode autorizar a sua própria solicitação.");
    }
    if (
      request.manager_approved_by === user.id &&
      !user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)
    ) {
      throw conflict("A segunda aprovação deve ser registrada por outro responsável.");
    }
    if (body.decision === "approved") {
      applyItemDecision("quote");
      const hasQuote = [...finalItems.values()].some(
        (item) =>
          !["rejected", "cancelled", "received"].includes(item.status) &&
          (item.mode ?? "direct") === "quote",
      );
      nextStatus = hasQuote ? "quoting" : "approved";
      nextStage = "buyer";
      auditAction = "purchase_request.approved";
      eventType = "purchase_request.authorized";
      const recipients = new Set<string>([
        ...(await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_ORDER)),
      ]);
      if (request.requester_id !== user.id) recipients.add(request.requester_id);
      statements.push(
        ...notificationStatements(c.env.DB, [...recipients].filter((id) => id !== user.id), {
          type: hasQuote ? "purchase_authorized_quoting" : "purchase_authorized",
          title: hasQuote
            ? `Solicitação ${request.code} autorizada para cotação`
            : `Solicitação ${request.code} autorizada para compra`,
          body: body.notes ?? null,
          link: `/compras/${id}`,
          entityType: "purchase_request",
          entityId: id,
          createdAt: ts,
        }),
      );
    } else if (body.decision === "rejected") {
      applyRejection();
      nextStatus = "rejected";
      nextStage = "completed";
      auditAction = "purchase_request.rejected";
      eventType = "purchase_request.rejected";
    } else {
      throw conflict("A Direção só pode autorizar ou rejeitar a solicitação.");
    }
  } else if (stage === "purchasing") {
    if (body.decision === "authorize_direct") {
      if (!user.permissions.has(PERMISSIONS.PURCHASES_DIRECT)) {
        throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_DIRECT}.`);
      }
      applyItemDecision("direct");
      // A autorização de compra direta vale para todos os itens ainda ativos:
      // o comprador não deve ficar com item marcado para cotação sem cotação.
      itemStatements.push(
        c.env.DB
          .prepare(
            `UPDATE purchase_request_items
                SET purchase_mode = 'direct',
                    status = 'approved',
                    qty_approved_milli = COALESCE(qty_approved_milli, qty_milli),
                    updated_at = ?
              WHERE request_id = ? AND status NOT IN ('rejected','cancelled','received')`,
          )
          .bind(ts, id),
      );
      nextStatus = "approved";
      nextStage = "buyer";
      auditAction = "purchase_request.authorize_direct";
      eventType = "purchase_request.direct_authorized";
      statements.push(
        ...notificationStatements(
          c.env.DB,
          (await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_ORDER)).filter(
            (buyerId) => buyerId !== user.id,
          ),
          {
            type: "purchase_direct_authorized",
            title: `Compra direta autorizada: ${request.code}`,
            body: body.notes ?? "O setor de compras autorizou a compra sem cotação.",
            link: `/compras/${id}`,
            entityType: "purchase_request",
            entityId: id,
            createdAt: ts,
          },
        ),
      );
    } else if (body.decision === "send_to_direction") {
      if (!user.permissions.has(PERMISSIONS.PURCHASES_AWARD)) {
        throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_AWARD}.`);
      }
      nextStage = "direction";
      nextStatus = "pending_approval";
      routingPatch = "standard";
      auditAction = "purchase_request.send_to_direction";
      eventType = "purchase_request.sent_to_direction";
      statements.push(
        ...notificationStatements(
          c.env.DB,
          (await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_AUTHORIZE)).filter(
            (approverId) => approverId !== user.id,
          ),
          {
            type: "purchase_pending_direction",
            title: `Solicitação ${request.code} aguarda análise da Direção`,
            body: body.notes ?? request.justification,
            link: `/compras/${id}`,
            entityType: "purchase_request",
            entityId: id,
            createdAt: ts,
          },
        ),
      );
    } else if (body.decision === "rejected") {
      if (!user.permissions.has(PERMISSIONS.PURCHASES_AWARD)) {
        throw conflict(`Permissão necessária: ${PERMISSIONS.PURCHASES_AWARD}.`);
      }
      applyRejection();
      nextStatus = "rejected";
      nextStage = "completed";
      auditAction = "purchase_request.rejected";
      eventType = "purchase_request.rejected";
    } else {
      throw conflict("A triagem de Compras só pode autorizar compra direta, enviar à Direção ou rejeitar.");
    }
  } else {
    throw conflict(`A solicitação está na etapa "${stage}" e não aceita esta decisão.`);
  }

  const requestPatch: Record<string, unknown> = {
    status: nextStatus,
    approval_stage: nextStage,
    approval_notes: body.notes ?? null,
    ...(routingPatch ? { routing: routingPatch } : {}),
    updated_at: ts,
  };
  if (stage === "manager") {
    requestPatch.manager_approved_by = user.id;
    requestPatch.manager_approved_at = ts;
  }
  if (stage === "manager" && body.decision === "send_to_purchasing") {
    requestPatch.routing = "direct_to_purchasing";
    requestPatch.budget_status = "pending";
  }
  if (stage === "direction" && body.decision === "approved") {
    requestPatch.direction_approved_by = user.id;
    requestPatch.direction_approved_at = ts;
    requestPatch.approved_by = user.id;
    requestPatch.approved_at = ts;
    requestPatch.budget_status = "approved";
    requestPatch.finance_status = "pending";
  }
  if (stage === "purchasing" && body.decision === "authorize_direct") {
    requestPatch.direct_authorized_by = user.id;
    requestPatch.direct_authorized_at = ts;
    requestPatch.approved_by = user.id;
    requestPatch.approved_at = ts;
    requestPatch.budget_status = "approved";
    requestPatch.finance_status = "pending";
    requestPatch.routing = "direct_to_purchasing";
  }
  if (body.decision === "rejected") {
    requestPatch.budget_status = "rejected";
    requestPatch.finance_status = "not_required";
  }

  statements.push(
    ...itemStatements,
    updateStatement(c.env.DB, "purchase_requests", id, requestPatch),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: auditAction,
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status, approvalStage: stage },
      after: {
        status: nextStatus,
        approvalStage: nextStage,
        decision: body.decision,
        itemDecisions: body.items ?? [],
      },
      reason: body.notes ?? null,
      ...info,
    }),
  );

  if (request.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: request.requester_id,
        type: `purchase_${nextStatus}`,
        title:
          body.decision === "rejected"
            ? `Solicitação ${request.code} recusada`
            : `Solicitação ${request.code}: ${PURCHASE_STATUS_LABEL[nextStatus as keyof typeof PURCHASE_STATUS_LABEL] ?? nextStatus}`,
        body: body.notes ?? null,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  if (eventType) {
    statements.push(
      outboxStatement(c.env.DB, {
        eventType,
        aggregateType: "purchase_request",
        aggregateId: id,
        idempotencyKey: `${eventType}:${id}:${body.decision}:${ts}`,
        payload: {
          requestId: id,
          code: request.code,
          status: nextStatus,
          approvalStage: nextStage,
          decision: body.decision,
          decidedBy: user.id,
          decidedAt: ts,
        },
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: nextStatus, approvalStage: nextStage });
}

router.post("/:id/quotes", requirePermission(PERMISSIONS.PURCHASES_ORDER), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, quoteBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (!["quoting", "quote_returned"].includes(request.status)) {
    throw conflict(`Propostas são registradas durante a cotação. Status atual: ${request.status}.`);
  }
  const supplier = await oneRow<{ id: string; is_active: number }>(
    c.env.DB,
    `SELECT id, is_active FROM suppliers WHERE id = ?`,
    [body.supplierId],
  );
  if (!supplier) throw notFound("Fornecedor não encontrado.");
  if (supplier.is_active !== 1) throw badRequest("O fornecedor informado esta inativo.");

  const itemIds = body.items.map((item) => item.itemId);
  const duplicated = findDuplicates(itemIds);
  if (duplicated.length > 0) throw badRequest("O mesmo item aparece mais de uma vez na proposta.");

  const rows = await allRows<{
    id: string;
    qty_milli: number;
    qty_approved_milli: number | null;
    status: string;
  }>(
    c.env.DB,
    `SELECT id, qty_milli, qty_approved_milli, status FROM purchase_request_items
      WHERE request_id = ? AND id IN (${itemIds.map(() => "?").join(",")})`,
    [id, ...itemIds],
  );
  if (rows.length !== itemIds.length) {
    throw badRequest("Um dos itens informados não pertence a esta solicitação.");
  }
  for (const row of rows) {
    if (["rejected", "cancelled", "received"].includes(row.status)) {
      throw conflict(`Um item da proposta está "${row.status}" e não entra na cotação.`);
    }
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const existing = await oneRow<{ id: string; code: string }>(
    c.env.DB,
    `SELECT id, code FROM purchase_quotes
      WHERE request_id = ? AND supplier_id = ? AND status = 'registered'`,
    [id, body.supplierId],
  );

  const quoteId = existing?.id ?? uuid();
  const code = existing?.code ?? buildCode("COT", await nextCounter(c.env.DB, "purchase_quote"));
  const rowById = new Map(rows.map((row) => [row.id, row]));

  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(c.env.DB.prepare(`DELETE FROM purchase_quote_items WHERE quote_id = ?`).bind(quoteId));
    statements.push(
      updateStatement(c.env.DB, "purchase_quotes", quoteId, {
        notes: body.notes ?? null,
        updated_at: ts,
      }),
    );
  } else {
    statements.push(
      insertStatement(c.env.DB, "purchase_quotes", {
        id: quoteId,
        code,
        request_id: id,
        supplier_id: body.supplierId,
        status: "registered",
        notes: body.notes ?? null,
        created_by: user.id,
        created_at: ts,
        updated_at: ts,
      }),
    );
  }
  for (const item of body.items) {
    const row = rowById.get(item.itemId)!;
    statements.push(
      insertStatement(c.env.DB, "purchase_quote_items", {
        id: uuid(),
        quote_id: quoteId,
        request_item_id: item.itemId,
        qty_milli:
          item.qty !== undefined ? Math.round(item.qty * 1000) : (row.qty_approved_milli ?? row.qty_milli),
        unit_price_cents: Math.round(item.unitPrice * 100),
        notes: item.notes ?? null,
        created_at: ts,
      }),
    );
  }

  // Proposta enviada depois da devolução volta a bola para o comprador: a
  // solicitação retorna para "em cotação" e o gestor decide sobre o conjunto final.
  const backToQuoting = request.status === "quote_returned";
  if (backToQuoting) {
    statements.push(
      updateStatement(c.env.DB, "purchase_requests", id, { status: "quoting", updated_at: ts }),
    );
  }

  statements.push(
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: existing ? "purchase_quote.update" : "purchase_quote.create",
      entityType: "purchase_quote",
      entityId: quoteId,
      after: { code, requestId: id, supplierId: body.supplierId, itemCount: body.items.length, backToQuoting },
      ...info,
    }),
  );

  await c.env.DB.batch(statements);
  return c.json({ id: quoteId, code, status: "registered" }, existing ? 200 : 201);
});

/** Devolve a cotação ao gestor: comprador encerra a coleta e pede a escolha. */
router.post("/:id/quotes/return", requirePermission(PERMISSIONS.PURCHASES_ORDER), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.status !== "quoting") {
    throw conflict(`Somente solicitações em cotação podem ser devolvidas para aprovação. Status atual: ${request.status}.`);
  }
  const quoteCount = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM purchase_quotes WHERE request_id = ? AND status = 'registered'`,
    [id],
  );
  if (quoteCount === 0) {
    throw badRequest("Registre ao menos uma proposta antes de devolver a cotação.");
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: "quote_returned",
      ...(request.workflow_version === 2 ? { approval_stage: "award" } : {}),
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_quote.return",
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status },
      after: { status: "quote_returned", quoteCount },
      ...info,
    }),
  ];

  const approverPermission =
    request.workflow_version === 2 ? PERMISSIONS.PURCHASES_AWARD : PERMISSIONS.PURCHASES_APPROVE;
  const approvers = (await usersWithPermission(c.env.DB, approverPermission)).filter(
    (approverId) => approverId !== user.id,
  );
  if (approvers.length > 0) {
    statements.push(
      ...notificationStatements(c.env.DB, approvers, {
        type: "purchase_quote_returned",
        title: `Cotação da solicitação ${request.code} aguarda aprovação`,
        body: `${quoteCount} ${quoteCount === 1 ? "proposta registrada" : "propostas registradas"}.`,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: "quote_returned" });
});

/**
 * Aprovação da proposta vencedora: as demais propostas registradas são
 * marcadas como não escolhidas e a solicitação fica pronta para o pedido, que
 * nasce com o fornecedor e os preços da proposta aprovada.
 */
router.post("/:id/quotes/:quoteId/approve", requirePermission(PERMISSIONS.PURCHASES_APPROVE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const quoteId = c.req.param("quoteId");
  const body = await parseBody(c, quoteDecisionBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.workflow_version === 2) {
    throw conflict("Use a adjudicação por item para escolher os fornecedores desta solicitação.");
  }
  if (request.status !== "quote_returned") {
    throw conflict(`A cotação só pode ser aprovada depois de devolvida pelo comprador. Status atual: ${request.status}.`);
  }
  if (request.requester_id === user.id && !user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
    throw conflict("Você não pode aprovar a cotação da sua própria solicitação.");
  }
  const quote = await oneRow<{ id: string; code: string; status: string; supplier_id: string }>(
    c.env.DB,
    `SELECT id, code, status, supplier_id FROM purchase_quotes WHERE id = ? AND request_id = ?`,
    [quoteId, id],
  );
  if (!quote) throw notFound("Proposta não encontrada nesta solicitação.");
  if (quote.status !== "registered") {
    throw conflict(`A proposta ${quote.code} está "${quote.status}" e não pode ser aprovada.`);
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "purchase_quotes", quoteId, {
      status: "approved",
      approved_by: user.id,
      approved_at: ts,
      approval_notes: body.notes ?? null,
      updated_at: ts,
    }),
    c.env.DB
      .prepare(
        `UPDATE purchase_quotes
            SET status = 'rejected',
                approval_notes = COALESCE(approval_notes, 'Não escolhida na comparação de propostas.'),
                updated_at = ?
          WHERE request_id = ? AND status = 'registered' AND id <> ?`,
      )
      .bind(ts, id, quoteId),
    updateStatement(c.env.DB, "purchase_requests", id, { status: "quote_approved", updated_at: ts }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_quote.approve",
      entityType: "purchase_quote",
      entityId: quoteId,
      before: { status: quote.status, requestStatus: request.status },
      after: { status: "approved", requestStatus: "quote_approved", supplierId: quote.supplier_id },
      reason: body.notes ?? null,
      ...info,
    }),
  ];

  const recipients = new Set<string>();
  if (request.requester_id !== user.id) recipients.add(request.requester_id);
  for (const buyerId of await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_ORDER)) {
    if (buyerId !== user.id) recipients.add(buyerId);
  }
  if (recipients.size > 0) {
    statements.push(
      ...notificationStatements(c.env.DB, [...recipients], {
        type: "purchase_quote_approved",
        title: `Cotação da solicitação ${request.code} aprovada`,
        body: `Proposta ${quote.code} selecionada; o pedido já pode ser emitido.`,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: "quote_approved" });
});

/** Recusa a proposta devolvida: a cotação volta ao comprador para ajustes. */
router.post("/:id/quotes/:quoteId/reject", requirePermission(PERMISSIONS.PURCHASES_APPROVE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const quoteId = c.req.param("quoteId");
  const body = await parseBody(c, quoteDecisionBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.status !== "quote_returned") {
    throw conflict(`A cotação só pode ser recusada depois de devolvida pelo comprador. Status atual: ${request.status}.`);
  }
  const quote = await oneRow<{ id: string; code: string; status: string }>(
    c.env.DB,
    `SELECT id, code, status FROM purchase_quotes WHERE id = ? AND request_id = ?`,
    [quoteId, id],
  );
  if (!quote) throw notFound("Proposta não encontrada nesta solicitação.");
  if (quote.status !== "registered") {
    throw conflict(`A proposta ${quote.code} está "${quote.status}" e não pode ser recusada.`);
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "purchase_quotes", quoteId, {
      status: "rejected",
      approved_by: user.id,
      approved_at: ts,
      approval_notes: body.notes ?? null,
      updated_at: ts,
    }),
    updateStatement(c.env.DB, "purchase_requests", id, { status: "quoting", updated_at: ts }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_quote.reject",
      entityType: "purchase_quote",
      entityId: quoteId,
      before: { status: quote.status, requestStatus: request.status },
      after: { status: "rejected", requestStatus: "quoting" },
      reason: body.notes ?? null,
      ...info,
    }),
  ];

  const buyers = (await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_ORDER)).filter(
    (buyerId) => buyerId !== user.id,
  );
  if (buyers.length > 0) {
    statements.push(
      ...notificationStatements(c.env.DB, buyers, {
        type: "purchase_quote_rejected",
        title: `Cotação da solicitação ${request.code} devolvida para ajustes`,
        body: body.notes ?? null,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: "quoting" });
});

/**
 * Adjudicação por item: o superior de compras escolhe um fornecedor para todos
 * os itens ou fornecedores diferentes por item. Cada item recebe no máximo uma
 * adjudicação; a proposta vencedora pode ganhar alguns itens e perder outros.
 */
router.post("/:id/award", requirePermission(PERMISSIONS.PURCHASES_AWARD), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, awardBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.workflow_version !== 2) {
    throw conflict("A adjudicação por item pertence ao fluxo corporativo (versão 2).");
  }
  if (request.status !== "quote_returned" || request.approval_stage !== "award") {
    throw conflict(`A cotação só pode ser adjudicada depois de devolvida pelo comprador. Status atual: ${request.status}.`);
  }
  if (request.requester_id === user.id && !user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) {
    throw conflict("Você não pode adjudicar a cotação da sua própria solicitação.");
  }

  const itemRows = await allRows<{
    id: string;
    qty_milli: number;
    qty_approved_milli: number | null;
    status: string;
    purchase_mode: string | null;
    description: string | null;
  }>(
    c.env.DB,
    `SELECT id, qty_milli, qty_approved_milli, status, purchase_mode, description
       FROM purchase_request_items WHERE request_id = ?`,
    [id],
  );
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const quoteRows = await allRows<{
    id: string;
    code: string;
    supplier_id: string;
    status: string;
    request_item_id: string;
    qty_milli: number;
    unit_price_cents: number;
  }>(
    c.env.DB,
    `SELECT q.id, q.code, q.supplier_id, q.status,
            qi.request_item_id, qi.qty_milli, qi.unit_price_cents
       FROM purchase_quotes q
       JOIN purchase_quote_items qi ON qi.quote_id = q.id
      WHERE q.request_id = ?`,
    [id],
  );
  const quoteItemByKey = new Map(
    quoteRows.map((row) => [`${row.id}:${row.request_item_id}`, row]),
  );
  const quoteById = new Map(quoteRows.map((row) => [row.id, row]));

  const seenItems = new Set<string>();
  const awardedQuoteIds = new Set<string>();
  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [];

  for (const award of body.awards) {
    if (seenItems.has(award.itemId)) {
      throw badRequest("O mesmo item aparece mais de uma vez na adjudicação.");
    }
    seenItems.add(award.itemId);
    const item = itemById.get(award.itemId);
    if (!item) throw notFound(`Item ${award.itemId} não pertence a esta solicitação.`);
    if (["rejected", "cancelled", "received"].includes(item.status)) {
      throw conflict(`O item "${item.description ?? item.id}" está ${item.status} e não entra na adjudicação.`);
    }
    if (item.purchase_mode !== "quote") {
      throw badRequest("Somente itens marcados para cotação precisam de adjudicação.");
    }
    const quote = quoteById.get(award.quoteId);
    if (!quote) throw notFound("Proposta não encontrada nesta solicitação.");
    if (quote.status !== "registered") {
      throw conflict(`A proposta ${quote.code} está "${quote.status}" e não pode ser adjudicada.`);
    }
    const quoteItem = quoteItemByKey.get(`${award.quoteId}:${award.itemId}`);
    if (!quoteItem) {
      throw badRequest(`A proposta ${quote.code} não inclui o item selecionado.`);
    }
    const qtyMilli = award.qty !== undefined ? Math.round(award.qty * 1000) : quoteItem.qty_milli;
    const limit = item.qty_approved_milli ?? item.qty_milli;
    if (qtyMilli <= 0 || qtyMilli > limit) {
      throw badRequest("A quantidade adjudicada não pode ser maior que a quantidade aprovada.");
    }
    if (qtyMilli > quoteItem.qty_milli) {
      throw badRequest(`A quantidade adjudicada excede a quantidade ofertada na proposta ${quote.code}.`);
    }

    awardedQuoteIds.add(quote.id);
    statements.push(
      insertStatement(c.env.DB, "purchase_awards", {
        id: uuid(),
        request_id: id,
        request_item_id: item.id,
        quote_id: quote.id,
        supplier_id: quote.supplier_id,
        qty_milli: qtyMilli,
        unit_price_cents: quoteItem.unit_price_cents,
        awarded_by: user.id,
        awarded_at: ts,
        notes: award.notes ?? null,
        created_at: ts,
      }),
      updateStatement(c.env.DB, "purchase_request_items", item.id, {
        supplier_id: quote.supplier_id,
        unit_price_cents: quoteItem.unit_price_cents,
        qty_approved_milli: qtyMilli,
        status: "approved",
        updated_at: ts,
      }),
    );
  }

  const quoteItems = itemRows.filter(
    (item) =>
      item.purchase_mode === "quote" &&
      !["rejected", "cancelled", "received"].includes(item.status),
  );
  const missing = quoteItems.filter((item) => !seenItems.has(item.id));
  if (missing.length > 0) {
    throw badRequest(
      `Adjudique todos os itens em cotação. Pendentes: ${missing
        .map((item) => item.description ?? item.id)
        .join(", ")}.`,
    );
  }

  const awardedList = [...awardedQuoteIds];
  if (awardedList.length > 0) {
    statements.push(
      c.env.DB
        .prepare(
          `UPDATE purchase_quotes
              SET status = 'approved', approved_by = ?, approved_at = ?,
                  approval_notes = COALESCE(approval_notes, ?), updated_at = ?
            WHERE request_id = ? AND status = 'registered'
              AND id IN (${awardedList.map(() => "?").join(",")})`,
        )
        .bind(user.id, ts, body.notes ?? null, ts, id, ...awardedList),
      c.env.DB
        .prepare(
          `UPDATE purchase_quotes
              SET status = 'rejected',
                  approval_notes = COALESCE(approval_notes, 'Não escolhida na adjudicação por item.'),
                  updated_at = ?
            WHERE request_id = ? AND status = 'registered'
              AND id NOT IN (${awardedList.map(() => "?").join(",")})`,
        )
        .bind(ts, id, ...awardedList),
    );
  }

  statements.push(
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: "quote_approved",
      approval_stage: "buyer",
      approval_notes: body.notes ?? null,
      finance_status: "pending",
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_award.create",
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status, approvalStage: request.approval_stage },
      after: {
        status: "quote_approved",
        approvalStage: "buyer",
        awards: body.awards,
        quoteIds: awardedList,
      },
      reason: body.notes ?? null,
      ...info,
    }),
    outboxStatement(c.env.DB, {
      eventType: "purchase_request.awarded",
      aggregateType: "purchase_request",
      aggregateId: id,
      idempotencyKey: `purchase_request.awarded:${id}:${ts}`,
      payload: {
        requestId: id,
        code: request.code,
        awards: body.awards,
        quoteIds: awardedList,
        awardedBy: user.id,
        awardedAt: ts,
      },
      createdAt: ts,
    }),
  );

  const recipients = new Set<string>();
  if (request.requester_id !== user.id) recipients.add(request.requester_id);
  for (const buyerId of await usersWithPermission(c.env.DB, PERMISSIONS.PURCHASES_ORDER)) {
    if (buyerId !== user.id) recipients.add(buyerId);
  }
  if (recipients.size > 0) {
    statements.push(
      ...notificationStatements(c.env.DB, [...recipients], {
        type: "purchase_quote_awarded",
        title: `Cotação da solicitação ${request.code} adjudicada`,
        body: `${body.awards.length} ${body.awards.length === 1 ? "item" : "itens"} com fornecedor definido; o pedido já pode ser emitido.`,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: "quote_approved", awards: body.awards.length });
});

/**
 * Pedidos por fornecedor do fluxo corporativo. Uma solicitação pode gerar um
 * pedido por fornecedor; cada item é vinculado à sua adjudicação quando existir.
 * O total é calculado em centavos e o pedido nasce pronto para exportação.
 */
router.post("/:id/orders", requirePermission(PERMISSIONS.PURCHASES_ORDER), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, multiOrderBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.workflow_version !== 2) {
    throw conflict("Pedidos por fornecedor pertencem ao fluxo corporativo (versão 2).");
  }
  if (!["approved", "quote_approved"].includes(request.status) || request.approval_stage !== "buyer") {
    throw conflict(
      `A solicitação precisa estar autorizada e na etapa do comprador para virar pedido. Status atual: ${request.status}.`,
    );
  }

  const itemRows = await allRows<{
    id: string;
    description: string | null;
    qty_milli: number;
    qty_approved_milli: number | null;
    status: string;
    purchase_mode: string | null;
    supplier_id: string | null;
    unit_price_cents: number | null;
  }>(
    c.env.DB,
    `SELECT id, description, qty_milli, qty_approved_milli, status, purchase_mode,
            supplier_id, unit_price_cents
       FROM purchase_request_items WHERE request_id = ?`,
    [id],
  );
  const itemById = new Map(itemRows.map((row) => [row.id, row]));
  const awardRows = await allRows<{
    request_item_id: string;
    supplier_id: string;
    unit_price_cents: number;
  }>(
    c.env.DB,
    `SELECT request_item_id, supplier_id, unit_price_cents
       FROM purchase_awards WHERE request_id = ?`,
    [id],
  );
  const awardByItem = new Map(awardRows.map((row) => [row.request_item_id, row]));

  const seenItems = new Set<string>();
  const seenSuppliers = new Set<string>();
  const orderPlans: Array<{
    supplierId: string;
    orderRef: string | null;
    notes: string | null;
    items: Array<{ itemId: string; qtyMilli: number; unitPriceCents: number }>;
    totalCents: number;
  }> = [];

  for (const order of body.orders) {
    if (seenSuppliers.has(order.supplierId)) {
      throw badRequest("Cada fornecedor deve aparecer em um único pedido.");
    }
    seenSuppliers.add(order.supplierId);
    const supplier = await oneRow<{ id: string; is_active: number }>(
      c.env.DB,
      `SELECT id, is_active FROM suppliers WHERE id = ?`,
      [order.supplierId],
    );
    if (!supplier) throw notFound("Fornecedor não encontrado.");
    if (supplier.is_active !== 1) throw badRequest("O fornecedor informado está inativo.");

    const plan = {
      supplierId: order.supplierId,
      orderRef: order.orderRef ?? null,
      notes: order.notes ?? null,
      items: [] as Array<{ itemId: string; qtyMilli: number; unitPriceCents: number }>,
      totalCents: 0,
    };

    for (const line of order.items) {
      if (seenItems.has(line.itemId)) {
        throw badRequest("O mesmo item aparece em mais de um pedido.");
      }
      seenItems.add(line.itemId);
      const item = itemById.get(line.itemId);
      if (!item) throw notFound(`Item ${line.itemId} não pertence a esta solicitação.`);
      if (item.status !== "approved") {
        throw conflict(`O item "${item.description ?? item.id}" está com status "${item.status}" e não entra em pedido.`);
      }
      const award = awardByItem.get(item.id);
      if (award && award.supplier_id !== order.supplierId) {
        throw conflict(
          `O item "${item.description ?? item.id}" foi adjudicado ao fornecedor selecionado em outro pedido.`,
        );
      }
      const qtyMilli = Math.round(line.qtyOrdered * 1000);
      const limit = item.qty_approved_milli ?? item.qty_milli;
      if (qtyMilli <= 0 || qtyMilli > limit) {
        throw badRequest("A quantidade pedida não pode ser maior que a quantidade aprovada.");
      }
      const informedPriceCents =
        line.unitPrice !== undefined ? Math.round(line.unitPrice * 100) : undefined;
      if (informedPriceCents !== undefined && informedPriceCents < 0) {
        throw badRequest("Preço unitário inválido.");
      }
      if (award && informedPriceCents !== undefined && informedPriceCents !== award.unit_price_cents) {
        throw conflict("O preço do item deve ser o da proposta adjudicada.");
      }
      const unitPriceCents =
        award?.unit_price_cents ?? informedPriceCents ?? item.unit_price_cents ?? 0;
      plan.items.push({ itemId: item.id, qtyMilli, unitPriceCents });
      plan.totalCents += Math.round((qtyMilli * unitPriceCents) / 1000);
    }
    if (plan.items.length === 0) throw badRequest("Cada pedido precisa de ao menos um item.");
    orderPlans.push(plan);
  }

  const activeItems = itemRows.filter((item) => item.status === "approved");
  const missing = activeItems.filter((item) => !seenItems.has(item.id));
  if (missing.length > 0) {
    throw badRequest(
      `Inclua todos os itens aprovados no pedido. Pendentes: ${missing
        .map((item) => item.description ?? item.id)
        .join(", ")}.`,
    );
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [];
  const createdOrders: Array<{ id: string; code: string; supplierId: string; totalCents: number }> = [];
  // O centro de custo e a conta contábil vêm da solicitação; ficam no pedido
  // para a exportação ao ERP não depender de uma segunda consulta.
  const requestFinance = await oneRow<{ cost_center_id: string | null; gl_account: string | null }>(
    c.env.DB,
    `SELECT cost_center_id, gl_account FROM purchase_requests WHERE id = ?`,
    [id],
  );

  for (const plan of orderPlans) {
    const orderId = uuid();
    const code = buildCode("PO", await nextCounter(c.env.DB, "purchase_order"));
    createdOrders.push({ id: orderId, code, supplierId: plan.supplierId, totalCents: plan.totalCents });
    statements.push(
      insertStatement(c.env.DB, "purchase_orders", {
        id: orderId,
        code,
        request_id: id,
        supplier_id: plan.supplierId,
        order_ref: plan.orderRef,
        status: "open",
        currency: "BRL",
        total_cents: plan.totalCents,
        cost_center_id: requestFinance?.cost_center_id ?? null,
        gl_account: requestFinance?.gl_account ?? null,
        sync_status: "pending",
        notes: plan.notes,
        created_by: user.id,
        created_at: ts,
        updated_at: ts,
      }),
    );
    for (const line of plan.items) {
      statements.push(
        insertStatement(c.env.DB, "purchase_order_items", {
          id: uuid(),
          order_id: orderId,
          request_item_id: line.itemId,
          qty_milli: line.qtyMilli,
          unit_price_cents: line.unitPriceCents,
          received_qty_milli: 0,
          created_at: ts,
          updated_at: ts,
        }),
        updateStatement(c.env.DB, "purchase_request_items", line.itemId, {
          qty_ordered_milli: line.qtyMilli,
          supplier_id: plan.supplierId,
          order_ref: plan.orderRef,
          unit_price_cents: line.unitPriceCents,
          status: "ordered",
          updated_at: ts,
        }),
      );
    }
    statements.push(
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "purchases",
        action: "purchase_order.create",
        entityType: "purchase_order",
        entityId: orderId,
        after: {
          code,
          requestId: id,
          supplierId: plan.supplierId,
          totalCents: plan.totalCents,
          items: plan.items,
        },
        ...info,
      }),
      outboxStatement(c.env.DB, {
        eventType: "purchase_order.created",
        aggregateType: "purchase_order",
        aggregateId: orderId,
        idempotencyKey: `purchase_order.created:${orderId}`,
        payload: {
          orderId,
          code,
          requestId: id,
          requestCode: request.code,
          supplierId: plan.supplierId,
          totalCents: plan.totalCents,
          currency: "BRL",
          costCenterId: requestFinance?.cost_center_id ?? null,
          glAccount: requestFinance?.gl_account ?? null,
          items: plan.items,
        },
        createdAt: ts,
      }),
    );
  }

  statements.push(
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: "ordered",
      approval_stage: "receipt",
      finance_status: "committed",
      approval_notes: body.notes ?? null,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_request.orders",
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status, approvalStage: request.approval_stage },
      after: {
        status: "ordered",
        approvalStage: "receipt",
        orders: createdOrders,
        costCenterId: requestFinance?.cost_center_id ?? null,
        glAccount: requestFinance?.gl_account ?? null,
      },
      reason: body.notes ?? null,
      ...info,
    }),
    outboxStatement(c.env.DB, {
      eventType: "purchase_request.ordered",
      aggregateType: "purchase_request",
      aggregateId: id,
      idempotencyKey: `purchase_request.ordered:${id}`,
      payload: {
        requestId: id,
        code: request.code,
        orders: createdOrders,
        costCenterId: requestFinance?.cost_center_id ?? null,
        glAccount: requestFinance?.gl_account ?? null,
        orderedBy: user.id,
        orderedAt: ts,
      },
      createdAt: ts,
    }),
  );

  if (request.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: request.requester_id,
        type: "purchase_ordered",
        title: `Pedido da solicitação ${request.code} registrado`,
        body: `${createdOrders.length} ${createdOrders.length === 1 ? "pedido" : "pedidos"} por fornecedor; acompanhe o recebimento.`,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true, status: "ordered", orders: createdOrders }, 201);
});

router.post("/:id/order", requirePermission(PERMISSIONS.PURCHASES_ORDER), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, orderBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.workflow_version === 2) {
    throw conflict("Use o pedido por fornecedor do fluxo corporativo (POST /api/purchases/:id/orders).");
  }
  if (!["approved", "purchasing", "quote_approved"].includes(request.status)) {
    throw conflict(
      request.status === "quoting" || request.status === "quote_returned"
        ? `Conclua a cotação e aguarde a aprovação antes de registrar o pedido. Status atual: ${request.status}.`
        : `Somente solicitações aprovadas podem virar pedido. Status atual: ${request.status}.`,
    );
  }
  // F-02: proposta aprovada vincula o pedido -- mesmo fornecedor e, quando o
  // preço não for informado, o valor cotado por item.
  const approvedQuote = await oneRow<{ id: string; code: string; supplier_id: string }>(
    c.env.DB,
    `SELECT id, code, supplier_id FROM purchase_quotes WHERE request_id = ? AND status = 'approved'`,
    [id],
  );
  if (approvedQuote && body.supplierId !== approvedQuote.supplier_id) {
    throw conflict(
      `A proposta ${approvedQuote.code} foi aprovada para esta solicitação; o pedido deve usar o fornecedor dela.`,
    );
  }
  const quotedPriceByItem = new Map<string, number>();
  if (approvedQuote) {
    const quotedPrices = await allRows<{ request_item_id: string; unit_price_cents: number }>(
      c.env.DB,
      `SELECT request_item_id, unit_price_cents FROM purchase_quote_items WHERE quote_id = ?`,
      [approvedQuote.id],
    );
    for (const price of quotedPrices) {
      quotedPriceByItem.set(price.request_item_id, Number(price.unit_price_cents));
    }
  }
  const supplier = await oneRow<{ id: string; is_active: number }>(
    c.env.DB,
    `SELECT id, is_active FROM suppliers WHERE id = ?`,
    [body.supplierId],
  );
  if (!supplier) throw notFound("Fornecedor não encontrado.");
  if (supplier.is_active !== 1) throw badRequest("O fornecedor informado esta inativo.");

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [];

  for (const item of body.items) {
    const existing = await oneRow<{
      id: string;
      qty_milli: number;
      qty_approved_milli: number | null;
      status: string;
    }>(
      c.env.DB,
      `SELECT id, qty_milli, qty_approved_milli, status FROM purchase_request_items WHERE id = ? AND request_id = ?`,
      [item.itemId, id],
    );
    if (!existing) throw notFound(`Item ${item.itemId} não pertence a esta solicitação.`);
    if (["rejected", "cancelled", "received"].includes(existing.status)) {
      throw conflict(`O item informado esta com status "${existing.status}" e não entra em novo pedido.`);
    }

    const orderedMilli = Math.round(item.qtyOrdered * 1000);
    const limit = existing.qty_approved_milli ?? existing.qty_milli;
    if (orderedMilli > limit) {
      throw badRequest("A quantidade pedida não pode ser maior que a quantidade aprovada.");
    }

    const orderedUnitPrice =
      item.unitPrice !== undefined ? Math.round(item.unitPrice * 100) : quotedPriceByItem.get(item.itemId);
    statements.push(
      updateStatement(c.env.DB, "purchase_request_items", item.itemId, {
        qty_ordered_milli: orderedMilli,
        supplier_id: body.supplierId,
        order_ref: body.orderRef ?? null,
        ...(orderedUnitPrice !== undefined ? { unit_price_cents: orderedUnitPrice } : {}),
        status: "ordered",
        updated_at: ts,
      }),
    );
  }

  statements.push(
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: "ordered",
      approval_stage: "receipt",
      finance_status: "committed",
      ...(body.notes !== undefined ? { notes: body.notes ?? null } : {}),
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_request.order",
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status },
      after: { status: "ordered", supplierId: body.supplierId, orderRef: body.orderRef ?? null },
      ...info,
    }),
  );

  if (request.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: request.requester_id,
        type: "purchase_ordered",
        title: `Solicitação ${request.code} virou pedido`,
        body: body.orderRef ? `Pedido ${body.orderRef}.` : null,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, status: "ordered" });
});

router.post("/:id/cancel", requirePermission(PERMISSIONS.PURCHASES_CANCEL), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, cancelBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);
  if (request.status === "cancelled") throw conflict("Esta solicitação já está cancelada.");
  if (request.status === "received") {
    throw conflict("Solicitação já recebida não pode ser cancelada. Registre uma devolução ou correção de estoque.");
  }
  if (request.status === "partially_received") {
    throw conflict(
      "Esta solicitação possui material já recebido. Cancele os itens pendentes ou registre a correção de estoque correspondente.",
    );
  }

  const ts = nowIso();
  const info = clientInfo(c);
  const statements: D1PreparedStatement[] = [
    updateStatement(c.env.DB, "purchase_requests", id, {
      status: "cancelled",
      cancel_reason: body.reason,
      updated_at: ts,
    }),
    c.env.DB
      .prepare(
        `UPDATE purchase_request_items SET status = 'cancelled', updated_at = ?
          WHERE request_id = ? AND status IN ('pending','approved','ordered','rejected')`,
      )
      .bind(ts, id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "purchases",
      action: "purchase_request.cancel",
      entityType: "purchase_request",
      entityId: id,
      before: { status: request.status },
      after: { status: "cancelled" },
      reason: body.reason,
      ...info,
    }),
  ];

  if (request.requester_id !== user.id) {
    statements.push(
      notificationStatement(c.env.DB, {
        userId: request.requester_id,
        type: "purchase_cancelled",
        title: `Solicitação ${request.code} cancelada`,
        body: body.reason,
        link: `/compras/${id}`,
        entityType: "purchase_request",
        entityId: id,
        createdAt: ts,
      }),
    );
  }

  await c.env.DB.batch(statements);

  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Recebimento                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Registra o recebimento (total ou parcial) de uma solicitação.
 *
 * Garantias:
 *  - `purchase_receipts.request_key` e UNIQUE: reenviar a mesma confirmação não
 *    cria um segundo recebimento;
 *  - cada linha gera exatamente UM movimento de entrada
 *    (`purchase_receipt_items.movement_id` e UNIQUE), impedindo entrada dupla;
 *  - a entrada de estoque, as linhas do recebimento e a atualização das
 *    quantidades recebidas acontecem na MESMA transação;
 *  - somente as quantidades efetivamente recebidas são somadas; o restante
 *    permanece pendente.
 */
router.post("/:id/receipts", requirePermission(PERMISSIONS.PURCHASES_RECEIVE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, receiptBody);

  const request = await requireRequest(c.env.DB, id);
  assertPurchaseVisible(user, request);

  // Reenvio da mesma confirmação (retry após timeout, duplo clique): devolve o
  // recebimento já registrado em vez de recusar pelo status atual -- a recusa
  // faria o cliente acreditar que nada entrou quando a entrada já aconteceu.
  const previous = await oneRow<{ id: string; code: string; request_id: string }>(
    c.env.DB,
    `SELECT id, code, request_id FROM purchase_receipts WHERE request_key = ?`,
    [body.requestKey],
  );
  if (previous) {
    if (previous.request_id !== id) {
      throw conflict(
        "O identificador de requisição informado já foi usado em outro recebimento. Gere um novo identificador.",
      );
    }
    return c.json({ receipt: { id: previous.id, code: previous.code }, idempotentReplay: true }, 200);
  }

  if (["draft", "pending_approval", "rejected", "cancelled", "received"].includes(request.status)) {
    throw conflict(`Não é possível receber material de uma solicitação com status "${request.status}".`);
  }
  assertLocationAllowed(user, body.locationId);
  await assertLocationActive(c.env.DB, body.locationId);

  const directUseCount = body.items.filter((line) => line.directUse).length;
  if (directUseCount > 0 && (body.directUseReason ?? "").trim().length < 5) {
    throw badRequest("Descreva a justificativa do uso direto do material (mínimo 5 caracteres).");
  }

  const requestItemIds = body.items.map((i) => i.requestItemId);
  const duplicated = findDuplicates(requestItemIds);
  if (duplicated.length > 0) {
    throw badRequest("O mesmo item aparece mais de uma vez no recebimento. Some as quantidades.");
  }

  const rows = await allRows<{
    id: string;
    product_id: string | null;
    description: string | null;
    qty_milli: number;
    qty_approved_milli: number | null;
    qty_ordered_milli: number | null;
    qty_received_milli: number;
    status: string;
    unit_price_cents: number | null;
  }>(
    c.env.DB,
    `SELECT id, product_id, description, qty_milli, qty_approved_milli, qty_ordered_milli,
            qty_received_milli, status, unit_price_cents
       FROM purchase_request_items
      WHERE request_id = ? AND id IN (${requestItemIds.map(() => "?").join(",")})`,
    [id, ...requestItemIds],
  );
  if (rows.length !== requestItemIds.length) {
    throw badRequest("Um dos itens informados não pertence a esta solicitação.");
  }

  const orderLinks = await allRows<{
    order_id: string;
    order_item_id: string;
    request_item_id: string;
    supplier_id: string;
  }>(
    c.env.DB,
    `SELECT po.id AS order_id, poi.id AS order_item_id, poi.request_item_id, po.supplier_id
       FROM purchase_order_items poi
       JOIN purchase_orders po ON po.id = poi.order_id
      WHERE po.request_id = ?
        AND poi.request_item_id IN (${requestItemIds.map(() => "?").join(",")})`,
    [id, ...requestItemIds],
  );
  const orderLinkByItem = new Map(orderLinks.map((row) => [row.request_item_id, row]));
  if (body.purchaseOrderId) {
    const selectedOrders = new Set(orderLinks.map((row) => row.order_id));
    if (selectedOrders.size !== 1 || !selectedOrders.has(body.purchaseOrderId)) {
      throw badRequest("O recebimento informado não corresponde a um único pedido desta solicitação.");
    }
  }
  const selectedOrderIds = new Set(orderLinks.map((row) => row.order_id));
  const receiptOrderId =
    body.purchaseOrderId ?? (selectedOrderIds.size === 1 ? [...selectedOrderIds][0] : null);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const receiptId = uuid();
  const ts = nowIso();
  const code = buildCode("REC", await nextCounter(c.env.DB, "purchase_receipt"));
  const receivedAt = body.receivedAt ?? ts;

  const movements: MovementRequest[] = [];
  const receiptLines: {
    requestItemId: string;
    productId: string;
    qtyMilli: number;
    unitPriceCents: number | null;
    hasDiscrepancy: boolean;
    discrepancyNote: string | null;
    notes: string | null;
  }[] = [];

  // Cadastro rápido: item sem produto no catálogo pode ser recebido criando o
  // produto na hora, apenas com o nome (unidade opcional). O produto nasce com
  // `catalog_status = 'incomplete'`; o alerta e a notificação para quem cuida
  // do catálogo só saem quando o cadastro for completado.
  const quickProducts: { id: string; name: string; uomId: string; requestItemId: string }[] = [];
  const quickNames = new Set<string>();
  let fallbackUomId: string | null = null;
  const resolveQuickUom = async (uomId: string | null | undefined): Promise<string> => {
    if (uomId) {
      const row = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM uoms WHERE id = ?`, [uomId]);
      if (!row) throw badRequest("A unidade de medida informada para o produto novo não existe.");
      return row.id;
    }
    if (!fallbackUomId) {
      const row = await oneRow<{ id: string }>(c.env.DB, `SELECT id FROM uoms WHERE code = 'UN' LIMIT 1`);
      if (!row) {
        throw badRequest("Informe a unidade de medida do produto novo (nenhuma unidade padrão encontrada).");
      }
      fallbackUomId = row.id;
    }
    return fallbackUomId;
  };

  for (const line of body.items) {
    const item = byId.get(line.requestItemId)!;
    let productId = item.product_id;
    if (!productId) {
      if (!line.newProduct) {
        throw badRequest(
          "Itens sem produto cadastrado (apenas descrição) não entram no estoque. Informe o nome para cadastrar o produto agora ou vincule um produto existente no catálogo.",
          { itemId: item.id, description: item.description },
        );
      }
      const name = line.newProduct.name.trim();
      const nameKey = name.toLocaleLowerCase("pt-BR");
      if (quickNames.has(nameKey)) {
        throw badRequest(
          `O produto "${name}" foi informado mais de uma vez no cadastro rápido. Una as quantidades em um único item.`,
        );
      }
      quickNames.add(nameKey);
      productId = uuid();
      quickProducts.push({
        id: productId,
        name,
        uomId: await resolveQuickUom(line.newProduct.uomId),
        requestItemId: item.id,
      });
    }
    if (["rejected", "cancelled"].includes(item.status)) {
      throw conflict(`O item "${item.description ?? item.id}" esta ${item.status} e não pode ser recebido.`);
    }

    const targetMilli = item.qty_ordered_milli ?? item.qty_approved_milli ?? item.qty_milli;
    const remaining = targetMilli - item.qty_received_milli;
    const qtyMilli = Math.round(line.receivedQty * 1000);

    if (remaining <= 0) {
      throw conflict(`O item "${item.description ?? item.id}" já foi recebido integralmente.`);
    }
    if (qtyMilli > remaining) {
      throw badRequest(
        `A quantidade recebida excede o saldo pendente do item "${item.description ?? item.id}" (pendente: ${remaining / 1000}).`,
        { itemId: item.id, remainingMilli: remaining, receivedMilli: qtyMilli },
      );
    }

    const unitPriceCents =
      line.unitPrice !== undefined ? Math.round(line.unitPrice * 100) : item.unit_price_cents;

    movements.push({
      type: "purchase_receipt",
      productId,
      qtyMilli,
      fromLocationId: null,
      toLocationId: body.locationId,
      reason: `Recebimento ${code} da solicitação ${request.code}`,
      counterparty: body.documentRef ?? null,
      refType: "purchase_receipt",
      refId: receiptId,
      notes: line.notes ?? body.notes ?? null,
      requestKey: `${body.requestKey}#${movements.length}`,
      unitCostCents: unitPriceCents,
      userId: user.id,
    });

    receiptLines.push({
      requestItemId: item.id,
      productId,
      qtyMilli,
      unitPriceCents,
      hasDiscrepancy: line.hasDiscrepancy,
      discrepancyNote: line.discrepancyNote ?? null,
      notes: line.notes ?? null,
    });
  }

  // Uso direto (F-06): depois das entradas, gera a saída imediata de cada item
  // marcado -- duas movimentações no livro-razão (entrada de compra + consumo),
  // com a justificativa registrada em cada uma.
  body.items.forEach((line, index) => {
    if (!line.directUse) return;
    const receiptLine = receiptLines[index];
    if (!receiptLine) return;
    movements.push({
      type: "consumption",
      productId: receiptLine.productId,
      qtyMilli: receiptLine.qtyMilli,
      fromLocationId: body.locationId,
      toLocationId: null,
      reason: `Uso direto no recebimento ${code}: ${(body.directUseReason ?? "").trim()}`,
      counterparty: null,
      refType: "purchase_receipt",
      refId: receiptId,
      notes: line.notes ?? body.notes ?? null,
      requestKey: `${body.requestKey}#u${index}`,
      unitCostCents: receiptLine.unitPriceCents,
      userId: user.id,
    });
  });

  const info = clientInfo(c);
  const supplierRow = await oneRow<{ supplier_id: string | null }>(
    c.env.DB,
    `SELECT supplier_id FROM purchase_request_items WHERE request_id = ? AND supplier_id IS NOT NULL LIMIT 1`,
    [id],
  );

  // Produtos do cadastro rápido entram ANTES das movimentações no mesmo lote
  // (a movimentação referência o produto) e o item da solicitação passa a
  // apontar para o produto novo.
  const quickStatements: D1PreparedStatement[] = [];
  for (const product of quickProducts) {
    quickStatements.push(
      insertStatement(c.env.DB, "products", {
        id: product.id,
        sku: null,
        name: product.name,
        description: null,
        category_id: null,
        uom_id: product.uomId,
        pack_uom_id: null,
        pack_factor: 1,
        min_qty_milli: 0,
        default_supplier_id: null,
        requires_location: 1,
        is_active: 1,
        catalog_status: "incomplete",
        notes: `Cadastro rápido no recebimento ${code} da solicitação ${request.code}.`,
        created_at: ts,
        updated_at: ts,
      }),
    );
    quickStatements.push(
      updateStatement(c.env.DB, "purchase_request_items", product.requestItemId, {
        product_id: product.id,
        updated_at: ts,
      }),
    );
  }
  const catalogManagers = quickProducts.length
    ? await usersWithPermission(c.env.DB, PERMISSIONS.CATALOG_MANAGE)
    : [];

  const results = await recordMovements(c.env.DB, { id: user.id, name: user.name }, movements, {
    preStatements: quickStatements,
    extraStatements: (recorded) => {
      const statements: D1PreparedStatement[] = [
        insertStatement(c.env.DB, "purchase_receipts", {
          id: receiptId,
          code,
          request_key: body.requestKey,
          request_id: id,
          supplier_id: supplierRow?.supplier_id ?? null,
          purchase_order_id: receiptOrderId,
          received_by: user.id,
          received_at: receivedAt,
          document_ref: body.documentRef ?? null,
          notes: body.notes ?? null,
          status: "confirmed",
          created_at: ts,
        }),
      ];

      receiptLines.forEach((line, index) => {
        statements.push(
          insertStatement(c.env.DB, "purchase_receipt_items", {
            id: uuid(),
            receipt_id: receiptId,
            request_item_id: line.requestItemId,
            purchase_order_item_id: orderLinkByItem.get(line.requestItemId)?.order_item_id ?? null,
            product_id: line.productId,
            qty_milli: line.qtyMilli,
            to_location_id: body.locationId,
            movement_id: recorded[index]?.id ?? null,
            has_discrepancy: line.hasDiscrepancy ? 1 : 0,
            discrepancy_note: line.discrepancyNote,
            notes: line.notes,
            created_at: ts,
          }),
        );
        statements.push(
          c.env.DB
            .prepare(
              `UPDATE purchase_request_items
                  SET qty_received_milli = qty_received_milli + ?,
                      status = CASE
                        WHEN qty_received_milli + ? >= COALESCE(qty_ordered_milli, qty_approved_milli, qty_milli)
                          THEN 'received'
                        ELSE 'partially_received'
                      END,
                      updated_at = ?
                WHERE id = ?`,
            )
            .bind(line.qtyMilli, line.qtyMilli, ts, line.requestItemId),
        );
        const orderLink = orderLinkByItem.get(line.requestItemId);
        if (orderLink) {
          statements.push(
            c.env.DB
              .prepare(
                `UPDATE purchase_order_items
                    SET received_qty_milli = received_qty_milli + ?, updated_at = ?
                  WHERE id = ?`,
              )
              .bind(line.qtyMilli, ts, orderLink.order_item_id),
            c.env.DB
              .prepare(
                `UPDATE purchase_orders
                    SET status = CASE
                          WHEN (SELECT COUNT(*) FROM purchase_order_items poi
                                 WHERE poi.order_id = purchase_orders.id
                                   AND poi.received_qty_milli < poi.qty_milli) = 0
                            THEN 'received'
                          WHEN (SELECT COUNT(*) FROM purchase_order_items poi
                                 WHERE poi.order_id = purchase_orders.id
                                   AND poi.received_qty_milli > 0) > 0
                            THEN 'partially_received'
                          ELSE status
                        END,
                        updated_at = ?
                  WHERE id = ?`,
              )
              .bind(ts, orderLink.order_id),
          );
        }
      });

      statements.push(
        c.env.DB
          .prepare(
            `UPDATE purchase_requests
                SET status = CASE
                      WHEN (SELECT COUNT(*) FROM purchase_request_items i
                             WHERE i.request_id = purchase_requests.id
                               AND i.status NOT IN ('received','rejected','cancelled')) = 0
                        THEN 'received'
                      ELSE 'partially_received'
                    END,
                    approval_stage = CASE
                      WHEN (SELECT COUNT(*) FROM purchase_request_items i
                             WHERE i.request_id = purchase_requests.id
                               AND i.status NOT IN ('received','rejected','cancelled')) = 0
                        THEN 'completed'
                      ELSE 'receipt'
                    END,
                    finance_status = CASE
                      WHEN (SELECT COUNT(*) FROM purchase_request_items i
                             WHERE i.request_id = purchase_requests.id
                               AND i.status NOT IN ('received','rejected','cancelled')) = 0
                        THEN 'received'
                      ELSE 'committed'
                    END,
                    updated_at = ?
              WHERE id = ?`,
          )
          .bind(ts, id),
        auditStatement(c.env.DB, {
          actor: { id: user.id, name: user.name },
          module: "purchases",
          action: "purchase_receipt.confirm",
          entityType: "purchase_receipt",
          entityId: receiptId,
          after: {
            code,
            requestId: id,
            locationId: body.locationId,
            documentRef: body.documentRef ?? null,
            lines: receiptLines.map((l) => ({
              requestItemId: l.requestItemId,
              productId: l.productId,
              qtyMilli: l.qtyMilli,
              hasDiscrepancy: l.hasDiscrepancy,
            })),
            quickProducts: quickProducts.map((p) => ({ id: p.id, name: p.name, catalogStatus: "incomplete" })),
            movementIds: recorded.map((r) => r.id),
            directUse: directUseCount > 0,
            directUseReason: directUseCount > 0 ? (body.directUseReason ?? "").trim() : null,
          },
          reason: receiptLines.some((l) => l.hasDiscrepancy) ? "Recebimento com divergência registrada." : null,
          ...info,
        }),
        outboxStatement(c.env.DB, {
          eventType: "goods_receipt.posted",
          aggregateType: "purchase_receipt",
          aggregateId: receiptId,
          idempotencyKey: `goods_receipt.posted:${receiptId}`,
          payload: {
            receiptId,
            code,
            requestId: id,
            requestCode: request.code,
            purchaseOrderId: receiptOrderId,
            locationId: body.locationId,
            documentRef: body.documentRef ?? null,
            receivedAt,
            lines: receiptLines.map((line, index) => ({
              requestItemId: line.requestItemId,
              purchaseOrderItemId:
                orderLinkByItem.get(line.requestItemId)?.order_item_id ?? null,
              productId: line.productId,
              qtyMilli: line.qtyMilli,
              unitPriceCents: line.unitPriceCents,
              movementId: recorded[index]?.id ?? null,
            })),
          },
          createdAt: ts,
        }),
      );

      if (request.requester_id !== user.id) {
        statements.push(
          notificationStatement(c.env.DB, {
            userId: request.requester_id,
            type: "purchase_received",
            title: `Recebimento ${code} registrado`,
            body: `Solicitação ${request.code}: material recebido em estoque.`,
            link: `/compras/${id}`,
            entityType: "purchase_receipt",
            entityId: receiptId,
            createdAt: ts,
          }),
        );
      }

      // Cadastro rápido: auditoria + aviso persistente para quem cuida do
      // catálogo completar os dados. O alerta no painel só desaparece quando o
      // cadastro for concluído.
      for (const product of quickProducts) {
        statements.push(
          auditStatement(c.env.DB, {
            actor: { id: user.id, name: user.name },
            module: "catalog",
            action: "product.quick_register",
            entityType: "product",
            entityId: product.id,
            after: {
              name: product.name,
              uomId: product.uomId,
              catalogStatus: "incomplete",
              receiptCode: code,
              requestId: id,
            },
            reason: "Cadastro rápido durante recebimento de compra.",
            ...info,
          }),
          ...notificationStatements(c.env.DB, catalogManagers, {
            type: "product_incomplete",
            title: `Produto "${product.name}" precisa completar o cadastro`,
            body: `Criado no recebimento ${code}. Complete categoria, SKU e demais dados no catálogo.`,
            link: "/catalogo?tab=products&incomplete=true",
            entityType: "product",
            entityId: product.id,
            createdAt: ts,
          }),
        );
      }

      return statements;
    },
  });

  const replay = results.every((r) => r.idempotentReplay);
  if (replay) {
    const existing = await oneRow<{ id: string; code: string }>(
      c.env.DB,
      `SELECT id, code FROM purchase_receipts WHERE request_key = ?`,
      [body.requestKey],
    );
    return c.json({ receipt: existing, idempotentReplay: true }, 200);
  }

  return c.json(
    {
      receipt: { id: receiptId, code },
      movements: results.map((r) => r.id),
      createdProducts: quickProducts.map((p) => ({ id: p.id, name: p.name, catalogStatus: "incomplete" })),
      idempotentReplay: false,
    },
    201,
  );
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

interface RequestRow {
  id: string;
  code: string;
  status: string;
  priority: string;
  requester_id: string;
  location_id: string | null;
  justification: string | null;
  workflow_version: number;
  approval_stage: string;
  routing: string;
  manager_approved_by: string | null;
}

async function requireRequest(db: D1Database, id: string | undefined): Promise<RequestRow> {
  if (!id) throw badRequest("Solicitação não informada.");
  const row = await oneRow<RequestRow>(
    db,
    `SELECT id, code, status, priority, requester_id, location_id, justification,
            workflow_version, approval_stage, routing, manager_approved_by
       FROM purchase_requests WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Solicitação de compra não encontrada.");
  return row;
}

async function assertCostCenterActive(db: D1Database, costCenterId: string): Promise<void> {
  const row = await oneRow<{ is_active: number }>(
    db,
    `SELECT is_active FROM cost_centers WHERE id = ?`,
    [costCenterId],
  );
  if (!row) throw notFound("Centro de custo não encontrado.");
  if (row.is_active !== 1) throw badRequest("O centro de custo está inativo.");
}

async function assertLocationActive(db: D1Database, locationId: string): Promise<void> {
  const location = await oneRow<{ is_active: number }>(db, `SELECT is_active FROM locations WHERE id = ?`, [
    locationId,
  ]);
  if (!location) throw notFound("Local não encontrado.");
  if (location.is_active !== 1) throw badRequest("Este local esta inativo.");
}

async function assertItemsReference(
  db: D1Database,
  items: { productId?: string | null; uomId?: string | null; description?: string | null }[],
): Promise<void> {
  const productIds = items.map((i) => i.productId ?? null);
  const uomIds = items.map((i) => i.uomId ?? null);

  const products = [...new Set(productIds.filter((v): v is string => Boolean(v)))];
  if (products.length > 0) {
    const found = await allRows<{ id: string; is_active: number }>(
      db,
      `SELECT id, is_active FROM products WHERE id IN (${products.map(() => "?").join(",")})`,
      products,
    );
    if (found.length !== products.length) throw badRequest("Um dos produtos informados não existe.");
    const inactive = found.filter((p) => p.is_active !== 1);
    if (inactive.length > 0) throw badRequest("Produto inativo não pode ser solicitado.");
  }

  const uoms = [...new Set(uomIds.filter((v): v is string => Boolean(v)))];
  if (uoms.length > 0) {
    const found = await allRows<{ id: string }>(
      db,
      `SELECT id FROM uoms WHERE id IN (${uoms.map(() => "?").join(",")})`,
      uoms,
    );
    if (found.length !== uoms.length) throw badRequest("Uma das unidades de medida informadas não existe.");
  }

  // Cada item precisa ser identificável: ou aponta para um produto do catálogo,
  // ou descreve em texto o que deve ser comprado. Sem isso não há o que cotar,
  // aprovar ou receber.
  const unidentified = items.filter((item) => !item.productId && !(item.description ?? "").trim());
  if (unidentified.length > 0) {
    throw badRequest("Informe o produto do catálogo ou a descrição do item que deve ser comprado.");
  }
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

function mapRequest(row: Record<string, unknown>) {
  const expected = Number(row.expected_qty_milli ?? 0);
  const received = Number(row.received_qty_milli ?? 0);
  return {
    id: String(row.id),
    code: String(row.code),
    requesterId: String(row.requester_id),
    requesterName: String(row.requester_name),
    locationId: row.location_id ? String(row.location_id) : null,
    locationName: row.location_name ? String(row.location_name) : null,
    locationPath: row.location_path ? String(row.location_path) : null,
    justification: row.justification ? String(row.justification) : null,
    priority: String(row.priority),
    status: String(row.status),
    workflowVersion: Number(row.workflow_version ?? 1),
    approvalStage: String(row.approval_stage ?? "completed"),
    routing: String(row.routing ?? "standard"),
    budgetStatus: String(row.budget_status ?? "not_required"),
    budgetNotes: row.budget_notes ? String(row.budget_notes) : null,
    costCenterId: row.cost_center_id ? String(row.cost_center_id) : null,
    costCenterCode: row.cost_center_code ? String(row.cost_center_code) : null,
    costCenterName: row.cost_center_name ? String(row.cost_center_name) : null,
    glAccount: row.gl_account ? String(row.gl_account) : null,
    externalRef: row.external_ref ? String(row.external_ref) : null,
    financeStatus: String(row.finance_status ?? "not_required"),
    desiredDate: row.desired_date ? String(row.desired_date) : null,
    approvedBy: row.approved_by ? String(row.approved_by) : null,
    approvedByName: row.approved_by_name ? String(row.approved_by_name) : null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    approvalNotes: row.approval_notes ? String(row.approval_notes) : null,
    managerApprovedBy: row.manager_approved_by ? String(row.manager_approved_by) : null,
    managerApprovedByName: row.manager_approved_by_name ? String(row.manager_approved_by_name) : null,
    managerApprovedAt: row.manager_approved_at ? String(row.manager_approved_at) : null,
    directionApprovedBy: row.direction_approved_by ? String(row.direction_approved_by) : null,
    directionApprovedByName: row.direction_approved_by_name
      ? String(row.direction_approved_by_name)
      : null,
    directionApprovedAt: row.direction_approved_at ? String(row.direction_approved_at) : null,
    directAuthorizedBy: row.direct_authorized_by ? String(row.direct_authorized_by) : null,
    directAuthorizedByName: row.direct_authorized_by_name
      ? String(row.direct_authorized_by_name)
      : null,
    directAuthorizedAt: row.direct_authorized_at ? String(row.direct_authorized_at) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    itemCount: Number(row.item_count ?? 0),
    pendingItemCount: Number(row.pending_item_count ?? 0),
    quoteItemCount: Number(row.quote_item_count ?? 0),
    quoteCount: Number(row.quote_count ?? 0),
    receiptCount: Number(row.receipt_count ?? 0),
    receivedQtyMilli: received,
    expectedQtyMilli: expected,
    pendingQtyMilli: Math.max(0, expected - received),
    fullyReceived: expected > 0 && received >= expected,
  };
}

function mapRequestItem(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    requestId: String(row.request_id),
    productId: row.product_id ? String(row.product_id) : null,
    productName: row.product_name ? String(row.product_name) : null,
    sku: row.sku ? String(row.sku) : null,
    description: row.description ? String(row.description) : null,
    qtyMilli: Number(row.qty_milli),
    uomId: row.uom_id ? String(row.uom_id) : null,
    uomCode: row.uom_code ? String(row.uom_code) : null,
    qtyApprovedMilli:
      row.qty_approved_milli === null || row.qty_approved_milli === undefined
        ? null
        : Number(row.qty_approved_milli),
    qtyOrderedMilli:
      row.qty_ordered_milli === null || row.qty_ordered_milli === undefined
        ? null
        : Number(row.qty_ordered_milli),
    qtyReceivedMilli: Number(row.qty_received_milli),
    pendingQtyMilli: Math.max(
      0,
      Number(row.qty_ordered_milli ?? row.qty_approved_milli ?? row.qty_milli) - Number(row.qty_received_milli),
    ),
    supplierId: row.supplier_id ? String(row.supplier_id) : null,
    supplierName: row.supplier_name ? String(row.supplier_name) : null,
    orderRef: row.order_ref ? String(row.order_ref) : null,
    unitPriceCents:
      row.unit_price_cents === null || row.unit_price_cents === undefined ? null : Number(row.unit_price_cents),
    purchaseMode: row.purchase_mode ? String(row.purchase_mode) : null,
    status: String(row.status),
    notes: row.notes ? String(row.notes) : null,
  };
}

export default router;
