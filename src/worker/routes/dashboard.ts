import { Hono } from "hono";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { currentUser, requireAuth, requirePermission } from "../auth";
import { allRows, countRows, oneRow } from "../db";
import { nowIso } from "../util";
import { lowStockScope } from "./reports";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/**
 * Painel inicial.
 *
 * Cada bloco devolve estado REAL lido das tabelas: nenhum indicador e simulação.
 * Quando o usuário tem escopo de local, os números de estoque ficam restritos
 * aos locais permitidos (o mesmo filtro que as rotas de estoque aplicam).
 */
router.get("/summary", requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (c) => {
  const user = currentUser(c);
  const now = nowIso();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const can = (code: string) => user.permissions.has(code);
  // Visibilidade de tickets segue a mesma regra de /api/tickets: sem
  // `tickets.view_all`, só contam os chamados dos quais o usuário participa
  // (autor ou responsável). Nada de número global para o solicitante.
  const ticketsAll = can(PERMISSIONS.TICKETS_VIEW_ALL);
  const ticketScope = ticketsAll ? "" : "AND (t.requester_id = ? OR t.assignee_id = ?)";
  const ticketParams = ticketsAll ? [] : [user.id, user.id];
  // Visões de gestão (painel do gerente/admin) — F-20.
  const isManagerView = user.roleCode === "facilities_manager" || user.roleCode === "admin";

  const scopeClause =
    user.locationScope.length > 0
      ? `stock.location_id IN (${user.locationScope.map(() => "?").join(",")})`
      : "1=1";
  const scopeParams = user.locationScope;
  const lowStockAlertScope = await lowStockScope(c.env.DB);
  // O painel segue o escopo configurado do alerta de estoque mínimo
  // (`stock.low_stock_scope`), igual aos relatórios: por local (uma linha por
  // local abaixo do mínimo) ou global (uma linha por produto, somando locais).
  const lowStockQuery =
    lowStockAlertScope === "global"
      ? `SELECT p.id, p.name, p.sku, NULL AS location_id, NULL AS location_name,
                SUM(stock.qty_milli) AS qty_milli, p.min_qty_milli,
                SUM(stock.qty_milli) AS total_qty_milli,
                COUNT(DISTINCT stock.location_id) AS location_count,
                u.code AS uom_code
           FROM stock
           JOIN products p ON p.id = stock.product_id
           LEFT JOIN uoms u ON u.id = p.uom_id
          WHERE p.is_active = 1 AND p.min_qty_milli > 0
            AND ${scopeClause}
          GROUP BY p.id
         HAVING SUM(stock.qty_milli) <= p.min_qty_milli
          ORDER BY (SUM(stock.qty_milli) * 1.0 / NULLIF(p.min_qty_milli, 0)) ASC, p.name
          LIMIT 10`
      : `SELECT p.id, p.name, p.sku, l.id AS location_id, l.name AS location_name,
                stock.qty_milli, p.min_qty_milli, NULL AS location_count,
                (SELECT COALESCE(SUM(s2.qty_milli), 0) FROM stock s2
                  WHERE s2.product_id = p.id) AS total_qty_milli,
                u.code AS uom_code
           FROM stock
           JOIN products p ON p.id = stock.product_id
           JOIN locations l ON l.id = stock.location_id
           LEFT JOIN uoms u ON u.id = p.uom_id
          WHERE p.is_active = 1 AND p.min_qty_milli > 0
            AND stock.qty_milli <= p.min_qty_milli
            AND ${scopeClause}
          ORDER BY (stock.qty_milli * 1.0 / NULLIF(p.min_qty_milli, 0)) ASC, p.name
          LIMIT 10`;

  const [
    stockTotals,
    lowStock,
    consumption30,
    tickets,
    workOrders,
    purchases,
    inventories,
    movements,
    mineTickets,
    mineWoStats,
    mineChecklistCount,
    mineWoList,
    managerChecklist,
    pendingApprovals,
    awaitingOrder,
    toReceiveOrders,
  ] = await Promise.all([
      can(PERMISSIONS.STOCK_VIEW)
        ? oneRow<{ items: number; units: number; locations: number }>(
            c.env.DB,
            `SELECT COUNT(*) AS items,
                    COALESCE(SUM(stock.qty_milli), 0) AS units,
                    COUNT(DISTINCT stock.location_id) AS locations
               FROM stock WHERE ${scopeClause}`,
            scopeParams,
          )
        : Promise.resolve(null),
      can(PERMISSIONS.STOCK_VIEW)
        ? allRows<Record<string, unknown>>(c.env.DB, lowStockQuery, scopeParams)
        : Promise.resolve([]),
      can(PERMISSIONS.CONSUMPTION_VIEW)
        ? oneRow<{ qty_milli: number; records: number }>(
            c.env.DB,
            `SELECT COALESCE(SUM(ci.qty_milli), 0) AS qty_milli, COUNT(DISTINCT cr.id) AS records
               FROM consumption_records cr
               JOIN consumption_items ci ON ci.consumption_id = cr.id
              WHERE cr.status = 'registered' AND cr.period_end >= ?
                ${user.locationScope.length > 0 ? `AND cr.location_id IN (${user.locationScope.map(() => "?").join(",")})` : ""}`,
            [since30.slice(0, 10), ...scopeParams],
          )
        : Promise.resolve(null),
      can(PERMISSIONS.TICKETS_VIEW)
        ? oneRow<Record<string, number>>(
            c.env.DB,
            `SELECT
               SUM(CASE WHEN t.status IN ('open','in_progress','waiting_material') THEN 1 ELSE 0 END) AS open_count,
               SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS pending_count,
               SUM(CASE WHEN t.priority IN ('high','urgent') AND t.status IN ('open','in_progress','waiting_material') THEN 1 ELSE 0 END) AS critical_count,
               SUM(CASE WHEN t.status = 'resolved' AND t.resolved_at >= ? THEN 1 ELSE 0 END) AS resolved_30d
             FROM tickets t
            WHERE 1=1 ${ticketScope}`,
            [since30, ...ticketParams],
          )
        : Promise.resolve(null),
      can(PERMISSIONS.WORKORDERS_VIEW)
        ? oneRow<Record<string, number>>(
            c.env.DB,
            `SELECT
               SUM(CASE WHEN status IN ('open','planned','in_progress','waiting_material') THEN 1 ELSE 0 END) AS open_count,
               SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
               SUM(CASE WHEN status = 'waiting_material' THEN 1 ELSE 0 END) AS waiting_material_count,
               SUM(CASE WHEN status = 'done' AND finished_at >= ? THEN 1 ELSE 0 END) AS done_30d,
               SUM(CASE WHEN assignee_id = ? AND status IN ('open','planned','in_progress','waiting_material') THEN 1 ELSE 0 END) AS mine_open
             FROM work_orders`,
            [since30, user.id],
          )
        : Promise.resolve(null),
      can(PERMISSIONS.PURCHASES_VIEW)
        ? oneRow<Record<string, number>>(
            c.env.DB,
            `SELECT
               SUM(CASE WHEN status = 'pending_approval' THEN 1 ELSE 0 END) AS pending_approval,
               SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END) AS ordered,
               SUM(CASE WHEN status = 'partially_received' THEN 1 ELSE 0 END) AS partially_received,
               COUNT(*) AS total_open
             FROM purchase_requests
             WHERE status NOT IN ('received','cancelled','rejected')`,
          )
        : Promise.resolve(null),
      can(PERMISSIONS.INVENTORY_VIEW)
        ? oneRow<{ open_count: number }>(
            c.env.DB,
            `SELECT COUNT(*) AS open_count FROM inventories WHERE status IN ('open','counting')`,
          )
        : Promise.resolve(null),
      can(PERMISSIONS.STOCK_VIEW)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT m.id, m.type, m.qty_milli, m.occurred_at, m.reason,
                    p.name AS product_name, p.sku,
                    fl.name AS from_location_name, tl.name AS to_location_name,
                    u.name AS user_name,
                    COALESCE(fl.path, tl.path) AS location_path
               FROM movements m
               JOIN products p ON p.id = m.product_id
               LEFT JOIN locations fl ON fl.id = m.from_location_id
               LEFT JOIN locations tl ON tl.id = m.to_location_id
               JOIN users u ON u.id = m.user_id
              ${user.locationScope.length > 0
                ? `WHERE (m.from_location_id IN (${user.locationScope.map(() => "?").join(",")})
                          OR m.to_location_id IN (${user.locationScope.map(() => "?").join(",")}))`
                : ""}
              ORDER BY m.occurred_at DESC, m.id DESC
              LIMIT 12`,
            user.locationScope.length > 0 ? [...scopeParams, ...scopeParams] : [],
          )
        : Promise.resolve([]),
      // --- Visões por perfil (F-20) -----------------------------------------
      // "Meus chamados": sempre escopado à participação (autor ou responsável),
      // independente de view_all — a lista é pessoal, nunca a fila global.
      can(PERMISSIONS.TICKETS_VIEW)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT t.id, t.code, t.title, t.status, t.priority, t.created_at, t.updated_at
               FROM tickets t
              WHERE (t.requester_id = ? OR t.assignee_id = ?)
              ORDER BY t.updated_at DESC, t.id DESC
              LIMIT 8`,
            [user.id, user.id],
          )
        : Promise.resolve([]),
      // Números das ordens atribuídas a mim (visão do técnico).
      can(PERMISSIONS.WORKORDERS_VIEW)
        ? oneRow<Record<string, number>>(
            c.env.DB,
            `SELECT
               SUM(CASE WHEN status IN ('open','planned','in_progress','waiting_material') THEN 1 ELSE 0 END) AS open_count,
               SUM(CASE WHEN status = 'waiting_material' THEN 1 ELSE 0 END) AS waiting_material_count,
               SUM(CASE WHEN status = 'done' AND finished_at >= ? THEN 1 ELSE 0 END) AS done_30d
             FROM work_orders WHERE assignee_id = ?`,
            [since30, user.id],
          )
        : Promise.resolve(null),
      // Etapas obrigatórias (criadas pelo gerente de facilities) pendentes nas
      // MINHAS ordens ativas: é o número que bloqueia a conclusão.
      can(PERMISSIONS.WORKORDERS_VIEW)
        ? countRows(
            c.env.DB,
            `SELECT COUNT(*) FROM work_order_checklist_items ci
               JOIN work_orders w ON w.id = ci.work_order_id
               JOIN users cu ON cu.id = ci.created_by
               JOIN roles cr ON cr.id = cu.role_id
              WHERE w.assignee_id = ?
                AND w.status IN ('open','planned','in_progress','waiting_material')
                AND ci.is_done = 0 AND cr.code = 'facilities_manager'`,
            [user.id],
          )
        : Promise.resolve(0),
      // Minhas ordens ativas, com o progresso do checklist por ordem.
      can(PERMISSIONS.WORKORDERS_VIEW)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT w.id, w.code, w.title, w.status, w.priority, w.planned_at,
                    l.name AS location_name,
                    (SELECT COUNT(*) FROM work_order_checklist_items ci
                      WHERE ci.work_order_id = w.id AND ci.is_done = 0) AS checklist_pending,
                    (SELECT COUNT(*) FROM work_order_checklist_items ci
                       JOIN users cu ON cu.id = ci.created_by
                       JOIN roles cr ON cr.id = cu.role_id
                      WHERE ci.work_order_id = w.id AND ci.is_done = 0
                        AND cr.code = 'facilities_manager') AS checklist_manager_pending
               FROM work_orders w
               LEFT JOIN locations l ON l.id = w.location_id
              WHERE w.assignee_id = ?
                AND w.status IN ('open','planned','in_progress','waiting_material')
              ORDER BY CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                                       WHEN 'normal' THEN 2 ELSE 3 END,
                       w.planned_at IS NULL, w.planned_at, w.created_at DESC
              LIMIT 8`,
            [user.id],
          )
        : Promise.resolve([]),
      // Ordens paradas por checklist obrigatório do gerente (visão de gestão).
      isManagerView && can(PERMISSIONS.WORKORDERS_VIEW)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT w.id, w.code, w.title,
                    COUNT(*) AS pending_count, MIN(ci.created_at) AS since
               FROM work_order_checklist_items ci
               JOIN work_orders w ON w.id = ci.work_order_id
               JOIN users cu ON cu.id = ci.created_by
               JOIN roles cr ON cr.id = cu.role_id
              WHERE ci.is_done = 0 AND cr.code = 'facilities_manager'
                AND w.status NOT IN ('done','cancelled')
              GROUP BY w.id
              ORDER BY since ASC
              LIMIT 5`,
          )
        : Promise.resolve([]),
      // Solicitações aguardando a decisão de quem aprova compras.
      can(PERMISSIONS.PURCHASES_APPROVE)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT pr.id, pr.code, pr.justification, pr.priority, pr.created_at,
                    ru.name AS requester_name
               FROM purchase_requests pr
               JOIN users ru ON ru.id = pr.requester_id
              WHERE pr.status = 'pending_approval'
              ORDER BY CASE pr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                                        WHEN 'normal' THEN 2 ELSE 3 END,
                       pr.created_at
              LIMIT 5`,
          )
        : Promise.resolve([]),
      // Pedidos para registrar (visão do comprador): solicitações aprovadas
      // que ainda não viraram pedido — é o que falta fazer na rotina dele.
      can(PERMISSIONS.PURCHASES_ORDER)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT pr.id, pr.code, pr.priority, pr.justification,
                    pr.approved_at, pr.created_at,
                    ru.name AS requester_name
               FROM purchase_requests pr
               JOIN users ru ON ru.id = pr.requester_id
              WHERE pr.status IN ('approved','quoting','quote_returned','quote_approved','purchasing')
              ORDER BY CASE pr.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1
                                        WHEN 'normal' THEN 2 ELSE 3 END,
                       COALESCE(pr.approved_at, pr.created_at)
              LIMIT 6`,
          )
        : Promise.resolve([]),
      // Pedidos a receber (visão do comprador): já pedidos, com recebimento
      // total ou parcial pendente.
      can(PERMISSIONS.PURCHASES_RECEIVE)
        ? allRows<Record<string, unknown>>(
            c.env.DB,
            `SELECT pr.id, pr.code, pr.priority, pr.status, pr.updated_at,
                    ru.name AS requester_name
               FROM purchase_requests pr
               JOIN users ru ON ru.id = pr.requester_id
              WHERE pr.status IN ('ordered','partially_received')
              ORDER BY pr.updated_at DESC, pr.id DESC
              LIMIT 6`,
          )
        : Promise.resolve([]),
    ]);

  const items = (stockTotals?.items ?? 0) as number;
  const unitsMilli = (stockTotals?.units ?? 0) as number;

  const totalNotifications = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [user.id],
  );

  return c.json({
    generatedAt: now,
    stock: {
      itemCount: items,
      totalQtyMilli: unitsMilli,
      locationCount: (stockTotals?.locations ?? 0) as number,
      lowStockCount: lowStock.length,
      lowStockScope: lowStockAlertScope,
      lowStock: lowStock.map((row) => ({
        productId: String(row.id),
        productName: String(row.name),
        sku: row.sku ? String(row.sku) : null,
        locationId: row.location_id ? String(row.location_id) : null,
        locationName: row.location_name ? String(row.location_name) : null,
        locationCount: row.location_count === null || row.location_count === undefined
          ? null
          : Number(row.location_count),
        qtyMilli: Number(row.qty_milli),
        totalQtyMilli: Number(row.total_qty_milli ?? row.qty_milli),
        minQtyMilli: Number(row.min_qty_milli),
        uomCode: row.uom_code ? String(row.uom_code) : null,
      })),
    },
    consumption: {
      periodDays: 30,
      qtyMilli: (consumption30?.qty_milli ?? 0) as number,
      recordCount: (consumption30?.records ?? 0) as number,
    },
    tickets: {
      openCount: Number(tickets?.open_count ?? 0),
      pendingCount: Number(tickets?.pending_count ?? 0),
      criticalCount: Number(tickets?.critical_count ?? 0),
      resolvedLast30Days: Number(tickets?.resolved_30d ?? 0),
      mine: mineTickets.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        title: String(row.title),
        status: String(row.status),
        priority: String(row.priority),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      })),
    },
    workOrders: {
      openCount: Number(workOrders?.open_count ?? 0),
      inProgressCount: Number(workOrders?.in_progress_count ?? 0),
      waitingMaterialCount: Number(workOrders?.waiting_material_count ?? 0),
      doneLast30Days: Number(workOrders?.done_30d ?? 0),
      mineOpenCount: Number(workOrders?.mine_open ?? 0),
      mine: {
        openCount: Number(mineWoStats?.open_count ?? 0),
        waitingMaterialCount: Number(mineWoStats?.waiting_material_count ?? 0),
        doneLast30Days: Number(mineWoStats?.done_30d ?? 0),
        checklistPendingCount: mineChecklistCount,
      },
      mineOpen: mineWoList.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        title: String(row.title),
        status: String(row.status),
        priority: String(row.priority),
        plannedAt: row.planned_at ? String(row.planned_at) : null,
        locationName: row.location_name ? String(row.location_name) : null,
        checklistPending: Number(row.checklist_pending ?? 0),
        checklistManagerPending: Number(row.checklist_manager_pending ?? 0),
      })),
      managerChecklistPending: managerChecklist.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        title: String(row.title),
        pendingCount: Number(row.pending_count ?? 0),
        since: String(row.since),
      })),
    },
    purchases: {
      pendingApprovalCount: Number(purchases?.pending_approval ?? 0),
      orderedCount: Number(purchases?.ordered ?? 0),
      partiallyReceivedCount: Number(purchases?.partially_received ?? 0),
      openRequestCount: Number(purchases?.total_open ?? 0),
      pendingApproval: pendingApprovals.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        justification: row.justification ? String(row.justification) : null,
        priority: String(row.priority),
        requesterName: String(row.requester_name),
        createdAt: String(row.created_at),
      })),
      awaitingOrder: awaitingOrder.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        priority: String(row.priority),
        justification: row.justification ? String(row.justification) : null,
        requesterName: String(row.requester_name),
        since: String(row.approved_at ?? row.created_at),
      })),
      toReceive: toReceiveOrders.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        priority: String(row.priority),
        status: String(row.status),
        requesterName: String(row.requester_name),
        updatedAt: String(row.updated_at),
      })),
    },
    inventories: {
      openCount: Number(inventories?.open_count ?? 0),
    },
    notifications: {
      unreadCount: totalNotifications,
    },
    recentMovements: movements.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      qtyMilli: Number(row.qty_milli),
      occurredAt: String(row.occurred_at),
      reason: row.reason ? String(row.reason) : null,
      productName: String(row.product_name),
      sku: row.sku ? String(row.sku) : null,
      fromLocationName: row.from_location_name ? String(row.from_location_name) : null,
      toLocationName: row.to_location_name ? String(row.to_location_name) : null,
      locationPath: row.location_path ? String(row.location_path) : null,
      userName: String(row.user_name),
    })),
  });
});

/**
 * Alertas operacionais: itens abaixo do mínimo, OS aguardando material, tickets
 * críticos parados e compras aguardando aprovação. Usado pelo painel e pelo
 * sino de avisos.
 */
router.get("/alerts", requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (c) => {
  const user = currentUser(c);
  const can = (code: string) => user.permissions.has(code);
  const ticketsAll = can(PERMISSIONS.TICKETS_VIEW_ALL);
  const ticketScope = ticketsAll ? "" : "AND (t.requester_id = ? OR t.assignee_id = ?)";
  const ticketParams = ticketsAll ? [] : [user.id, user.id];
  const scopeClause =
    user.locationScope.length > 0
      ? `stock.location_id IN (${user.locationScope.map(() => "?").join(",")})`
      : "1=1";
  const alertScope = await lowStockScope(c.env.DB);

  // No escopo global o alerta e por produto (soma dos locais), então o count
  // agrupa por produto antes de contar.
  const lowStockQuery =
    alertScope === "global"
      ? `SELECT COUNT(*) AS count FROM (
           SELECT p.id FROM stock
             JOIN products p ON p.id = stock.product_id
            WHERE p.is_active = 1 AND p.min_qty_milli > 0 AND ${scopeClause}
            GROUP BY p.id HAVING SUM(stock.qty_milli) <= p.min_qty_milli)`
      : `SELECT COUNT(*) AS count FROM stock
           JOIN products p ON p.id = stock.product_id
          WHERE p.is_active = 1 AND p.min_qty_milli > 0
            AND stock.qty_milli <= p.min_qty_milli
            AND ${scopeClause}`;

  // Cada alerta só é calculado para quem pode ver a área correspondente:
  // estoque exige `stock.view`, OS exige `workorders.view`, compras exige
  // `purchases.approve` (e o alerta existe para quem decide) e chamados seguem
  // a visibilidade de /api/tickets.
  const [lowStock, waitingMaterial, criticalTickets, pendingApprovals, incompleteProducts] = await Promise.all([
    can(PERMISSIONS.STOCK_VIEW)
      ? allRows<Record<string, unknown>>(c.env.DB, lowStockQuery, user.locationScope)
      : Promise.resolve([]),
    can(PERMISSIONS.WORKORDERS_VIEW)
      ? countRows(
          c.env.DB,
          `SELECT COUNT(*) FROM work_orders WHERE status = 'waiting_material'`,
        )
      : Promise.resolve(0),
    can(PERMISSIONS.TICKETS_VIEW)
      ? countRows(
          c.env.DB,
          `SELECT COUNT(*) FROM tickets t
            WHERE t.status IN ('open','in_progress','waiting_material')
              AND t.priority IN ('high','urgent') ${ticketScope}`,
          ticketParams,
        )
      : Promise.resolve(0),
    can(PERMISSIONS.PURCHASES_APPROVE)
      ? countRows(c.env.DB, `SELECT COUNT(*) FROM purchase_requests WHERE status = 'pending_approval'`)
      : Promise.resolve(0),
    // Cadastro rápido (recebimento): o alerta fica com quem pode corrigir o
    // catálogo e só desaparece quando o cadastro for completado.
    can(PERMISSIONS.CATALOG_MANAGE)
      ? countRows(c.env.DB, `SELECT COUNT(*) FROM products WHERE catalog_status = 'incomplete'`)
      : Promise.resolve(0),
  ]);

  return c.json({
    lowStockCount: Number(lowStock[0]?.count ?? 0),
    waitingMaterialCount: waitingMaterial,
    criticalTicketCount: criticalTickets,
    pendingApprovalCount: pendingApprovals,
    incompleteProductCount: incompleteProducts,
  });
});

export default router;
