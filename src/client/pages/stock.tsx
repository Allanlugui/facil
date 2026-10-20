import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import { MOVEMENT_TYPE_LABEL, type MovementType, type Paginated } from "@shared/types";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api";
import { formatDateTime, formatQuantity, toIsoDayBound } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useLocations } from "../lib/lookups";
import { ProductPicker } from "../lib/product-picker";
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
  SearchIcon,
  SearchInput,
  Select,
  Table,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface PositionRow {
  productId: string;
  productName: string;
  sku: string | null;
  categoryName: string | null;
  uomCode: string;
  locationId: string;
  locationName: string;
  locationPath: string;
  qtyMilli: number;
  minQtyMilli: number;
  deficitMilli: number;
  status: "ok" | "low" | "out_of_stock";
  updatedAt: string;
}

interface MovementRow {
  id: string;
  type: MovementType;
  productId: string;
  productName: string;
  sku: string | null;
  uomCode: string;
  qtyMilli: number;
  fromName: string | null;
  fromPath: string | null;
  toName: string | null;
  toPath: string | null;
  reason: string | null;
  counterparty: string | null;
  refType: string | null;
  refId: string | null;
  reversesMovementId: string | null;
  reversalCount: number;
  userName: string;
  occurredAt: string;
  notes: string | null;
  unitCostCents: number | null;
}

interface ManualRule {
  label: string;
  permissions: string[];
  requireFrom: boolean;
  requireTo: boolean;
  requireReason: boolean;
}

/** Espelha as regras de `routes/stock.ts` para montar o formulário; o servidor decide de novo. */
const MANUAL_RULES: Record<string, ManualRule> = {
  issue: {
    label: "Saída definitiva (consumo/entrega)",
    permissions: [PERMISSIONS.STOCK_ISSUE],
    requireFrom: true,
    requireTo: false,
    requireReason: false,
  },
  transfer: {
    label: "Transferência entre locais",
    permissions: [PERMISSIONS.STOCK_TRANSFER],
    requireFrom: true,
    requireTo: true,
    requireReason: false,
  },
  replenish: {
    label: "Reposição de ambiente",
    permissions: [PERMISSIONS.STOCK_REPLENISH],
    requireFrom: true,
    requireTo: true,
    requireReason: false,
  },
  return: {
    label: "Devolução ao estoque",
    permissions: [PERMISSIONS.STOCK_TRANSFER, PERMISSIONS.STOCK_REPLENISH, PERMISSIONS.STOCK_ISSUE],
    requireFrom: false,
    requireTo: true,
    requireReason: true,
  },
  loss: {
    label: "Perda ou descarte",
    permissions: [PERMISSIONS.STOCK_LOSS],
    requireFrom: true,
    requireTo: false,
    requireReason: true,
  },
  correction: {
    label: "Lançamento corretivo (ajuste manual)",
    permissions: [PERMISSIONS.STOCK_ADJUST],
    requireFrom: false,
    requireTo: false,
    requireReason: true,
  },
};

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function StockPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "movements" ? "movements" : "position";

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Saldos por local e histórico de movimentações. Todo saldo vem de um lançamento registrado."
      />
      <Tabs
        tabs={[
          { value: "position", label: "Posição de estoque" },
          { value: "movements", label: "Movimentações" },
        ]}
        value={tab}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("tab", value);
          setParams(next, { replace: true });
        }}
      />
      {tab === "position" ? <PositionTab /> : <MovementsTab />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Posição                                                                    */
/* -------------------------------------------------------------------------- */

function PositionTab() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const locations = useLocations();

  const locationId = params.get("locationId") ?? "";
  const belowMinimum = params.get("belowMinimum") === "true";
  const onlyWithStock = params.get("onlyWithStock") === "true";
  const page = Number(params.get("page") ?? 1);

  const state = useAsync(
    () =>
      apiGet<Paginated<PositionRow>>("/api/stock", {
        search: debouncedSearch,
        locationId: locationId || undefined,
        belowMinimum: belowMinimum ? "true" : undefined,
        onlyWithStock: onlyWithStock ? "true" : undefined,
        page,
        pageSize: 25,
      }),
    [debouncedSearch, locationId, belowMinimum, onlyWithStock, page],
  );

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const columns: Column<PositionRow>[] = [
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
      cell: (row) => <span className="text-sm text-slate-600">{row.locationPath}</span>,
      hideOnMobile: true,
    },
    {
      key: "qty",
      header: "Saldo",
      align: "right",
      cell: (row) => (
        <span
          className={`font-semibold tabular-nums ${
            row.status === "out_of_stock" ? "text-red-700" : row.status === "low" ? "text-amber-800" : "text-slate-800"
          }`}
        >
          {formatQuantity(row.qtyMilli)} {row.uomCode}
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
      key: "status",
      header: "Situação",
      cell: (row) =>
        row.status === "out_of_stock" ? (
          <Badge tone="red">Sem saldo</Badge>
        ) : row.status === "low" ? (
          <Badge tone="amber">
            Faltam {formatQuantity(row.deficitMilli)} {row.uomCode}
          </Badge>
        ) : (
          <Badge tone="green">Ok</Badge>
        ),
    },
    {
      key: "updated",
      header: "Atualizado",
      align: "right",
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-slate-500">{formatDateTime(row.updatedAt)}</span>,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por nome ou SKU..."
            className="w-full sm:w-72"
          />
          <Select
            value={locationId}
            onChange={(event) => update({ locationId: event.target.value })}
            className="w-full sm:w-64"
            aria-label="Filtrar por local"
          >
            <option value="">Todos os locais</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={belowMinimum}
              onChange={(event) => update({ belowMinimum: event.target.checked ? "true" : null })}
            />
            Abaixo do mínimo
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={onlyWithStock}
              onChange={(event) => update({ onlyWithStock: event.target.checked ? "true" : null })}
            />
            Somente com saldo
          </label>
        </div>
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
              keyOf={(row) => `${row.productId}-${row.locationId}`}
              empty={
                <EmptyState
                  title="Nada encontrado"
                  description="Ajuste os filtros ou registre uma movimentação de entrada para criar saldo."
                />
              }
            />
            <div className="mt-3">
              <Pagination
                page={state.data?.page ?? 1}
                pageSize={state.data?.pageSize ?? 25}
                total={state.data?.total ?? 0}
                onPage={(next) => update({ page: String(next) })}
              />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Movimentações                                                              */
/* -------------------------------------------------------------------------- */

function MovementsTab() {
  const [params, setParams] = useSearchParams();
  const { can, user } = useSession();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const locations = useLocations();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reversing, setReversing] = useState<MovementRow | null>(null);

  const type = params.get("type") ?? "";
  const locationId = params.get("locationId") ?? "";
  const dateFrom = params.get("dateFrom") ?? "";
  const dateTo = params.get("dateTo") ?? "";
  const onlyMine = params.get("userId") === user?.id;
  const page = Number(params.get("page") ?? 1);

  const state = useAsync(
    () =>
      apiGet<Paginated<MovementRow>>("/api/stock/movements", {
        type: type || undefined,
        locationId: locationId || undefined,
        dateFrom: dateFrom ? toIsoDayBound(dateFrom, false) : undefined,
        dateTo: dateTo ? toIsoDayBound(dateTo, true) : undefined,
        userId: onlyMine ? user?.id : undefined,
        search: debouncedSearch,
        page,
        pageSize: 25,
      }),
    [type, locationId, dateFrom, dateTo, onlyMine, user?.id, debouncedSearch, page],
  );

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  const visibleTypes = useMemo(
    () => Object.entries(MANUAL_RULES).filter(([, rule]) => rule.permissions.some((code) => can(code))),
    [can],
  );

  const columns: Column<MovementRow>[] = [
    {
      key: "date",
      header: "Data",
      cell: (row) => <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(row.occurredAt)}</span>,
    },
    {
      key: "type",
      header: "Tipo",
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={movementTone(row.type)}>{MOVEMENT_TYPE_LABEL[row.type] ?? row.type}</Badge>
          {row.reversesMovementId ? <Badge tone="violet">Correção</Badge> : null}
          {row.reversalCount > 0 ? <Badge tone="violet">Revertida</Badge> : null}
        </div>
      ),
    },
    {
      key: "product",
      header: "Produto",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.productName}</p>
          <p className="truncate text-xs text-slate-500">{row.sku ?? "-"}</p>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Qtd.",
      align: "right",
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {formatQuantity(row.qtyMilli)} {row.uomCode}
        </span>
      ),
    },
    {
      key: "route",
      header: "Origem / destino",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-slate-600">
          {row.fromPath ?? "externo"} → {row.toPath ?? "consumido"}
        </span>
      ),
    },
    {
      key: "user",
      header: "Responsável",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs">
          <p className="text-slate-700">{row.userName}</p>
          {row.reason ? <p className="truncate text-slate-500">{row.reason}</p> : null}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        can(PERMISSIONS.STOCK_ADJUST) && !row.reversesMovementId && row.reversalCount === 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setReversing(row)}>
            Reverter
          </Button>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Produto, motivo ou contraparte..."
            className="w-full sm:w-64"
          />
          <Select
            value={type}
            onChange={(event) => update({ type: event.target.value })}
            className="w-full sm:w-48"
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos os tipos</option>
            {Object.keys(MOVEMENT_TYPE_LABEL).map((code) => (
              <option key={code} value={code}>
                {MOVEMENT_TYPE_LABEL[code as MovementType]}
              </option>
            ))}
          </Select>
          <Select
            value={locationId}
            onChange={(event) => update({ locationId: event.target.value })}
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Field label="De" className="w-full sm:w-40" htmlFor="dateFrom">
            <Input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(event) => update({ dateFrom: event.target.value })}
            />
          </Field>
          <Field label="Até" className="w-full sm:w-40" htmlFor="dateTo">
            <Input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(event) => update({ dateTo: event.target.value })}
            />
          </Field>
          <label className="mt-5 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={onlyMine}
              onChange={(event) => update({ userId: event.target.checked ? user?.id ?? null : null })}
            />
            Somente as minhas
          </label>
          <div className="mt-5 ml-auto">
            {visibleTypes.length > 0 ? (
              <Button icon={<SearchIcon className="size-4" />} onClick={() => setDialogOpen(true)}>
                Registrar movimentação
              </Button>
            ) : (
              <span className="text-xs text-slate-500">
                Seu perfil não permite lancar movimentações de estoque.
              </span>
            )}
          </div>
        </div>
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
              empty={<EmptyState title="Sem movimentações" description="Nenhum lançamento no filtro atual." />}
            />
            <div className="mt-3">
              <Pagination
                page={state.data?.page ?? 1}
                pageSize={state.data?.pageSize ?? 25}
                total={state.data?.total ?? 0}
                onPage={(next) => update({ page: String(next) })}
              />
            </div>
          </>
        )}
      </div>

      {dialogOpen ? (
        <MovementDialog
          rules={visibleTypes}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            state.reload();
          }}
        />
      ) : null}

      {reversing ? (
        <ReverseDialog
          movement={reversing}
          onClose={() => setReversing(null)}
          onSaved={() => {
            setReversing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function movementTone(type: MovementType): "green" | "red" | "blue" | "violet" | "amber" | "slate" {
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
    case "correction":
      return "amber";
    default:
      return "slate";
  }
}

/* -------------------------------------------------------------------------- */
/* Dialogo: nova movimentação                                                 */
/* -------------------------------------------------------------------------- */

interface ItemDraft {
  productId: string;
  qty: string;
  notes: string;
}

function MovementDialog({
  rules,
  onClose,
  onSaved,
}: {
  rules: [string, ManualRule][];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const firstRule = rules[0];
  const [type, setType] = useState(firstRule?.[0] ?? "issue");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [reason, setReason] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ productId: "", qty: "", notes: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-mov-${crypto.randomUUID()}`);

  const rule = MANUAL_RULES[type];
  if (!rule) return null;

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const submit = async () => {
    setError(null);
    const parsedItems = items
      .filter((item) => item.productId && Number(item.qty.replace(",", ".")) > 0)
      .map((item) => ({
        productId: item.productId,
        qty: Number(item.qty.replace(",", ".")),
        notes: item.notes || null,
      }));

    if (parsedItems.length === 0) {
      setError("Inclua ao menos um produto com quantidade maior que zero.");
      return;
    }
    if (rule.requireFrom && !fromLocationId) {
      setError("Informe o local de origem.");
      return;
    }
    if (rule.requireTo && !toLocationId) {
      setError("Informe o local de destino.");
      return;
    }
    if (rule.requireReason && reason.trim().length < 3) {
      setError("Este tipo de movimentação exige uma justificativa.");
      return;
    }

    setSaving(true);
    try {
      await apiPost("/api/stock/movements", {
        type,
        requestKey,
        fromLocationId: fromLocationId || null,
        toLocationId: toLocationId || null,
        reason: reason || null,
        counterparty: counterparty || null,
        notes: notes || null,
        items: parsedItems,
      });
      toast.success("Movimentação registrada.");
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
      wide
      title="Registrar movimentação de estoque"
      description="O saldo só muda por lançamento; o histórico é imutável (corrija com reversão)."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de movimentação" required htmlFor="movementType">
            <Select id="movementType" value={type} onChange={(event) => setType(event.target.value)}>
              {rules.map(([code, definition]) => (
                <option key={code} value={code}>
                  {definition.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Local de origem"
            required={rule.requireFrom}
            htmlFor="fromLocation"
            hint={rule.requireFrom ? undefined : "Opcional para este tipo."}
          >
            <Select
              id="fromLocation"
              value={fromLocationId}
              onChange={(event) => setFromLocationId(event.target.value)}
            >
              <option value="">Selecione...</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Local de destino"
            required={rule.requireTo}
            htmlFor="toLocation"
            hint={rule.requireTo ? undefined : "Opcional para este tipo."}
          >
            <Select id="toLocation" value={toLocationId} onChange={(event) => setToLocationId(event.target.value)}>
              <option value="">Selecione...</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Justificativa"
            required={rule.requireReason}
            error={rule.requireReason && reason.length > 0 && reason.trim().length < 3 ? "Mínimo 3 caracteres." : null}
            htmlFor="movementReason"
          >
            <Input
              id="movementReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: consumo da semana, material avariado..."
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contraparte" htmlFor="counterparty" hint="Fornecedor, equipe ou pessoa envolvida.">
            <Input id="counterparty" value={counterparty} onChange={(event) => setCounterparty(event.target.value)} />
          </Field>
          <Field label="Observações" htmlFor="movementNotes">
            <Textarea
              id="movementNotes"
              rows={1}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">Itens</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setItems((current) => [...current, { productId: "", qty: "", notes: "" }])}
            >
              Adicionar item
            </Button>
          </div>
          <div className="space-y-2 p-3">
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem_2rem]">
                <ProductPicker
                  value={item.productId}
                  onChange={(productId) => updateItem(index, { productId })}
                  ariaLabel={`Produto do item ${index + 1}`}
                  placeholder="Produto..."
                  activeOnly={false}
                />
                <Input
                  value={item.qty}
                  onChange={(event) => updateItem(index, { qty: event.target.value })}
                  placeholder="Qtd."
                  inputMode="decimal"
                  aria-label={`Quantidade do item ${index + 1}`}
                />
                <Input
                  value={item.notes}
                  onChange={(event) => updateItem(index, { notes: event.target.value })}
                  placeholder="Obs."
                  aria-label={`Observação do item ${index + 1}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={items.length === 1}
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                  aria-label="Remover item"
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialogo: reversão                                                          */
/* -------------------------------------------------------------------------- */

function ReverseDialog({
  movement,
  onClose,
  onSaved,
}: {
  movement: MovementRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-rev-${crypto.randomUUID()}`);

  const submit = async () => {
    if (reason.trim().length < 5) {
      setError("Explique o motivo da correção (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/stock/movements/${movement.id}/reverse`, { reason, requestKey });
      toast.success("Movimentação revertida. O lançamento original foi preservado.");
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
      title="Reverter movimentação"
      description="A correção cria um novo lançamento com os locais invertidos; nada e apagado."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Reverter
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Alert tone="amber" title="Confira antes de reverter">
          {MOVEMENT_TYPE_LABEL[movement.type] ?? movement.type} de{" "}
          {formatQuantity(movement.qtyMilli)} {movement.uomCode} de {movement.productName} em{" "}
          {formatDateTime(movement.occurredAt)}.
        </Alert>
        <Field label="Motivo da correção" required htmlFor="reverseReason">
          <Input
            id="reverseReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: quantidade lançada a mais por engano"
            autoFocus
          />
        </Field>
        <p className="text-xs text-slate-500">
          A quantidade reverte para o local de origem original e a reversão fica vinculada ao
          lançamento corrigido na auditoria.
        </p>
      </div>
    </Dialog>
  );
}
