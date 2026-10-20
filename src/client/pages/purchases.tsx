import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  PRIORITY_LABEL,
  PURCHASE_EVENT_LABEL,
  PURCHASE_ITEM_MODE_LABEL,
  PURCHASE_ITEM_STATUS_LABEL,
  PURCHASE_STATUS_LABEL,
  type Paginated,
  type Priority,
  type PurchaseItemStatus,
  type PurchaseStatus,
} from "@shared/types";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api";
import {
  PRIORITY_TONE,
  PURCHASE_STATUS_TONE,
  addDaysIsoDate,
  formatCurrencyFromCents,
  formatDate,
  formatDateTime,
  formatQuantity,
  formatRelative,
  plural,
} from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useLocations, useSuppliers, useUoms } from "../lib/lookups";
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
  SearchInput,
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

interface PurchaseRow {
  id: string;
  code: string;
  requesterId: string;
  requesterName: string;
  locationId: string | null;
  locationName: string | null;
  locationPath: string | null;
  justification: string | null;
  priority: Priority;
  status: PurchaseStatus;
  desiredDate: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  pendingItemCount: number;
  quoteItemCount: number;
  quoteCount: number;
  receiptCount: number;
  receivedQtyMilli: number;
  expectedQtyMilli: number;
  pendingQtyMilli: number;
  fullyReceived: boolean;
}

interface PurchaseItem {
  id: string;
  requestId: string;
  productId: string | null;
  productName: string | null;
  sku: string | null;
  description: string | null;
  qtyMilli: number;
  uomId: string | null;
  uomCode: string | null;
  qtyApprovedMilli: number | null;
  qtyOrderedMilli: number | null;
  qtyReceivedMilli: number;
  pendingQtyMilli: number;
  supplierId: string | null;
  supplierName: string | null;
  orderRef: string | null;
  unitPriceCents: number | null;
  purchaseMode: "direct" | "quote" | null;
  status: PurchaseItemStatus;
  notes: string | null;
}

interface QuoteItem {
  id: string;
  requestItemId: string;
  qtyMilli: number;
  unitPriceCents: number;
  notes: string | null;
  productName: string | null;
  sku: string | null;
  description: string | null;
  uomCode: string | null;
}

interface QuoteSummary {
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  status: "registered" | "approved" | "rejected";
  notes: string | null;
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  items: QuoteItem[];
  totalCents: number;
}

const QUOTE_STATUS_LABEL: Record<QuoteSummary["status"], string> = {
  registered: "Registrada",
  approved: "Aprovada",
  rejected: "Não escolhida",
};

const QUOTE_STATUS_TONE: Record<QuoteSummary["status"], Tone> = {
  registered: "violet",
  approved: "green",
  rejected: "slate",
};

interface ReceiptSummary {
  id: string;
  code: string;
  receivedAt: string;
  receivedBy: string;
  receivedByName: string;
  supplierName: string | null;
  documentRef: string | null;
  notes: string | null;
  status: string;
  cancelReason: string | null;
  itemCount: number;
  qtyMilli: number;
  discrepancyCount: number;
  /** F-06: itens deste recebimento que entraram e já saíram para uso. */
  directUseCount: number;
}

const ITEM_STATUS_TONE: Record<PurchaseItemStatus, Tone> = {
  pending: "amber",
  approved: "blue",
  rejected: "red",
  ordered: "brand",
  partially_received: "amber",
  received: "green",
  cancelled: "slate",
};

/* -------------------------------------------------------------------------- */
/* Lista                                                                      */
/* -------------------------------------------------------------------------- */

export function PurchasesPage() {
  const { can, user } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [pendingApproval, setPendingApproval] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  // Atalho vindo do painel do comprador: /compras?novo=1 abre a solicitação
  // direto e limpa o parâmetro para o botão Voltar não reabrir sozinho.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("novo") === "1") {
      setCreating(true);
      const next = new URLSearchParams(searchParams);
      next.delete("novo");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const state = useAsync(
    () =>
      apiGet<Paginated<PurchaseRow>>("/api/purchases", {
        search: debounced || undefined,
        status: status || undefined,
        priority: priority || undefined,
        pendingApproval: pendingApproval ? "true" : undefined,
        requesterId: onlyMine ? user?.id : undefined,
        page,
        pageSize: 25,
      }),
    [debounced, status, priority, pendingApproval, onlyMine, user?.id, page],
  );

  const columns: Column<PurchaseRow>[] = [
    {
      key: "code",
      header: "Solicitação",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{row.code}</p>
          <p className="truncate text-xs text-slate-500">
            {row.locationPath ?? row.locationName ?? "Sem local"} ·{" "}
            {row.justification ? row.justification : "sem justificativa"}
          </p>
        </div>
      ),
    },
    {
      key: "items",
      header: "Itens / recebimento",
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p className="tabular-nums">
            {row.itemCount} {plural(row.itemCount, "item", "itens")} · {row.receiptCount} {plural(row.receiptCount, "recebimento", "recebimentos")}
          </p>
          <p className="tabular-nums text-slate-500">
            {row.fullyReceived
              ? "Recebida integralmente"
              : `${formatQuantity(row.pendingQtyMilli)} ${plural(row.pendingQtyMilli, "pendente", "pendentes")}`}
          </p>
        </div>
      ),
    },
    {
      key: "priority",
      header: "Prioridade",
      hideOnMobile: true,
      cell: (row) => <Badge tone={PRIORITY_TONE[row.priority]}>{PRIORITY_LABEL[row.priority]}</Badge>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => <Badge tone={PURCHASE_STATUS_TONE[row.status]}>{PURCHASE_STATUS_LABEL[row.status]}</Badge>,
    },
    {
      key: "requester",
      header: "Solicitante",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.requesterName}</p>
          <p className="text-slate-500">{formatRelative(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="secondary" size="sm" onClick={() => navigate(`/compras/${row.id}`)}>
          Abrir
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Compras"
        description="Solicitação, aprovação, pedido ao fornecedor e recebimento no estoque."
        actions={
          can(PERMISSIONS.PURCHASES_CREATE) ? (
            <Button onClick={() => setCreating(true)}>Nova solicitação</Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Código, justificativa..." className="w-full sm:w-60" />
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-48"
            aria-label="Filtrar por situação"
          >
            <option value="">Todas as situações</option>
            {Object.entries(PURCHASE_STATUS_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-40"
            aria-label="Filtrar por prioridade"
          >
            <option value="">Todas as prioridades</option>
            {Object.entries(PRIORITY_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={pendingApproval}
              onChange={(event) => {
                setPendingApproval(event.target.checked);
                setPage(1);
              }}
            />
            Aguardando aprovação
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={onlyMine}
              onChange={(event) => {
                setOnlyMine(event.target.checked);
                setPage(1);
              }}
            />
            Minhas solicitações
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
                empty={<EmptyState title="Nenhuma solicitação" description="Nada encontrado com os filtros atuais." />}
                onRowClick={(row) => navigate(`/compras/${row.id}`)}
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
        <CreatePurchaseDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/compras/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

interface ItemDraft {
  productId: string;
  description: string;
  qty: string;
  uomId: string;
  notes: string;
}

export function CreatePurchaseDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const uoms = useUoms();
  const [locationId, setLocationId] = useState("");
  const [justification, setJustification] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [desiredDate, setDesiredDate] = useState(addDaysIsoDate(7));
  const [notes, setNotes] = useState("");
  const [submitNow, setSubmitNow] = useState(true);
  const [items, setItems] = useState<ItemDraft[]>([
    { productId: "", description: "", qty: "", uomId: "", notes: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const submit = async () => {
    const parsed = items
      .filter((item) => (item.productId || item.description.trim().length > 0) && Number(item.qty.replace(",", ".")) > 0)
      .map((item) => ({
        productId: item.productId || null,
        description: item.description || null,
        qty: Number(item.qty.replace(",", ".")),
        uomId: item.uomId || null,
        notes: item.notes || null,
      }));
    if (parsed.length === 0) {
      setError("Inclua ao menos um item com quantidade; informe o produto ou a descrição.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ id: string; code: string; status: PurchaseStatus }>("/api/purchases", {
        locationId: locationId || null,
        justification: justification || null,
        priority,
        desiredDate: desiredDate || null,
        notes: notes || null,
        submit: submitNow,
        items: parsed,
      });
      toast.success(
        result.status === "pending_approval"
          ? `Solicitação ${result.code} enviada para aprovação.`
          : `Rascunho ${result.code} salvo.`,
      );
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
      wide
      title="Nova solicitação de compra"
      description="A aprovação e feita por um aprovador; o pedido vai ao fornecedor e depois o recebimento entra no estoque."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            {submitNow ? "Enviar para aprovação" : "Salvar rascunho"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Local de destino" hint="Para onde o material será entregue." htmlFor="prLocation">
            <Select id="prLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Sem local específico</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data desejada" htmlFor="prDesired">
            <Input
              id="prDesired"
              type="date"
              value={desiredDate}
              onChange={(event) => setDesiredDate(event.target.value)}
            />
          </Field>
          <Field label="Prioridade" htmlFor="prPriority">
            <Select
              id="prPriority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
            >
              {Object.entries(PRIORITY_LABEL).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Justificativa" htmlFor="prJustification">
            <Input
              id="prJustification"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Ex.: reposição de estoque mínimo"
            />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-medium text-slate-700">Itens</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setItems((current) => [
                  ...current,
                  { productId: "", description: "", qty: "", uomId: "", notes: "" },
                ])
              }
            >
              Adicionar item
            </Button>
          </div>
          <div className="space-y-3 p-3">
            {items.map((item, index) => (
              <div key={index} className="rounded-lg border border-slate-100 p-2">
                <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr_7rem_9rem_2rem]">
                  <ProductPicker
                    value={item.productId}
                    onChange={(productId, product) =>
                      updateItem(index, {
                        productId,
                        // Ajuda o comprador: a unidade do cadastro já vem escolhida.
                        ...(product && !item.uomId ? { uomId: product.uomId } : {}),
                      })
                    }
                    ariaLabel={`Produto ${index + 1}`}
                    placeholder="Produto (ou descreva ao lado)"
                  />
                  <Input
                    value={item.description}
                    onChange={(event) => updateItem(index, { description: event.target.value })}
                    placeholder="Descrição livre"
                    aria-label={`Descrição ${index + 1}`}
                  />
                  <Input
                    value={item.qty}
                    onChange={(event) => updateItem(index, { qty: event.target.value })}
                    placeholder="Qtd."
                    inputMode="decimal"
                    aria-label={`Quantidade ${index + 1}`}
                  />
                  <Select
                    value={item.uomId}
                    onChange={(event) => updateItem(index, { uomId: event.target.value })}
                    aria-label={`Unidade ${index + 1}`}
                  >
                    <option value="">Unidade...</option>
                    {(uoms.data ?? [])
                      .filter((uom) => uom.isActive)
                      .map((uom) => (
                        <option key={uom.id} value={uom.id}>
                          {uom.code}
                        </option>
                      ))}
                  </Select>
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
              </div>
            ))}
          </div>
        </div>

        <Field label="Observações" htmlFor="prNotes">
          <Textarea id="prNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
            checked={submitNow}
            onChange={(event) => setSubmitNow(event.target.checked)}
          />
          <span>
            <span className="font-medium">Enviar para aprovação agora</span>
            <span className="block text-xs text-slate-500">
              Desmarque para salvar como rascunho e revisar depois.
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhe                                                                    */
/* -------------------------------------------------------------------------- */

interface PurchaseTimelineEvent {
  at: string;
  actor: string;
  action: string;
  entityId: string | null;
  code: string | null;
  supplierId: string | null;
  orderRef: string | null;
  note: string | null;
}

interface PurchaseDetailResponse {
  request: PurchaseRow;
  items: PurchaseItem[];
  receipts: ReceiptSummary[];
  quotes: QuoteSummary[];
  /** Linha do tempo (F-05): eventos da auditoria na ordem em que aconteceram. */
  timeline: PurchaseTimelineEvent[];
}

interface ReceiptLine {
  id: string;
  requestItemId: string | null;
  productId: string | null;
  productName: string | null;
  sku: string | null;
  uomCode: string | null;
  qtyMilli: number;
  locationName: string | null;
  locationPath: string | null;
  movementId: string | null;
  hasDiscrepancy: boolean;
  discrepancyNote: string | null;
  notes: string | null;
}

export function PurchaseDetailPage() {
  const { id = "" } = useParams();
  const { can, user } = useSession();
  const toast = useToast();
  const [deciding, setDeciding] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [returningQuote, setReturningQuote] = useState(false);
  const [quoteDecision, setQuoteDecision] = useState<{ quote: QuoteSummary; action: "approve" | "reject" } | null>(
    null,
  );
  const [expandedReceipt, setExpandedReceipt] = useState<string | null>(null);
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null);

  const state = useAsync(() => apiGet<PurchaseDetailResponse>(`/api/purchases/${id}`), [id]);

  if (state.loading && !state.data) return <LoadingBlock label="Carregando a solicitação..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;

  const { request, items, receipts, quotes, timeline } = state.data;
  const canSubmit = request.status === "draft" && can(PERMISSIONS.PURCHASES_CREATE);
  const canDecide =
    request.status === "pending_approval" &&
    (can(PERMISSIONS.PURCHASES_APPROVE) || can(PERMISSIONS.PURCHASES_ORDER)) &&
    user?.id !== request.requesterId;
  const canOrder =
    ["approved", "purchasing", "quote_approved"].includes(request.status) && can(PERMISSIONS.PURCHASES_ORDER);
  const canQuote =
    ["quoting", "quote_returned"].includes(request.status) && can(PERMISSIONS.PURCHASES_ORDER);
  const canReturnQuote =
    request.status === "quoting" &&
    can(PERMISSIONS.PURCHASES_ORDER) &&
    quotes.some((quote) => quote.status === "registered");
  const canDecideQuote =
    request.status === "quote_returned" &&
    can(PERMISSIONS.PURCHASES_APPROVE) &&
    user?.id !== request.requesterId;
  const approvedQuote = quotes.find((quote) => quote.status === "approved") ?? null;
  const canReceive =
    ["ordered", "partially_received"].includes(request.status) && can(PERMISSIONS.PURCHASES_RECEIVE);
  const canCancel =
    !["received", "cancelled", "rejected"].includes(request.status) &&
    receipts.length === 0 &&
    can(PERMISSIONS.PURCHASES_CANCEL);

  // Linha do tempo (F-05): enriquece o evento com o dado que o identifica --
  // proposta (codigo + fornecedor), pedido (fornecedor) ou recebimento (codigo).
  const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
  const supplierById = new Map(
    items
      .filter((item) => item.supplierId && item.supplierName)
      .map((item) => [item.supplierId as string, item.supplierName as string]),
  );
  const timelineDetail = (event: PurchaseTimelineEvent): string | null => {
    if (event.action.startsWith("purchase_quote.")) {
      const quote = event.entityId ? quoteById.get(event.entityId) : undefined;
      return quote ? `${quote.code} · ${quote.supplierName}` : event.code;
    }
    if (event.action === "purchase_receipt.confirm") return event.code;
    if (event.action === "purchase_request.order") {
      return event.supplierId ? (supplierById.get(event.supplierId) ?? null) : null;
    }
    return null;
  };

  const submitForApproval = async () => {
    try {
      await apiPost(`/api/purchases/${request.id}/submit`, {});
      toast.success("Solicitação enviada para aprovação.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  // Devolve a cotação ao gestor: a solicitação passa a aguardar a escolha da
  // proposta vencedora (F-02).
  const returnQuote = async () => {
    setReturningQuote(true);
    try {
      await apiPost(`/api/purchases/${request.id}/quotes/return`, {});
      toast.success("Cotação devolvida ao gestor para aprovação.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setReturningQuote(false);
    }
  };

  const columns: Column<PurchaseItem>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-slate-800">
            <span className="truncate">{row.productName ?? row.description ?? "Item sem identificação"}</span>
            {row.purchaseMode && ["pending", "approved"].includes(row.status) ? (
              <Badge tone={row.purchaseMode === "quote" ? "violet" : "slate"}>
                {PURCHASE_ITEM_MODE_LABEL[row.purchaseMode]}
              </Badge>
            ) : null}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.sku ? `${row.sku} · ` : ""}
            {row.uomCode ?? "-"}
            {row.supplierName ? ` · ${row.supplierName}` : ""}
            {row.orderRef ? ` · pedido ${row.orderRef}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "qty",
      header: "Solicitado",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-700">{formatQuantity(row.qtyMilli)}</span>,
    },
    {
      key: "approved",
      header: "Aprovado",
      align: "right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums text-slate-700">
          {row.qtyApprovedMilli === null ? "-" : formatQuantity(row.qtyApprovedMilli)}
        </span>
      ),
    },
    {
      key: "ordered",
      header: "Pedido",
      align: "right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums text-slate-700">
          {row.qtyOrderedMilli === null ? "-" : formatQuantity(row.qtyOrderedMilli)}
        </span>
      ),
    },
    {
      key: "received",
      header: "Recebido",
      align: "right",
      cell: (row) => (
        <div className="text-right">
          <p className="tabular-nums font-medium text-slate-800">{formatQuantity(row.qtyReceivedMilli)}</p>
          <p className="text-xs tabular-nums text-slate-500">
            {row.pendingQtyMilli > 0 ? `faltam ${formatQuantity(row.pendingQtyMilli)}` : "completo"}
          </p>
        </div>
      ),
    },
    {
      key: "price",
      header: "Preço unit.",
      align: "right",
      hideOnMobile: true,
      cell: (row) =>
        row.unitPriceCents === null ? (
          <span className="text-slate-400">-</span>
        ) : (
          <span className="tabular-nums text-slate-700">{formatCurrencyFromCents(row.unitPriceCents)}</span>
        ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge tone={ITEM_STATUS_TONE[row.status]}>{PURCHASE_ITEM_STATUS_LABEL[row.status]}</Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Solicitação ${request.code}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={PURCHASE_STATUS_TONE[request.status]}>{PURCHASE_STATUS_LABEL[request.status]}</Badge>
            <Badge tone={PRIORITY_TONE[request.priority]}>Prioridade {PRIORITY_LABEL[request.priority]}</Badge>
            {request.desiredDate ? <Badge tone="slate">Desejada para {formatDate(request.desiredDate)}</Badge> : null}
          </span>
        }
        actions={
          <>
            <Link to="/compras">
              <Button variant="secondary">Voltar</Button>
            </Link>
            {canSubmit ? (
              <Button onClick={() => void submitForApproval()}>Enviar para aprovação</Button>
            ) : null}
            {canDecide ? (
              <Button onClick={() => setDeciding(true)}>Analisar</Button>
            ) : null}
            {canQuote ? (
              <Button variant="secondary" onClick={() => setQuoting(true)}>
                Registrar proposta
              </Button>
            ) : null}
            {canReturnQuote ? (
              <Button onClick={() => void returnQuote()} loading={returningQuote}>
                Devolver cotação
              </Button>
            ) : null}
            {canOrder ? (
              <Button onClick={() => setOrdering(true)}>Registrar pedido</Button>
            ) : null}
            {canReceive ? (
              <Button onClick={() => setReceiving(true)}>Registrar recebimento</Button>
            ) : null}
            {canCancel ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancelar
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card padded={false} title="Itens da solicitação">
            <Table
              columns={columns}
              rows={items}
              keyOf={(row) => row.id}
              empty={<EmptyState title="Sem itens" description="A solicitação não possui itens." />}
            />
          </Card>

          {["quoting", "quote_returned", "quote_approved"].includes(request.status) || quotes.length > 0 ? (
            <Card title={`Cotação (${quotes.length})`}>
              {request.status === "quote_returned" && canDecideQuote ? (
                <Alert tone="amber" title="Cotação devolvida">
                  Compare as propostas e aprove a vencedora; o pedido nasce da proposta aprovada.
                </Alert>
              ) : null}
              {request.status === "quoting" ? (
                <p className="text-sm text-slate-500">
                  {request.quoteItemCount > 0
                    ? `${request.quoteItemCount} ${plural(request.quoteItemCount, "item marcado", "itens marcados")} para cotação.`
                    : "Registre as propostas de fornecedor e devolva ao gestor para aprovação."}
                </p>
              ) : null}
              {quotes.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">Nenhuma proposta registrada ainda.</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {quotes.map((quote) => (
                    <li key={quote.id} className="py-2">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setExpandedQuote(expandedQuote === quote.id ? null : quote.id)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-slate-800">
                              {quote.code} · {quote.supplierName}
                            </p>
                            <Badge tone={QUOTE_STATUS_TONE[quote.status]}>{QUOTE_STATUS_LABEL[quote.status]}</Badge>
                          </div>
                          <p className="text-xs text-slate-500">
                            {quote.items.length} {plural(quote.items.length, "item", "itens")} · total{" "}
                            {formatCurrencyFromCents(quote.totalCents)} · {quote.createdByName} em{" "}
                            {formatDateTime(quote.createdAt)}
                          </p>
                        </button>
                        {canDecideQuote && quote.status === "registered" ? (
                          <div className="flex shrink-0 gap-2">
                            <Button
                              size="sm"
                              onClick={() => setQuoteDecision({ quote, action: "approve" })}
                            >
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setQuoteDecision({ quote, action: "reject" })}
                            >
                              Recusar
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {expandedQuote === quote.id ? (
                        <div className="mt-2 overflow-hidden rounded-md border border-slate-100">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-3 py-1.5 text-left font-medium">Item</th>
                                <th className="px-3 py-1.5 text-right font-medium">Qtde</th>
                                <th className="px-3 py-1.5 text-right font-medium">Valor unit.</th>
                                <th className="px-3 py-1.5 text-right font-medium">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {quote.items.map((line) => (
                                <tr key={line.id}>
                                  <td className="px-3 py-1.5 text-slate-700">
                                    {line.productName ?? line.description ?? "-"}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                                    {formatQuantity(line.qtyMilli)}
                                    {line.uomCode ? ` ${line.uomCode}` : ""}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                                    {formatCurrencyFromCents(line.unitPriceCents)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-slate-800">
                                    {formatCurrencyFromCents(Math.round((line.unitPriceCents * line.qtyMilli) / 1000))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {quote.notes ? (
                            <p className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">
                              Observações: {quote.notes}
                            </p>
                          ) : null}
                          {quote.approvalNotes ? (
                            <p className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-500">
                              Decisão: {quote.approvalNotes}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          <Card title={`Recebimentos (${receipts.length})`}>
            {receipts.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum recebimento registrado. O recebimento gera entrada no estoque por movimentação.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {receipts.map((receipt) => (
                  <li key={receipt.id} className="py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => setExpandedReceipt(expandedReceipt === receipt.id ? null : receipt.id)}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {receipt.code}
                          {receipt.discrepancyCount > 0 ? (
                            <span className="ml-2">
                              <Badge tone="amber">{receipt.discrepancyCount} {plural(receipt.discrepancyCount, "divergência", "divergências")}</Badge>
                            </span>
                          ) : null}
                          {receipt.directUseCount > 0 ? (
                            <span className="ml-2">
                              <Badge tone="violet">Uso direto</Badge>
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateTime(receipt.receivedAt)} · {receipt.receivedByName}
                          {receipt.documentRef ? ` · doc. ${receipt.documentRef}` : ""}
                        </p>
                      </div>
                      <span className="text-xs text-slate-500">
                        {receipt.itemCount} {plural(receipt.itemCount, "item", "itens")} · total {formatQuantity(receipt.qtyMilli)}
                      </span>
                    </button>
                    {expandedReceipt === receipt.id ? (
                      <ReceiptLines requestId={request.id} receiptId={receipt.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Ficha da solicitação">
            <dl className="space-y-3 text-sm">
              <InfoRow label="Solicitante" value={request.requesterName} />
              <InfoRow label="Local" value={request.locationPath ?? request.locationName ?? "-"} />
              <InfoRow label="Criada em" value={formatDateTime(request.createdAt)} />
              <InfoRow label="Justificativa" value={request.justification ?? "-"} />
              {request.approvedAt ? (
                <InfoRow
                  label="Decisão"
                  value={`${PURCHASE_STATUS_LABEL[request.status]} por ${request.approvedByName ?? "-"} em ${formatDateTime(
                    request.approvedAt,
                  )}${request.approvalNotes ? ` — ${request.approvalNotes}` : ""}`}
                />
              ) : null}
              {request.cancelReason ? <InfoRow label="Motivo do cancelamento" value={request.cancelReason} /> : null}
              {request.notes ? <InfoRow label="Observações" value={request.notes} /> : null}
            </dl>
          </Card>

          <Card title="Linha do tempo">
            {timeline.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum evento registrado ainda.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((event, index) => {
                  const detail = timelineDetail(event);
                  return (
                    <li key={`${event.at}-${event.action}-${index}`} className="flex gap-3">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">
                          {PURCHASE_EVENT_LABEL[event.action] ?? event.action}
                          {detail ? <span className="text-slate-500"> · {detail}</span> : null}
                        </p>
                        <p className="text-xs text-slate-500">
                          {event.actor} · {formatDateTime(event.at)}
                        </p>
                        {event.note ? <p className="mt-0.5 text-xs text-slate-500">“{event.note}”</p> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>
      </div>

      {deciding ? (
        <DecideDialog
          request={request}
          items={items}
          onClose={() => setDeciding(false)}
          onSaved={() => {
            setDeciding(false);
            state.reload();
          }}
        />
      ) : null}

      {ordering ? (
        <OrderDialog
          request={request}
          items={items}
          approvedQuote={approvedQuote}
          onClose={() => setOrdering(false)}
          onSaved={() => {
            setOrdering(false);
            state.reload();
          }}
        />
      ) : null}

      {quoting ? (
        <QuoteDialog
          request={request}
          items={items}
          onClose={() => setQuoting(false)}
          onSaved={() => {
            setQuoting(false);
            state.reload();
          }}
        />
      ) : null}

      {quoteDecision ? (
        <QuoteDecisionDialog
          request={request}
          quote={quoteDecision.quote}
          action={quoteDecision.action}
          onClose={() => setQuoteDecision(null)}
          onSaved={() => {
            setQuoteDecision(null);
            state.reload();
          }}
        />
      ) : null}

      {receiving ? (
        <ReceiptDialog
          request={request}
          items={items}
          onClose={() => setReceiving(false)}
          onSaved={() => {
            setReceiving(false);
            state.reload();
          }}
        />
      ) : null}

      {cancelling ? (
        <CancelPurchaseDialog
          request={request}
          onClose={() => setCancelling(false)}
          onSaved={() => {
            setCancelling(false);
            state.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}

function ReceiptLines({ requestId, receiptId }: { requestId: string; receiptId: string }) {
  const state = useAsync(
    () =>
      apiGet<{ items: { id: string; code: string; lines: ReceiptLine[] }[] }>(`/api/purchases/${requestId}/receipts`),
    [requestId],
  );
  const receipt = state.data?.items.find((entry) => entry.id === receiptId);

  if (state.loading && !state.data) return <p className="mt-2 text-xs text-slate-500">Carregando itens...</p>;
  if (state.error) return <p className="mt-2 text-xs text-red-600">{state.error}</p>;
  if (!receipt) return null;

  return (
    <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-3">
      {receipt.lines.map((line) => (
        <li key={line.id} className="flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-700">
            {line.productName ?? "Item"} · {formatQuantity(line.qtyMilli)} {line.uomCode ?? ""} →{" "}
            {line.locationPath ?? line.locationName ?? "-"}
          </span>
          <span>
            {line.hasDiscrepancy ? (
              <Badge tone="amber">Divergência: {line.discrepancyNote ?? "sem observação"}</Badge>
            ) : line.movementId ? (
              <Badge tone="green">Entrada no estoque</Badge>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Decisão (aprovação)                                                        */
/* -------------------------------------------------------------------------- */

interface DecideItemDraft {
  itemId: string;
  label: string;
  requestedMilli: number;
  approved: boolean;
  qtyApproved: string;
  /** F-01: compra direta ou cotação, escolhido item a item pelo gestor. */
  mode: "direct" | "quote";
}

function DecideDialog({
  request,
  items,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  items: PurchaseItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [decision, setDecision] = useState<"approved" | "rejected" | "quoting" | "purchasing">("approved");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<DecideItemDraft[]>(() =>
    items
      .filter((item) => item.status === "pending")
      .map((item) => ({
        itemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        requestedMilli: item.qtyMilli,
        approved: true,
        qtyApproved: formatQuantity(item.qtyMilli, 3),
        mode: "direct",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDraft = (itemId: string, patch: Partial<DecideItemDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.itemId === itemId ? { ...draft, ...patch } : draft)));
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { decision, notes: notes || null };
      if (decision === "approved" && drafts.length > 0) {
        payload.items = drafts.map((draft) => ({
          itemId: draft.itemId,
          status: draft.approved ? "approved" : "rejected",
          qtyApproved: draft.approved ? Number(draft.qtyApproved.replace(",", ".")) : undefined,
          purchaseMode: draft.approved ? draft.mode : undefined,
        }));
      }
      const saved = await apiPost<{ status: string }>(`/api/purchases/${request.id}/decide`, payload);
      toast.success(
        saved.status === "quoting" && decision === "approved"
          ? "Solicitação aprovada; itens em cotação seguem para o comprador."
          : decision === "approved"
            ? "Solicitação aprovada."
            : decision === "rejected"
              ? "Solicitação rejeitada."
              : "Situação atualizada.",
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
      wide
      title={`Analisar ${request.code}`}
      description="Aprove, recuse ou mova a solicitação para cotação/compra. A decisão fica na auditoria."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar decisão
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Decisão" required htmlFor="decideDecision">
          <Select
            id="decideDecision"
            value={decision}
            onChange={(event) => setDecision(event.target.value as typeof decision)}
          >
            <option value="approved">Aprovar</option>
            <option value="rejected">Rejeitar</option>
            <option value="quoting">Em cotação</option>
            <option value="purchasing">Em compra</option>
          </Select>
        </Field>

        {decision === "approved" && drafts.length > 0 ? (
          <div className="rounded-lg border border-slate-200">
            <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
              Aprove, ajuste a quantidade e defina compra direta ou cotação por item
            </p>
            <p className="px-3 pt-2 text-xs text-slate-500">
              Itens em cotação seguem para o comprador registrar propostas de fornecedor; os demais seguem como
              compra direta.
            </p>
            <div className="space-y-2 p-3">
              {drafts.map((draft) => (
                <div key={draft.itemId} className="grid items-center gap-2 sm:grid-cols-[1.4fr_5.5rem_5.5rem_7.5rem]">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{draft.label}</p>
                    <p className="text-xs text-slate-500">
                      Solicitado: {formatQuantity(draft.requestedMilli)}
                    </p>
                  </div>
                  <Input
                    value={draft.qtyApproved}
                    onChange={(event) => updateDraft(draft.itemId, { qtyApproved: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Quantidade aprovada de ${draft.label}`}
                    disabled={!draft.approved}
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                      checked={draft.approved}
                      onChange={(event) => updateDraft(draft.itemId, { approved: event.target.checked })}
                    />
                    Aprovar
                  </label>
                  <Select
                    value={draft.mode}
                    onChange={(event) => updateDraft(draft.itemId, { mode: event.target.value as "direct" | "quote" })}
                    aria-label={`Modo de compra de ${draft.label}`}
                    disabled={!draft.approved}
                  >
                    <option value="direct">Compra direta</option>
                    <option value="quote">Cotação</option>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <Field label="Observações da decisão" htmlFor="decideNotes">
          <Textarea id="decideNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Pedido ao fornecedor                                                       */
/* -------------------------------------------------------------------------- */

interface OrderDraft {
  itemId: string;
  label: string;
  selected: boolean;
  qtyOrdered: string;
  unitPrice: string;
}

function OrderDialog({
  request,
  items,
  approvedQuote,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  items: PurchaseItem[];
  approvedQuote: QuoteSummary | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState(
    approvedQuote?.supplierId ?? items.find((item) => item.supplierId)?.supplierId ?? "",
  );
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<OrderDraft[]>(() =>
    items
      .filter((item) => item.status === "approved")
      .map((item) => {
        const quoted = approvedQuote?.items.find((line) => line.requestItemId === item.id);
        return {
          itemId: item.id,
          label: item.productName ?? item.description ?? "Item",
          selected: true,
          qtyOrdered: formatQuantity(item.qtyApprovedMilli ?? item.qtyMilli, 3),
          unitPrice: quoted
            ? (quoted.unitPriceCents / 100).toFixed(2)
            : item.unitPriceCents !== null
              ? (item.unitPriceCents / 100).toFixed(2)
              : "",
        };
      }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDraft = (itemId: string, patch: Partial<OrderDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.itemId === itemId ? { ...draft, ...patch } : draft)));
  };

  const submit = async () => {
    const chosen = drafts.filter((draft) => draft.selected && Number(draft.qtyOrdered.replace(",", ".")) > 0);
    if (!supplierId) {
      setError("Selecione o fornecedor do pedido.");
      return;
    }
    if (chosen.length === 0) {
      setError("Selecione ao menos um item aprovado para o pedido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/purchases/${request.id}/order`, {
        supplierId,
        orderRef: orderRef || null,
        notes: notes || null,
        items: chosen.map((draft) => ({
          itemId: draft.itemId,
          qtyOrdered: Number(draft.qtyOrdered.replace(",", ".")),
          unitPrice: draft.unitPrice ? Number(draft.unitPrice.replace(",", ".")) : undefined,
        })),
      });
      toast.success("Pedido registrado. A solicitação esta aguardando recebimento.");
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
      title={`Pedido de ${request.code}`}
      description="Registre fornecedor, referência e preços; o saldo só entra no recebimento."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar pedido
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {approvedQuote ? (
          <Alert tone="blue">
            Pedido vinculado à proposta {approvedQuote.code} ({approvedQuote.supplierName}); os preços abaixo vêm da
            cotação aprovada.
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fornecedor" required htmlFor="orderSupplier">
            <Select
              id="orderSupplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              disabled={Boolean(approvedQuote)}
            >
              <option value="">Selecione...</option>
              {(suppliers.data ?? [])
                .filter((supplier) => supplier.isActive)
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Referência do pedido" hint="Número do pedido ou orçamento." htmlFor="orderRef">
            <Input id="orderRef" value={orderRef} onChange={(event) => setOrderRef(event.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
            Itens aprovados
          </p>
          <div className="space-y-2 p-3">
            {drafts.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum item aprovado para pedido.</p>
            ) : (
              drafts.map((draft) => (
                <div key={draft.itemId} className="grid items-center gap-2 sm:grid-cols-[1.4fr_6rem_7rem_2rem]">
                  <p className="truncate text-sm text-slate-700">{draft.label}</p>
                  <Input
                    value={draft.qtyOrdered}
                    onChange={(event) => updateDraft(draft.itemId, { qtyOrdered: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Quantidade pedida de ${draft.label}`}
                    disabled={!draft.selected}
                  />
                  <Input
                    value={draft.unitPrice}
                    onChange={(event) => updateDraft(draft.itemId, { unitPrice: event.target.value })}
                    placeholder="Preço (R$)"
                    inputMode="decimal"
                    aria-label={`Preço unitário de ${draft.label}`}
                    disabled={!draft.selected}
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                      checked={draft.selected}
                      onChange={(event) => updateDraft(draft.itemId, { selected: event.target.checked })}
                    />
                    Pedir
                  </label>
                </div>
              ))
            )}
          </div>
        </div>

        <Field label="Observações do pedido" htmlFor="orderNotes">
          <Textarea id="orderNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Cotação (F-02)                                                             */
/* -------------------------------------------------------------------------- */

interface QuoteDraft {
  itemId: string;
  label: string;
  mode: "direct" | "quote" | null;
  included: boolean;
  qty: string;
  unitPrice: string;
}

function QuoteDialog({
  request,
  items,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  items: PurchaseItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<QuoteDraft[]>(() =>
    items
      .filter((item) => !["rejected", "cancelled", "received"].includes(item.status))
      .map((item) => ({
        itemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        mode: item.purchaseMode,
        // Itens marcados para cotação já entram na proposta; os demais são opcionais.
        included: item.purchaseMode !== "direct",
        qty: formatQuantity(item.qtyApprovedMilli ?? item.qtyMilli, 3),
        unitPrice: "",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateDraft = (itemId: string, patch: Partial<QuoteDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.itemId === itemId ? { ...draft, ...patch } : draft)));
  };

  const submit = async () => {
    const chosen = drafts.filter((draft) => draft.included);
    if (!supplierId) {
      setError("Selecione o fornecedor da proposta.");
      return;
    }
    if (chosen.length === 0) {
      setError("Selecione ao menos um item para a proposta.");
      return;
    }
    const missing = chosen.find((draft) => draft.unitPrice.trim() === "");
    if (missing) {
      setError(`Informe o preço unitário de "${missing.label}".`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/purchases/${request.id}/quotes`, {
        supplierId,
        notes: notes || null,
        items: chosen.map((draft) => ({
          itemId: draft.itemId,
          unitPrice: Number(draft.unitPrice.replace(",", ".")),
          qty: Number(draft.qty.replace(",", ".")),
        })),
      });
      toast.success("Proposta registrada.");
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
      title={`Proposta de fornecedor — ${request.code}`}
      description="Registre o valor por item desta proposta. Repetir o fornecedor atualiza a proposta já registrada."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar proposta
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Fornecedor" required htmlFor="quoteSupplier">
          <Select id="quoteSupplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
            <option value="">Selecione...</option>
            {(suppliers.data ?? [])
              .filter((supplier) => supplier.isActive)
              .map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
          </Select>
        </Field>

        <div className="rounded-lg border border-slate-200">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
            Itens e valores da proposta
          </p>
          <div className="space-y-2 p-3">
            {drafts.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum item disponível para cotação.</p>
            ) : (
              drafts.map((draft) => (
                <div key={draft.itemId} className="grid items-center gap-2 sm:grid-cols-[1.4fr_6rem_7rem_2.5rem]">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{draft.label}</p>
                    {draft.mode ? (
                      <span className="text-xs text-slate-500">{PURCHASE_ITEM_MODE_LABEL[draft.mode]}</span>
                    ) : null}
                  </div>
                  <Input
                    value={draft.qty}
                    onChange={(event) => updateDraft(draft.itemId, { qty: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Quantidade cotada de ${draft.label}`}
                    disabled={!draft.included}
                  />
                  <Input
                    value={draft.unitPrice}
                    onChange={(event) => updateDraft(draft.itemId, { unitPrice: event.target.value })}
                    placeholder="Valor (R$)"
                    inputMode="decimal"
                    aria-label={`Valor unitário de ${draft.label}`}
                    disabled={!draft.included}
                  />
                  <label className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                      checked={draft.included}
                      onChange={(event) => updateDraft(draft.itemId, { included: event.target.checked })}
                      aria-label={`Incluir ${draft.label} na proposta`}
                    />
                  </label>
                </div>
              ))
            )}
          </div>
        </div>

        <Field label="Observações da proposta" htmlFor="quoteNotes">
          <Textarea id="quoteNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function QuoteDecisionDialog({
  request,
  quote,
  action,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  quote: QuoteSummary;
  action: "approve" | "reject";
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/purchases/${request.id}/quotes/${quote.id}/${action}`, { notes: notes || null });
      toast.success(
        action === "approve"
          ? "Proposta aprovada; o pedido já pode ser emitido."
          : "Cotação devolvida ao comprador para ajustes.",
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
      title={action === "approve" ? `Aprovar ${quote.code}` : `Recusar ${quote.code}`}
      description={
        action === "approve"
          ? `A proposta de ${quote.supplierName} vira a escolhida desta cotação; as demais são marcadas como não escolhidas.`
          : `A proposta de ${quote.supplierName} não será usada; a cotação volta ao comprador para ajustes.`
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} variant={action === "reject" ? "danger" : "primary"}>
            {action === "approve" ? "Aprovar proposta" : "Recusar proposta"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Observações da decisão" htmlFor="quoteDecisionNotes">
          <Textarea
            id="quoteDecisionNotes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Recebimento                                                                */
/* -------------------------------------------------------------------------- */

interface ReceiptDraft {
  requestItemId: string;
  label: string;
  pendingMilli: number;
  uomCode: string | null;
  include: boolean;
  receivedQty: string;
  unitPrice: string;
  hasDiscrepancy: boolean;
  discrepancyNote: string;
  /** F-06: item que entra e já é consumido (entrada + saída com justificativa). */
  directUse: boolean;
  /** Item sem produto no catálogo: recebe aqui o cadastro rápido (apenas o nome). */
  newProduct: boolean;
  newProductName: string;
}

function ReceiptDialog({
  request,
  items,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  items: PurchaseItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const [locationId, setLocationId] = useState(request.locationId ?? "");
  const [documentRef, setDocumentRef] = useState("");
  const [notes, setNotes] = useState("");
  const [directUseReason, setDirectUseReason] = useState("");
  const [drafts, setDrafts] = useState<ReceiptDraft[]>(() =>
    items
      .filter((item) => item.pendingQtyMilli > 0 && ["ordered", "partially_received"].includes(item.status))
      .map((item) => ({
        requestItemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        pendingMilli: item.pendingQtyMilli,
        uomCode: item.uomCode,
        include: true,
        receivedQty: formatQuantity(item.pendingQtyMilli, 3),
        unitPrice: item.unitPriceCents !== null ? (item.unitPriceCents / 100).toFixed(2) : "",
        hasDiscrepancy: false,
        discrepancyNote: "",
        directUse: false,
        newProduct: !item.productId,
        newProductName: item.description ?? "",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-receipt-${crypto.randomUUID()}`);

  const updateDraft = (itemId: string, patch: Partial<ReceiptDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.requestItemId === itemId ? { ...draft, ...patch } : draft)));
  };

  const chosen = useMemo(
    () => drafts.filter((draft) => draft.include && Number(draft.receivedQty.replace(",", ".")) > 0),
    [drafts],
  );
  const directUseChosen = useMemo(() => chosen.filter((draft) => draft.directUse), [chosen]);

  const submit = async () => {
    if (!locationId) {
      setError("Informe o local de destino do material recebido.");
      return;
    }
    if (chosen.length === 0) {
      setError("Informe ao menos um item recebido com quantidade.");
      return;
    }
    if (directUseChosen.length > 0 && directUseReason.trim().length < 5) {
      setError("Descreva a justificativa do uso direto (mínimo 5 caracteres).");
      return;
    }
    const missingNote = chosen.find((draft) => draft.hasDiscrepancy && draft.discrepancyNote.trim().length < 3);
    if (missingNote) {
      setError(`Descreva a divergência do item ${missingNote.label}.`);
      return;
    }
    const missingProductName = chosen.find(
      (draft) => draft.newProduct && draft.newProductName.trim().length < 2,
    );
    if (missingProductName) {
      setError(`Informe o nome do produto para o item ${missingProductName.label} (cadastro rápido).`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{
        receipt: { id: string; code: string };
        idempotentReplay: boolean;
        createdProducts?: { id: string; name: string; catalogStatus: string }[];
      }>(`/api/purchases/${request.id}/receipts`, {
        requestKey,
        locationId,
        documentRef: documentRef || null,
        notes: notes || null,
        directUseReason: directUseChosen.length > 0 ? directUseReason.trim() : null,
        items: chosen.map((draft) => ({
          requestItemId: draft.requestItemId,
          receivedQty: Number(draft.receivedQty.replace(",", ".")),
          unitPrice: draft.unitPrice ? Number(draft.unitPrice.replace(",", ".")) : undefined,
          hasDiscrepancy: draft.hasDiscrepancy,
          discrepancyNote: draft.discrepancyNote || null,
          directUse: draft.directUse,
          newProduct: draft.newProduct ? { name: draft.newProductName.trim() } : undefined,
        })),
      });
      const createdCount = result.createdProducts?.length ?? 0;
      const directUseCount = directUseChosen.length;
      const directUseNote =
        directUseCount > 0
          ? ` ${directUseCount} ${plural(directUseCount, "item seguiu", "itens seguiram")} direto para uso (entrada e saída registradas).`
          : "";
      toast.success(
        createdCount > 0
          ? `Recebimento ${result.receipt.code} registrado; ${createdCount} ${plural(createdCount, "produto aguardando", "produtos aguardando")} completar o cadastro.${directUseNote}`
          : `Recebimento ${result.receipt.code} registrado e estoque atualizado.${directUseNote}`,
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
      wide
      title={`Recebimento de ${request.code}`}
      description="O recebimento cria entrada de estoque por movimentação; divergências ficam registradas."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Registrar recebimento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Entregar em" required htmlFor="receiptLocation">
            <Select id="receiptLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Selecione o local de estoque...</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Documento" hint="Nota fiscal, romaneio ou protocolo." htmlFor="receiptDoc">
            <Input id="receiptDoc" value={documentRef} onChange={(event) => setDocumentRef(event.target.value)} />
          </Field>
        </div>

        <div className="rounded-lg border border-slate-200">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
            Itens a receber
          </p>
          <div className="space-y-3 p-3">
            {drafts.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum item com saldo pendente para receber. Registre o pedido antes do recebimento.
              </p>
            ) : (
              drafts.map((draft) => (
                <div key={draft.requestItemId} className="rounded-lg border border-slate-100 p-2">
                  <div className="grid items-center gap-2 sm:grid-cols-[1.4fr_6rem_7rem_2rem]">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-700">{draft.label}</p>
                      <p className="text-xs text-slate-500">
                        Pendente: {formatQuantity(draft.pendingMilli)} {draft.uomCode ?? ""}
                      </p>
                    </div>
                    <Input
                      value={draft.receivedQty}
                      onChange={(event) => updateDraft(draft.requestItemId, { receivedQty: event.target.value })}
                      inputMode="decimal"
                      aria-label={`Quantidade recebida de ${draft.label}`}
                      disabled={!draft.include}
                    />
                    <Input
                      value={draft.unitPrice}
                      onChange={(event) => updateDraft(draft.requestItemId, { unitPrice: event.target.value })}
                      placeholder="Preço (R$)"
                      inputMode="decimal"
                      aria-label={`Preço de ${draft.label}`}
                      disabled={!draft.include}
                    />
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                        checked={draft.include}
                        onChange={(event) => updateDraft(draft.requestItemId, { include: event.target.checked })}
                      />
                      Receber
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                        checked={draft.hasDiscrepancy}
                        disabled={!draft.include}
                        onChange={(event) =>
                          updateDraft(draft.requestItemId, { hasDiscrepancy: event.target.checked })
                        }
                      />
                      Divergência (falta, avaria, item diferente)
                    </label>
                    {draft.hasDiscrepancy ? (
                      <Input
                        value={draft.discrepancyNote}
                        onChange={(event) => updateDraft(draft.requestItemId, { discrepancyNote: event.target.value })}
                        placeholder="Descreva a divergência"
                        className="w-full sm:w-72"
                        aria-label={`Divergência de ${draft.label}`}
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                        checked={draft.directUse}
                        disabled={!draft.include}
                        onChange={(event) => updateDraft(draft.requestItemId, { directUse: event.target.checked })}
                      />
                      Uso direto (entra e já sai para uso)
                    </label>
                  </div>
                  {draft.newProduct ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2">
                      <p className="text-xs text-amber-900">
                        Item sem produto no catálogo. Informe o nome e o produto será cadastrado agora, com
                        cadastro incompleto para correção posterior no catálogo.
                      </p>
                      <Input
                        value={draft.newProductName}
                        onChange={(event) =>
                          updateDraft(draft.requestItemId, { newProductName: event.target.value })
                        }
                        placeholder="Nome do produto"
                        className="mt-1"
                        aria-label={`Nome do produto novo para ${draft.label}`}
                        disabled={!draft.include}
                      />
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        {directUseChosen.length > 0 ? (
          <Field
            label="Justificativa do uso direto"
            required
            hint="O material entra no estoque e sai no mesmo recebimento (entrada + saída no livro-razão); a justificativa fica registrada em cada movimentação."
            htmlFor="receiptDirectUse"
          >
            <Textarea
              id="receiptDirectUse"
              rows={2}
              value={directUseReason}
              onChange={(event) => setDirectUseReason(event.target.value)}
              placeholder="Ex.: entregue direto à equipe de manutenção para o reparo do 3º andar"
            />
          </Field>
        ) : null}

        <Field label="Observações do recebimento" htmlFor="receiptNotes">
          <Textarea id="receiptNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Cancelamento                                                               */
/* -------------------------------------------------------------------------- */

function CancelPurchaseDialog({
  request,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
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
      await apiPost(`/api/purchases/${request.id}/cancel`, { reason });
      toast.success("Solicitação cancelada.");
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
      title={`Cancelar ${request.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Cancelar solicitação
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Alert tone="amber" title="Cancelamento com histórico">
          A solicitação não é apagada: fica com o motivo informado e o estoque não e afetado, pois
          não há recebimento confirmado.
        </Alert>
        <Field label="Motivo" required htmlFor="purchaseCancelReason">
          <Input
            id="purchaseCancelReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: compra não autorizada no orçamento"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}
