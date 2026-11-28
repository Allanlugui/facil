import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  INVENTORY_ITEM_STATUS_LABEL,
  INVENTORY_STATUS_LABEL,
  type InventoryItemStatus,
  type InventoryStatus,
  type Paginated,
} from "@shared/types";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api";
import { formatDateTime, formatQuantity, plural, todayIsoDate } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useLocations } from "../lib/lookups";
import { useSession } from "../lib/session";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Stat,
  Table,
  Textarea,
  useToast,
  type Column,
  type Tone,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface InventoryRow {
  id: string;
  code: string;
  periodLabel: string;
  locationId: string;
  locationName: string | null;
  locationPath: string | null;
  status: InventoryStatus;
  openedBy: string;
  openedByName: string | null;
  openedAt: string;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  reopenCount: number;
  notes: string | null;
  itemCount: number;
  pendingCount: number;
  divergentCount: number;
  adjustedCount: number;
  skippedCount: number;
}

interface InventoryItemRow {
  id: string;
  inventoryId: string;
  productId: string;
  productName: string;
  sku: string | null;
  uomCode: string;
  categoryName: string | null;
  productActive: boolean;
  isInactiveProduct: boolean;
  minQtyMilli: number;
  systemQtyMilli: number;
  liveQtyMilli: number;
  countedQtyMilli: number | null;
  differenceMilli: number | null;
  status: InventoryItemStatus;
  countedBy: string | null;
  countedByName: string | null;
  countedAt: string | null;
  justification: string | null;
  notes: string | null;
  adjustmentMovementId: string | null;
  adjustmentDeltaMilli: number | null;
}

interface InventoryReport {
  inventory: InventoryRow;
  summary: {
    totalItems: number;
    pending: number;
    counted: number;
    divergent: number;
    adjusted: number;
    skipped: number;
    excessItems: number;
    shortageItems: number;
    belowMinimumItems: number;
    totalExcessMilli: number;
    totalShortageMilli: number;
    appliedAdjustmentMilli: number;
  };
  counters: { name: string; firstCountAt: string }[];
  items: InventoryItemRow[];
}

const STATUS_TONE: Record<InventoryStatus, Tone> = { open: "blue", closed: "green", cancelled: "red" };

/* -------------------------------------------------------------------------- */
/* Lista de inventários                                                       */
/* -------------------------------------------------------------------------- */

export function InventoryPage() {
  const navigate = useNavigate();
  const { can } = useSession();
  const locations = useLocations();
  const [status, setStatus] = useState("");
  const [locationId, setLocationId] = useState("");
  const [period, setPeriod] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const debouncedPeriod = useDebounced(period);

  const state = useAsync(
    () =>
      apiGet<Paginated<InventoryRow>>("/api/inventories", {
        status: status || undefined,
        locationId: locationId || undefined,
        period: debouncedPeriod || undefined,
        page,
        pageSize: 25,
      }),
    [status, locationId, debouncedPeriod, page],
  );

  const columns: Column<InventoryRow>[] = [
    {
      key: "code",
      header: "Inventário",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{row.code}</p>
          <p className="truncate text-xs text-slate-500">
            {row.periodLabel} · {row.locationPath ?? row.locationName}
          </p>
        </div>
      ),
    },
    {
      key: "progress",
      header: "Andamento",
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p className="tabular-nums">
            {row.itemCount} {plural(row.itemCount, "item", "itens")} · {row.pendingCount} {plural(row.pendingCount, "pendente", "pendentes")}
          </p>
          <p className="tabular-nums text-slate-500">
            {row.divergentCount} {plural(row.divergentCount, "divergente", "divergentes")} · {row.adjustedCount} {plural(row.adjustedCount, "ajustado", "ajustados")} · {row.skippedCount} {plural(row.skippedCount, "dispensado", "dispensados")}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={STATUS_TONE[row.status]}>{INVENTORY_STATUS_LABEL[row.status]}</Badge>
          {row.reopenCount > 0 ? <Badge tone="violet">Reaberto {row.reopenCount}x</Badge> : null}
        </div>
      ),
    },
    {
      key: "opened",
      header: "Abertura",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.openedByName}</p>
          <p className="text-slate-500">{formatDateTime(row.openedAt)}</p>
        </div>
      ),
    },
    {
      key: "closed",
      header: "Fechamento",
      hideOnMobile: true,
      cell: (row) =>
        row.closedAt ? (
          <div className="text-xs text-slate-600">
            <p>{row.closedByName}</p>
            <p className="text-slate-500">{formatDateTime(row.closedAt)}</p>
          </div>
        ) : (
          <span className="text-xs text-slate-400">-</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="secondary" size="sm" onClick={() => navigate(`/inventario/${row.id}`)}>
          Abrir ciclo
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Inventário"
        description="Contagem física com snapshot do sistema, divergências justificadas e ajuste por movimentação."
        actions={
          can(PERMISSIONS.INVENTORY_CREATE) ? (
            <Button onClick={() => setCreating(true)}>Abrir novo inventário</Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <SearchInput value={period} onChange={setPeriod} placeholder="Período (ex.: 2026-10)..." className="w-full sm:w-56" />
          <Select
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-56"
            aria-label="Filtrar por local"
          >
            <option value="">Todos os locais</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </Select>
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-44"
            aria-label="Filtrar por situação"
          >
            <option value="">Todas as situações</option>
            {Object.entries(INVENTORY_STATUS_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="p-4">
          {state.loading && !state.data ? (
            <LoadingBlock />
          ) : state.error ? (
            <ErrorBlock message={state.error} onRetry={state.reload} />
          ) : (
            <>
              <Table
                columns={columns}
                rows={state.data?.items ?? []}
                keyOf={(row) => row.id}
                empty={
                  <EmptyState
                    title="Nenhum inventário"
                    description="Abra um ciclo para congelar o saldo do sistema por local e iniciar a contagem."
                  />
                }
              />
              <div className="mt-3">
                <Pagination
                  page={state.data?.page ?? 1}
                  pageSize={state.data?.pageSize ?? 25}
                  total={state.data?.total ?? 0}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      {creating ? (
        <OpenInventoryDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/inventario/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

function OpenInventoryDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const [locationId, setLocationId] = useState("");
  const [periodLabel, setPeriodLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!locationId) {
      setError("Selecione o local do inventário.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ id: string; code: string; itemCount: number }>("/api/inventories", {
        locationId,
        periodLabel: periodLabel || undefined,
        notes: notes || null,
      });
      toast.success(`Inventário ${result.code} aberto com ${result.itemCount} ${plural(result.itemCount, "item", "itens")}.`);
      onCreated(result.id);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="Abrir inventário"
      description="O snapshot congela o saldo atual do local; apenas um ciclo aberto por local."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Abrir ciclo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Local" required htmlFor="invLocation">
          <Select id="invLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)} autoFocus>
            <option value="">Selecione o local...</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Período"
          hint={`Deixe vazio para usar a periodicidade configurada (ex.: ${todayIsoDate().slice(0, 7)}).`}
          htmlFor="invPeriod"
        >
          <Input
            id="invPeriod"
            value={periodLabel}
            onChange={(event) => setPeriodLabel(event.target.value)}
            placeholder="Ex.: 2026-10"
          />
        </Field>
        <Field label="Observações" htmlFor="invNotes">
          <Textarea id="invNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhe do ciclo                                                           */
/* -------------------------------------------------------------------------- */

export function InventoryDetailPage() {
  const { id = "" } = useParams();
  const { can } = useSession();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [counting, setCounting] = useState<InventoryItemRow | null>(null);
  const [skipping, setSkipping] = useState<InventoryItemRow | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryItemRow | null>(null);
  const [closing, setClosing] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const report = useAsync(() => apiGet<InventoryReport>(`/api/inventories/${id}/report`), [id]);
  const items = useAsync(
    () =>
      apiGet<{ items: InventoryItemRow[] }>(`/api/inventories/${id}/items`, {
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
      }),
    [id, statusFilter, debouncedSearch],
  );

  const inventory = report.data?.inventory;
  const summary = report.data?.summary;

  const reloadAll = () => {
    report.reload();
    items.reload();
  };

  const syncItems = async () => {
    setSyncing(true);
    try {
      const result = await apiPost<{ added?: number }>(`/api/inventories/${id}/sync-items`, {});
      toast.success(
        result.added && result.added > 0
          ? `${result.added} ${plural(result.added, "produto novo incluído", "produtos novos incluídos")} no ciclo.`
          : "Nenhum produto novo para incluir.",
      );
      reloadAll();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setSyncing(false);
    }
  };

  const columns: Column<InventoryItemRow>[] = [
    {
      key: "product",
      header: "Produto",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.productName}</p>
          <p className="truncate text-xs text-slate-500">
            {row.sku ? `${row.sku} · ` : ""}
            {row.categoryName ?? "Sem categoria"}
            {row.isInactiveProduct ? " · produto inativo" : ""}
          </p>
        </div>
      ),
    },
    {
      key: "system",
      header: "Saldo sistema",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-slate-700">
          {formatQuantity(row.systemQtyMilli)} {row.uomCode}
        </span>
      ),
    },
    {
      key: "live",
      header: "Saldo atual",
      align: "right",
      hideOnMobile: true,
      cell: (row) => (
        <span className={`tabular-nums ${row.liveQtyMilli !== row.systemQtyMilli ? "font-medium text-violet-700" : "text-slate-600"}`}>
          {formatQuantity(row.liveQtyMilli)}
        </span>
      ),
    },
    {
      key: "counted",
      header: "Contado",
      align: "right",
      cell: (row) =>
        row.countedQtyMilli !== null ? (
          <span className="font-semibold tabular-nums text-slate-800">{formatQuantity(row.countedQtyMilli)}</span>
        ) : (
          <span className="text-slate-400">-</span>
        ),
    },
    {
      key: "diff",
      header: "Diferença",
      align: "right",
      cell: (row) =>
        row.differenceMilli === null ? (
          <span className="text-slate-400">-</span>
        ) : row.differenceMilli === 0 ? (
          <Badge tone="green">Sem diferença</Badge>
        ) : (
          <span className={`font-semibold tabular-nums ${row.differenceMilli > 0 ? "text-blue-700" : "text-red-700"}`}>
            {row.differenceMilli > 0 ? "+" : ""}
            {formatQuantity(row.differenceMilli)}
          </span>
        ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={itemStatusTone(row.status)}>{INVENTORY_ITEM_STATUS_LABEL[row.status]}</Badge>
          {row.adjustmentMovementId ? <Badge tone="violet">Ajuste aplicado</Badge> : null}
        </div>
      ),
    },
    {
      key: "countedBy",
      header: "Contagem",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.countedByName ?? "-"}</p>
          {row.countedAt ? <p className="text-slate-500">{formatDateTime(row.countedAt)}</p> : null}
          {row.justification ? <p className="text-slate-500">{row.justification}</p> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          {can(PERMISSIONS.INVENTORY_COUNT) && row.status !== "skipped" ? (
            <Button variant="ghost" size="sm" onClick={() => setCounting(row)}>
              {row.countedQtyMilli !== null ? "Recontar" : "Contar"}
            </Button>
          ) : null}
          {can(PERMISSIONS.INVENTORY_COUNT) && row.status === "pending" ? (
            <Button variant="ghost" size="sm" onClick={() => setSkipping(row)}>
              Dispensar
            </Button>
          ) : null}
          {can(PERMISSIONS.INVENTORY_ADJUST) && row.status === "divergent" ? (
            <Button variant="ghost" size="sm" onClick={() => setAdjusting(row)}>
              Ajustar
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (report.loading && !report.data) return <LoadingBlock label="Carregando o inventário..." />;
  if (report.error && !report.data) return <ErrorBlock message={report.error} onRetry={report.reload} />;
  if (!inventory || !summary) return null;

  const open = inventory.status === "open";

  return (
    <div>
      <PageHeader
        title={`Inventário ${inventory.code}`}
        description={
          <>
            {inventory.periodLabel} · {inventory.locationPath ?? inventory.locationName} ·{" "}
            <Badge tone={STATUS_TONE[inventory.status]}>{INVENTORY_STATUS_LABEL[inventory.status]}</Badge>
          </>
        }
        backTo="/inventario"
        backLabel="Voltar aos inventários"
        actions={
          <>
            {open && can(PERMISSIONS.INVENTORY_CREATE) ? (
              <Button variant="secondary" loading={syncing} onClick={() => void syncItems()}>
                Incluir produtos novos
              </Button>
            ) : null}
            {open && can(PERMISSIONS.INVENTORY_CLOSE) ? (
              <Button onClick={() => setClosing(true)}>Fechar ciclo</Button>
            ) : null}
            {!open && can(PERMISSIONS.INVENTORY_REOPEN) ? (
              <Button variant="secondary" onClick={() => setReopening(true)}>
                Reabrir para contagem
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Itens no ciclo" value={summary.totalItems} hint={`${summary.pending} ${plural(summary.pending, "pendente", "pendentes")}`} tone="brand" />
        <Stat
          label="Contados"
          value={summary.counted}
          hint={`${summary.divergent} ${plural(summary.divergent, "divergente", "divergentes")} · ${summary.skipped} ${plural(summary.skipped, "dispensado", "dispensados")}`}
          tone="blue"
        />
        <Stat
          label="Sobras"
          value={formatQuantity(summary.totalExcessMilli)}
          hint={`${summary.excessItems} ${plural(summary.excessItems, "item", "itens")} com sobra`}
          tone="amber"
          alert={summary.excessItems > 0}
        />
        <Stat
          label="Faltas"
          value={formatQuantity(summary.totalShortageMilli)}
          hint={`${summary.shortageItems} ${plural(summary.shortageItems, "item", "itens")} com falta`}
          tone="red"
          alert={summary.shortageItems > 0}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Stat label="Ajustes aplicados" value={formatQuantity(summary.appliedAdjustmentMilli)} hint={`${summary.adjusted} ${plural(summary.adjusted, "item ajustado", "itens ajustados")}`} />
        <Stat label="Abaixo do mínimo" value={summary.belowMinimumItems} hint="Contagem abaixo do estoque mínimo" />
        <Stat
          label="Abertura"
          value={inventory.openedByName ?? "-"}
          hint={`${formatDateTime(inventory.openedAt)}${inventory.reopenCount > 0 ? ` · reaberto ${inventory.reopenCount}x` : ""}`}
        />
      </div>

      {inventory.notes ? (
        <div className="mt-3">
          <Alert tone="slate" title="Observações do ciclo">
            {inventory.notes}
          </Alert>
        </div>
      ) : null}

      {report.data && report.data.counters.length > 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          Contagens registradas por: {report.data.counters.map((counter) => counter.name).join(", ")}.
        </p>
      ) : null}

      <Card className="mt-5" padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Produto ou SKU..." className="w-full sm:w-64" />
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="w-full sm:w-48"
            aria-label="Filtrar por situação do item"
          >
            <option value="">Todas as situações</option>
            {Object.entries(INVENTORY_ITEM_STATUS_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="p-4">
          {items.loading && !items.data ? (
            <LoadingBlock />
          ) : items.error ? (
            <ErrorBlock message={items.error} onRetry={items.reload} />
          ) : (
            <Table
              columns={columns}
              rows={items.data?.items ?? []}
              keyOf={(row) => row.id}
              empty={<EmptyState title="Nenhum item" description="Ajuste os filtros para ver os itens do ciclo." />}
            />
          )}
        </div>
      </Card>

      {counting ? (
        <CountDialog
          inventoryId={id}
          item={counting}
          onClose={() => setCounting(null)}
          onSaved={() => {
            setCounting(null);
            reloadAll();
          }}
        />
      ) : null}

      {skipping ? (
        <SkipDialog
          inventoryId={id}
          item={skipping}
          onClose={() => setSkipping(null)}
          onSaved={() => {
            setSkipping(null);
            reloadAll();
          }}
        />
      ) : null}

      {adjusting ? (
        <AdjustDialog
          inventoryId={id}
          item={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            reloadAll();
          }}
        />
      ) : null}

      {closing ? (
        <CloseDialog
          inventory={inventory}
          pending={summary.pending}
          onClose={() => setClosing(false)}
          onSaved={() => {
            setClosing(false);
            reloadAll();
          }}
        />
      ) : null}

      {reopening ? (
        <ReopenDialog
          inventoryId={id}
          onClose={() => setReopening(false)}
          onSaved={() => {
            setReopening(false);
            reloadAll();
          }}
        />
      ) : null}
    </div>
  );
}

function itemStatusTone(status: InventoryItemStatus): Tone {
  switch (status) {
    case "pending":
      return "amber";
    case "counted":
      return "blue";
    case "divergent":
      return "red";
    case "adjusted":
      return "green";
    case "skipped":
      return "slate";
    default:
      return "slate";
  }
}

/* -------------------------------------------------------------------------- */
/* Ações por item                                                             */
/* -------------------------------------------------------------------------- */

function CountDialog({
  inventoryId,
  item,
  onClose,
  onSaved,
}: {
  inventoryId: string;
  item: InventoryItemRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [countedQty, setCountedQty] = useState(
    item.countedQtyMilli !== null ? formatQuantity(item.countedQtyMilli, 3) : "",
  );
  const [justification, setJustification] = useState(item.justification ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = numbered(countedQty);

  const submit = async () => {
    if (parsed === null || parsed < 0) {
      setError("Informe a quantidade contada (pode ser zero).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/inventories/${inventoryId}/items/${item.id}/count`, {
        countedQty: parsed,
        justification: justification || null,
        notes: notes || null,
      });
      toast.success("Contagem registrada.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={`Contar ${item.productName}`}
      description={`Saldo do sistema: ${formatQuantity(item.systemQtyMilli)} ${item.uomCode} · saldo atual: ${formatQuantity(
        item.liveQtyMilli,
      )}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar contagem
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label={`Quantidade contada (${item.uomCode})`} required htmlFor="countedQty">
          <Input
            id="countedQty"
            value={countedQty}
            onChange={(event) => setCountedQty(event.target.value)}
            inputMode="decimal"
            autoFocus
          />
        </Field>
        {parsed !== null ? (
          <Alert tone={parsed * 1000 === item.systemQtyMilli ? "blue" : "amber"}>
            Diferença em relação ao snapshot:{" "}
            <strong>
              {parsed * 1000 - item.systemQtyMilli > 0 ? "+" : ""}
              {formatQuantity(parsed * 1000 - item.systemQtyMilli)} {item.uomCode}
            </strong>
            .{parsed * 1000 !== item.systemQtyMilli ? " Informe a justificativa abaixo." : ""}
          </Alert>
        ) : null}
        <Field label="Justificativa" htmlFor="countJustification" hint="Obrigatória na prática quando há divergência.">
          <Input
            id="countJustification"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            placeholder="Ex.: quebra na movimentação interna"
          />
        </Field>
        <Field label="Observações" htmlFor="countNotes">
          <Textarea id="countNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function SkipDialog({
  inventoryId,
  item,
  onClose,
  onSaved,
}: {
  inventoryId: string;
  item: InventoryItemRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 5) {
      setError("Explique por que o item será dispensado (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/inventories/${inventoryId}/items/${item.id}/skip`, { reason });
      toast.success("Item dispensado com justificativa registrada.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={`Dispensar ${item.productName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Dispensar item
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Motivo" required htmlFor="skipReason">
          <Input
            id="skipReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: item de uso descontinuado"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}

function AdjustDialog({
  inventoryId,
  item,
  onClose,
  onSaved,
}: {
  inventoryId: string;
  item: InventoryItemRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [justification, setJustification] = useState(item.justification ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delta =
    item.countedQtyMilli !== null ? item.countedQtyMilli - item.liveQtyMilli : null;

  const submit = async () => {
    if (justification.trim().length < 5) {
      setError("Explique a divergência (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/inventories/${inventoryId}/items/${item.id}/adjust`, { justification });
      toast.success("Ajuste aplicado por movimentação de estoque.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={`Ajustar ${item.productName}`}
      description="O ajuste vira uma movimentação (inventory_adjust) vinculada a este item."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Aplicar ajuste
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {delta !== null ? (
          <Alert tone={delta === 0 ? "blue" : delta > 0 ? "amber" : "red"}>
            Contagem {formatQuantity(item.countedQtyMilli ?? 0)} contra saldo atual{" "}
            {formatQuantity(item.liveQtyMilli)} → ajuste de{" "}
            <strong>
              {delta > 0 ? "+" : ""}
              {formatQuantity(delta)} {item.uomCode}
            </strong>
            .
          </Alert>
        ) : (
          <Alert tone="amber">Registre a contagem antes de ajustar.</Alert>
        )}
        <Field label="Justificativa" required htmlFor="adjustJustification">
          <Input
            id="adjustJustification"
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            placeholder="Ex.: contagem física confirmada pelo responsável"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Fechamento e reabertura                                                    */
/* -------------------------------------------------------------------------- */

function CloseDialog({
  inventory,
  pending,
  onClose,
  onSaved,
}: {
  inventory: InventoryRow;
  pending: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [force, setForce] = useState(false);
  const [forceReason, setForceReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pending > 0 && force && forceReason.trim().length < 5) {
      setError("Para fechar com pendências informe a justificativa da exceção.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/inventories/${inventory.id}/close`, {
        force: pending > 0 ? force : false,
        forceReason: forceReason || null,
      });
      toast.success("Inventário fechado.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={`Fechar ${inventory.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Fechar inventário
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {pending > 0 ? (
          <>
            <Alert tone="amber" title={`${pending} ${plural(pending, "item pendente", "itens pendentes")}`}>
              O fechamento exige todos os itens contados, dispensados ou ajustados. Fechar com
              pendências fica registrado na auditoria.
            </Alert>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                checked={force}
                onChange={(event) => setForce(event.target.checked)}
              />
              Fechar mesmo assim (exceção registrada)
            </label>
            {force ? (
              <Field label="Justificativa da exceção" required htmlFor="forceReason">
                <Input
                  id="forceReason"
                  value={forceReason}
                  onChange={(event) => setForceReason(event.target.value)}
                  placeholder="Ex.: itens em transito, sem acesso ao local"
                />
              </Field>
            ) : null}
          </>
        ) : (
          <Alert tone="blue" title="Tudo contado">
            Nenhum item pendente. O fechamento gera o relatório final do ciclo.
          </Alert>
        )}
        <p className="text-xs text-slate-500">
          Itens divergentes sem ajuste aplicado impedem o fechamento: ajuste-os ou reabra a contagem.
        </p>
      </div>
    </Dialog>
  );
}

function ReopenDialog({
  inventoryId,
  onClose,
  onSaved,
}: {
  inventoryId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 5) {
      setError("Explique o motivo da reabertura (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/inventories/${inventoryId}/reopen`, { reason });
      toast.success("Inventário reaberto para contagem.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="Reabrir inventário"
      description="A reabertura fica registrada no histórico com o motivo informado."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Reabrir
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Motivo" required htmlFor="reopenReason">
          <Input
            id="reopenReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: contagem de setor faltante"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Útil                                                                       */
/* -------------------------------------------------------------------------- */

function numbered(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
