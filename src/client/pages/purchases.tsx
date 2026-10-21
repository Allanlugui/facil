import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  PRIORITY_LABEL,
  PURCHASE_APPROVAL_STAGE,
  PURCHASE_APPROVAL_STAGE_LABEL,
  PURCHASE_BUDGET_STATUS_LABEL,
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
  workflowVersion: number;
  approvalStage: string;
  routing: "standard" | "direct_to_purchasing";
  budgetStatus: "pending" | "approved" | "rejected" | "not_required";
  budgetNotes: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  glAccount: string | null;
  externalRef: string | null;
  financeStatus: "pending" | "committed" | "received" | "not_required";
  desiredDate: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  approvalNotes: string | null;
  managerApprovedBy: string | null;
  managerApprovedByName: string | null;
  managerApprovedAt: string | null;
  directionApprovedBy: string | null;
  directionApprovedByName: string | null;
  directionApprovedAt: string | null;
  directAuthorizedBy: string | null;
  directAuthorizedByName: string | null;
  directAuthorizedAt: string | null;
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

interface PurchaseAward {
  id: string;
  requestItemId: string;
  quoteId: string;
  quoteCode: string;
  supplierId: string;
  supplierName: string;
  qtyMilli: number;
  unitPriceCents: number;
  awardedBy: string;
  awardedByName: string;
  awardedAt: string;
  notes: string | null;
  productName: string | null;
  sku: string | null;
  description: string | null;
  uomCode: string | null;
}

interface PurchaseOrderItem {
  id: string;
  requestItemId: string;
  productName: string | null;
  sku: string | null;
  description: string | null;
  uomCode: string | null;
  qtyMilli: number;
  unitPriceCents: number;
  receivedQtyMilli: number;
  notes: string | null;
}

interface PurchaseOrder {
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  orderRef: string | null;
  status: string;
  currency: string;
  totalCents: number;
  costCenterId: string | null;
  glAccount: string | null;
  externalSystem: string | null;
  externalId: string | null;
  externalStatus: string | null;
  syncStatus: string;
  syncError: string | null;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  qtyMilli: number;
  items: PurchaseOrderItem[];
}

interface PurchaseOverview {
  queues: {
    manager: number;
    direction: number;
    purchasing: number;
    buyer: number;
    award: number;
    receipt: number;
    quoting: number;
  };
  openCount: number;
  totalCount: number;
  financial: {
    committedCents: number;
    orderedValueCents: number;
    approvedValueCents: number;
  };
  costCenters: Array<{ id: string; code: string; name: string }>;
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
  const [stage, setStage] = useState("");
  const [priority, setPriority] = useState("");
  const [pendingApproval, setPendingApproval] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  // Atalho vindo do painel do comprador: /compras?novo=1 abre a solicitação
  // direto e limpa o parâmetro para o botão Voltar não reabrir sozinho.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const stageParam = searchParams.get("stage");
    if (stageParam) setStage(stageParam);
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
        stage: stage || undefined,
        priority: priority || undefined,
        pendingApproval: pendingApproval ? "true" : undefined,
        requesterId: onlyMine ? user?.id : undefined,
        page,
        pageSize: 25,
      }),
    [debounced, status, stage, priority, pendingApproval, onlyMine, user?.id, page],
  );

  const overview = useAsync(
    () => apiGet<PurchaseOverview>("/api/purchases/overview"),
    [user?.id],
  );

  const queueItems = overview.data
    ? [
        { key: "manager", label: "Aprovar como gestor", count: overview.data.queues.manager, show: can(PERMISSIONS.PURCHASES_APPROVE) },
        { key: "direction", label: "Autorizar orçamento", count: overview.data.queues.direction, show: can(PERMISSIONS.PURCHASES_AUTHORIZE) },
        { key: "purchasing", label: "Triagem de compras", count: overview.data.queues.purchasing, show: can(PERMISSIONS.PURCHASES_AWARD) || can(PERMISSIONS.PURCHASES_DIRECT) },
        { key: "award", label: "Adjudicar cotação", count: overview.data.queues.award, show: can(PERMISSIONS.PURCHASES_AWARD) },
        { key: "buyer", label: "Preparar pedido", count: overview.data.queues.buyer, show: can(PERMISSIONS.PURCHASES_ORDER) },
        { key: "receipt", label: "Receber material", count: overview.data.queues.receipt, show: can(PERMISSIONS.PURCHASES_RECEIVE) },
      ].filter((item) => item.show && item.count > 0)
    : [];

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
      cell: (row) => (
        <div className="space-y-1">
          <Badge tone={PURCHASE_STATUS_TONE[row.status]}>{PURCHASE_STATUS_LABEL[row.status]}</Badge>
          {row.status === "pending_approval" ? (
            <p className="text-[11px] text-slate-500">
              {PURCHASE_APPROVAL_STAGE_LABEL[row.approvalStage as keyof typeof PURCHASE_APPROVAL_STAGE_LABEL] ??
                row.approvalStage}
            </p>
          ) : null}
        </div>
      ),
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

      {queueItems.length > 0 ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {queueItems.map((queue) => (
            <button
              key={queue.key}
              type="button"
              onClick={() => {
                setStage(queue.key);
                setStatus("");
                setPendingApproval(false);
                setPage(1);
              }}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                stage === queue.key
                  ? "border-brand-300 bg-brand-50"
                  : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"
              }`}
            >
              <span className="text-sm font-medium text-slate-700">{queue.label}</span>
              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
                {queue.count}
              </span>
            </button>
          ))}
        </div>
      ) : null}

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
            value={stage}
            onChange={(event) => {
              setStage(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-48"
            aria-label="Filtrar por etapa"
          >
            <option value="">Todas as etapas</option>
            {PURCHASE_APPROVAL_STAGE.map((code) => (
              <option key={code} value={code}>
                {PURCHASE_APPROVAL_STAGE_LABEL[code]}
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
  /** Item que ainda não existe no catálogo: a descrição é obrigatória. */
  freeText: boolean;
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
  const overview = useAsync(() => apiGet<PurchaseOverview>("/api/purchases/overview"), []);
  const [locationId, setLocationId] = useState("");
  const [justification, setJustification] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [desiredDate, setDesiredDate] = useState(addDaysIsoDate(7));
  const [costCenterId, setCostCenterId] = useState("");
  const [glAccount, setGlAccount] = useState("");
  const [budgetNotes, setBudgetNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [submitNow, setSubmitNow] = useState(true);
  const [items, setItems] = useState<ItemDraft[]>([
    { productId: "", description: "", qty: "", uomId: "", notes: "", freeText: false },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const submit = async () => {
    const incomplete = items.find(
      (item) =>
        Number(item.qty.replace(",", ".")) > 0 &&
        !item.productId &&
        item.description.trim().length < 3,
    );
    if (incomplete) {
      setError("Informe o produto do catálogo ou descreva o item que deve ser comprado (mínimo 3 caracteres).");
      return;
    }
    const parsed = items
      .filter((item) => (item.productId || item.description.trim().length > 0) && Number(item.qty.replace(",", ".")) > 0)
      .map((item) => ({
        productId: item.freeText ? null : item.productId || null,
        description: item.description.trim() || null,
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
        workflowVersion: 2,
        locationId: locationId || null,
        justification: justification || null,
        priority,
        desiredDate: desiredDate || null,
        costCenterId: costCenterId || null,
        glAccount: glAccount || null,
        budgetNotes: budgetNotes || null,
        notes: notes || null,
        submit: submitNow,
        items: parsed,
      });
      toast.success(
        result.status === "pending_approval"
          ? `Solicitação ${result.code} enviada ao gestor do setor.`
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
      description="O gestor do setor aprova a necessidade; a Direção analisa o orçamento; Compras cota, escolhe fornecedores e conduz o recebimento."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            {submitNow ? "Enviar ao gestor" : "Salvar rascunho"}
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
          <Field
            label="Centro de custo"
            hint="Usado na análise de orçamento e na exportação ao ERP."
            htmlFor="prCostCenter"
          >
            <Select id="prCostCenter" value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
              <option value="">Selecione...</option>
              {(overview.data?.costCenters ?? []).map((center) => (
                <option key={center.id} value={center.id}>
                  {center.code} — {center.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Conta contábil" hint="Opcional; o financeiro pode completar depois." htmlFor="prGlAccount">
            <Input
              id="prGlAccount"
              value={glAccount}
              onChange={(event) => setGlAccount(event.target.value)}
              placeholder="Ex.: 4.2.01"
            />
          </Field>
          <Field label="Observação de orçamento" htmlFor="prBudgetNotes">
            <Input
              id="prBudgetNotes"
              value={budgetNotes}
              onChange={(event) => setBudgetNotes(event.target.value)}
              placeholder="Verba, contrato ou centro de aprovação"
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
                  { productId: "", description: "", qty: "", uomId: "", notes: "", freeText: false },
                ])
              }
            >
              Adicionar item
            </Button>
          </div>
          <div className="space-y-3 p-3">
            {items.map((item, index) => (
              <div key={index} className="rounded-lg border border-slate-100 p-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Item {index + 1}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateItem(
                        index,
                        item.freeText
                          ? { freeText: false }
                          : { freeText: true, productId: "" },
                      )
                    }
                  >
                    {item.freeText ? "Voltar ao catálogo" : "Item fora do catálogo"}
                  </Button>
                </div>
                {item.freeText ? (
                  <p className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Este item não está no catálogo. A solicitação pode seguir normalmente; o cadastro
                    será feito durante o processo de compra ou no recebimento.
                  </p>
                ) : null}
                <div
                  className={`grid gap-2 ${
                    item.freeText
                      ? "sm:grid-cols-[2.4fr_7rem_9rem_2rem]"
                      : "sm:grid-cols-[1.4fr_1fr_7rem_9rem_2rem]"
                  }`}
                >
                  {item.freeText ? (
                    <Input
                      value={item.description}
                      onChange={(event) => updateItem(index, { description: event.target.value })}
                      placeholder="Descreva o item (marca, modelo, medidas...)"
                      aria-label={`Descrição do item fora do catálogo ${index + 1}`}
                      maxLength={300}
                    />
                  ) : (
                    <>
                      <ProductPicker
                        value={item.productId}
                        onChange={(productId, product) =>
                          updateItem(index, {
                            productId,
                            // Ajuda o comprador: a unidade do cadastro já vem escolhida.
                            ...(product && !item.uomId ? { uomId: product.uomId } : {}),
                          })
                        }
                        onRequestFreeText={(query) =>
                          updateItem(index, {
                            freeText: true,
                            productId: "",
                            description: query || item.description,
                          })
                        }
                        ariaLabel={`Produto ${index + 1}`}
                        placeholder="Buscar produto no catálogo..."
                      />
                      <Input
                        value={item.description}
                        onChange={(event) => updateItem(index, { description: event.target.value })}
                        placeholder="Descrição/complemento (opcional)"
                        aria-label={`Descrição ${index + 1}`}
                        maxLength={300}
                      />
                    </>
                  )}
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
  awards: PurchaseAward[];
  orders: PurchaseOrder[];
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
  const [awarding, setAwarding] = useState(false);
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

  const { request, items, receipts, quotes, awards, orders, timeline } = state.data;
  const isV2 = request.workflowVersion === 2;
  const canSubmit = request.status === "draft" && can(PERMISSIONS.PURCHASES_CREATE);
  const stageAllowed =
    request.approvalStage === "manager"
      ? can(PERMISSIONS.PURCHASES_APPROVE)
      : request.approvalStage === "direction"
        ? can(PERMISSIONS.PURCHASES_AUTHORIZE)
        : request.approvalStage === "purchasing"
          ? can(PERMISSIONS.PURCHASES_AWARD) || can(PERMISSIONS.PURCHASES_DIRECT)
          : false;
  const canDecide =
    isV2
      ? request.status === "pending_approval" && stageAllowed && user?.id !== request.requesterId
      : request.status === "pending_approval" &&
        (can(PERMISSIONS.PURCHASES_APPROVE) || can(PERMISSIONS.PURCHASES_ORDER)) &&
        user?.id !== request.requesterId;
  const canAward =
    isV2 &&
    request.status === "quote_returned" &&
    request.approvalStage === "award" &&
    can(PERMISSIONS.PURCHASES_AWARD) &&
    user?.id !== request.requesterId;
  const canOrder = isV2
    ? ["approved", "quote_approved"].includes(request.status) &&
      request.approvalStage === "buyer" &&
      can(PERMISSIONS.PURCHASES_ORDER)
    : ["approved", "purchasing", "quote_approved"].includes(request.status) &&
      can(PERMISSIONS.PURCHASES_ORDER);
  const canQuote = isV2
    ? request.status === "quoting" && can(PERMISSIONS.PURCHASES_ORDER)
    : ["quoting", "quote_returned"].includes(request.status) && can(PERMISSIONS.PURCHASES_ORDER);
  const canReturnQuote =
    request.status === "quoting" &&
    can(PERMISSIONS.PURCHASES_ORDER) &&
    quotes.some((quote) => quote.status === "registered");
  const canDecideQuote =
    !isV2 &&
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
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const timelineDetail = (event: PurchaseTimelineEvent): string | null => {
    if (event.action.startsWith("purchase_quote.")) {
      const quote = event.entityId ? quoteById.get(event.entityId) : undefined;
      return quote ? `${quote.code} · ${quote.supplierName}` : event.code;
    }
    if (event.action === "purchase_receipt.confirm") return event.code;
    if (event.action.startsWith("purchase_order.")) {
      const order = event.entityId ? orderById.get(event.entityId) : undefined;
      return order ? `${order.code} - ${order.supplierName}` : event.code;
    }
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
            {!row.productId ? <Badge tone="amber">Fora do catálogo</Badge> : null}
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
            {isV2 ? (
              <Badge tone={request.routing === "direct_to_purchasing" ? "violet" : "brand"}>
                {request.routing === "direct_to_purchasing"
                  ? "Enviada direto a Compras"
                  : `Etapa: ${
                      PURCHASE_APPROVAL_STAGE_LABEL[
                        request.approvalStage as keyof typeof PURCHASE_APPROVAL_STAGE_LABEL
                      ] ?? request.approvalStage
                    }`}
              </Badge>
            ) : (
              <Badge tone="slate">Fluxo anterior</Badge>
            )}
            <Badge tone={PRIORITY_TONE[request.priority]}>Prioridade {PRIORITY_LABEL[request.priority]}</Badge>
            {request.costCenterCode ? (
              <Badge tone="slate">
                {request.costCenterCode} - {request.costCenterName}
              </Badge>
            ) : null}
            {request.desiredDate ? <Badge tone="slate">Desejada para {formatDate(request.desiredDate)}</Badge> : null}
          </span>
        }
        actions={
          <>
            <Link to="/compras">
              <Button variant="secondary">Voltar</Button>
            </Link>
            {canSubmit ? (
              <Button onClick={() => void submitForApproval()}>Enviar ao gestor</Button>
            ) : null}
            {canDecide ? (
              <Button onClick={() => setDeciding(true)}>
                {request.approvalStage === "manager"
                  ? "Analisar necessidade"
                  : request.approvalStage === "direction"
                    ? "Analisar orçamento"
                    : "Triagem de compras"}
              </Button>
            ) : null}
            {canQuote ? (
              <Button variant="secondary" onClick={() => setQuoting(true)}>
                Registrar proposta
              </Button>
            ) : null}
            {canReturnQuote ? (
              <Button onClick={() => void returnQuote()} loading={returningQuote}>
                Devolver para adjudicação
              </Button>
            ) : null}
            {canAward ? (
              <Button onClick={() => setAwarding(true)}>Adjudicar por item</Button>
            ) : null}
            {canOrder ? (
              <Button onClick={() => setOrdering(true)}>
                {isV2 ? "Emitir pedidos" : "Registrar pedido"}
              </Button>
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
          {isV2 ? (
            <Card title="Fluxo corporativo">
              <WorkflowProgress request={request} />
            </Card>
          ) : null}

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
              {request.status === "quote_returned" && isV2 && canAward ? (
                <Alert tone="amber" title="Escolha o fornecedor por item">
                  Um mesmo fornecedor pode ganhar todos os itens ou cada item pode ter um vencedor diferente.
                  Use “Adjudicar por item” para concluir.
                </Alert>
              ) : null}
              {awards.length > 0 ? (
                <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                  <p className="text-sm font-medium text-emerald-900">Adjudicação registrada</p>
                  <ul className="mt-1 space-y-1 text-xs text-emerald-800">
                    {awards.map((award) => (
                      <li key={award.id}>
                        {award.productName ?? award.description ?? "Item"} — {award.supplierName} •{" "}
                        {formatCurrencyFromCents(award.unitPriceCents)} / {award.uomCode ?? "un"}
                      </li>
                    ))}
                  </ul>
                </div>
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

          {orders.length > 0 ? (
            <Card title={`Pedidos por fornecedor (${orders.length})`}>
              <ul className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <li key={order.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {order.code} — {order.supplierName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {order.itemCount} {plural(order.itemCount, "item", "itens")} •{" "}
                          {order.orderRef ? `ref. ${order.orderRef} • ` : ""}
                          {order.createdByName} em {formatDateTime(order.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-slate-800">
                          {formatCurrencyFromCents(order.totalCents)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {order.status === "received"
                            ? "Recebido"
                            : order.status === "partially_received"
                              ? "Parcialmente recebido"
                              : "Pedido aberto"}
                          {order.syncStatus === "pending" ? " • ERP pendente" : ""}
                        </p>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {order.items.map((line) => (
                        <li key={line.id} className="flex justify-between gap-3">
                          <span>
                            {line.productName ?? line.description ?? "Item"} — {formatQuantity(line.qtyMilli)}{" "}
                            {line.uomCode ?? ""}
                          </span>
                          <span className="tabular-nums">{formatCurrencyFromCents(line.unitPriceCents)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
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
              {isV2 ? (
                <>
                  <InfoRow
                    label="Centro de custo"
                    value={
                      request.costCenterCode
                        ? `${request.costCenterCode} - ${request.costCenterName}`
                        : "Não informado"
                    }
                  />
                  <InfoRow label="Conta contábil" value={request.glAccount ?? "-"} />
                  <InfoRow label="Orçamento" value={PURCHASE_BUDGET_STATUS_LABEL[request.budgetStatus]} />
                  {request.budgetNotes ? <InfoRow label="Observação de orçamento" value={request.budgetNotes} /> : null}
                  <InfoRow
                    label="Financeiro"
                    value={
                      request.financeStatus === "committed"
                        ? "Comprometido no pedido"
                        : request.financeStatus === "received"
                          ? "Recebido e conciliado"
                          : request.financeStatus === "pending"
                            ? "Aguardando pedido"
                            : "Não se aplica"
                    }
                  />
                </>
              ) : null}
              <InfoRow label="Criada em" value={formatDateTime(request.createdAt)} />
              <InfoRow label="Justificativa" value={request.justification ?? "-"} />
              {request.managerApprovedAt ? (
                <InfoRow
                  label="Aprovação do gestor"
                  value={`${request.managerApprovedByName ?? "-"} em ${formatDateTime(request.managerApprovedAt)}`}
                />
              ) : null}
              {request.directionApprovedAt ? (
                <InfoRow
                  label="Autorização da Direção"
                  value={`${request.directionApprovedByName ?? "-"} em ${formatDateTime(request.directionApprovedAt)}`}
                />
              ) : null}
              {request.directAuthorizedAt ? (
                <InfoRow
                  label="Compra direta autorizada"
                  value={`${request.directAuthorizedByName ?? "-"} em ${formatDateTime(request.directAuthorizedAt)}`}
                />
              ) : null}
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
        isV2 ? (
          <WorkflowDecisionDialog
            request={request}
            items={items}
            onClose={() => setDeciding(false)}
            onSaved={() => {
              setDeciding(false);
              state.reload();
            }}
          />
        ) : (
          <DecideDialog
            request={request}
            items={items}
            onClose={() => setDeciding(false)}
            onSaved={() => {
              setDeciding(false);
              state.reload();
            }}
          />
        )
      ) : null}

      {awarding ? (
        <AwardDialog
          request={request}
          items={items}
          quotes={quotes}
          onClose={() => setAwarding(false)}
          onSaved={() => {
            setAwarding(false);
            state.reload();
          }}
        />
      ) : null}

      {ordering ? (
        isV2 ? (
          <MultiOrderDialog
            request={request}
            items={items}
            awards={awards}
            onClose={() => setOrdering(false)}
            onSaved={() => {
              setOrdering(false);
              state.reload();
            }}
          />
        ) : (
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
        )
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

function WorkflowProgress({ request }: { request: PurchaseRow }) {
  const standard = request.routing !== "direct_to_purchasing";
  const steps = [
    { key: "manager", label: "Gestor do setor" },
    ...(standard ? [{ key: "direction", label: "Direção" }] : []),
    { key: "purchasing", label: "Compras" },
    { key: "buyer", label: "Comprador" },
    { key: "receipt", label: "Recebimento" },
  ];
  const stageOrder: Record<string, number> = {
    manager: 0,
    direction: standard ? 1 : 0,
    purchasing: standard ? 2 : 1,
    buyer: standard ? 3 : 2,
    award: standard ? 3 : 2,
    receipt: standard ? 4 : 3,
    completed: steps.length,
  };
  const current = stageOrder[request.approvalStage] ?? 0;

  return (
    <ol className="grid gap-2 sm:grid-cols-5">
      {steps.map((step, index) => {
        const done = request.approvalStage === "completed" || index < current;
        const active = index === current && request.approvalStage !== "completed";
        return (
          <li key={step.key} className="flex items-center gap-2 sm:block">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-emerald-100 text-emerald-700"
                  : active
                    ? "bg-brand-700 text-white"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {done ? "✓" : index + 1}
            </span>
            <span
              className={`mt-1 block text-xs ${active ? "font-semibold text-slate-800" : "text-slate-500"}`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function WorkflowDecisionDialog({
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
  const stage = request.approvalStage;
  const options =
    stage === "manager"
      ? [
          { value: "approved", label: "Aprovar e enviar à Direção" },
          { value: "send_to_purchasing", label: "Enviar diretamente a Compras" },
          { value: "rejected", label: "Rejeitar solicitação" },
        ]
      : stage === "direction"
        ? [
            { value: "approved", label: "Autorizar compra / orçamento" },
            { value: "rejected", label: "Rejeitar solicitação" },
          ]
        : [
            { value: "send_to_direction", label: "Enviar à Direção para análise" },
            { value: "authorize_direct", label: "Autorizar compra direta sem cotação" },
            { value: "rejected", label: "Rejeitar solicitação" },
          ];
  const [decision, setDecision] = useState(options[0]!.value);
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState(() =>
    items
      .filter((item) => !["received", "cancelled", "rejected"].includes(item.status))
      .map((item) => ({
        itemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        requestedMilli: item.qtyMilli,
        approved: true,
        qtyApproved: formatQuantity(item.qtyApprovedMilli ?? item.qtyMilli, 3),
        mode: item.purchaseMode ?? "quote",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editItems = stage === "manager" || stage === "direction";

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { decision, notes: notes || null };
      if (editItems && drafts.length > 0) {
        payload.items = drafts.map((draft) => ({
          itemId: draft.itemId,
          status: draft.approved ? "approved" : "rejected",
          qtyApproved: draft.approved ? Number(draft.qtyApproved.replace(",", ".")) : undefined,
          purchaseMode: draft.approved ? draft.mode : undefined,
        }));
      }
      await apiPost(`/api/purchases/${request.id}/decide`, payload);
      toast.success("Decisão registrada.");
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
      title={`Decidir ${request.code}`}
      description="A decisão fica registrada na auditoria e avança a solicitação para a próxima etapa."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Confirmar decisão
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Decisão" htmlFor="workflowDecision">
          <Select
            id="workflowDecision"
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {stage === "manager"
            ? "O gestor confirma a necessidade. A Direção fará a análise de orçamento antes de Compras."
            : stage === "direction"
              ? "A Direção confere o centro de custo e o orçamento. A aprovação libera a cotação/compra."
              : "A triagem de Compras pode autorizar compra direta ou devolver à Direção para análise de orçamento."}
        </div>
        {editItems ? (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Solicitado</th>
                  <th className="px-3 py-2 text-right font-medium">Aprovado</th>
                  <th className="px-3 py-2 text-left font-medium">Destino</th>
                  <th className="px-3 py-2 text-center font-medium">Incluir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drafts.map((draft) => (
                  <tr key={draft.itemId}>
                    <td className="px-3 py-2 text-slate-700">{draft.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {formatQuantity(draft.requestedMilli)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        value={draft.qtyApproved}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId
                                ? { ...entry, qtyApproved: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        className="w-24 text-right"
                        inputMode="decimal"
                        aria-label={`Quantidade aprovada de ${draft.label}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={draft.mode}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId
                                ? { ...entry, mode: event.target.value as "direct" | "quote" }
                                : entry,
                            ),
                          )
                        }
                        className="w-32"
                        aria-label={`Destino de ${draft.label}`}
                      >
                        <option value="direct">Compra direta</option>
                        <option value="quote">Cotação</option>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-brand-700"
                        checked={draft.approved}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId
                                ? { ...entry, approved: event.target.checked }
                                : entry,
                            ),
                          )
                        }
                        aria-label={`Incluir ${draft.label}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <Field label="Observação da decisão" htmlFor="workflowNotes">
          <Textarea
            id="workflowNotes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Registre a justificativa, a verba ou a orientação para a próxima etapa."
          />
        </Field>
      </div>
    </Dialog>
  );
}

function AwardDialog({
  request,
  items,
  quotes,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  items: PurchaseItem[];
  quotes: QuoteSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = items.filter(
    (item) => item.purchaseMode === "quote" && !["rejected", "cancelled", "received"].includes(item.status),
  );
  const [drafts, setDrafts] = useState(() =>
    candidates.map((item) => {
      const options = quotes
        .filter((quote) => quote.status === "registered")
        .map((quote) => ({ quote, line: quote.items.find((line) => line.requestItemId === item.id) }))
        .filter((entry) => entry.line);
      const best = options.sort((a, b) => (a.line!.unitPriceCents - b.line!.unitPriceCents))[0];
      return {
        itemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        qty: formatQuantity(item.qtyApprovedMilli ?? item.qtyMilli, 3),
        quoteId: best?.quote.id ?? "",
      };
    }),
  );

  const submit = async () => {
    if (drafts.some((draft) => !draft.quoteId)) {
      setError("Selecione um fornecedor para cada item em cotação.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/purchases/${request.id}/award`, {
        notes: notes || null,
        awards: drafts.map((draft) => ({
          itemId: draft.itemId,
          quoteId: draft.quoteId,
          qty: Number(draft.qty.replace(",", ".")),
        })),
      });
      toast.success("Cotação adjudicada por item.");
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
      title={`Adjudicar ${request.code}`}
      description="Escolha o fornecedor de cada item. É permitido um fornecedor para todos ou fornecedores diferentes por item."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Confirmar adjudicação
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {candidates.length === 0 ? (
          <Alert tone="amber">Não há itens em cotação pendentes de adjudicação.</Alert>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qtde</th>
                  <th className="px-3 py-2 text-left font-medium">Fornecedor / proposta</th>
                  <th className="px-3 py-2 text-right font-medium">Preço unit.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drafts.map((draft) => {
                  const selected = quotes.find((quote) => quote.id === draft.quoteId);
                  const line = selected?.items.find((entry) => entry.requestItemId === draft.itemId);
                  const options = quotes.filter(
                    (quote) =>
                      quote.status === "registered" &&
                      quote.items.some((entry) => entry.requestItemId === draft.itemId),
                  );
                  return (
                    <tr key={draft.itemId}>
                      <td className="px-3 py-2 text-slate-700">{draft.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{draft.qty}</td>
                      <td className="px-3 py-2">
                        <Select
                          value={draft.quoteId}
                          onChange={(event) =>
                            setDrafts((current) =>
                              current.map((entry) =>
                                entry.itemId === draft.itemId
                                  ? { ...entry, quoteId: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          aria-label={`Fornecedor de ${draft.label}`}
                        >
                          <option value="">Selecione...</option>
                          {options.map((quote) => (
                            <option key={quote.id} value={quote.id}>
                              {quote.supplierName} ({quote.code})
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {line ? formatCurrencyFromCents(line.unitPriceCents) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Field label="Observação da adjudicação" htmlFor="awardNotes">
          <Textarea
            id="awardNotes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: melhor prazo de entrega; item dividido por disponibilidade."
          />
        </Field>
      </div>
    </Dialog>
  );
}

function MultiOrderDialog({
  request,
  items,
  awards,
  onClose,
  onSaved,
}: {
  request: PurchaseRow;
  items: PurchaseItem[];
  awards: PurchaseAward[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const suppliers = useSuppliers();
  const awardByItem = new Map(awards.map((award) => [award.requestItemId, award]));
  const [orderRef, setOrderRef] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState(() =>
    items
      .filter((item) => item.status === "approved")
      .map((item) => {
        const award = awardByItem.get(item.id);
        return {
          itemId: item.id,
          label: item.productName ?? item.description ?? "Item",
          uomCode: item.uomCode,
          qty: formatQuantity(item.qtyApprovedMilli ?? item.qtyMilli, 3),
          supplierId: award?.supplierId ?? item.supplierId ?? "",
          unitPrice:
            (award?.unitPriceCents ?? item.unitPriceCents) !== null &&
            (award?.unitPriceCents ?? item.unitPriceCents) !== undefined
              ? ((award?.unitPriceCents ?? item.unitPriceCents)! / 100).toFixed(2)
              : "",
        };
      }),
  );

  const grouped = useMemo(() => {
    const map = new Map<string, typeof drafts>();
    for (const draft of drafts) {
      if (!draft.supplierId) continue;
      const list = map.get(draft.supplierId) ?? [];
      list.push(draft);
      map.set(draft.supplierId, list);
    }
    return [...map.entries()];
  }, [drafts]);

  const submit = async () => {
    if (drafts.some((draft) => !draft.supplierId)) {
      setError("Selecione o fornecedor de cada item. Itens adjudicados já vêm com o fornecedor definido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/purchases/${request.id}/orders`, {
        notes: notes || null,
        orders: grouped.map(([supplierId, lines]) => ({
          supplierId,
          orderRef: orderRef || null,
          items: lines.map((line) => ({
            itemId: line.itemId,
            qtyOrdered: Number(line.qty.replace(",", ".")),
            unitPrice: Number(line.unitPrice.replace(",", ".")) || 0,
          })),
        })),
      });
      toast.success(`${grouped.length} ${plural(grouped.length, "pedido emitido", "pedidos emitidos")}.`);
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
      title={`Emitir pedidos de ${request.code}`}
      description="Confira fornecedor, quantidade e preço. O sistema agrupa os itens em um pedido por fornecedor."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={saving}>
            Emitir {grouped.length || ""} {plural(grouped.length, "pedido", "pedidos")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Referência do pedido" hint="Opcional; pode ser o número do fornecedor." htmlFor="multiOrderRef">
            <Input id="multiOrderRef" value={orderRef} onChange={(event) => setOrderRef(event.target.value)} />
          </Field>
          <Field label="Observação" htmlFor="multiOrderNotes">
            <Input
              id="multiOrderNotes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Prazo, condição de pagamento..."
            />
          </Field>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qtde</th>
                <th className="px-3 py-2 text-left font-medium">Fornecedor</th>
                <th className="px-3 py-2 text-right font-medium">Preço unit.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drafts.map((draft) => {
                const award = awardByItem.get(draft.itemId);
                return (
                  <tr key={draft.itemId}>
                    <td className="px-3 py-2 text-slate-700">
                      {draft.label}
                      {award ? <span className="ml-2 text-xs text-emerald-700">adjudicado</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        value={draft.qty}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId ? { ...entry, qty: event.target.value } : entry,
                            ),
                          )
                        }
                        className="w-24 text-right"
                        inputMode="decimal"
                        aria-label={`Quantidade de ${draft.label}`}
                      />
                      <span className="ml-1 text-xs text-slate-500">{draft.uomCode ?? ""}</span>
                    </td>
                    <td className="px-3 py-2">
                      {award ? (
                        <span className="text-sm text-slate-700">{award.supplierName}</span>
                      ) : (
                        <Select
                          value={draft.supplierId}
                          onChange={(event) =>
                            setDrafts((current) =>
                              current.map((entry) =>
                                entry.itemId === draft.itemId
                                  ? { ...entry, supplierId: event.target.value }
                                  : entry,
                              ),
                            )
                          }
                          aria-label={`Fornecedor de ${draft.label}`}
                        >
                          <option value="">Selecione...</option>
                          {(suppliers.data ?? []).map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        value={draft.unitPrice}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId
                                ? { ...entry, unitPrice: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        className="w-24 text-right"
                        inputMode="decimal"
                        aria-label={`Preço de ${draft.label}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {grouped.length > 0 ? (
          <p className="text-xs text-slate-500">
            Serão criados {grouped.length} {plural(grouped.length, "pedido", "pedidos")}, um por fornecedor.
          </p>
        ) : (
          <Alert tone="amber">Selecione um fornecedor para os itens de compra direta.</Alert>
        )}
      </div>
    </Dialog>
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
