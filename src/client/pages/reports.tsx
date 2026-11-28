import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  INVENTORY_STATUS_LABEL,
  MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABEL,
  PRIORITY_LABEL,
  PURCHASE_STATUS,
  PURCHASE_STATUS_LABEL,
  TICKET_STATUS_LABEL,
  type InventoryStatus,
  type MovementType,
  type Priority,
  type PurchaseStatus,
  type TicketStatus,
} from "@shared/types";
import { apiErrorMessage, apiGet, downloadCsv, withParams } from "../lib/api";
import {
  PURCHASE_STATUS_TONE,
  addDaysIsoDate,
  dayRangeParams,
  formatCurrencyFromCents,
  formatDateTime,
  formatPercent,
  formatQuantity,
  plural,
  todayIsoDate,
} from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useCategories, useLocations } from "../lib/lookups";
import { ProductPicker } from "../lib/product-picker";
import { useSession } from "../lib/session";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  SearchInput,
  Select,
  Stat,
  Table,
  Tabs,
  useToast,
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos das respostas                                                        */
/* -------------------------------------------------------------------------- */

interface StockPositionResponse {
  scope: "per_location" | "global";
  items: {
    productId: string;
    productName: string;
    sku: string | null;
    uomCode: string | null;
    categoryName: string | null;
    locationId: string;
    locationName: string;
    locationPath: string | null;
    qtyMilli: number;
    totalQtyMilli: number;
    minQtyMilli: number;
    isBelowMin: boolean;
    isZero: boolean;
    lastCostCents: number | null;
    updatedAt: string;
  }[];
  totals: { lines: number; qtyMilli: number };
}

interface MovementsResponse {
  items: {
    id: string;
    type: string;
    qtyMilli: number;
    occurredAt: string;
    reason: string | null;
    counterparty: string | null;
    refType: string | null;
    refId: string | null;
    unitCostCents: number | null;
    productName: string;
    sku: string | null;
    uomCode: string | null;
    fromLocationName: string | null;
    fromLocationPath: string | null;
    toLocationName: string | null;
    toLocationPath: string | null;
    userName: string;
  }[];
  byType: { type: string; count: number; qtyMilli: number }[];
  total: number;
}

interface ConsumptionReportResponse {
  period: { from: string; to: string };
  groupBy: string;
  groups: { key: string | null; label: string | null; qtyMilli: number; recordCount: number; lineCount: number }[];
  byPeriodicity: { periodicity: string; recordCount: number; qtyMilli: number }[];
  totals: { qtyMilli: number; recordCount: number };
}

interface TicketsReportResponse {
  period: { from: string; to: string };
  byStatus: { status: string; count: number }[];
  byCategory: { categoryName: string; count: number; resolvedCount: number }[];
  byPriority: { priority: string; count: number }[];
  byLocation: { locationName: string; count: number }[];
  timing: { avgResolutionHours: number | null; resolvedCount: number; convertedCount: number };
}

interface WorkOrdersReportResponse {
  period: { from: string; to: string };
  byStatus: { status: string; count: number }[];
  byAssignee: { assigneeName: string; count: number; doneCount: number }[];
  timing: { avgCompletionHours: number | null };
  materialsQtyMilli: number;
}

interface PurchasesReportResponse {
  period: { from: string; to: string };
  byStatus: { status: string; count: number }[];
  quantities: { expectedQtyMilli: number; receivedQtyMilli: number; pendingQtyMilli: number };
  receipts: { count: number; valueCents: number; discrepancyCount: number };
  bySupplier: { supplierName: string; receiptCount: number; qtyMilli: number }[];
  /** F-04: propostas de cotação registradas no período. */
  quotes: { total: number; byStatus: { status: string; count: number }[] };
  /** F-03: itens com fornecedor definido — onde a compra está acontecendo. */
  ordersBySupplier: { supplierName: string; itemCount: number; qtyMilli: number; valueCents: number }[];
  /** F-04: ciclo completo por solicitação (até 100, mais recentes primeiro). */
  requests: {
    id: string;
    code: string;
    status: string;
    priority: string;
    createdAt: string;
    updatedAt: string;
    requesterName: string;
    itemCount: number;
    quoteItemCount: number;
    quoteCount: number;
    supplierNames: string | null;
    orderedValueCents: number;
    expectedQtyMilli: number;
    receivedQtyMilli: number;
    receiptCount: number;
  }[];
}

interface VariancesResponse {
  items: {
    inventoryId: string;
    inventoryCode: string;
    inventoryStatus: string;
    closedAt: string | null;
    locationName: string | null;
    locationPath: string | null;
    itemId: string;
    productName: string;
    sku: string | null;
    uomCode: string | null;
    qtyExpectedMilli: number;
    qtyCountedMilli: number;
    differenceMilli: number;
    adjustmentMovementId: string | null;
    isInactiveProduct: boolean;
  }[];
  totals: { shortageMilli: number; surplusMilli: number; lines: number };
}

type ReportTab =
  | "stock"
  | "movements"
  | "consumption"
  | "tickets"
  | "workorders"
  | "purchases"
  | "variances";

const TABS: { value: ReportTab; label: string }[] = [
  { value: "stock", label: "Posição de estoque" },
  { value: "movements", label: "Movimentações" },
  { value: "consumption", label: "Consumo" },
  { value: "tickets", label: "Chamados" },
  { value: "workorders", label: "Ordens de serviço" },
  { value: "purchases", label: "Compras" },
  { value: "variances", label: "Divergências de inventário" },
];

const PERIODICITY_LABEL: Record<string, string> = {
  daily: "Diário",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
  custom: "Período livre",
};

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: ReportTab = (TABS.some((entry) => entry.value === raw) ? raw : "stock") as ReportTab;

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Leituras agregadas de estoque, consumo, atendimento e compras. Exportação em CSV quando disponível."
        backTo="/configuracoes/administracao"
        backLabel="Voltar à administração"
      />
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(value) => {
          const next = new URLSearchParams();
          next.set("tab", value);
          setParams(next, { replace: true });
        }}
      />
      {tab === "stock" ? <StockReport /> : null}
      {tab === "movements" ? <MovementsReport /> : null}
      {tab === "consumption" ? <ConsumptionReport /> : null}
      {tab === "tickets" ? <TicketsReport /> : null}
      {tab === "workorders" ? <WorkOrdersReport /> : null}
      {tab === "purchases" ? <PurchasesReport /> : null}
      {tab === "variances" ? <VariancesReport /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Posição de estoque                                                         */
/* -------------------------------------------------------------------------- */

function StockReport() {
  const { can } = useSession();
  const toast = useToast();
  const locations = useLocations();
  const categories = useCategories();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [includeZero, setIncludeZero] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [exporting, setExporting] = useState(false);

  const filters = {
    search: debounced || undefined,
    locationId: locationId || undefined,
    categoryId: categoryId || undefined,
    onlyLow: onlyLow ? "true" : undefined,
    includeZero: includeZero ? undefined : "false",
    activeOnly: activeOnly ? "true" : undefined,
  };

  const state = useAsync(() => apiGet<StockPositionResponse>("/api/reports/stock", filters), [
    debounced,
    locationId,
    categoryId,
    onlyLow,
    includeZero,
    activeOnly,
  ]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        withParams("/api/reports/export", {
          report: "stock-position",
          locationId: locationId || undefined,
          onlyLow: onlyLow ? "true" : undefined,
        }),
        "posicao-estoque.csv",
      );
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<StockPositionResponse["items"][number]>[] = [
    {
      key: "product",
      header: "Produto",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.productName}</p>
          <p className="truncate text-xs text-slate-500">
            {row.sku ? `${row.sku} · ` : ""}
            {row.categoryName ?? "Sem categoria"}
          </p>
        </div>
      ),
    },
    {
      key: "location",
      header: "Local",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-slate-600">{row.locationPath ?? row.locationName}</span>,
    },
    {
      key: "qty",
      header: "Saldo no local",
      align: "right",
      cell: (row) => (
        <span className={`tabular-nums ${row.isBelowMin ? "font-semibold text-amber-800" : "text-slate-800"}`}>
          {formatQuantity(row.qtyMilli)} {row.uomCode ?? ""}
        </span>
      ),
    },
    {
      key: "total",
      header: "Saldo total",
      align: "right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums text-slate-600">
          {formatQuantity(row.totalQtyMilli)} {row.uomCode ?? ""}
        </span>
      ),
    },
    {
      key: "min",
      header: "Mínimo",
      align: "right",
      hideOnMobile: true,
      cell: (row) =>
        row.minQtyMilli > 0 ? (
          <span className="tabular-nums text-slate-600">{formatQuantity(row.minQtyMilli)}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    {
      key: "cost",
      header: "Último custo",
      align: "right",
      hideOnMobile: true,
      cell: (row) =>
        row.lastCostCents === null ? (
          <span className="text-slate-400">-</span>
        ) : (
          <span className="tabular-nums text-slate-600">{formatCurrencyFromCents(row.lastCostCents)}</span>
        ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) =>
        row.isZero ? (
          <Badge tone="red">Zerado</Badge>
        ) : row.isBelowMin ? (
          <Badge tone="amber">Abaixo do mínimo</Badge>
        ) : (
          <Badge tone="green">Normal</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Produto, SKU..." className="w-full sm:w-64" />
          <Select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="w-full sm:w-56"
            aria-label="Local"
          >
            <option value="">Todos os locais</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </Select>
          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="w-full sm:w-52"
            aria-label="Categoria"
          >
            <option value="">Todas as categorias</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          {can(PERMISSIONS.REPORTS_EXPORT) ? (
            <div className="ml-auto">
              <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
                Exportar CSV
              </Button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-4 py-2 text-sm text-slate-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={onlyLow}
              onChange={(event) => setOnlyLow(event.target.checked)}
            />
            Somente abaixo do mínimo
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={includeZero}
              onChange={(event) => setIncludeZero(event.target.checked)}
            />
            Incluir saldos zerados
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={activeOnly}
              onChange={(event) => setActiveOnly(event.target.checked)}
            />
            Somente produtos ativos
          </label>
          {state.data ? (
            <span className="ml-auto text-xs text-slate-500">
              Escopo do mínimo: {state.data.scope === "global" ? "por produto (todos os locais)" : "por local"}
            </span>
          ) : null}
        </div>
        <div className="p-4">
          {state.loading && !state.data ? (
            <LoadingBlock />
          ) : state.error ? (
            <ErrorBlock message={state.error} onRetry={state.reload} />
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Stat label="Linhas" value={state.data?.totals.lines ?? 0} />
                <Stat
                  label="Quantidade somada"
                  value={formatQuantity(state.data?.totals.qtyMilli ?? 0)}
                  hint="Soma das linhas listadas, misturando unidades de medida."
                />
              </div>
              <Table
                columns={columns}
                rows={state.data?.items ?? []}
                keyOf={(row) => `${row.productId}-${row.locationId}`}
                empty={<EmptyState title="Nenhuma linha" description="Nada encontrado com os filtros atuais." />}
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Movimentações                                                              */
/* -------------------------------------------------------------------------- */

function MovementsReport() {
  const { can } = useSession();
  const toast = useToast();
  const locations = useLocations();
  const [from, setFrom] = useState(addDaysIsoDate(-30));
  const [to, setTo] = useState(todayIsoDate());
  const [type, setType] = useState("");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = {
    ...dayRangeParams(from, to),
    type: type || undefined,
    productId: productId || undefined,
    locationId: locationId || undefined,
  };

  const state = useAsync(() => apiGet<MovementsResponse>("/api/reports/movements", filters), [
    from,
    to,
    type,
    productId,
    locationId,
  ]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(withParams("/api/reports/export", { report: "movements", ...filters }), "movimentações.csv");
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<MovementsResponse["items"][number]>[] = [
    {
      key: "movement",
      header: "Movimentação",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {MOVEMENT_TYPE_LABEL[row.type as MovementType] ?? row.type} · {row.productName}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.fromLocationPath ?? row.fromLocationName ?? "sem origem"} →{" "}
            {row.toLocationPath ?? row.toLocationName ?? "sem destino"}
          </p>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Quantidade",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-slate-800">
          {formatQuantity(row.qtyMilli)} {row.uomCode ?? ""}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Custo unit.",
      align: "right",
      hideOnMobile: true,
      cell: (row) =>
        row.unitCostCents === null ? (
          <span className="text-slate-400">-</span>
        ) : (
          <span className="tabular-nums text-slate-600">{formatCurrencyFromCents(row.unitCostCents)}</span>
        ),
    },
    {
      key: "when",
      header: "Quando",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{formatDateTime(row.occurredAt)}</p>
          <p className="text-slate-500">{row.userName}</p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Motivo",
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-slate-600">{row.reason ?? row.counterparty ?? "-"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <Field label="De" className="w-full sm:w-36" htmlFor="repMovFrom">
            <Input id="repMovFrom" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="Até" className="w-full sm:w-36" htmlFor="repMovTo">
            <Input id="repMovTo" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field label="Tipo" className="w-full sm:w-48" htmlFor="repMovType">
            <Select id="repMovType" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">Todos os tipos</option>
              {MOVEMENT_TYPES.map((code) => (
                <option key={code} value={code}>
                  {MOVEMENT_TYPE_LABEL[code]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Produto" className="w-full sm:w-56" htmlFor="repMovProduct">
            <ProductPicker
              id="repMovProduct"
              value={productId}
              onChange={(next) => setProductId(next)}
              ariaLabel="Filtrar por produto"
              placeholder="Todos os produtos"
              activeOnly={false}
            />
          </Field>
          <Field label="Local" className="w-full sm:w-56" htmlFor="repMovLocation">
            <Select id="repMovLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Todos os locais</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          {can(PERMISSIONS.REPORTS_EXPORT) ? (
            <div className="ml-auto">
              <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
                Exportar CSV
              </Button>
            </div>
          ) : null}
        </div>
        <div className="p-4">
          {state.loading && !state.data ? (
            <LoadingBlock />
          ) : state.error ? (
            <ErrorBlock message={state.error} onRetry={state.reload} />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Movimentações" value={state.data?.total ?? 0} />
                {(state.data?.byType ?? []).slice(0, 2).map((entry) => (
                  <Stat
                    key={entry.type}
                    label={MOVEMENT_TYPE_LABEL[entry.type as MovementType] ?? entry.type}
                    value={formatQuantity(entry.qtyMilli)}
                    hint={`${entry.count} ${plural(entry.count, "movimento", "movimentos")}`}
                  />
                ))}
              </div>
              <Table
                columns={columns}
                rows={state.data?.items ?? []}
                keyOf={(row) => row.id}
                empty={<EmptyState title="Nenhuma movimentação" description="Ajuste o período ou os filtros." />}
              />
              <p className="text-xs text-slate-500">Mostrando no máximo 2.000 movimentações, das mais recentes para as mais antigas.</p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Consumo                                                                    */
/* -------------------------------------------------------------------------- */

function ConsumptionReport() {
  const { can } = useSession();
  const toast = useToast();
  const locations = useLocations();
  const [from, setFrom] = useState(addDaysIsoDate(-60));
  const [to, setTo] = useState(todayIsoDate());
  const [groupBy, setGroupBy] = useState("product");
  const [locationId, setLocationId] = useState("");
  const [productId, setProductId] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = {
    ...dayRangeParams(from, to),
    groupBy,
    locationId: locationId || undefined,
    productId: productId || undefined,
  };

  const state = useAsync(() => apiGet<ConsumptionReportResponse>("/api/reports/consumption", filters), [
    from,
    to,
    groupBy,
    locationId,
    productId,
  ]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(withParams("/api/reports/export", { report: "consumption", ...filters }), "consumo.csv");
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<ConsumptionReportResponse["groups"][number]>[] = [
    { key: "label", header: "Grupo", cell: (row) => <span className="font-medium text-slate-800">{row.label ?? "-"}</span> },
    {
      key: "qty",
      header: "Quantidade",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-800">{formatQuantity(row.qtyMilli)}</span>,
    },
    {
      key: "records",
      header: "Lançamentos",
      align: "right",
      hideOnMobile: true,
      cell: (row) => <span className="tabular-nums text-slate-600">{row.recordCount}</span>,
    },
    {
      key: "lines",
      header: "Linhas",
      align: "right",
      hideOnMobile: true,
      cell: (row) => <span className="tabular-nums text-slate-600">{row.lineCount}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <Field label="De" className="w-full sm:w-36" htmlFor="repConsFrom">
            <Input id="repConsFrom" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="Até" className="w-full sm:w-36" htmlFor="repConsTo">
            <Input id="repConsTo" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field label="Agrupar por" className="w-full sm:w-44" htmlFor="repConsGroup">
            <Select id="repConsGroup" value={groupBy} onChange={(event) => setGroupBy(event.target.value)}>
              <option value="product">Produto</option>
              <option value="location">Local</option>
              <option value="user">Responsável</option>
              <option value="day">Dia do fechamento</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
            </Select>
          </Field>
          <Field label="Local" className="w-full sm:w-56" htmlFor="repConsLocation">
            <Select id="repConsLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Todos os locais</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Produto" className="w-full sm:w-56" htmlFor="repConsProduct">
            <ProductPicker
              id="repConsProduct"
              value={productId}
              onChange={(next) => setProductId(next)}
              ariaLabel="Filtrar por produto"
              placeholder="Todos os produtos"
              activeOnly={false}
            />
          </Field>
          {can(PERMISSIONS.REPORTS_EXPORT) ? (
            <div className="ml-auto">
              <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
                Exportar CSV
              </Button>
            </div>
          ) : null}
        </div>
        <div className="p-4">
          {state.loading && !state.data ? (
            <LoadingBlock />
          ) : state.error ? (
            <ErrorBlock message={state.error} onRetry={state.reload} />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label="Quantidade total" value={formatQuantity(state.data?.totals.qtyMilli ?? 0)} />
                <Stat label="Lançamentos" value={state.data?.totals.recordCount ?? 0} />
                <Stat
                  label="Periodicidades"
                  value={(state.data?.byPeriodicity ?? []).length}
                  hint={(state.data?.byPeriodicity ?? [])
                    .map(
                      (entry) =>
                        `${PERIODICITY_LABEL[entry.periodicity] ?? entry.periodicity}: ${formatQuantity(entry.qtyMilli)}`,
                    )
                    .join(" · ")}
                />
              </div>
              <Table
                columns={columns}
                rows={state.data?.groups ?? []}
                keyOf={(row) => row.key ?? row.label ?? "-"}
                empty={<EmptyState title="Nenhum consumo" description="Não há lançamentos confirmados no período." />}
              />
              <p className="text-xs text-slate-500">
                Somente lançamentos confirmados entram nos totais; rascunhos e cancelados ficam de fora.
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chamados                                                                   */
/* -------------------------------------------------------------------------- */

function TicketsReport() {
  const { can } = useSession();
  const toast = useToast();
  const locations = useLocations();
  const [from, setFrom] = useState(addDaysIsoDate(-30));
  const [to, setTo] = useState(todayIsoDate());
  const [locationId, setLocationId] = useState("");
  const [exporting, setExporting] = useState(false);

  const filters = { ...dayRangeParams(from, to), locationId: locationId || undefined };
  const state = useAsync(() => apiGet<TicketsReportResponse>("/api/reports/tickets", filters), [from, to, locationId]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(withParams("/api/reports/export", { report: "tickets", ...filters }), "chamados.csv");
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ReportScaffold
      from={from}
      to={to}
      setFrom={setFrom}
      setTo={setTo}
      locationId={locationId}
      setLocationId={setLocationId}
      locations={locations.data ?? []}
      exportLabel={can(PERMISSIONS.REPORTS_EXPORT) ? "Exportar CSV" : null}
      exporting={exporting}
      onExport={() => void exportCsv()}
      loading={state.loading && !state.data}
      error={state.error}
      reload={state.reload}
    >
      {state.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Tickets no período"
              value={state.data.byStatus.reduce((sum, entry) => sum + entry.count, 0)}
            />
            <Stat
              label="Resolvidos"
              value={state.data.timing.resolvedCount}
              hint={
                state.data.timing.avgResolutionHours === null
                  ? "Sem tempo medio calculado"
                  : `Tempo medio: ${state.data.timing.avgResolutionHours.toFixed(1)} h`
              }
            />
            <Stat label="Convertidos em OS" value={state.data.timing.convertedCount} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionCard
              title="Por situação"
              rows={state.data.byStatus.map((entry) => ({
                label: TICKET_STATUS_LABEL[entry.status as TicketStatus] ?? entry.status,
                value: entry.count,
              }))}
            />
            <DistributionCard
              title="Por prioridade"
              rows={state.data.byPriority.map((entry) => ({
                label: PRIORITY_LABEL[entry.priority as Priority] ?? entry.priority,
                value: entry.count,
              }))}
            />
            <DistributionCard
              title="Por categoria"
              rows={state.data.byCategory.map((entry) => ({
                label: entry.categoryName,
                value: entry.count,
                hint: `${entry.resolvedCount} ${plural(entry.resolvedCount, "resolvido", "resolvidos")}`,
              }))}
            />
            <DistributionCard
              title="Por local"
              rows={state.data.byLocation.map((entry) => ({ label: entry.locationName, value: entry.count }))}
            />
          </div>
        </div>
      ) : null}
    </ReportScaffold>
  );
}

/* -------------------------------------------------------------------------- */
/* Ordens de serviço                                                          */
/* -------------------------------------------------------------------------- */

function WorkOrdersReport() {
  const locations = useLocations();
  const [from, setFrom] = useState(addDaysIsoDate(-30));
  const [to, setTo] = useState(todayIsoDate());
  const [locationId, setLocationId] = useState("");

  const state = useAsync(
    () =>
      apiGet<WorkOrdersReportResponse>("/api/reports/workorders", {
        ...dayRangeParams(from, to),
        locationId: locationId || undefined,
      }),
    [from, to, locationId],
  );

  return (
    <ReportScaffold
      from={from}
      to={to}
      setFrom={setFrom}
      setTo={setTo}
      locationId={locationId}
      setLocationId={setLocationId}
      locations={locations.data ?? []}
      exportLabel={null}
      exporting={false}
      onExport={() => undefined}
      loading={state.loading && !state.data}
      error={state.error}
      reload={state.reload}
    >
      {state.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Ordens no período" value={state.data.byStatus.reduce((sum, entry) => sum + entry.count, 0)} />
            <Stat
              label="Concluídas"
              value={state.data.byStatus.find((entry) => entry.status === "done")?.count ?? 0}
              hint={
                state.data.timing.avgCompletionHours === null
                  ? "Sem tempo medio calculado"
                  : `Tempo medio: ${state.data.timing.avgCompletionHours.toFixed(1)} h`
              }
            />
            <Stat
              label="Material utilizado"
              value={formatQuantity(state.data.materialsQtyMilli)}
              hint="Soma das retiradas de material em ordens de serviço."
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionCard
              title="Por situação"
              rows={state.data.byStatus.map((entry) => ({ label: statusLabel(entry.status), value: entry.count }))}
            />
            <DistributionCard
              title="Por responsável"
              rows={state.data.byAssignee.map((entry) => ({
                label: entry.assigneeName,
                value: entry.count,
                hint: `${entry.doneCount} ${plural(entry.doneCount, "concluída", "concluídas")}`,
              }))}
            />
          </div>
        </div>
      ) : null}
    </ReportScaffold>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    open: "Aberta",
    planned: "Planejada",
    in_progress: "Em andamento",
    waiting_material: "Aguardando material",
    done: "Concluída",
    closed: "Fechada",
    cancelled: "Cancelada",
  };
  return labels[status] ?? status;
}

/* -------------------------------------------------------------------------- */
/* Compras                                                                    */
/* -------------------------------------------------------------------------- */

function PurchasesReport() {
  const { can } = useSession();
  const toast = useToast();
  const [from, setFrom] = useState(addDaysIsoDate(-30));
  const [to, setTo] = useState(todayIsoDate());
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  const state = useAsync(
    () =>
      apiGet<PurchasesReportResponse>("/api/reports/purchases", {
        ...dayRangeParams(from, to),
        status: status || undefined,
      }),
    [from, to, status],
  );

  const columns: Column<PurchasesReportResponse["requests"][number]>[] = [
    {
      key: "code",
      header: "Solicitação",
      cell: (row) => (
        <Link to={`/compras/${row.id}`} className="font-medium text-brand-700 hover:underline">
          {row.code}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge tone={PURCHASE_STATUS_TONE[row.status as PurchaseStatus] ?? "slate"}>
          {PURCHASE_STATUS_LABEL[row.status as PurchaseStatus] ?? row.status}
        </Badge>
      ),
    },
    {
      key: "requester",
      header: "Solicitante",
      hideOnMobile: true,
      cell: (row) => <span className="text-slate-700">{row.requesterName}</span>,
    },
    {
      key: "items",
      header: "Itens",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-slate-700">
          {row.itemCount}
          {row.quoteItemCount > 0 ? (
            <span className="ml-1 text-xs text-violet-700">{row.quoteItemCount} em cotação</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "supplier",
      header: "Fornecedor",
      hideOnMobile: true,
      cell: (row) => <span className="text-slate-700">{row.supplierNames ?? "-"}</span>,
    },
    {
      key: "value",
      header: "Pedido",
      align: "right",
      cell: (row) =>
        row.orderedValueCents > 0 ? (
          <span className="tabular-nums text-slate-700">{formatCurrencyFromCents(row.orderedValueCents)}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    {
      key: "received",
      header: "Recebido / previsto",
      align: "right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatQuantity(row.receivedQtyMilli)} / {formatQuantity(row.expectedQtyMilli)}
        </span>
      ),
    },
  ];

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        withParams("/api/reports/export", {
          report: "purchases",
          ...dayRangeParams(from, to),
          status: status || undefined,
        }),
        "compras.csv",
      );
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ReportScaffold
      from={from}
      to={to}
      setFrom={setFrom}
      setTo={setTo}
      locationId=""
      setLocationId={() => undefined}
      locations={[]}
      exportLabel={can(PERMISSIONS.REPORTS_EXPORT) ? "Exportar CSV" : null}
      exporting={exporting}
      onExport={() => void exportCsv()}
      loading={state.loading && !state.data}
      error={state.error}
      reload={state.reload}
    >
      {state.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Solicitações"
              value={state.data.byStatus.reduce((sum, entry) => sum + entry.count, 0)}
            />
            <Stat label="Recebimentos" value={state.data.receipts.count} />
            <Stat
              label="Valor recebido"
              value={formatCurrencyFromCents(state.data.receipts.valueCents)}
              hint="Calculado pelo custo unitário registrado no movimento de entrada."
            />
            <Stat
              label="Divergências"
              value={state.data.receipts.discrepancyCount}
              alert={state.data.receipts.discrepancyCount > 0}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Quantidade prevista" value={formatQuantity(state.data.quantities.expectedQtyMilli)} />
            <Stat label="Quantidade recebida" value={formatQuantity(state.data.quantities.receivedQtyMilli)} />
            <Stat
              label="Pendente de receber"
              value={formatQuantity(state.data.quantities.pendingQtyMilli)}
              alert={state.data.quantities.pendingQtyMilli > 0}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionCard
              title="Por situação"
              rows={state.data.byStatus.map((entry) => ({
                label: PURCHASE_STATUS_LABEL[entry.status as PurchaseStatus] ?? entry.status,
                value: entry.count,
              }))}
            />
            <DistributionCard
              title="Recebimentos por fornecedor"
              rows={state.data.bySupplier.map((entry) => ({
                label: entry.supplierName,
                value: entry.receiptCount,
                hint: formatQuantity(entry.qtyMilli),
              }))}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionCard
              title="Cotações no período"
              rows={state.data.quotes.byStatus.map((entry) => ({
                label:
                  entry.status === "registered"
                    ? "Registradas"
                    : entry.status === "approved"
                      ? "Aprovadas"
                      : entry.status === "rejected"
                        ? "Não escolhidas"
                        : entry.status,
                value: entry.count,
              }))}
            />
            <DistributionCard
              title="Pedidos por fornecedor"
              rows={state.data.ordersBySupplier.map((entry) => ({
                label: entry.supplierName,
                value: entry.itemCount,
                hint: `${formatCurrencyFromCents(entry.valueCents)} · ${formatQuantity(entry.qtyMilli)}`,
              }))}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Ciclo das solicitações</h3>
                <p className="text-xs text-slate-500">
                  Da criação ao recebimento, com fornecedor e valor comprometido (até 100 solicitações no período).
                </p>
              </div>
              <Field label="Situação" htmlFor="purchasesReportStatus" className="w-full sm:w-56">
                <Select
                  id="purchasesReportStatus"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="">Todas as situações</option>
                  {PURCHASE_STATUS.map((value) => (
                    <option key={value} value={value}>
                      {PURCHASE_STATUS_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Card padded={false}>
              <Table
                columns={columns}
                rows={state.data.requests}
                keyOf={(row) => row.id}
                empty={
                  <EmptyState
                    title="Sem solicitações"
                    description="Nenhuma solicitação de compra encontrada no período e no filtro selecionados."
                  />
                }
              />
            </Card>
          </div>
        </div>
      ) : null}
    </ReportScaffold>
  );
}

/* -------------------------------------------------------------------------- */
/* Divergências de inventário                                                 */
/* -------------------------------------------------------------------------- */

function VariancesReport() {
  const { can } = useSession();
  const toast = useToast();
  const [onlyDifference, setOnlyDifference] = useState(true);
  const [exporting, setExporting] = useState(false);

  const state = useAsync(
    () =>
      apiGet<VariancesResponse>("/api/reports/inventory-variances", {
        onlyDifference: onlyDifference ? undefined : "false",
      }),
    [onlyDifference],
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadCsv(
        withParams("/api/reports/export", {
          report: "inventory-variances",
          onlyDifference: onlyDifference ? undefined : "false",
        }),
        "divergencias-inventario.csv",
      );
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<VariancesResponse["items"][number]>[] = [
    {
      key: "product",
      header: "Produto",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {row.productName}
            {row.isInactiveProduct ? <span className="text-slate-400"> (inativo)</span> : null}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.sku ? `${row.sku} · ` : ""}
            {row.locationPath ?? row.locationName ?? "-"}
          </p>
        </div>
      ),
    },
    {
      key: "inventory",
      header: "Inventário",
      hideOnMobile: true,
      cell: (row) => (
        <Link to={`/inventario/${row.inventoryId}`} className="text-brand-700 hover:underline">
          {row.inventoryCode}
        </Link>
      ),
    },
    {
      key: "expected",
      header: "Sistema",
      align: "right",
      hideOnMobile: true,
      cell: (row) => <span className="tabular-nums text-slate-600">{formatQuantity(row.qtyExpectedMilli)}</span>,
    },
    {
      key: "counted",
      header: "Contado",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-700">{formatQuantity(row.qtyCountedMilli)}</span>,
    },
    {
      key: "diff",
      header: "Diferença",
      align: "right",
      cell: (row) => (
        <span
          className={`font-semibold tabular-nums ${
            row.differenceMilli > 0 ? "text-blue-700" : row.differenceMilli < 0 ? "text-red-700" : "text-slate-500"
          }`}
        >
          {row.differenceMilli > 0 ? "+" : ""}
          {formatQuantity(row.differenceMilli)} {row.uomCode ?? ""}
        </span>
      ),
    },
    {
      key: "adjust",
      header: "Ajuste",
      hideOnMobile: true,
      cell: (row) =>
        row.adjustmentMovementId ? <Badge tone="green">Aplicado</Badge> : <Badge tone="amber">Pendente</Badge>,
    },
    {
      key: "status",
      header: "Ciclo",
      hideOnMobile: true,
      cell: (row) => (
        <Badge tone={row.inventoryStatus === "closed" ? "slate" : "blue"}>
          {INVENTORY_STATUS_LABEL[row.inventoryStatus as InventoryStatus] ?? row.inventoryStatus}
        </Badge>
      ),
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
            checked={onlyDifference}
            onChange={(event) => setOnlyDifference(event.target.checked)}
          />
          Somente com diferença
        </label>
        {can(PERMISSIONS.REPORTS_EXPORT) ? (
          <div className="ml-auto">
            <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
              Exportar CSV
            </Button>
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Linhas" value={state.data?.totals.lines ?? 0} />
              <Stat label="Faltas" value={formatQuantity(state.data?.totals.shortageMilli ?? 0)} alert={(state.data?.totals.shortageMilli ?? 0) > 0} />
              <Stat label="Sobras" value={formatQuantity(state.data?.totals.surplusMilli ?? 0)} />
            </div>
            <Table
              columns={columns}
              rows={state.data?.items ?? []}
              keyOf={(row) => row.itemId}
              empty={<EmptyState title="Nenhuma divergência" description="Nenhum item de inventário com diferença." />}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

function ReportScaffold({
  from,
  to,
  setFrom,
  setTo,
  locationId,
  setLocationId,
  locations,
  exportLabel,
  exporting,
  onExport,
  loading,
  error,
  reload,
  children,
}: {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  locationId: string;
  setLocationId: (value: string) => void;
  locations: { id: string; path: string; unitName: string | null }[];
  exportLabel: string | null;
  exporting: boolean;
  onExport: () => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
        <Field label="De" className="w-full sm:w-36" htmlFor="repFrom">
          <Input id="repFrom" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="Até" className="w-full sm:w-36" htmlFor="repTo">
          <Input id="repTo" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        {locations.length > 0 ? (
          <Field label="Local" className="w-full sm:w-56" htmlFor="repLocation">
            <Select id="repLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Todos os locais</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {exportLabel ? (
          <div className="ml-auto">
            <Button variant="secondary" loading={exporting} onClick={onExport}>
              {exportLabel}
            </Button>
          </div>
        ) : null}
      </div>
      <div className="p-4">
        {loading ? <LoadingBlock /> : error ? <ErrorBlock message={error} onRetry={reload} /> : children}
      </div>
    </Card>
  );
}

function DistributionCard({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number; hint?: string }[];
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = rows.reduce((highest, row) => Math.max(highest, row.value), 0);

  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Sem dados no período.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-slate-700">{row.label}</span>
                <span className="whitespace-nowrap tabular-nums text-slate-600">
                  {row.value}
                  <span className="ml-1.5 text-xs text-slate-400">
                    {formatPercent(total > 0 ? (row.value / total) * 100 : 0)}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{ width: max > 0 ? `${Math.round((row.value / max) * 100)}%` : "0%" }}
                />
              </div>
              {row.hint ? <p className="mt-0.5 text-xs text-slate-500">{row.hint}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
