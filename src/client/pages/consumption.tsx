import { useMemo, useState } from "react";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  CONSUMPTION_STATUS_LABEL,
  type ConsumptionStatus,
  type Paginated,
} from "@shared/types";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api";
import { addDaysIsoDate, formatDateTime, formatQuantity, plural, toIsoDayBound, todayIsoDate } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useLocations } from "../lib/lookups";
import { ProductPicker } from "../lib/product-picker";
import { useSession } from "../lib/session";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  Table,
  Textarea,
  useToast,
  type Column,
  type Tone,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface ConsumptionRow {
  id: string;
  code: string;
  periodStart: string;
  periodEnd: string;
  periodicity: string;
  locationId: string | null;
  locationName: string | null;
  locationPath: string | null;
  scopeNote: string | null;
  status: ConsumptionStatus;
  notes: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdBy: string;
  userName: string;
  createdAt: string;
  itemCount: number;
  deductedItemCount: number;
  stockDeducted: boolean;
}

interface ConsumptionItem {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  uomCode: string;
  qtyMilli: number;
  locationId: string | null;
  locationName: string | null;
  locationPath: string | null;
  movementId: string | null;
  movementFrom: string | null;
  movementAt: string | null;
  notes: string | null;
}

const PERIODICITY_LABEL: Record<string, string> = {
  daily: "Diário",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
  custom: "Período livre",
};

const STATUS_TONE: Record<ConsumptionStatus, Tone> = {
  draft: "slate",
  registered: "green",
  cancelled: "red",
};

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function ConsumptionPage() {
  const { can, user, app } = useSession();
  const toast = useToast();
  const locations = useLocations();
  const [periodFrom, setPeriodFrom] = useState(addDaysIsoDate(-30));
  const [periodTo, setPeriodTo] = useState(todayIsoDate());
  const [locationId, setLocationId] = useState("");
  const [status, setStatus] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<ConsumptionRow | null>(null);

  const state = useAsync(
    () =>
      apiGet<Paginated<ConsumptionRow>>("/api/consumption", {
        periodFrom: periodFrom ? toIsoDayBound(periodFrom, false) : undefined,
        periodTo: periodTo ? toIsoDayBound(periodTo, true) : undefined,
        locationId: locationId || undefined,
        status: status || undefined,
        userId: onlyMine ? user?.id : undefined,
        page,
        pageSize: 25,
      }),
    [periodFrom, periodTo, locationId, status, onlyMine, user?.id, page],
  );

  const columns: Column<ConsumptionRow>[] = [
    {
      key: "code",
      header: "Lançamento",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{row.code}</p>
          <p className="truncate text-xs text-slate-500">
            {row.locationPath ?? row.locationName ?? "Sem local definido"}
            {row.scopeNote ? ` · ${row.scopeNote}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "period",
      header: "Período",
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>
            {row.periodStart} a {row.periodEnd}
          </p>
          <p className="text-slate-500">{PERIODICITY_LABEL[row.periodicity] ?? row.periodicity}</p>
        </div>
      ),
    },
    {
      key: "items",
      header: "Itens",
      align: "right",
      cell: (row) => (
        <div className="text-right text-xs">
          <p className="tabular-nums text-slate-700">{row.itemCount} {plural(row.itemCount, "item", "itens")}</p>
          {row.stockDeducted ? (
            <p className="text-emerald-700">{row.deductedItemCount} com baixa</p>
          ) : (
            <p className="text-slate-500">sem baixa de estoque</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{CONSUMPTION_STATUS_LABEL[row.status]}</Badge>,
    },
    {
      key: "author",
      header: "Registrado por",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs">
          <p className="text-slate-700">{row.userName}</p>
          <p className="text-slate-500">{formatDateTime(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDetailId(row.id)}>
            Detalhes
          </Button>
          {can(PERMISSIONS.CONSUMPTION_CANCEL) && row.status === "registered" ? (
            <Button variant="ghost" size="sm" onClick={() => setCancelling(row)}>
              Cancelar
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Consumo"
        description={`Registro de consumo por período, com baixa opcional de estoque. Fuso ${app.timezone}.`}
        actions={
          can(PERMISSIONS.CONSUMPTION_CREATE) ? (
            <Button onClick={() => setCreating(true)}>Novo lançamento</Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <Field label="De" className="w-full sm:w-36" htmlFor="consFrom">
            <Input
              id="consFrom"
              type="date"
              value={periodFrom}
              onChange={(event) => {
                setPeriodFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Até" className="w-full sm:w-36" htmlFor="consTo">
            <Input
              id="consTo"
              type="date"
              value={periodTo}
              onChange={(event) => {
                setPeriodTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Local" className="w-full sm:w-56" htmlFor="consLocation">
            <Select
              id="consLocation"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos os locais</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Situação" className="w-full sm:w-44" htmlFor="consStatus">
            <Select
              id="consStatus"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {Object.entries(CONSUMPTION_STATUS_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={onlyMine}
              onChange={(event) => {
                setOnlyMine(event.target.checked);
                setPage(1);
              }}
            />
            Somente os meus
          </label>
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
                    title="Nenhum lançamento"
                    description="Registre o consumo do período para acompanhar os números por local."
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
        <ConsumptionDialog
          onClose={() => setCreating(false)}
          onSaved={(code) => {
            setCreating(false);
            toast.success(`Lançamento ${code} registrado.`);
            state.reload();
          }}
        />
      ) : null}

      {detailId ? <ConsumptionDetailDialog id={detailId} onClose={() => setDetailId(null)} /> : null}

      {cancelling ? (
        <CancelConsumptionDialog
          record={cancelling}
          onClose={() => setCancelling(null)}
          onSaved={() => {
            setCancelling(null);
            state.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Novo lançamento                                                           */
/* -------------------------------------------------------------------------- */

interface ItemDraft {
  productId: string;
  qty: string;
  notes: string;
}

function ConsumptionDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const locations = useLocations();
  const [periodStart, setPeriodStart] = useState(addDaysIsoDate(-7));
  const [periodEnd, setPeriodEnd] = useState(todayIsoDate());
  const [periodicity, setPeriodicity] = useState("");
  const [locationId, setLocationId] = useState("");
  const [scopeNote, setScopeNote] = useState("");
  const [notes, setNotes] = useState("");
  const [deduct, setDeduct] = useState(true);
  const [deductFromLocationId, setDeductFromLocationId] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ productId: "", qty: "", notes: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-cons-${crypto.randomUUID()}`);

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const parsedItems = useMemo(
    () =>
      items
        .filter((item) => item.productId && Number(item.qty.replace(",", ".")) > 0)
        .map((item) => ({
          productId: item.productId,
          qty: Number(item.qty.replace(",", ".")),
          notes: item.notes || null,
        })),
    [items],
  );

  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const item of parsedItems) {
      if (seen.has(item.productId)) repeated.add(item.productId);
      seen.add(item.productId);
    }
    return repeated.size;
  }, [parsedItems]);

  const submit = async () => {
    setError(null);
    if (parsedItems.length === 0) {
      setError("Inclua ao menos um produto com quantidade maior que zero.");
      return;
    }
    if (duplicates > 0) {
      setError("O mesmo produto aparece mais de uma vez; some as quantidades em uma única linha.");
      return;
    }
    if (periodEnd < periodStart) {
      setError("O fim do período não pode ser anterior ao início.");
      return;
    }
    if (deduct && !deductFromLocationId) {
      setError("Escolha o local de onde o estoque será baixado.");
      return;
    }

    setSaving(true);
    try {
      const result = await apiPost<{ code: string; idempotentReplay: boolean }>("/api/consumption", {
        requestKey,
        periodStart,
        periodEnd,
        periodicity: periodicity || undefined,
        locationId: locationId || null,
        scopeNote: scopeNote || null,
        notes: notes || null,
        deductFromLocationId: deduct ? deductFromLocationId : null,
        items: parsedItems,
      });
      onSaved(result.code);
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
      title="Novo lançamento de consumo"
      description="Medição de consumo do período. A baixa de estoque e um passo separado é opcional."
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

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Início do período" required htmlFor="consStart">
            <Input
              id="consStart"
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </Field>
          <Field label="Fim do período" required htmlFor="consEnd">
            <Input id="consEnd" type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </Field>
          <Field
            label="Periodicidade"
            hint="Em branco usa a configuração padrão do sistema."
            htmlFor="consPeriodicity"
          >
            <Select
              id="consPeriodicity"
              value={periodicity}
              onChange={(event) => setPeriodicity(event.target.value)}
            >
              <option value="">Padrão do sistema</option>
              {Object.entries(PERIODICITY_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Local de referência"
            hint="Onde o consumo aconteceu (ex.: área comum, andar 3)."
            htmlFor="consLocationRef"
          >
            <Select id="consLocationRef" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Sem local específico</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Escopo (anotação curta)" htmlFor="consScope">
            <Input
              id="consScope"
              value={scopeNote}
              onChange={(event) => setScopeNote(event.target.value)}
              placeholder="Ex.: banheiros do bloco A"
            />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200 p-3">
          <Checkbox
            label="Dar baixa no estoque agora"
            hint="Cria uma movimentação de consumo por item. Desmarque para registrar apenas a medição."
            checked={deduct}
            onChange={setDeduct}
          />
          {deduct ? (
            <div className="mt-3">
              <Field label="Baixar do local" required htmlFor="consDeductFrom">
                <Select
                  id="consDeductFrom"
                  value={deductFromLocationId}
                  onChange={(event) => setDeductFromLocationId(event.target.value)}
                >
                  <option value="">Selecione o local de estoque...</option>
                  {(locations.data ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {locationLabel(location)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">Itens consumidos</p>
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
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_7rem_10rem_2rem]">
                <ProductPicker
                  value={item.productId}
                  onChange={(productId) => updateItem(index, { productId })}
                  ariaLabel={`Produto do item ${index + 1}`}
                  placeholder="Produto..."
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
                  placeholder="Observação"
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

        <Field label="Observações do lançamento" htmlFor="consNotes">
          <Textarea id="consNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhes                                                                   */
/* -------------------------------------------------------------------------- */

function ConsumptionDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useAsync(
    () => apiGet<{ record: ConsumptionRow; items: ConsumptionItem[] }>(`/api/consumption/${id}`),
    [id],
  );

  return (
    <Dialog open wide title="Detalhes do lançamento" onClose={onClose}>
      {state.loading && !state.data ? (
        <LoadingBlock />
      ) : state.error ? (
        <ErrorBlock message={state.error} onRetry={state.reload} />
      ) : state.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Código" value={state.data.record.code} />
            <Info
              label="Período"
              value={`${state.data.record.periodStart} a ${state.data.record.periodEnd} (${
                PERIODICITY_LABEL[state.data.record.periodicity] ?? state.data.record.periodicity
              })`}
            />
            <Info label="Local" value={state.data.record.locationPath ?? state.data.record.locationName ?? "-"} />
            <Info
              label="Situação"
              value={CONSUMPTION_STATUS_LABEL[state.data.record.status]}
            />
            <Info label="Registrado por" value={`${state.data.record.userName} em ${formatDateTime(state.data.record.createdAt)}`} />
            <Info label="Escopo" value={state.data.record.scopeNote ?? "-"} />
            {state.data.record.cancelReason ? (
              <Info
                label="Motivo do cancelamento"
                value={`${state.data.record.cancelReason} (${formatDateTime(state.data.record.cancelledAt)})`}
              />
            ) : null}
          </div>

          {state.data.record.notes ? (
            <Alert tone="slate" title="Observações">
              {state.data.record.notes}
            </Alert>
          ) : null}

          <div className="rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Quantidade</th>
                  <th className="px-3 py-2">Baixa de estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{item.productName}</p>
                      <p className="text-xs text-slate-500">
                        {item.sku ?? "-"}
                        {item.locationPath ? ` · ${item.locationPath}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatQuantity(item.qtyMilli)} {item.uomCode}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {item.movementId ? (
                        <span className="text-emerald-700">
                          Baixa em {item.movementFrom} ({formatDateTime(item.movementAt)})
                        </span>
                      ) : (
                        <span className="text-slate-500">Sem baixa (apenas medição)</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-800">{value}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Cancelamento                                                               */
/* -------------------------------------------------------------------------- */

function CancelConsumptionDialog({
  record,
  onClose,
  onSaved,
}: {
  record: ConsumptionRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 5) {
      setError("Explique o motivo do cancelamento (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/consumption/${record.id}/cancel`, { reason });
      toast.success(
        record.stockDeducted
          ? "Lançamento cancelado e baixas de estoque revertidas por movimentação de correção."
          : "Lançamento cancelado.",
      );
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
      title={`Cancelar ${record.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Cancelar lançamento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Alert tone="amber" title="O lançamento não e apagado">
          O registro permanece no histórico com o motivo informado.
          {record.stockDeducted
            ? " As baixas de estoque serão revertidas por movimentações de correção vinculadas."
            : " Não houve baixa de estoque neste lançamento."}
        </Alert>
        <Field label="Motivo do cancelamento" required htmlFor="cancelReason">
          <Input
            id="cancelReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: quantidade lançada em duplicidade"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}
