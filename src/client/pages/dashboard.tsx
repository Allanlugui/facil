import { Link } from "react-router-dom";
import { PERMISSIONS } from "@shared/permissions";
import {
  MOVEMENT_TYPE_LABEL,
  PRIORITY_LABEL,
  PURCHASE_STATUS_LABEL,
  TICKET_STATUS_LABEL,
  WORK_ORDER_STATUS_LABEL,
  type MovementType,
  type Priority,
  type PurchaseStatus,
  type TicketStatus,
  type WorkOrderStatus,
} from "@shared/types";
import { apiGet } from "../lib/api";
import {
  PRIORITY_TONE,
  PURCHASE_STATUS_TONE,
  formatDate,
  formatDateTime,
  formatQuantity,
  formatRelative,
  plural,
} from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dot,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Stat,
  type Tone,
} from "../lib/ui";

/** Tons de situação por área (espelham as listas de chamados e ordens). */
const WO_STATUS_TONE: Record<WorkOrderStatus, Tone> = {
  open: "blue",
  planned: "blue",
  in_progress: "amber",
  waiting_material: "amber",
  done: "green",
  cancelled: "slate",
};

const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  open: "blue",
  in_progress: "amber",
  waiting_material: "amber",
  resolved: "green",
  converted: "violet",
  cancelled: "slate",
};

interface MineWorkOrderRow {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  plannedAt: string | null;
  locationName: string | null;
  checklistPending: number;
  checklistManagerPending: number;
}

interface ManagerChecklistRow {
  id: string;
  code: string;
  title: string;
  pendingCount: number;
  since: string;
}

interface MineTicketRow {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

interface PendingApprovalRow {
  id: string;
  code: string;
  justification: string | null;
  priority: string;
  requesterName: string;
  createdAt: string;
}

/** Solicitação aprovada que ainda aguarda o pedido ao fornecedor (comprador). */
interface AwaitingOrderRow {
  id: string;
  code: string;
  priority: string;
  justification: string | null;
  requesterName: string;
  since: string;
}

/** Pedido registrado com recebimento total ou parcial pendente (comprador). */
interface ToReceiveRow {
  id: string;
  code: string;
  priority: string;
  status: string;
  requesterName: string;
  updatedAt: string;
}

interface Summary {
  generatedAt: string;
  stock: {
    itemCount: number;
    totalQtyMilli: number;
    locationCount: number;
    lowStockCount: number;
    lowStockScope: string;
    lowStock: {
      productId: string;
      productName: string;
      sku: string | null;
      locationId: string | null;
      locationName: string | null;
      locationCount: number | null;
      qtyMilli: number;
      totalQtyMilli: number;
      minQtyMilli: number;
      uomCode: string | null;
    }[];
  };
  consumption: { periodDays: number; qtyMilli: number; recordCount: number };
  tickets: {
    openCount: number;
    pendingCount: number;
    criticalCount: number;
    resolvedLast30Days: number;
    /** Chamados em que o usuário participa (autor ou responsável). */
    mine: MineTicketRow[];
  };
  workOrders: {
    openCount: number;
    inProgressCount: number;
    waitingMaterialCount: number;
    doneLast30Days: number;
    mineOpenCount: number;
    /** Recorte pessoal do técnico (ordens atribuídas a ele). */
    mine: {
      openCount: number;
      waitingMaterialCount: number;
      doneLast30Days: number;
      checklistPendingCount: number;
    };
    mineOpen: MineWorkOrderRow[];
    /** Ordens paradas por etapas obrigatórias do gerente (visão de gestão). */
    managerChecklistPending: ManagerChecklistRow[];
  };
  purchases: {
    pendingApprovalCount: number;
    orderedCount: number;
    partiallyReceivedCount: number;
    openRequestCount: number;
    pendingApproval: PendingApprovalRow[];
    /** Rotina do comprador: o que falta fazer (F-20 fase 2). */
    awaitingOrder: AwaitingOrderRow[];
    toReceive: ToReceiveRow[];
  };
  inventories: { openCount: number };
  notifications: { unreadCount: number };
  recentMovements: {
    id: string;
    type: string;
    qtyMilli: number;
    occurredAt: string;
    reason: string | null;
    productName: string;
    sku: string | null;
    fromLocationName: string | null;
    toLocationName: string | null;
    locationPath: string | null;
    userName: string;
  }[];
}

interface Alerts {
  lowStockCount: number;
  waitingMaterialCount: number;
  criticalTicketCount: number;
  pendingApprovalCount: number;
  incompleteProductCount: number;
}

/** Busca única do painel (resumo + alertas) compartilhada pelas visões. */
function useDashboardData() {
  return useAsync(async () => {
    const [summary, alerts] = await Promise.all([
      apiGet<Summary>("/api/dashboard/summary"),
      apiGet<Alerts>("/api/dashboard/alerts"),
    ]);
    return { summary, alerts };
  }, []);
}

/**
 * Capa de topo dos painéis iniciais (D-28): faixa visual no topo da home de
 * cada perfil. A variante mobile troca a capa ampla por uma composta em
 * formato quadrado, que lê melhor em telas estreitas.
 */
function HomeCover() {
  return (
    <div className="relative h-[clamp(190px,12.5vw,320px)] overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
      <picture>
        <source media="(max-width: 767px)" srcSet="/branding/cover-mobile.webp" />
        <img
          src="/branding/cover.webp"
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
        />
      </picture>
    </div>
  );
}

/**
 * Ponto de entrada do painel.
 *
 * Cada perfil de acesso entra na sua visão inicial (F-20): o técnico vê as
 * ordens dele e as etapas obrigatórias; o solicitante e a recepção veem os
 * próprios chamados; o comprador vê a fila de pedidos e recebimentos; o
 * responsável pelo estoque vê saldos, movimentações e inventários; a limpeza
 * vê o consumo da equipe; gestão e administração seguem a visão geral completa.
 *
 * Acima da home de cada perfil entra a capa da marca (D-28).
 */
export function DashboardPage() {
  const { user } = useSession();
  const home = (() => {
    switch (user?.roleCode) {
      case "maintenance_tech":
        return <TechHome />;
      case "requester":
        return <RequesterHome />;
      case "buyer":
        return <BuyerHome />;
      case "stock_keeper":
        return <StockHome />;
      case "cleaning_lead":
      case "cleaning_staff":
        return <CleaningHome />;
      case "receptionist":
        return <ReceptionHome />;
      default:
        return <OverviewHome />;
    }
  })();

  return (
    <div className="space-y-5">
      <HomeCover />
      {home}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Blocos reaproveitados entre os painéis por perfil                          */
/* -------------------------------------------------------------------------- */

function RecentMovementsCard(props: { movements: Summary["recentMovements"]; className?: string }) {
  const { can } = useSession();
  return (
    <Card
      className={props.className}
      title="Últimas movimentações de estoque"
      description="O livro-razão do estoque: nenhum saldo muda sem uma linha aqui."
      actions={
        can(PERMISSIONS.STOCK_VIEW) ? (
          <Link to="/estoque?tab=movements" className="text-sm font-medium text-brand-700 hover:underline">
            Ver histórico completo
          </Link>
        ) : null
      }
      padded={false}
    >
      {props.movements.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="Sem movimentações"
            description="Assim que houver entrada, saída ou transferência, o histórico aparece aqui."
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {props.movements.slice(0, 8).map((movement) => (
            <li key={movement.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-1.5">
                <Dot tone={movementTone(movement.type)} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">
                  {movement.productName}{" "}
                  <span className="font-normal text-slate-500">
                    · {formatQuantity(movement.qtyMilli)}
                  </span>
                </p>
                <p className="truncate text-xs text-slate-500">
                  {MOVEMENT_TYPE_LABEL[movement.type as MovementType] ?? movement.type} ·{" "}
                  {direction(movement.fromLocationName, movement.toLocationName)} ·{" "}
                  {movement.userName}
                </p>
              </div>
              <span className="shrink-0 text-xs text-slate-400">
                {formatRelative(movement.occurredAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LowStockCard(props: { stock: Summary["stock"]; className?: string }) {
  const { can } = useSession();
  const scopeLabel =
    props.stock.lowStockScope === "global" ? "Soma de todos os locais" : "Saldo por local";
  return (
    <Card
      className={props.className}
      title="Itens abaixo do mínimo"
      description={scopeLabel}
      actions={
        can(PERMISSIONS.STOCK_VIEW) ? (
          <Link to="/estoque?belowMinimum=true" className="text-sm font-medium text-brand-700 hover:underline">
            Ver tudo
          </Link>
        ) : null
      }
    >
      {props.stock.lowStock.length === 0 ? (
        <EmptyState title="Nada em falta" description="Nenhum produto esta abaixo do estoque mínimo agora." />
      ) : (
        <ul className="space-y-2">
          {props.stock.lowStock.slice(0, 8).map((item) => (
            <li
              key={`${item.productId}-${item.locationId ?? "global"}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{item.productName}</p>
                <p className="truncate text-xs text-slate-500">
                  {item.sku ? `${item.sku} · ` : ""}
                  {item.locationId
                    ? item.locationName
                    : `Todos os locais (${item.locationCount ?? 0})`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-amber-900">
                  {formatQuantity(item.locationId ? item.qtyMilli : item.totalQtyMilli)}{" "}
                  {item.uomCode ?? ""}
                </p>
                <p className="text-xs tabular-nums text-slate-500">
                  mínimo {formatQuantity(item.minQtyMilli)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface PurchaseListRow {
  id: string;
  code: string;
  title: string;
  meta: string;
  dotTone: Tone;
  badgeTone: Tone;
  badgeLabel: string;
}

function PurchaseListCard(props: {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  rows: PurchaseListRow[];
}) {
  return (
    <Card className="min-w-0" title={props.title} description={props.description} padded={false}>
      {props.rows.length === 0 ? (
        <div className="p-4">
          <EmptyState title={props.emptyTitle} description={props.emptyDescription} />
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {props.rows.map((row) => (
            <li key={row.id}>
              <Link
                to={`/compras/${row.id}`}
                className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
              >
                <span className="mt-1.5">
                  <Dot tone={row.dotTone} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {row.code} · {row.title}
                  </p>
                  <p className="truncate text-xs text-slate-500">{row.meta}</p>
                </div>
                <Badge tone={row.badgeTone}>{row.badgeLabel}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Lista "meus chamados" reaproveitada por solicitante, recepção e limpeza.
 * O recorte de quem participa do chamado vem do servidor (escopo por perfil).
 */
function MineTicketsList(props: { mine: MineTicketRow[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {props.mine.map((row) => (
        <li key={row.id}>
          <Link
            to={`/chamados/${row.id}`}
            className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
          >
            <span className="mt-1.5">
              <Dot tone={PRIORITY_TONE[row.priority as Priority] ?? "slate"} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">
                {row.code} · {row.title}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={TICKET_STATUS_TONE[row.status as TicketStatus] ?? "slate"}>
                  {TICKET_STATUS_LABEL[row.status as TicketStatus] ?? row.status}
                </Badge>
                <Badge tone={PRIORITY_TONE[row.priority as Priority] ?? "slate"}>
                  {PRIORITY_LABEL[row.priority as Priority] ?? row.priority}
                </Badge>
              </div>
            </div>
            <span className="shrink-0 text-xs text-slate-400">
              aberto {formatRelative(row.createdAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral (gestão, administração e demais perfis)                        */
/* -------------------------------------------------------------------------- */

function OverviewHome() {
  const { can, user, app } = useSession();
  const state = useDashboardData();

  if (state.loading && !state.data) return <LoadingBlock label="Carregando o painel..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  const summary = state.data?.summary;
  const alerts = state.data?.alerts;
  if (!summary || !alerts) return null;

  const roleCode = user?.roleCode;
  const isManagerView = roleCode === "facilities_manager" || roleCode === "admin";

  // O painel só mostra o que o usuário pode ver: cada bloco e gateado pela
  // permissão da área (o servidor também zera/bloqueia o que não e visível).
  const canStock = can(PERMISSIONS.STOCK_VIEW);
  const canConsumption = can(PERMISSIONS.CONSUMPTION_VIEW);
  const canTickets = can(PERMISSIONS.TICKETS_VIEW);
  const canWorkOrders = can(PERMISSIONS.WORKORDERS_VIEW);
  const canPurchases = can(PERMISSIONS.PURCHASES_VIEW);
  const canInventory = can(PERMISSIONS.INVENTORY_VIEW);
  const canApprovePurchases = can(PERMISSIONS.PURCHASES_APPROVE);
  const canManageCatalog = can(PERMISSIONS.CATALOG_MANAGE);

  const visibleAlertCount =
    (canTickets ? alerts.criticalTicketCount : 0) +
    (canStock ? alerts.lowStockCount : 0) +
    (canWorkOrders ? alerts.waitingMaterialCount : 0) +
    (canApprovePurchases ? alerts.pendingApprovalCount : 0) +
    (canManageCatalog ? alerts.incompleteProductCount : 0);
  const hasAlertSources =
    canTickets || canStock || canWorkOrders || canApprovePurchases || canManageCatalog;

  const lowStockScopeLabel =
    summary.stock.lowStockScope === "global"
      ? "Soma de todos os locais"
      : "Saldo por local";

  return (
    <div>
      <PageHeader
        title={`Olá, ${user?.name.split(" ")[0] ?? ""}`}
        description={
          <>
            Visão de {app.companyName ?? "sua operação"} em {formatDateTime(summary.generatedAt)} ·
            atualizado sob demanda.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              Atualizar
            </Button>
            {can(PERMISSIONS.REPORTS_VIEW) ? (
              <Link to="/relatorios">
                <Button variant="primary">Abrir relatórios</Button>
              </Link>
            ) : null}
          </>
        }
      />

      {hasAlertSources ? (
        visibleAlertCount > 0 ? (
          <div className="mb-5 space-y-2">
            {canTickets && alerts.criticalTicketCount > 0 ? (
              <Alert tone="red" title="Chamados críticos em aberto">
                <Link className="font-medium underline" to="/chamados?open=true&priority=urgent">
                  {alerts.criticalTicketCount} {plural(alerts.criticalTicketCount, "chamado urgente", "chamados urgentes")} sem resolução. Abrir lista.
                </Link>
              </Alert>
            ) : null}
            {canStock && alerts.lowStockCount > 0 ? (
              <Alert tone="amber" title="Estoque abaixo do mínimo">
                <Link className="font-medium underline" to="/estoque?belowMinimum=true">
                  {alerts.lowStockCount} {plural(alerts.lowStockCount, "item precisa", "itens precisam")} de reposição. Ver posição de estoque.
                </Link>
              </Alert>
            ) : null}
            {canWorkOrders && alerts.waitingMaterialCount > 0 ? (
              <Alert tone="amber" title="Ordens aguardando material">
                <Link className="font-medium underline" to="/ordens?status=waiting_material">
                  {alerts.waitingMaterialCount} {plural(alerts.waitingMaterialCount, "ordem parada", "ordens paradas")} por falta de material.
                </Link>
              </Alert>
            ) : null}
            {canApprovePurchases && alerts.pendingApprovalCount > 0 ? (
              <Alert tone="blue" title="Compras aguardando aprovação">
                <Link className="font-medium underline" to="/compras?pendingApproval=true">
                  {alerts.pendingApprovalCount} {plural(alerts.pendingApprovalCount, "solicitação esperando", "solicitações esperando")} sua decisão.
                </Link>
              </Alert>
            ) : null}
            {canManageCatalog && alerts.incompleteProductCount > 0 ? (
              <Alert tone="amber" title="Produtos com cadastro incompleto">
                <Link className="font-medium underline" to="/catalogo?tab=products&incomplete=true">
                  {alerts.incompleteProductCount} {plural(alerts.incompleteProductCount, "produto criado no recebimento aguarda", "produtos criados no recebimento aguardam")} completar o cadastro.
                </Link>
              </Alert>
            ) : null}
          </div>
        ) : (
          <Alert tone="green">Nenhum alerta aberto para o que você acompanha.</Alert>
        )
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canStock ? (
          <>
            <Stat
              label="Saldos registrados"
              value={summary.stock.itemCount}
              hint={`${summary.stock.locationCount} ${plural(summary.stock.locationCount, "local", "locais")} com estoque · ${formatQuantity(summary.stock.totalQtyMilli)} un`}
              tone="brand"
            />
            <Stat
              label="Abaixo do mínimo"
              value={summary.stock.lowStockCount}
              hint={lowStockScopeLabel}
              tone={summary.stock.lowStockCount > 0 ? "amber" : "green"}
              alert={summary.stock.lowStockCount > 0}
            />
          </>
        ) : null}
        {canConsumption ? (
          <Stat
            label={`Consumo (${summary.consumption.periodDays} dias)`}
            value={formatQuantity(summary.consumption.qtyMilli)}
            hint={`${summary.consumption.recordCount} ${plural(summary.consumption.recordCount, "lançamento", "lançamentos")}`}
            tone="blue"
          />
        ) : null}
        {canTickets ? (
          <Stat
            label="Chamados abertos"
            value={summary.tickets.openCount}
            hint={`${summary.tickets.criticalCount} ${plural(summary.tickets.criticalCount, "crítico", "críticos")} · ${summary.tickets.resolvedLast30Days} ${plural(summary.tickets.resolvedLast30Days, "resolvido", "resolvidos")} em 30 dias`}
            tone={summary.tickets.criticalCount > 0 ? "red" : "slate"}
          />
        ) : null}
        {canWorkOrders ? (
          <>
            <Stat
              label="Ordens de serviço abertas"
              value={summary.workOrders.openCount}
              hint={`${summary.workOrders.inProgressCount} em execução · ${summary.workOrders.doneLast30Days} ${plural(summary.workOrders.doneLast30Days, "concluída", "concluídas")} em 30 dias`}
              tone="violet"
            />
            <Stat
              label="Aguardando material"
              value={summary.workOrders.waitingMaterialCount}
              hint={
                summary.workOrders.waitingMaterialCount > 0
                  ? "Ordens paradas por falta de estoque"
                  : "Nenhuma ordem parada"
              }
              tone={summary.workOrders.waitingMaterialCount > 0 ? "amber" : "green"}
              alert={summary.workOrders.waitingMaterialCount > 0}
            />
          </>
        ) : null}
        {canPurchases ? (
          <Stat
            label="Compras em andamento"
            value={summary.purchases.openRequestCount}
            hint={`${summary.purchases.pendingApprovalCount} aguardando aprovação · ${summary.purchases.partiallyReceivedCount} ${plural(summary.purchases.partiallyReceivedCount, "parcial", "parciais")}`}
            tone="amber"
          />
        ) : null}
        {canInventory ? (
          <Stat
            label="Inventários abertos"
            value={summary.inventories.openCount}
            hint={summary.inventories.openCount > 0 ? "Contagens em andamento" : "Nenhum ciclo aberto"}
            tone="brand"
          />
        ) : null}
      </div>

      {canApprovePurchases || (canWorkOrders && isManagerView) ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {canApprovePurchases ? (
            <Card
              className="min-w-0"
              title="Compras aguardando sua aprovação"
              description="Solicitações enviadas que esperam a sua decisão."
              actions={
                <Link
                  to="/compras?pendingApproval=true"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Ver em Compras
                </Link>
              }
              padded={false}
            >
              {summary.purchases.pendingApproval.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="Nada pendente"
                    description="Quando alguém enviar uma solicitação de compra, ela aparece aqui."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {summary.purchases.pendingApproval.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={`/compras/${row.id}`}
                        className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                      >
                        <span className="mt-1.5">
                          <Dot tone={PRIORITY_TONE[row.priority as Priority] ?? "slate"} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {row.code}
                            {row.justification ? ` · ${row.justification}` : ""}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            Solicitada por {row.requesterName} · {formatRelative(row.createdAt)}
                          </p>
                        </div>
                        <Badge tone={PRIORITY_TONE[row.priority as Priority] ?? "slate"}>
                          {PRIORITY_LABEL[row.priority as Priority] ?? row.priority}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {canWorkOrders && isManagerView ? (
            <Card
              className="min-w-0"
              title="Ordens travadas pelo checklist do gestor"
              description="Etapas obrigatórias criadas pela gestão ainda pendentes de execução."
              actions={
                <Link
                  to="/ordens"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Ver ordens
                </Link>
              }
              padded={false}
            >
              {summary.workOrders.managerChecklistPending.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="Nenhuma ordem bloqueada"
                    description="Quando houver etapa obrigatória pendente, a ordem aparece aqui."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {summary.workOrders.managerChecklistPending.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={`/ordens/${row.id}`}
                        className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {row.code} · {row.title}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            Pendente desde {formatRelative(row.since)}
                          </p>
                        </div>
                        <Badge tone="amber">
                          {row.pendingCount} {plural(row.pendingCount, "etapa", "etapas")}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}

      {canStock ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-5">
          <RecentMovementsCard
            movements={summary.recentMovements}
            className="min-w-0 lg:col-span-3"
          />
          <LowStockCard stock={summary.stock} className="min-w-0 lg:col-span-2" />
        </div>
      ) : null}

      {roleCode === "admin" ? (
        <Card
          className="mt-5"
          title="Atalhos do administrador"
          description="As áreas de configuração e controle do sistema."
        >
          <div className="flex flex-wrap gap-2">
            <Link to="/configuracoes">
              <Button variant="secondary" size="sm">Configurações</Button>
            </Link>
            <Link to="/usuarios">
              <Button variant="secondary" size="sm">Usuários</Button>
            </Link>
            <Link to="/auditoria">
              <Button variant="secondary" size="sm">Auditoria</Button>
            </Link>
            <Link to="/catalogo">
              <Button variant="secondary" size="sm">Catálogo</Button>
            </Link>
            <Link to="/estrutura">
              <Button variant="secondary" size="sm">Estrutura</Button>
            </Link>
            <Link to="/ajuda">
              <Button variant="secondary" size="sm">Suporte</Button>
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painel do técnico                                                          */
/* -------------------------------------------------------------------------- */

function TechHome() {
  const { user, app } = useSession();
  const state = useDashboardData();

  if (state.loading && !state.data) return <LoadingBlock label="Carregando suas ordens..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  const summary = state.data?.summary;
  if (!summary) return null;

  const mine = summary.workOrders.mine;
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          <>
            Suas ordens de serviço e pendências em {app.companyName ?? "sua operação"} ·{" "}
            {formatDateTime(summary.generatedAt)}.
          </>
        }
        actions={
          <Button variant="secondary" onClick={state.reload} loading={state.loading}>
            Atualizar
          </Button>
        }
      />

      {mine.checklistPendingCount > 0 ? (
        <div className="mb-5">
          <Alert tone="amber" title="Etapas obrigatórias pendentes">
            {mine.checklistPendingCount}{" "}
            {plural(mine.checklistPendingCount, "etapa definida", "etapas definidas")} pelo gerente
            de facilities {plural(mine.checklistPendingCount, "aguarda", "aguardam")} conclusão.
            Enquanto estiverem abertas, a ordem não pode ser concluída.
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Minhas ordens abertas"
          value={mine.openCount}
          hint="Atribuídas a você agora"
          tone="violet"
        />
        <Stat
          label="Aguardando material"
          value={mine.waitingMaterialCount}
          hint={
            mine.waitingMaterialCount > 0
              ? "Suas ordens paradas por estoque"
              : "Nenhuma ordem sua parada"
          }
          tone={mine.waitingMaterialCount > 0 ? "amber" : "green"}
          alert={mine.waitingMaterialCount > 0}
        />
        <Stat
          label="Etapas obrigatórias"
          value={mine.checklistPendingCount}
          hint={
            mine.checklistPendingCount > 0
              ? "Bloqueiam a conclusão da ordem"
              : "Nada pendente da gestão"
          }
          tone={mine.checklistPendingCount > 0 ? "amber" : "green"}
          alert={mine.checklistPendingCount > 0}
        />
        <Stat
          label="Concluídas (30 dias)"
          value={mine.doneLast30Days}
          hint="Seu histórico recente"
          tone="green"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card
          className="min-w-0 lg:col-span-3"
          title="Minhas ordens"
          description="Suas ordens ativas, das mais urgentes para as demais."
          actions={
            <Link to="/ordens" className="text-sm font-medium text-brand-700 hover:underline">
              Ver todas
            </Link>
          }
          padded={false}
        >
          {summary.workOrders.mineOpen.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="Nenhuma ordem atribuída a você"
                description="Quando uma ordem for designada para você, ela aparece aqui com o checklist e o local."
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {summary.workOrders.mineOpen.map((row) => (
                <li key={row.id}>
                  <Link
                    to={`/ordens/${row.id}`}
                    className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                  >
                    <span className="mt-1.5">
                      <Dot tone={PRIORITY_TONE[row.priority as Priority] ?? "slate"} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {row.code} · {row.title}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {row.locationName ?? "Sem local definido"}
                        {row.plannedAt ? ` · planejada para ${formatDate(row.plannedAt)}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={WO_STATUS_TONE[row.status as WorkOrderStatus] ?? "slate"}>
                          {WORK_ORDER_STATUS_LABEL[row.status as WorkOrderStatus] ?? row.status}
                        </Badge>
                        <Badge tone={PRIORITY_TONE[row.priority as Priority] ?? "slate"}>
                          {PRIORITY_LABEL[row.priority as Priority] ?? row.priority}
                        </Badge>
                        {row.checklistManagerPending > 0 ? (
                          <Badge tone="amber">
                            {row.checklistManagerPending}{" "}
                            {plural(row.checklistManagerPending, "etapa obrigatória", "etapas obrigatórias")}
                          </Badge>
                        ) : row.checklistPending > 0 ? (
                          <Badge tone="slate">
                            {row.checklistPending}{" "}
                            {plural(row.checklistPending, "etapa no checklist", "etapas no checklist")}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card
            title="Meus chamados"
            description="Chamados que você abriu ou assumiu."
            actions={
              <Link to="/chamados" className="text-sm font-medium text-brand-700 hover:underline">
                Ver todos
              </Link>
            }
            padded={false}
          >
            {summary.tickets.mine.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Nada por aqui"
                  description="Seus chamados recentes aparecem nesta lista."
                />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {summary.tickets.mine.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    <Link
                      to={`/chamados/${row.id}`}
                      className="flex items-start gap-3 px-4 py-2.5 transition hover:bg-slate-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {row.code} · {row.title}
                        </p>
                        <div className="mt-1">
                          <Badge tone={TICKET_STATUS_TONE[row.status as TicketStatus] ?? "slate"}>
                            {TICKET_STATUS_LABEL[row.status as TicketStatus] ?? row.status}
                          </Badge>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">
                        {formatRelative(row.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Ações rápidas" description="Os atalhos da sua rotina.">
            <div className="flex flex-col gap-2">
              <Link to="/ordens">
                <Button variant="secondary" className="w-full">
                  Lançar material na ordem
                </Button>
              </Link>
              <Link to="/consumo">
                <Button variant="secondary" className="w-full">
                  Registrar consumo
                </Button>
              </Link>
              <Link to="/chamados">
                <Button variant="secondary" className="w-full">
                  Ver chamados
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painéis de quem abre chamados (solicitante e recepção)                     */
/* -------------------------------------------------------------------------- */

function RequesterHome() {
  return (
    <MyTicketsHome
      intro="Abra e acompanhe seus chamados com o time de facilities em"
      emptyTitle="Você ainda não abriu chamados"
      emptyDescription="Precisa de manutenção, limpeza ou um ajuste no seu ambiente? Abra um chamado e acompanhe por aqui."
      emptyAction="Abrir meu primeiro chamado"
    />
  );
}

function ReceptionHome() {
  return (
    <MyTicketsHome
      showConsumption
      intro="Chamados e itens utilizados no seu posto com o time de facilities em"
      emptyTitle="Nenhum chamado aberto por você"
      emptyDescription="Manutenção, limpeza ou apoio para a recepção: abra um chamado e acompanhe por aqui."
      emptyAction="Abrir chamado"
    />
  );
}

/** Visão de quem abre chamados: contadores, lista dos próprios e ação para abrir. */
function MyTicketsHome(props: {
  intro: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction: string;
  /** Recepção também lança o consumo do posto (D-30): ação e indicador extra. */
  showConsumption?: boolean;
}) {
  const { user, app } = useSession();
  const state = useDashboardData();

  if (state.loading && !state.data) return <LoadingBlock label="Carregando seus chamados..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  const summary = state.data?.summary;
  if (!summary) return null;

  const mine = summary.tickets.mine;
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          <>
            {props.intro} {app.companyName ?? "sua operação"} ·{" "}
            {formatDateTime(summary.generatedAt)}.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              Atualizar
            </Button>
            {props.showConsumption ? (
              <Link to="/consumo">
                <Button variant="secondary">Registrar consumo</Button>
              </Link>
            ) : null}
            <Link to="/chamados?novo=1">
              <Button>Abrir chamado</Button>
            </Link>
          </>
        }
      />

      <div
        className={`grid gap-3 sm:grid-cols-2 ${props.showConsumption ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}
      >
        <Stat
          label="Chamados em aberto"
          value={summary.tickets.openCount}
          hint="Aguardando o time de facilities"
          tone={summary.tickets.openCount > 0 ? "blue" : "green"}
        />
        <Stat
          label="Resolvidos (30 dias)"
          value={summary.tickets.resolvedLast30Days}
          hint="Seu histórico recente"
          tone="green"
        />
        <Stat
          label="Prioridade alta"
          value={summary.tickets.criticalCount}
          hint={
            summary.tickets.criticalCount > 0
              ? "Em tratamento prioritário"
              : "Nenhum chamado crítico seu"
          }
          tone={summary.tickets.criticalCount > 0 ? "red" : "green"}
        />
        {props.showConsumption ? (
          <Stat
            label={`Consumo (${summary.consumption.periodDays} dias)`}
            value={formatQuantity(summary.consumption.qtyMilli)}
            hint={`${summary.consumption.recordCount} ${plural(summary.consumption.recordCount, "lançamento", "lançamentos")} do posto`}
            tone="blue"
          />
        ) : null}
      </div>

      <Card
        className="mt-5"
        title="Meus chamados"
        description="Os últimos chamados que você abriu ou assumiu."
        padded={false}
      >
        {mine.length === 0 ? (
          <div className="p-6">
            <EmptyState title={props.emptyTitle} description={props.emptyDescription} />
            <div className="mt-4 flex justify-center">
              <Link to="/chamados?novo=1">
                <Button>{props.emptyAction}</Button>
              </Link>
            </div>
          </div>
        ) : (
          <MineTicketsList mine={mine} />
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painel do comprador                                                        */
/* -------------------------------------------------------------------------- */

function BuyerHome() {
  const { user, app } = useSession();
  const state = useDashboardData();

  if (state.loading && !state.data) return <LoadingBlock label="Carregando suas compras..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  const summary = state.data?.summary;
  const alerts = state.data?.alerts;
  if (!summary || !alerts) return null;

  const firstName = user?.name.split(" ")[0] ?? "";
  const purchases = summary.purchases;
  const toReceiveCount = purchases.orderedCount + purchases.partiallyReceivedCount;

  // As duas filas da rotina do comprador: registrar o pedido e receber.
  const awaitingRows: PurchaseListRow[] = purchases.awaitingOrder.map((row) => {
    const priority = row.priority as Priority;
    return {
      id: row.id,
      code: row.code,
      title: row.justification ?? "Solicitação de compra",
      meta: `Solicitada por ${row.requesterName} · aguarda pedido desde ${formatRelative(row.since)}`,
      dotTone: PRIORITY_TONE[priority] ?? "slate",
      badgeTone: PRIORITY_TONE[priority] ?? "slate",
      badgeLabel: PRIORITY_LABEL[priority] ?? row.priority,
    };
  });

  const receiveRows: PurchaseListRow[] = purchases.toReceive.map((row) => {
    const status = row.status as PurchaseStatus;
    const priority = row.priority as Priority;
    return {
      id: row.id,
      code: row.code,
      title: `Solicitada por ${row.requesterName}`,
      meta: `Atualizada ${formatRelative(row.updatedAt)}`,
      dotTone: PRIORITY_TONE[priority] ?? "slate",
      badgeTone: PURCHASE_STATUS_TONE[status] ?? "slate",
      badgeLabel: PURCHASE_STATUS_LABEL[status] ?? row.status,
    };
  });

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          <>
            Pedidos, recebimentos e catálogo de {app.companyName ?? "sua operação"} ·{" "}
            {formatDateTime(summary.generatedAt)}.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              Atualizar
            </Button>
            <Link to="/compras">
              <Button>Abrir compras</Button>
            </Link>
          </>
        }
      />

      {alerts.incompleteProductCount > 0 ? (
        <div className="mb-5">
          <Alert tone="amber" title="Produtos com cadastro incompleto">
            <Link className="font-medium underline" to="/catalogo?tab=products&incomplete=true">
              {alerts.incompleteProductCount}{" "}
              {plural(
                alerts.incompleteProductCount,
                "produto criado no recebimento aguarda",
                "produtos criados no recebimento aguardam",
              )}{" "}
              completar o cadastro.
            </Link>
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Stat
          label="Aguardando aprovação"
          value={purchases.pendingApprovalCount}
          hint="Solicitações enviadas ao gestor"
          tone={purchases.pendingApprovalCount > 0 ? "amber" : "green"}
        />
        <Stat
          label="Pedidos a receber"
          value={toReceiveCount}
          hint={`${purchases.partiallyReceivedCount} ${plural(
            purchases.partiallyReceivedCount,
            "recebimento parcial",
            "recebimentos parciais",
          )}`}
          tone={toReceiveCount > 0 ? "brand" : "green"}
        />
        <Stat
          label="Em andamento"
          value={purchases.openRequestCount}
          hint="Solicitações em qualquer etapa"
          tone="blue"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <PurchaseListCard
          title="Pedidos para registrar"
          description="Solicitações aprovadas que ainda aguardam o pedido ao fornecedor."
          emptyTitle="Nada aguardando pedido"
          emptyDescription="Quando o gestor aprovar uma solicitação, ela aparece aqui para virar pedido."
          rows={awaitingRows}
        />
        <PurchaseListCard
          title="Pedidos a receber"
          description="Pedidos registrados com recebimento total ou parcial pendente."
          emptyTitle="Nada a receber"
          emptyDescription="Os pedidos registrados aparecem aqui até o recebimento ser concluído."
          rows={receiveRows}
        />
      </div>

      <Card
        className="mt-5"
        title="Ações rápidas"
        description="O caminho curto para o trabalho do dia."
      >
        <div className="flex flex-wrap gap-2">
          <Link to="/compras?novo=1">
            <Button variant="secondary" size="sm">Nova solicitação</Button>
          </Link>
          <Link to="/compras">
            <Button variant="secondary" size="sm">Todas as compras</Button>
          </Link>
          <Link to="/catalogo">
            <Button variant="secondary" size="sm">Catálogo de produtos</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painel do responsável pelo estoque                                         */
/* -------------------------------------------------------------------------- */

function StockHome() {
  const { can, user, app } = useSession();
  const state = useDashboardData();

  if (state.loading && !state.data) return <LoadingBlock label="Carregando o estoque..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  const summary = state.data?.summary;
  const alerts = state.data?.alerts;
  if (!summary || !alerts) return null;

  const firstName = user?.name.split(" ")[0] ?? "";
  const lowStockScopeLabel =
    summary.stock.lowStockScope === "global" ? "Soma de todos os locais" : "Saldo por local";
  const canInventory = can(PERMISSIONS.INVENTORY_VIEW);
  const canConsumption = can(PERMISSIONS.CONSUMPTION_VIEW);
  const canWorkOrders = can(PERMISSIONS.WORKORDERS_VIEW);
  const hasAlerts = alerts.lowStockCount > 0 || (canWorkOrders && alerts.waitingMaterialCount > 0);

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          <>
            Saldos, movimentações e inventários de {app.companyName ?? "sua operação"} ·{" "}
            {formatDateTime(summary.generatedAt)}.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              Atualizar
            </Button>
            <Link to="/estoque">
              <Button>Abrir estoque</Button>
            </Link>
          </>
        }
      />

      {hasAlerts ? (
        <div className="mb-5 space-y-2">
          {alerts.lowStockCount > 0 ? (
            <Alert tone="amber" title="Estoque abaixo do mínimo">
              <Link className="font-medium underline" to="/estoque?belowMinimum=true">
                {alerts.lowStockCount}{" "}
                {plural(alerts.lowStockCount, "item precisa", "itens precisam")} de reposição. Ver
                posição de estoque.
              </Link>
            </Alert>
          ) : null}
          {canWorkOrders && alerts.waitingMaterialCount > 0 ? (
            <Alert tone="amber" title="Ordens aguardando material">
              <Link className="font-medium underline" to="/ordens?status=waiting_material">
                {alerts.waitingMaterialCount}{" "}
                {plural(alerts.waitingMaterialCount, "ordem parada", "ordens paradas")} por falta
                de material.
              </Link>
            </Alert>
          ) : null}
        </div>
      ) : (
        <Alert tone="green">Nenhum alerta de estoque aberto agora.</Alert>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Saldos registrados"
          value={summary.stock.itemCount}
          hint={`${summary.stock.locationCount} ${plural(summary.stock.locationCount, "local", "locais")} com estoque · ${formatQuantity(summary.stock.totalQtyMilli)} un`}
          tone="brand"
        />
        <Stat
          label="Abaixo do mínimo"
          value={summary.stock.lowStockCount}
          hint={lowStockScopeLabel}
          tone={summary.stock.lowStockCount > 0 ? "amber" : "green"}
          alert={summary.stock.lowStockCount > 0}
        />
        <Stat
          label={`Consumo (${summary.consumption.periodDays} dias)`}
          value={formatQuantity(summary.consumption.qtyMilli)}
          hint={`${summary.consumption.recordCount} ${plural(summary.consumption.recordCount, "lançamento", "lançamentos")}`}
          tone="blue"
        />
        {canInventory ? (
          <Stat
            label="Inventários abertos"
            value={summary.inventories.openCount}
            hint={
              summary.inventories.openCount > 0
                ? "Contagens em andamento"
                : "Nenhuma contagem aberta"
            }
            tone={summary.inventories.openCount > 0 ? "brand" : "green"}
          />
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <RecentMovementsCard
          movements={summary.recentMovements}
          className="min-w-0 lg:col-span-3"
        />
        <LowStockCard stock={summary.stock} className="min-w-0 lg:col-span-2" />
      </div>

      <Card
        className="mt-5"
        title="Ações rápidas"
        description="O caminho curto para a rotina do estoque."
      >
        <div className="flex flex-wrap gap-2">
          <Link to="/estoque">
            <Button variant="secondary" size="sm">Movimentar estoque</Button>
          </Link>
          {canInventory ? (
            <Link to="/inventario">
              <Button variant="secondary" size="sm">Abrir inventário</Button>
            </Link>
          ) : null}
          {canConsumption ? (
            <Link to="/consumo">
              <Button variant="secondary" size="sm">Registrar consumo</Button>
            </Link>
          ) : null}
          <Link to="/catalogo">
            <Button variant="secondary" size="sm">Catálogo</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painel da limpeza (líder e equipe)                                         */
/* -------------------------------------------------------------------------- */

function CleaningHome() {
  const { can, user, app } = useSession();
  const state = useDashboardData();

  if (state.loading && !state.data) {
    return <LoadingBlock label="Carregando a rotina da limpeza..." />;
  }
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  const summary = state.data?.summary;
  if (!summary) return null;

  const firstName = user?.name.split(" ")[0] ?? "";
  const canInventory = can(PERMISSIONS.INVENTORY_VIEW);
  const canConsumption = can(PERMISSIONS.CONSUMPTION_CREATE);
  const mine = summary.tickets.mine;

  return (
    <div>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          <>
            Consumo da equipe e seus chamados em {app.companyName ?? "sua operação"} ·{" "}
            {formatDateTime(summary.generatedAt)}.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={state.reload} loading={state.loading}>
              Atualizar
            </Button>
            <Link to="/chamados?novo=1">
              <Button>Abrir chamado</Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={`Consumo (${summary.consumption.periodDays} dias)`}
          value={formatQuantity(summary.consumption.qtyMilli)}
          hint={`${summary.consumption.recordCount} ${plural(summary.consumption.recordCount, "lançamento", "lançamentos")} da equipe`}
          tone="blue"
        />
        <Stat
          label="Chamados em aberto"
          value={summary.tickets.openCount}
          hint="Aguardando o time de facilities"
          tone={summary.tickets.openCount > 0 ? "blue" : "green"}
        />
        <Stat
          label="Resolvidos (30 dias)"
          value={summary.tickets.resolvedLast30Days}
          hint="Seu histórico recente"
          tone="green"
        />
        {canInventory ? (
          <Stat
            label="Inventários abertos"
            value={summary.inventories.openCount}
            hint={
              summary.inventories.openCount > 0
                ? "Contagens para conferir"
                : "Nenhuma contagem aberta"
            }
            tone={summary.inventories.openCount > 0 ? "brand" : "green"}
          />
        ) : null}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card
          className="min-w-0 lg:col-span-3"
          title="Meus chamados"
          description="Os últimos chamados que você abriu ou assumiu."
          padded={false}
        >
          {mine.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nenhum chamado no seu nome"
                description="Precisa de manutenção, limpeza ou apoio no seu setor? Abra um chamado e acompanhe por aqui."
              />
              <div className="mt-4 flex justify-center">
                <Link to="/chamados?novo=1">
                  <Button>Abrir chamado</Button>
                </Link>
              </div>
            </div>
          ) : (
            <MineTicketsList mine={mine} />
          )}
        </Card>

        <Card
          className="min-w-0 lg:col-span-2"
          title="Ações rápidas"
          description="O registro do dia a dia da limpeza."
        >
          <div className="flex flex-col gap-2">
            {canConsumption ? (
              <Link to="/consumo">
                <Button variant="secondary" size="sm" className="w-full">
                  Registrar consumo
                </Button>
              </Link>
            ) : null}
            <Link to="/chamados?novo=1">
              <Button variant="secondary" size="sm" className="w-full">
                Abrir chamado
              </Button>
            </Link>
            {canInventory ? (
              <Link to="/inventario">
                <Button variant="secondary" size="sm" className="w-full">
                  Conferir inventário
                </Button>
              </Link>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

function direction(from: string | null, to: string | null): string {
  if (from && to) return `${from} -> ${to}`;
  if (from) return `saída de ${from}`;
  if (to) return `entrada em ${to}`;
  return "-";
}

function movementTone(type: string): "green" | "red" | "blue" | "violet" | "amber" | "slate" {
  switch (type) {
    case "return":
    case "replenish":
    case "purchase_receipt":
      return "green";
    case "issue":
    case "loss":
      return "red";
    case "transfer":
      return "blue";
    case "maintenance_use":
      return "violet";
    case "inventory_adjust":
    case "consumption":
      return "amber";
    default:
      return "slate";
  }
}
