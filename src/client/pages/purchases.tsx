import { useEffect, useMemo, useState, useCallback } from "react";
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
  PURCHASE_MODE_SHORT_LABEL,
  PURCHASE_STATUS_LABEL,
  type Paginated,
  type Priority,
  type PurchaseItemStatus,
  type PurchaseStatus,
} from "@shared/types";
import { apiErrorMessage, apiGet, apiPatch, apiPost, apiPut } from "../lib/api";
import {
  PRIORITY_TONE,
  PURCHASE_STATUS_TONE,
  addDaysIsoDate,
  entityName,
  formatCurrencyFromCents,
  formatDate,
  formatDateTime,
  formatQuantity,
  formatRelative,
  plural,
} from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useLocations, useProducts, useSuppliers, useUoms, useCategories, type ProductOption } from "../lib/lookups";
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
  locationDeleted: boolean;
  justification: string | null;
  priority: Priority;
  status: PurchaseStatus;
  workflowVersion: number;
  flowRevision: number;
  approvalStage: string;
  departmentId: string | null;
  departmentName: string | null;
  purchaseMode: "quote" | "budget" | "direct" | null;
  paymentMethodId: string | null;
  paymentMethodCode: string | null;
  paymentMethodName: string | null;
  paymentRequiresAuthorization: boolean;
  paymentRequiresQuote: boolean;
  paymentTerms: string | null;
  purchasingAuthorizedBy: string | null;
  purchasingAuthorizedByName: string | null;
  purchasingAuthorizedAt: string | null;
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
  triageCompletedAt: string | null;
  triageCompletedBy: string | null;
  triageCompletedByName: string | null;
  /** Devolução ao solicitante (ajuste fino do fluxo v3). */
  returnedAt: string | null;
  returnedBy: string | null;
  returnedByName: string | null;
  returnedReason: string | null;
  returned: boolean;
  displayStatus: string;
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
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  paymentTerms: string | null;
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

interface PurchaseOptions {
  paymentMethods: Array<{
    id: string;
    code: string;
    name: string;
    requiresAuthorization: boolean;
    requiresQuote: boolean;
    isActive: boolean;
    notes: string | null;
  }>;
  departments: Array<{ id: string; code: string; name: string; isPurchasing: boolean }>;
  costCenters: Array<{ id: string; code: string; name: string }>;
}

interface PurchaseOverview {
  queues: {
    triage: number;
    manager: number;
    direction: number;
    purchasing: number;
    buyer: number;
    award: number;
    receipt: number;
    quoting: number;
    returned: number;
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
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  invoiceDate: string | null;
  invoiceTotalCents: number | null;
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
        { key: "triage", label: "Fazer triagem", count: overview.data.queues.triage, show: can(PERMISSIONS.PURCHASES_ORDER) || can(PERMISSIONS.PURCHASES_AUTHORIZE) },
        { key: "manager", label: "Aprovar como gestor", count: overview.data.queues.manager, show: can(PERMISSIONS.PURCHASES_APPROVE) },
        { key: "direction", label: "Autorizar orçamento", count: overview.data.queues.direction, show: can(PERMISSIONS.PURCHASES_AUTHORIZE) },
        { key: "purchasing", label: "Aprovar compra", count: overview.data.queues.purchasing, show: can(PERMISSIONS.PURCHASES_AUTHORIZE) || can(PERMISSIONS.PURCHASES_AWARD) || can(PERMISSIONS.PURCHASES_DIRECT) },
        { key: "award", label: "Adjudicar cotação", count: overview.data.queues.award, show: can(PERMISSIONS.PURCHASES_AWARD) },
        { key: "buyer", label: "Preparar pedido", count: overview.data.queues.buyer, show: can(PERMISSIONS.PURCHASES_ORDER) },
        { key: "receipt", label: "Receber material", count: overview.data.queues.receipt, show: can(PERMISSIONS.PURCHASES_RECEIVE) },
        { key: "returned", label: "Devolvidas para ajuste", count: overview.data.queues.returned, show: can(PERMISSIONS.PURCHASES_CREATE) },
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
            {row.locationDeleted
              ? entityName(row.locationName, true)
              : row.locationPath ?? row.locationName ?? "Sem local"}{" "}
            · {row.justification ? row.justification : "sem justificativa"}
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
          {row.returned ? (
            <Badge tone="amber">Devolvida ao solicitante</Badge>
          ) : (
            <Badge tone={PURCHASE_STATUS_TONE[row.status]}>{PURCHASE_STATUS_LABEL[row.status]}</Badge>
          )}
          {row.status === "pending_approval" && !row.returned ? (
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
            <option value="triage">Fazer triagem</option>
            {PURCHASE_APPROVAL_STAGE.map((code) => (
              <option key={code} value={code}>
                {PURCHASE_APPROVAL_STAGE_LABEL[code]}
              </option>
            ))}
            <option value="returned">Devolvidas para ajuste</option>
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
/* Criação — Formulário Simplificado (Visão Solicitante)                      */
/* -------------------------------------------------------------------------- */

interface BatchItemDraft {
  /** Produto do catálogo (se encontrado) */
  productId: string | null;
  /** Nome do produto do catálogo (para exibição) */
  productName: string | null;
  /** SKU do produto do catálogo */
  sku: string | null;
  /** Unidade de medida padrão do produto */
  defaultUomId: string | null;
  /** Unidade de medida padrão do produto (código) */
  defaultUomCode: string | null;
  /** Descrição livre (item do catálogo ou item fora do catálogo) */
  description: string;
  /** Quantidade em string (para input) */
  qty: string;
  /** Unidade de medida selecionada */
  uomId: string | null;
  /** Observações do item */
  notes: string;
  /** Item não encontrado no catálogo */
  isFreeText: boolean;
  /** Linha original do texto colado (para referência) */
  rawLine: string;
}

interface ParsedBatchItem {
  qty: number;
  uom: string | null;
  description: string;
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
  const products = useProducts();
  const [locationId, setLocationId] = useState("");
  const [justification, setJustification] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [desiredDate, setDesiredDate] = useState(addDaysIsoDate(7));
  const [notes, setNotes] = useState("");
  const [submitNow, setSubmitNow] = useState(true);
  const [items, setItems] = useState<BatchItemDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBatchEntry, setShowBatchEntry] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchPreview, setBatchPreview] = useState<BatchItemDraft[] | null>(null);
  const [processingBatch, setProcessingBatch] = useState(false);

  // Busca produtos do catálogo para matching
  const productMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; sku: string | null; uomId: string | null; uomCode: string | null }>();
    (products.data ?? []).forEach((product: ProductOption) => {
      map.set(product.id, { id: product.id, name: product.name, sku: product.sku, uomId: product.uomId, uomCode: product.uomCode });
      // Também indexa por nome normalizado e SKU para busca fuzzy
      const normalizedName = product.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      map.set(`name:${normalizedName}`, { id: product.id, name: product.name, sku: product.sku, uomId: product.uomId, uomCode: product.uomCode });
      if (product.sku) {
        map.set(`sku:${product.sku.toLowerCase()}`, { id: product.id, name: product.name, sku: product.sku, uomId: product.uomId, uomCode: product.uomCode });
      }
    });
    return map;
  }, [products.data]);

  const updateItem = useCallback((index: number, patch: Partial<BatchItemDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((current) => current.filter((_, i) => i !== index));
  }, []);

  const parseBatchText = useCallback((text: string): ParsedBatchItem[] => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const results: ParsedBatchItem[] = [];

    for (const line of lines) {
      // Padrões suportados:
      // "10 Teclado modelo X"
      // "5 Monitores 24 polegadas UN"
      // "3 - Cabo HDMI 2m"
      // "2x Mouse sem fio"
      // "1 Cadeira ergonômica PC"

      let qty = 1;
      let uom: string | null = null;
      let description = line;

      // Tenta extrair quantidade no início: "10 ", "5x ", "3 - ", "2x"
      const qtyMatch = line.match(/^(\d+(?:[.,]\d+)?)\s*[xX×\-–—]?\s*(.+)$/);
      if (qtyMatch) {
        const qtyStr = qtyMatch[1] ?? "1";
        const descStr = qtyMatch[2] ?? "";
        const parsedQty = parseQuantityInput(qtyStr);
        qty = parsedQty > 0 ? parsedQty : 1;
        description = descStr.trim();
      }

      // Tenta extrair unidade no final: " 5 UN", " 10 PC", " 3 CX"
      const uomMatch = description.match(/\s+([A-Z]{1,3})$/);
      if (uomMatch) {
        const possibleUom = (uomMatch[1] ?? "").toUpperCase();
        const uomExists = (uoms.data ?? []).some((u) => u.code.toUpperCase() === possibleUom);
        if (uomExists) {
          uom = possibleUom;
          const matchLength = uomMatch[0]?.length ?? 0;
          description = description.slice(0, -matchLength).trim();
        }
      }

      results.push({ qty, uom, description });
    }

    return results;
  }, [uoms.data]);

  const matchProducts = useCallback((parsed: ParsedBatchItem[]): BatchItemDraft[] => {
    return parsed.map((p): BatchItemDraft => {
      const normalizedDesc = p.description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      // Busca exata por nome normalizado
      let product = productMap.get(`name:${normalizedDesc}`);

      // Busca parcial: tenta encontrar produto contendo as palavras-chave
      if (!product) {
        const words = normalizedDesc.split(/\s+/).filter((w) => w.length > 2);
        for (const [key, prod] of productMap.entries()) {
          if (key.startsWith("name:") && words.every((w) => key.includes(w))) {
            product = prod;
            break;
          }
        }
      }

      // Busca por SKU se a descrição parece um SKU
      if (!product && /^[A-Z0-9\-]{3,}$/i.test(p.description.trim())) {
        product = productMap.get(`sku:${p.description.trim().toLowerCase()}`);
      }

      const defaultUomId = product?.uomId ?? null;
      const defaultUomCode = product?.uomCode ?? null;
      const matchedUomId = p.uom
        ? (uoms.data ?? []).find((u) => u.code.toUpperCase() === p.uom?.toUpperCase())?.id ?? defaultUomId
        : defaultUomId;

      return {
        productId: product?.id ?? null,
        productName: product?.name ?? null,
        sku: product?.sku ?? null,
        defaultUomId,
        defaultUomCode,
        description: product ? "" : p.description,
        qty: String(p.qty),
        uomId: matchedUomId,
        notes: "",
        isFreeText: !product,
        rawLine: `${p.qty}${p.uom ? ` ${p.uom}` : ""} ${p.description}`.trim(),
      };
    });
  }, [productMap, uoms.data]);

  const handleBatchProcess = () => {
    if (!batchText.trim()) {
      setError("Cole ou digite a lista de itens antes de processar.");
      return;
    }
    setProcessingBatch(true);
    setError(null);
    try {
      const parsed = parseBatchText(batchText);
      if (parsed.length === 0) {
        setError("Nenhum item válido encontrado no texto.");
        return;
      }
      const matched = matchProducts(parsed);
      setBatchPreview(matched);
    } catch (cause) {
      setError("Erro ao processar a lista. Verifique o formato.");
      console.error(cause);
    } finally {
      setProcessingBatch(false);
    }
  };

  const handleBatchConfirm = () => {
    if (!batchPreview) return;
    setItems((current) => [...current, ...batchPreview]);
    setBatchPreview(null);
    setBatchText("");
    setShowBatchEntry(false);
  };

  const handleBatchCancel = () => {
    setBatchPreview(null);
    setBatchText("");
    setShowBatchEntry(false);
  };

  const submit = async () => {
    // Validação: justificativa obrigatória no envio
    if (submitNow && !justification.trim()) {
      setError("A justificativa da compra é obrigatória para enviar a solicitação.");
      return;
    }

    const validItems = items.filter(
      (item) => parseQuantityInput(item.qty) > 0 && Boolean(item.productId || item.description.trim())
    );
    if (validItems.length === 0) {
      setError("Inclua ao menos um item com quantidade e descrição.");
      return;
    }

    // Verifica itens com quantidade mas sem descrição
    const incomplete = items.find(
      (item) =>
        parseQuantityInput(item.qty) > 0 &&
        !item.productId &&
        item.description.trim().length === 0
    );
    if (incomplete) {
      setError("Todos os itens com quantidade devem ter descrição.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const parsed = validItems.map((item) => ({
        productId: item.productId,
        description: item.description.trim(),
        qty: parseQuantityInput(item.qty),
        uomId: item.uomId,
        notes: item.notes || null,
      }));

      const result = await apiPost<{ id: string; code: string; status: PurchaseStatus }>("/api/purchases", {
        workflowVersion: 2,
        flowRevision: 3,
        // departmentId preenchido automaticamente no backend pelo user.departmentId
        locationId: locationId || null,
        justification: justification.trim() || null,
        priority,
        desiredDate: desiredDate || null,
        notes: notes || null,
        submit: submitNow,
        items: parsed,
      });
      toast.success(
        result.status === "pending_approval"
          ? `Solicitação ${result.code} enviada para Compras.`
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
      description="Preencha os dados essenciais. O setor é identificado automaticamente pelo seu login. Condições de pagamento, centro de custo e conta contábil serão definidos pelo time de Compras nas etapas seguintes."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            {submitNow ? "Enviar para Compras" : "Salvar rascunho"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        {/* Campos principais do solicitante */}
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
          <Field label="Justificativa *" htmlFor="prJustification" className="sm:col-span-2">
            <Textarea
              id="prJustification"
              rows={2}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              placeholder="Ex.: reposição de estoque mínimo, nova demanda do setor..."
              maxLength={1000}
              required
            />
          </Field>
        </div>

        {/* Batch Entry - Entrada em lote */}
        <Card title="Itens da solicitação" description="Adicione itens um a um ou use a entrada em lote para colar sua lista completa.">
          <div className="space-y-3">
            {/* Botões de ação */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowBatchEntry(true)}
                className="whitespace-nowrap"
              >
                Entrada em lote (colar lista)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setItems((current) => [
                    ...current,
                    { productId: null, productName: null, sku: null, defaultUomId: null, defaultUomCode: null, description: "", qty: "", uomId: null, notes: "", isFreeText: true, rawLine: "" },
                  ])
                }
              >
                Adicionar item
              </Button>
            </div>

            {/* Área de entrada em lote */}
            {showBatchEntry && !batchPreview && (
              <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 space-y-3">
                <p className="text-sm text-slate-700">
                  Cole sua lista (um item por linha). Exemplos:
                </p>
                <pre className="rounded bg-slate-100 px-3 py-2 text-xs text-slate-600 overflow-x-auto">
{`10 Teclado mecânico modelo X
5 Monitores 24 polegadas UN
3 Cabo HDMI 2m
2x Mouse sem fio
1 Cadeira ergonômica PC`}
                </pre>
                <Textarea
                  rows={4}
                  value={batchText}
                  onChange={(event) => setBatchText(event.target.value)}
                  placeholder="Cole aqui sua lista de itens..."
                  aria-label="Lista de itens em lote"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={handleBatchCancel}>
                    Cancelar
                  </Button>
                  <Button size="sm" onClick={handleBatchProcess} loading={processingBatch} disabled={processingBatch}>
                    Processar lista
                  </Button>
                </div>
              </div>
            )}

            {/* Preview da entrada em lote */}
            {batchPreview && batchPreview.length > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-emerald-900">
                    {batchPreview.length} {plural(batchPreview.length, "item encontrado", "itens encontrados")} — revise e confirme
                  </p>
                  <Button variant="ghost" size="sm" onClick={handleBatchCancel}>
                    Descartar
                  </Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left">Item</th>
                        <th className="px-3 py-1.5 text-left">Catálogo</th>
                        <th className="px-3 py-1.5 text-right">Qtd</th>
                        <th className="px-3 py-1.5 text-left">Unidade</th>
                        <th className="px-3 py-1.5 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {batchPreview.map((item, index) => (
                        <tr key={index} className={item.isFreeText ? "bg-amber-50/50" : ""}>
                          <td className="px-3 py-1.5 text-slate-700">{item.productName ?? item.description}</td>
                          <td className="px-3 py-1.5 text-slate-600">
                            {item.productName ? (
                              <>
                                <span className="font-medium">{item.productName}</span>
                                {item.sku && <span className="ml-1 text-xs text-slate-400">({item.sku})</span>}
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <Input
                              value={item.qty}
                              onChange={(e) => {
                                setBatchPreview((prev) => prev ? prev.map((it, i) => i === index ? { ...it, qty: e.target.value } : it) : null);
                              }}
                              className="w-20 text-right"
                              inputMode="decimal"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <Select
                              value={item.uomId ?? ""}
                              onChange={(e) => {
                                setBatchPreview((prev) => prev ? prev.map((it, i) => i === index ? { ...it, uomId: e.target.value || null } : it) : null);
                              }}
                              className="w-full"
                            >
                              <option value="">—</option>
                              {(uoms.data ?? []).filter((u) => u.isActive).map((uom) => (
                                <option key={uom.id} value={uom.id}>{uom.code}</option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-3 py-1.5">
                            {item.isFreeText ? (
                              <Badge tone="amber" size="sm">Fora do catálogo</Badge>
                            ) : (
                              <Badge tone="green" size="sm">No catálogo</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-amber-800 flex items-center gap-1">
                  <span>⚠</span>
                  Itens "Fora do catálogo" seguem na solicitação normalmente; o cadastro será feito durante o processo de compra ou no recebimento.
                </p>
                <div className="flex justify-end">
                  <Button onClick={handleBatchConfirm}>Confirmar e adicionar</Button>
                </div>
              </div>
            )}

            {/* Lista de itens adicionados */}
            {items.length === 0 && !showBatchEntry && (
              <p className="text-sm text-slate-500 text-center py-4">
                Nenhum item adicionado. Use "Entrada em lote" ou "Adicionar item".
              </p>
            )}

            <div className="space-y-2">
              {items.map((item, index) => (
                <div key={index} className={`rounded-lg border p-3 ${!item.productId ? "border-amber-200 bg-amber-50/30" : "border-slate-100"}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Item {index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      {!item.productId && (
                        <Badge tone="amber" size="sm">Fora do catálogo</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        aria-label="Remover item"
                      >
                        Remover
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[2fr_1fr_7rem_9rem_auto]">
                    {/* Produto / Descrição */}
                    {item.productId ? (
                      <>
                        <ProductPicker
                          value={item.productId}
                          onChange={(productId, product) =>
                            updateItem(index, {
                              productId,
                              productName: product?.name ?? null,
                              sku: product?.sku ?? null,
                              defaultUomId: product?.uomId ?? null,
                              defaultUomCode: product?.uomCode ?? null,
                              uomId: product?.uomId ?? item.uomId,
                              isFreeText: false,
                            })
                          }
                          onRequestFreeText={(query) =>
                            updateItem(index, {
                              productId: null,
                              productName: null,
                              sku: null,
                              defaultUomId: null,
                              defaultUomCode: null,
                              description: query || item.description,
                              isFreeText: true,
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
                    ) : (
                      <div className="sm:col-span-2">
                        <Input
                          value={item.description}
                          onChange={(event) => updateItem(index, { description: event.target.value })}
                          placeholder="Descreva o item (marca, modelo, medidas...)"
                          aria-label={`Descrição do item ${index + 1}`}
                          maxLength={300}
                        />
                      </div>
                    )}

                    {/* Quantidade */}
                    <Input
                      value={item.qty}
                      onChange={(event) => updateItem(index, { qty: event.target.value })}
                      placeholder="Qtd."
                      inputMode="decimal"
                      aria-label={`Quantidade ${index + 1}`}
                    />

                    {/* Unidade */}
                    <Select
                      value={item.uomId ?? ""}
                      onChange={(event) => updateItem(index, { uomId: event.target.value || null })}
                      aria-label={`Unidade ${index + 1}`}
                    >
                      <option value="">Unidade...</option>
                      {(uoms.data ?? []).filter((uom) => uom.isActive).map((uom) => (
                        <option key={uom.id} value={uom.id}>{uom.code}</option>
                      ))}
                    </Select>

                    {/* Ações */}
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        aria-label="Remover item"
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

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
            <span className="font-medium">Enviar para Compras agora</span>
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
  const [triaging, setTriaging] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
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
  const isV3 = request.flowRevision === 3;
  const isV2 = request.workflowVersion === 2 && !isV3;
  const managesRequestDepartment =
    !!request.departmentId && (user?.managedDepartmentIds.includes(request.departmentId) ?? false);
  const canSubmit =
    (request.status === "draft" || request.returned) &&
    request.requesterId === user?.id &&
    can(PERMISSIONS.PURCHASES_CREATE);
  const stageAllowed =
    request.approvalStage === "triage"
      ? isV3 && (can(PERMISSIONS.PURCHASES_ORDER) || can(PERMISSIONS.PURCHASES_AUTHORIZE))
      : request.approvalStage === "manager"
        ? isV3
          ? can(PERMISSIONS.PURCHASES_APPROVE_DEPARTMENT) && managesRequestDepartment
          : can(PERMISSIONS.PURCHASES_APPROVE)
        : request.approvalStage === "direction"
          ? can(PERMISSIONS.PURCHASES_AUTHORIZE)
          : request.approvalStage === "purchasing"
            ? isV3
              ? can(PERMISSIONS.PURCHASES_AUTHORIZE) &&
                (user?.departmentIsPurchasing || can(PERMISSIONS.SETTINGS_MANAGE))
              : can(PERMISSIONS.PURCHASES_AWARD) || can(PERMISSIONS.PURCHASES_DIRECT)
            : false;
  const canTriage =
    request.status === "pending_approval" &&
    isV3 &&
    request.approvalStage === "triage" &&
    stageAllowed &&
    user?.id !== request.requesterId;
  const canDecide =
    request.status === "pending_approval" &&
    !request.returned &&
    stageAllowed &&
    user?.id !== request.requesterId &&
    (isV3 ? ["manager", "purchasing"].includes(request.approvalStage) : true);
  const canAward =
    isV2 &&
    request.status === "quote_returned" &&
    request.approvalStage === "award" &&
    can(PERMISSIONS.PURCHASES_AWARD) &&
    user?.id !== request.requesterId;
  const canOrder = isV3
    ? ["approved", "quote_approved"].includes(request.status) &&
      request.approvalStage === "buyer" &&
      can(PERMISSIONS.PURCHASES_ORDER)
    : isV2
      ? ["approved", "quote_approved"].includes(request.status) &&
        request.approvalStage === "buyer" &&
        can(PERMISSIONS.PURCHASES_ORDER)
      : ["approved", "purchasing", "quote_approved"].includes(request.status) &&
        can(PERMISSIONS.PURCHASES_ORDER);
  const canQuote = isV3
    ? request.status === "quoting" &&
      request.approvalStage === "buyer" &&
      can(PERMISSIONS.PURCHASES_ORDER)
    : isV2
      ? request.status === "quoting" && can(PERMISSIONS.PURCHASES_ORDER)
      : ["quoting", "quote_returned"].includes(request.status) && can(PERMISSIONS.PURCHASES_ORDER);
  const registeredQuotes = quotes.filter((quote) => quote.status === "registered").length;
  // Orçamento é fornecedor único; cotação exige duas propostas para comparar.
  const requiredQuotes = isV3 ? (request.purchaseMode === "budget" ? 1 : 2) : 1;
  const quoteRequirementMet = registeredQuotes >= requiredQuotes;
  const canReturnQuote =
    request.status === "quoting" &&
    request.approvalStage === "buyer" &&
    can(PERMISSIONS.PURCHASES_ORDER) &&
    registeredQuotes > 0 &&
    quoteRequirementMet;
  const canDecideQuote = isV3
    ? request.status === "quote_returned" &&
      can(PERMISSIONS.PURCHASES_AUTHORIZE) &&
      (user?.departmentIsPurchasing || can(PERMISSIONS.SETTINGS_MANAGE)) &&
      user?.id !== request.requesterId
    : !isV2 &&
      request.status === "quote_returned" &&
      can(PERMISSIONS.PURCHASES_APPROVE) &&
      user?.id !== request.requesterId;
  const approvedQuote = quotes.find((quote) => quote.status === "approved") ?? null;
  const nextStep = (() => {
    if (!isV3 || ["received", "cancelled", "rejected"].includes(request.status)) return null;
    if (request.approvalStage === "triage") {
      return {
        title: "Triagem de Compras",
        responsible: "Comprador ou analista de Compras",
        action:
          "Ajustar itens e quantidades, cadastrar produtos fora do catálogo e encaminhar ao gestor de Compras.",
      };
    }
    if (request.approvalStage === "manager") {
      return {
        title: "Aprovação do gestor do setor",
        responsible: `Gestor de ${request.departmentName ?? "seu setor"}`,
        action: "Confirmar a necessidade para enviar a Compras.",
      };
    }
    if (request.approvalStage === "purchasing") {
      return {
        title: "Aprovação do gestor de Compras",
        responsible: "Gestor ou diretor do setor de Compras",
        action:
          "Revisar itens e quantidades, definir forma de pagamento e centro de custo e liberar o comprador.",
      };
    }
    if (request.status === "quoting") {
      return {
        title: "Propostas de fornecedor",
        responsible: "Comprador",
        action:
          registeredQuotes >= requiredQuotes
            ? "Enviar as propostas para autorização de Compras."
            : `Registrar ${requiredQuotes - registeredQuotes} ${
                requiredQuotes - registeredQuotes === 1 ? "proposta" : "propostas"
              } e enviar para autorização.`,
      };
    }
    if (request.status === "quote_returned") {
      return {
        title: "Aprovação da proposta",
        responsible: "Responsável pelo setor de Compras",
        action: "Aprovar ou recusar a proposta escolhida pelo comprador.",
      };
    }
    if (["approved", "quote_approved"].includes(request.status)) {
      return {
        title: "Emissão do pedido",
        responsible: "Comprador",
        action: "Emitir o pedido ao fornecedor e acompanhar a entrega.",
      };
    }
    if (["ordered", "partially_received"].includes(request.status)) {
      return {
        title: "Recebimento e nota fiscal",
        responsible: "Responsável pelo estoque",
        action: "Conferir os itens, lançar a nota fiscal e dar entrada no estoque.",
      };
    }
    return null;
  })();
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
      toast.success("Solicitação enviada para Compras.");
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
        <Badge size="sm" tone={ITEM_STATUS_TONE[row.status]}>{PURCHASE_ITEM_STATUS_LABEL[row.status]}</Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Solicitação ${request.code}`}
        description={
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              Solicitante: <span className="font-medium text-slate-800">{request.requesterName}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              Criada em {formatDateTime(request.createdAt)}
            </p>
            {/* Badges de status principais - linha 1 */}
            <div className="flex flex-wrap items-center gap-2">
              {request.returned ? (
                <Badge tone="amber">Devolvida ao solicitante</Badge>
              ) : (
                <Badge tone={PURCHASE_STATUS_TONE[request.status]}>{PURCHASE_STATUS_LABEL[request.status]}</Badge>
              )}
              {request.departmentName ? <Badge tone="brand">{request.departmentName}</Badge> : null}
              {isV3 ? (
                <Badge tone="violet">
                  Etapa:{" "}
                  {request.status === "quote_returned"
                    ? "Aprovação da proposta"
                    : PURCHASE_APPROVAL_STAGE_LABEL[
                        request.approvalStage as keyof typeof PURCHASE_APPROVAL_STAGE_LABEL
                      ] ?? request.approvalStage}
                </Badge>
              ) : isV2 ? (
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
            </div>
            {/* Badges informativos secundários - linha 2 */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {request.purchaseMode ? (
                <Badge tone={request.purchaseMode === "direct" ? "amber" : "slate"} size="sm">
                  {PURCHASE_MODE_SHORT_LABEL[request.purchaseMode]}
                </Badge>
              ) : null}
              {request.paymentMethodName ? (
                <Badge tone="slate" size="sm">Pagamento: {request.paymentMethodName}</Badge>
              ) : null}
              {request.costCenterCode ? (
                <Badge tone="slate" size="sm">
                  {request.costCenterCode} - {request.costCenterName}
                </Badge>
              ) : null}
              {request.desiredDate ? (
                <Badge tone="slate" size="sm">Desejada para {formatDate(request.desiredDate)}</Badge>
              ) : null}
            </div>
          </div>
        }
        actions={
          <>
            <Link to="/compras">
              <Button variant="secondary">Voltar</Button>
            </Link>
            {canSubmit && !request.returned ? (
              <Button onClick={() => void submitForApproval()}>Enviar para Compras</Button>
            ) : null}
            {canTriage ? (
              <Button onClick={() => setTriaging(true)}>Fazer triagem</Button>
            ) : null}
            {canDecide ? (
              <Button onClick={() => setDeciding(true)}>
                {request.approvalStage === "manager"
                  ? "Analisar necessidade"
                  : request.approvalStage === "direction"
                    ? "Analisar orçamento"
                    : "Aprovar compra"}
              </Button>
            ) : null}
            {canQuote ? (
              <Button variant="secondary" onClick={() => setQuoting(true)}>
                Registrar proposta
              </Button>
            ) : null}
            {canReturnQuote ? (
              <Button onClick={() => void returnQuote()} loading={returningQuote}>
                {isV3 ? "Enviar para autorização de Compras" : "Devolver para adjudicação"}
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

      {request.returned ? (
        <Alert tone="amber" title="Devolvida para ajuste">
          <p>
            {request.returnedByName ?? "Compras"} devolveu esta solicitação em{" "}
            {request.returnedAt ? formatDateTime(request.returnedAt) : "—"} para que você ajuste os dados e reenvie.
          </p>
          {request.returnedReason ? (
            <p className="mt-1 whitespace-pre-line font-medium text-amber-900">{request.returnedReason}</p>
          ) : null}
          {request.requesterId === user?.id && can(PERMISSIONS.PURCHASES_CREATE) ? (
            <div className="mt-2">
              <Button size="sm" onClick={() => setAdjusting(true)}>
                Ajustar e reenviar
              </Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {nextStep && !request.returned ? (
        <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50/70 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Próxima etapa</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-slate-900">{nextStep.title}</p>
            <p className="text-xs text-slate-600">Responsável: {nextStep.responsible}</p>
          </div>
          <p className="mt-1 text-sm text-slate-700">{nextStep.action}</p>
          {request.justification ? (
            <p className="mt-2 whitespace-pre-line border-t border-brand-100 pt-2 text-sm text-slate-700">
              <span className="font-medium text-slate-900">Justificativa: </span>
              {request.justification}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {isV2 || isV3 ? (
            <Card title="Fluxo da compra">
              <WorkflowProgress request={request} />
            </Card>
          ) : null}

          <Card padded={false} title="Itens da solicitação">
            <Table
              dense
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
                  {isV3 ? (
                    <>
                      {registeredQuotes} de {requiredQuotes}{" "}
                      {plural(requiredQuotes, "proposta necessária", "propostas necessárias")} registrada
                      {registeredQuotes === 1 ? "" : "s"}.
                      {!quoteRequirementMet
                        ? request.purchaseMode === "direct"
                          ? " A compra direta não usa cotação; o comprador emite o pedido."
                          : ` Registre mais ${requiredQuotes - registeredQuotes} ${
                              requiredQuotes - registeredQuotes === 1 ? "proposta" : "propostas"
                            } para enviar a autorização.`
                        : " Envie para autorização do responsável de Compras."}
                    </>
                  ) : request.quoteItemCount > 0 ? (
                    `${request.quoteItemCount} ${plural(request.quoteItemCount, "item marcado", "itens marcados")} para cotação.`
                  ) : (
                    "Registre as propostas de fornecedor e devolva ao gestor para aprovação."
                  )}
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
                        <div className="mt-2 overflow-x-auto rounded-md border border-slate-100">
                          <table className="w-full min-w-[520px] text-sm">
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
                          {receipt.invoiceNumber
                            ? ` · NF ${receipt.invoiceNumber}${receipt.invoiceSeries ? `/${receipt.invoiceSeries}` : ""}`
                            : receipt.documentRef
                              ? ` · doc. ${receipt.documentRef}`
                              : ""}
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

        <div className="min-w-0 space-y-5">
          <Card title="Ficha da solicitação">
            <dl className="space-y-3 text-sm">
              <InfoRow label="Solicitante" value={request.requesterName} />
              <InfoRow label="Local" value={request.locationDeleted ? entityName(request.locationName, true) : request.locationPath ?? request.locationName ?? "-"} />
              {isV3 ? (
                <>
                  <InfoRow label="Setor" value={request.departmentName ?? "-"} />
                  <InfoRow
                    label="Modo de compra"
                    value={request.purchaseMode ? PURCHASE_MODE_SHORT_LABEL[request.purchaseMode] : "A definir por Compras"}
                  />
                  <InfoRow label="Forma de pagamento" value={request.paymentMethodName ?? "-"} />
                  {request.paymentTerms ? <InfoRow label="Condições de pagamento" value={request.paymentTerms} /> : null}
                  {request.purchasingAuthorizedAt ? (
                    <InfoRow
                      label="Autorização de Compras"
                      value={`${request.purchasingAuthorizedByName ?? "-"} em ${formatDateTime(
                        request.purchasingAuthorizedAt,
                      )}`}
                    />
                  ) : null}
                </>
              ) : null}
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
                  label={isV3 ? "Aprovação de Compras" : "Decisão"}
                  value={
                    isV3
                      ? `Aprovada por ${request.approvedByName ?? "-"} em ${formatDateTime(request.approvedAt)}${
                          request.approvalNotes ? ` — ${request.approvalNotes}` : ""
                        }`
                      : `${PURCHASE_STATUS_LABEL[request.status]} por ${request.approvedByName ?? "-"} em ${formatDateTime(
                          request.approvedAt,
                        )}${request.approvalNotes ? ` — ${request.approvalNotes}` : ""}`
                  }
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

      {triaging ? (
        <TriageDialog
          request={request}
          items={items}
          onClose={() => setTriaging(false)}
          onSaved={() => {
            setTriaging(false);
            state.reload();
          }}
        />
      ) : null}

      {adjusting ? (
        <AdjustReturnedDialog
          request={request}
          items={items}
          onClose={() => setAdjusting(false)}
          onSaved={() => {
            setAdjusting(false);
            state.reload();
          }}
        />
      ) : null}

      {deciding ? (
        request.workflowVersion === 2 ? (
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
        request.workflowVersion === 2 ? (
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
  const isV3 = request.flowRevision === 3;
  const standard = request.routing !== "direct_to_purchasing";
  const steps = isV3
    ? [
        { key: "sent", label: "Solicitação" },
        { key: "triage", label: "Triagem" },
        { key: "purchasing", label: "Aprovação de Compras" },
        { key: "buyer", label: "Comprador" },
        { key: "receipt", label: "Recebimento" },
      ]
    : [
        { key: "manager", label: "Gestor do setor" },
        ...(standard ? [{ key: "direction", label: "Direção" }] : []),
        { key: "purchasing", label: "Compras" },
        { key: "buyer", label: "Comprador" },
        { key: "receipt", label: "Recebimento" },
      ];
  const stageOrder: Record<string, number> = isV3
    ? {
        manager: 1,
        purchasing: 2,
        buyer: 3,
        award: 3,
        receipt: 4,
        completed: steps.length,
      }
    : {
        manager: 0,
        direction: standard ? 1 : 0,
        purchasing: standard ? 2 : 1,
        buyer: standard ? 3 : 2,
        award: standard ? 3 : 2,
        receipt: standard ? 4 : 3,
        completed: steps.length,
      };
  const current = request.status === "draft" ? 0 : stageOrder[request.approvalStage] ?? 0;

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

/* -------------------------------------------------------------------------- */
/* Triagem de compras (v3)                                                    */
/* -------------------------------------------------------------------------- */

interface TriageDraft {
  itemId: string;
  label: string;
  productId: string;
  description: string;
  qty: string;
  uomId: string;
  remove: boolean;
}

/** Aceita "1.000,5" (pt-BR), "1000.5" e "10,5". */
function parseQuantityInput(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  return Number(normalized);
}

function TriageDialog({
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
  const { can } = useSession();
  const uoms = useUoms();
  const categories = useCategories();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState<"forward" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<TriageDraft[]>(() =>
    items
      .filter((item) => !["received", "cancelled", "rejected"].includes(item.status))
      .map((item) => ({
        itemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        productId: item.productId ?? "",
        description: item.description ?? "",
        qty: formatQuantity(item.qtyMilli, 3),
        uomId: item.uomId ?? "",
        remove: false,
      })),
  );
  const [registering, setRegistering] = useState<string | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUomId, setNewUomId] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newSku, setNewSku] = useState("");

  const canManageCatalog = can(PERMISSIONS.CATALOG_MANAGE);
  const defaultUomId = uoms.data?.find((uom) => uom.code === "UN")?.id ?? uoms.data?.[0]?.id ?? "";

  const patchDraft = (itemId: string, patch: Partial<TriageDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.itemId === itemId ? { ...draft, ...patch } : draft)),
    );
  };

  const startRegistration = (draft: TriageDraft, query?: string) => {
    setRegistering(draft.itemId);
    setNewName((query ?? draft.description ?? draft.label).trim());
    setNewUomId(draft.uomId || defaultUomId);
    setNewCategoryId("");
    setNewSku("");
    setError(null);
  };

  const createProduct = async (itemId: string) => {
    const name = newName.trim();
    if (name.length < 2) {
      setError("Informe o nome do produto.");
      return;
    }
    if (!newUomId) {
      setError("Selecione a unidade de medida do produto.");
      return;
    }
    setCreatingProduct(true);
    setError(null);
    try {
      const created = await apiPost<{ id: string }>("/api/catalog/products", {
        name,
        sku: newSku.trim() || null,
        categoryId: newCategoryId || null,
        uomId: newUomId,
        tracksStock: true,
      });
      patchDraft(itemId, { productId: created.id, uomId: newUomId });
      setRegistering(null);
      toast.success("Produto cadastrado no catálogo.");
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setCreatingProduct(false);
    }
  };

  const submit = async (decision: "forward" | "rejected") => {
    setError(null);
    if (decision === "rejected") {
      if (notes.trim().length < 5) {
        setError("Explique o motivo da recusa (mínimo de 5 caracteres).");
        return;
      }
      setSaving("rejected");
      try {
        await apiPost(`/api/purchases/${request.id}/decide`, {
          decision: "rejected",
          notes: notes.trim(),
        });
        toast.success("Solicitação recusada na triagem.");
        onSaved();
      } catch (cause) {
        setError(apiErrorMessage(cause));
      } finally {
        setSaving(null);
      }
      return;
    }

    const active = drafts.filter((draft) => !draft.remove);
    if (active.length === 0) {
      setError("Mantenha ao menos um item ativo na solicitação.");
      return;
    }
    for (const draft of active) {
      const qty = parseQuantityInput(draft.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Informe uma quantidade maior que zero para ${draft.label}.`);
        return;
      }
      if (!draft.productId && !draft.description.trim()) {
        setError(`Vincule um produto do catálogo ou descreva ${draft.label}.`);
        return;
      }
    }

    setSaving("forward");
    try {
      await apiPost(`/api/purchases/${request.id}/decide`, {
        decision: "forward",
        notes: notes.trim() || null,
        items: drafts.map((draft) =>
          draft.remove
            ? { itemId: draft.itemId, remove: true }
            : {
                itemId: draft.itemId,
                qty: parseQuantityInput(draft.qty),
                description: draft.description.trim() || null,
                productId: draft.productId || null,
                uomId: draft.uomId || null,
              },
        ),
      });
      toast.success("Triagem concluída. A solicitação foi para o gestor de Compras.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog
      open
      wide
      title={`Triagem de ${request.code}`}
      description="Ajuste os itens à necessidade real e ao catálogo. Ao encaminhar, a solicitação segue para o gestor de Compras definir pagamento e centro de custo."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit("rejected")}
            loading={saving === "rejected"}
            disabled={saving === "forward"}
          >
            Recusar
          </Button>
          <Button
            onClick={() => void submit("forward")}
            loading={saving === "forward"}
            disabled={saving === "rejected"}
          >
            Encaminhar ao gestor
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        <div className="rounded-lg border border-brand-100 bg-brand-50/70 p-3 text-sm text-brand-900">
          <p className="font-medium">O que a triagem pode fazer</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li>Corrigir nome, descrição, quantidade e unidade dos itens.</li>
            <li>Vincular itens fora do catálogo a um produto existente ou cadastrar um produto novo.</li>
            <li>Remover itens que não fazem parte da compra. A solicitação precisa manter ao menos um item.</li>
          </ul>
        </div>

        {drafts.map((draft) => (
          <div
            key={draft.itemId}
            className={`rounded-lg border p-3 ${
              draft.remove ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{draft.label}</p>
                <p className="text-xs text-slate-500">
                  {draft.productId ? "Vinculado ao catálogo" : "Fora do catálogo — descreva ou cadastre o produto"}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                  checked={!draft.remove}
                  onChange={(event) => patchDraft(draft.itemId, { remove: !event.target.checked })}
                />
                Manter item
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_130px]">
              <Field label="Produto do catálogo" htmlFor={`triageProduct-${draft.itemId}`}>
                <ProductPicker
                  id={`triageProduct-${draft.itemId}`}
                  value={draft.productId}
                  onChange={(productId, product) =>
                    patchDraft(draft.itemId, {
                      productId,
                      ...(product ? { uomId: product.uomId } : {}),
                    })
                  }
                  onRequestFreeText={
                    canManageCatalog ? (query) => startRegistration(draft, query) : undefined
                  }
                  disabled={draft.remove}
                />
              </Field>
              <Field label="Quantidade" htmlFor={`triageQty-${draft.itemId}`}>
                <Input
                  id={`triageQty-${draft.itemId}`}
                  value={draft.qty}
                  onChange={(event) => patchDraft(draft.itemId, { qty: event.target.value })}
                  inputMode="decimal"
                  disabled={draft.remove}
                />
              </Field>
              <Field label="Unidade" htmlFor={`triageUom-${draft.itemId}`}>
                <Select
                  id={`triageUom-${draft.itemId}`}
                  value={draft.uomId}
                  onChange={(event) => patchDraft(draft.itemId, { uomId: event.target.value })}
                  disabled={draft.remove}
                >
                  <option value="">Selecione...</option>
                  {(uoms.data ?? []).map((uom) => (
                    <option key={uom.id} value={uom.id}>
                      {uom.code} — {uom.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-3">
              <Field label="Descrição / nome do item" htmlFor={`triageDesc-${draft.itemId}`}>
                <Input
                  id={`triageDesc-${draft.itemId}`}
                  value={draft.description}
                  onChange={(event) => patchDraft(draft.itemId, { description: event.target.value })}
                  placeholder="Ex.: detergente neutro 500 ml"
                  maxLength={300}
                  disabled={draft.remove}
                />
              </Field>
            </div>

            {!draft.remove && canManageCatalog && registering === draft.itemId ? (
              <div className="mt-3 rounded-md border border-brand-200 bg-brand-50/60 p-3">
                <p className="text-sm font-medium text-slate-800">Cadastrar produto no catálogo</p>
                <p className="mb-2 text-xs text-slate-600">
                  O cadastro é permanente e ficará disponível para as próximas compras.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nome do produto" htmlFor={`newProductName-${draft.itemId}`}>
                    <Input
                      id={`newProductName-${draft.itemId}`}
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      maxLength={160}
                    />
                  </Field>
                  <Field label="Unidade de medida" htmlFor={`newProductUom-${draft.itemId}`}>
                    <Select
                      id={`newProductUom-${draft.itemId}`}
                      value={newUomId}
                      onChange={(event) => setNewUomId(event.target.value)}
                    >
                      <option value="">Selecione...</option>
                      {(uoms.data ?? []).map((uom) => (
                        <option key={uom.id} value={uom.id}>
                          {uom.code} — {uom.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Categoria (opcional)" htmlFor={`newProductCategory-${draft.itemId}`}>
                    <Select
                      id={`newProductCategory-${draft.itemId}`}
                      value={newCategoryId}
                      onChange={(event) => setNewCategoryId(event.target.value)}
                    >
                      <option value="">Sem categoria</option>
                      {(categories.data ?? []).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="SKU (opcional)" htmlFor={`newProductSku-${draft.itemId}`}>
                    <Input
                      id={`newProductSku-${draft.itemId}`}
                      value={newSku}
                      onChange={(event) => setNewSku(event.target.value)}
                      maxLength={40}
                    />
                  </Field>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setRegistering(null)}>
                    Cancelar cadastro
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void createProduct(draft.itemId)}
                    loading={creatingProduct}
                  >
                    Salvar produto
                  </Button>
                </div>
              </div>
            ) : !draft.remove && canManageCatalog ? (
              <div className="mt-2 flex justify-end">
                <Button variant="secondary" size="sm" onClick={() => startRegistration(draft)}>
                  Cadastrar produto no catálogo
                </Button>
              </div>
            ) : null}
          </div>
        ))}

        <Field
          label="Observação da triagem"
          hint="Explique ajustes, itens removidos ou oriente o gestor de Compras."
          htmlFor="triageNotes"
        >
          <Textarea
            id="triageNotes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ex.: item 2 ajustado para a embalagem de 5 L; item 3 removido por já existir em estoque."
          />
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Ajuste de uma solicitação devolvida pelo gestor de Compras.
 *
 * O solicitante corrige o cabeçalho e os itens; ao salvar, a solicitação é
 * reenviada automaticamente e volta para a fila do gestor (se a triagem já
 * tinha sido concluída) — exatamente o ajuste fino pedido no fluxo.
 */
function AdjustReturnedDialog({
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
  const uoms = useUoms();
  const [locationId, setLocationId] = useState(request.locationId ?? "");
  const [justification, setJustification] = useState(request.justification ?? "");
  const [priority, setPriority] = useState<Priority>(request.priority);
  const [desiredDate, setDesiredDate] = useState(request.desiredDate ?? "");
  const [notes, setNotes] = useState(request.notes ?? "");
  const [drafts, setDrafts] = useState(() =>
    items.map((item) => ({
      key: item.id,
      productId: item.productId ?? "",
      description: item.description ?? item.productName ?? "",
      qty: String(item.qtyMilli / 1000).replace(".", ","),
      uomId: item.uomId ?? "",
      notes: item.notes ?? "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (index: number, values: Partial<(typeof drafts)[number]>) =>
    setDrafts((current) => current.map((item, i) => (i === index ? { ...item, ...values } : item)));

  const save = async () => {
    setError(null);
    if (justification.trim().length === 0) {
      setError("A justificativa é obrigatória para reenviar a solicitação.");
      return;
    }
    const parsed = drafts.map((item) => ({
      productId: item.productId || null,
      description: item.description.trim() || null,
      qty: Number(item.qty.replace(",", ".")),
      uomId: item.uomId || null,
      notes: item.notes.trim() || null,
    }));
    if (parsed.length === 0) {
      setError("Inclua ao menos um item.");
      return;
    }
    if (parsed.some((item) => !Number.isFinite(item.qty) || item.qty <= 0)) {
      setError("Informe uma quantidade maior que zero em todos os itens.");
      return;
    }
    if (parsed.some((item) => !item.productId && !item.description)) {
      setError("Cada item precisa de um produto do catálogo ou de uma descrição.");
      return;
    }

    setSaving(true);
    try {
      await apiPut(`/api/purchases/${request.id}/items`, { items: parsed });
      await apiPatch(`/api/purchases/${request.id}`, {
        locationId: locationId || null,
        justification: justification.trim(),
        priority,
        desiredDate: desiredDate || null,
        notes: notes.trim() || null,
      });
      await apiPost(`/api/purchases/${request.id}/submit`, {});
      toast.success("Solicitação ajustada e reenviada para o gestor de Compras.");
      onSaved();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={`Ajustar solicitação ${request.code}`}
      description="Corrija o que foi apontado e reenvie. O histórico da devolução permanece na auditoria."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Salvar e reenviar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Local de destino" htmlFor="adjLocation">
            <Select id="adjLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Sem local específico</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data desejada" htmlFor="adjDesired">
            <Input
              id="adjDesired"
              type="date"
              value={desiredDate}
              onChange={(event) => setDesiredDate(event.target.value)}
            />
          </Field>
          <Field label="Prioridade" htmlFor="adjPriority">
            <Select
              id="adjPriority"
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
          <Field label="Justificativa *" htmlFor="adjJustification" className="sm:col-span-2">
            <Textarea
              id="adjJustification"
              rows={2}
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              maxLength={1000}
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Itens</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  {
                    key: `new-${Date.now()}-${current.length}`,
                    productId: "",
                    description: "",
                    qty: "1",
                    uomId: "",
                    notes: "",
                  },
                ])
              }
            >
              Adicionar item
            </Button>
          </div>
          <div className="space-y-2">
            {drafts.map((item, index) => (
              <div key={item.key} className="rounded-lg border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_90px_110px_auto]">
                  <ProductPicker
                    value={item.productId}
                    onChange={(productId, product) =>
                      patch(index, {
                        productId,
                        description: product?.name ?? drafts[index]?.description ?? "",
                        uomId: drafts[index]?.uomId || product?.uomId || "",
                      })
                    }
                    ariaLabel={`Produto do item ${index + 1}`}
                  />
                  <Input
                    value={item.qty}
                    onChange={(event) => patch(index, { qty: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Quantidade do item ${index + 1}`}
                  />
                  <Select
                    value={item.uomId}
                    onChange={(event) => patch(index, { uomId: event.target.value })}
                    aria-label={`Unidade do item ${index + 1}`}
                  >
                    <option value="">Unidade</option>
                    {(uoms.data ?? []).map((uom) => (
                      <option key={uom.id} value={uom.id}>
                        {uom.code}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}
                    disabled={drafts.length === 1}
                  >
                    Remover
                  </Button>
                </div>
                {!item.productId ? (
                  <Input
                    className="mt-2"
                    value={item.description}
                    onChange={(event) => patch(index, { description: event.target.value })}
                    placeholder="Descrição do item fora do catálogo"
                    aria-label={`Descrição do item ${index + 1}`}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <Field label="Observações" htmlFor="adjNotes">
          <Textarea id="adjNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
        </Field>
      </div>
    </Dialog>
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
  const isV3 = request.flowRevision === 3;
  const options = isV3
    ? stage === "manager"
      ? [
          { value: "approved", label: "Aprovar e enviar ao setor de Compras" },
          { value: "rejected", label: "Recusar solicitação" },
        ]
      : [
          { value: "approved", label: "Autorizar a compra e liberar o comprador" },
          { value: "request_alignment", label: "Solicitar alinhamento ao solicitante" },
          { value: "return_to_requester", label: "Devolver ao solicitante para ajuste" },
          { value: "rejected", label: "Recusar solicitação" },
        ]
    : stage === "manager"
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
  const optionsData = useAsync(
    () => (isV3 && stage === "purchasing" ? apiGet<PurchaseOptions>("/api/purchases/options") : Promise.resolve(null)),
    [isV3, stage],
  );
  const [purchaseMode, setPurchaseMode] = useState<"quote" | "budget" | "direct">(
    request.purchaseMode ?? "quote",
  );
  const defaultItemMode: "quote" | "direct" = purchaseMode === "direct" ? "direct" : "quote";
  const [paymentMethodId, setPaymentMethodId] = useState(request.paymentMethodId ?? "");
  const [paymentTerms, setPaymentTerms] = useState(request.paymentTerms ?? "");
  const [costCenterId, setCostCenterId] = useState(request.costCenterId ?? "");
  const [glAccount, setGlAccount] = useState(request.glAccount ?? "");
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState(() =>
    items
      .filter((item) => !["received", "cancelled", "rejected"].includes(item.status))
      .map((item) => ({
        itemId: item.id,
        label: item.productName ?? item.description ?? "Item",
        description: item.description ?? "",
        requestedMilli: item.qtyMilli,
        approved: true,
        qtyApproved: formatQuantity(item.qtyApprovedMilli ?? item.qtyMilli, 3),
        mode: item.purchaseMode ?? defaultItemMode,
        notes: item.notes ?? "",
        uomCode: item.uomCode ?? "",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changePurchaseMode = (next: "quote" | "budget" | "direct") => {
    setPurchaseMode(next);
    // O destino de cada item acompanha a escolha do modo de compra; o gestor
    // ainda pode ajustar item a item depois.
    const itemMode = next === "direct" ? "direct" : "quote";
    setDrafts((current) => current.map((draft) => ({ ...draft, mode: itemMode })));
  };
  const editItems = isV3
    ? stage === "purchasing" && decision === "approved"
    : stage === "manager" || stage === "direction";
  const selectedPayment = (optionsData.data?.paymentMethods ?? []).find(
    (method) => method.id === paymentMethodId,
  );

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isV3 && stage === "purchasing" && decision === "approved") {
        if (!paymentMethodId) {
          setError("Escolha a forma de pagamento antes de autorizar.");
          setSaving(false);
          return;
        }
        if (purchaseMode === "direct" && selectedPayment?.requiresQuote) {
          setError("A forma de pagamento selecionada exige cotação ou orçamento.");
          setSaving(false);
          return;
        }
      }
      if (isV3 && stage === "purchasing" && decision === "request_alignment" && notes.trim().length < 5) {
        setError("Descreva o que precisa ser alinhado com o solicitante (mínimo 5 caracteres).");
        setSaving(false);
        return;
      }
      if (isV3 && decision === "return_to_requester" && notes.trim().length < 5) {
        setError("Explique o que o solicitante precisa ajustar (mínimo 5 caracteres).");
        setSaving(false);
        return;
      }
      const payload: Record<string, unknown> = { decision, notes: notes || null };
      if (isV3 && stage === "purchasing" && decision === "approved") {
        payload.purchaseMode = purchaseMode;
        payload.paymentMethodId = paymentMethodId || null;
        payload.paymentTerms = paymentTerms || null;
        payload.costCenterId = costCenterId || null;
        payload.glAccount = glAccount.trim() || null;
      }
      if (editItems && drafts.length > 0) {
        const invalid = drafts.find((draft) => {
          if (!draft.approved) return false;
          const value = parseQuantityInput(draft.qtyApproved);
          return !Number.isFinite(value) || value <= 0;
        });
        if (invalid) {
          setError(`Informe uma quantidade aprovada maior que zero para ${invalid.label}.`);
          setSaving(false);
          return;
        }
        payload.items = drafts.map((draft) => ({
          itemId: draft.itemId,
          status: draft.approved ? "approved" : "rejected",
          qtyApproved: draft.approved ? parseQuantityInput(draft.qtyApproved) : undefined,
          purchaseMode: draft.approved ? draft.mode : undefined,
          description: draft.description.trim() || null,
          notes: draft.notes.trim() || null,
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
        {isV3 && stage === "purchasing" && decision === "approved" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Como comprar"
              hint="Cotação exige 2 propostas; orçamento aceita 1; compra direta dispensa proposta. O destino dos itens acompanha esta escolha; ajuste item a item se precisar."
              htmlFor="decisionMode"
            >
              <Select
                id="decisionMode"
                value={purchaseMode}
                onChange={(event) =>
                  changePurchaseMode(event.target.value as "quote" | "budget" | "direct")
                }
              >
                <option value="quote">Cotação — comparar fornecedores</option>
                <option value="budget">Orçamento — fornecedor único</option>
                <option value="direct" disabled={selectedPayment?.requiresQuote}>
                  Compra direta — sem cotação
                </option>
              </Select>
            </Field>
            <Field
              label="Forma de pagamento"
              hint={selectedPayment?.requiresQuote ? "Exige cotação ou orçamento." : "Confirme a forma negociada."}
              htmlFor="decisionPayment"
            >
              <Select
                id="decisionPayment"
                value={paymentMethodId}
                onChange={(event) => {
                  const next = event.target.value;
                  setPaymentMethodId(next);
                  const method = (optionsData.data?.paymentMethods ?? []).find((item) => item.id === next);
                  if (method?.requiresQuote && purchaseMode === "direct") setPurchaseMode("quote");
                }}
              >
                <option value="">Selecione...</option>
                {(optionsData.data?.paymentMethods ?? []).map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condições de pagamento" htmlFor="decisionTerms">
              <Input
                id="decisionTerms"
                value={paymentTerms}
                onChange={(event) => setPaymentTerms(event.target.value)}
                placeholder="Ex.: 30 dias após a nota fiscal"
                maxLength={300}
              />
            </Field>
            <Field
              label="Centro de custo"
              hint="Rateio financeiro da compra; pode ser ajustado antes de liberar."
              htmlFor="decisionCostCenter"
            >
              <Select
                id="decisionCostCenter"
                value={costCenterId}
                onChange={(event) => setCostCenterId(event.target.value)}
              >
                <option value="">Não definido</option>
                {(optionsData.data?.costCenters ?? []).map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.code} - {center.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Conta contábil (GL)" hint="Opcional; usada na integração contábil." htmlFor="decisionGl">
              <Input
                id="decisionGl"
                value={glAccount}
                onChange={(event) => setGlAccount(event.target.value)}
                placeholder="Ex.: 4.02.001"
                maxLength={40}
              />
            </Field>
          </div>
        ) : null}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          {isV3
            ? stage === "manager"
              ? "Você confirma a necessidade do seu setor. A solicitação segue para a triagem do comprador e depois para o gestor de Compras."
              : "Ajuste itens e quantidades, escolha como comprar, confirme a forma de pagamento e o centro de custo. Se faltar informação, solicite alinhamento ao solicitante sem sair da etapa. A aprovação libera o comprador."
            : stage === "manager"
              ? "O gestor confirma a necessidade. A Direção fará a análise de orçamento antes de Compras."
              : stage === "direction"
                ? "A Direção confere o centro de custo e o orçamento. A aprovação libera a cotação/compra."
                : "A triagem de Compras pode autorizar compra direta ou devolver à Direção para análise de orçamento."}
        </div>
        {editItems ? (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Solicitado</th>
                  <th className="px-3 py-2 text-right font-medium">Aprovado</th>
                  <th className="px-3 py-2 text-left font-medium">Destino</th>
                  <th className="px-3 py-2 text-left font-medium">Observação</th>
                  <th className="px-3 py-2 text-center font-medium">Incluir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drafts.map((draft) => (
                  <tr key={draft.itemId}>
                    <td className="px-3 py-2 text-slate-700">
                      <p className="font-medium text-slate-800">{draft.label}</p>
                      <Input
                        value={draft.description}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId
                                ? { ...entry, description: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        className="mt-1 h-8 text-xs"
                        placeholder="Descrição / complemento"
                        maxLength={300}
                        aria-label={`Descrição de ${draft.label}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {formatQuantity(draft.requestedMilli)} {draft.uomCode}
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
                    <td className="px-3 py-2">
                      <Input
                        value={draft.notes}
                        onChange={(event) =>
                          setDrafts((current) =>
                            current.map((entry) =>
                              entry.itemId === draft.itemId
                                ? { ...entry, notes: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        className="w-40"
                        placeholder="Opcional"
                        maxLength={500}
                        aria-label={`Observação de ${draft.label}`}
                      />
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
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[560px] text-sm">
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
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[560px] text-sm">
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
          qtyApproved: draft.approved ? parseQuantityInput(draft.qtyApproved) : undefined,
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
  const options = useAsync(() => apiGet<PurchaseOptions>("/api/purchases/options"), []);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(request.paymentMethodId ?? "");
  const [paymentTerms, setPaymentTerms] = useState(request.paymentTerms ?? "");
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
        paymentMethodId: paymentMethodId || null,
        paymentTerms: paymentTerms || null,
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

        {request.flowRevision === 3 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Forma de pagamento desta proposta"
              hint="Pode confirmar ou ajustar a forma definida na solicitação."
              htmlFor="quotePayment"
            >
              <Select
                id="quotePayment"
                value={paymentMethodId}
                onChange={(event) => setPaymentMethodId(event.target.value)}
              >
                <option value="">Selecione...</option>
                {(options.data?.paymentMethods ?? []).map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condições de pagamento" htmlFor="quoteTerms">
              <Input
                id="quoteTerms"
                value={paymentTerms}
                onChange={(event) => setPaymentTerms(event.target.value)}
                placeholder="Ex.: 28 dias após a nota fiscal"
                maxLength={300}
              />
            </Field>
          </div>
        ) : null}

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
  /** Produto existente escolhido para normalizar um item fora do catálogo. */
  productId: string;
  /** Item sem produto no catálogo: recebe aqui o cadastro rápido. */
  newProduct: boolean;
  newProductName: string;
  newProductUomId: string;
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
  const uoms = useUoms();
  const [locationId, setLocationId] = useState(request.locationId ?? "");
  const [documentRef, setDocumentRef] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceSeries, setInvoiceSeries] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceTotal, setInvoiceTotal] = useState("");
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
        productId: "",
        newProduct: !item.productId,
        newProductName: item.description ?? "",
        newProductUomId: item.uomId ?? "",
      })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-receipt-${crypto.randomUUID()}`);

  const updateDraft = (itemId: string, patch: Partial<ReceiptDraft>) => {
    setDrafts((current) => current.map((draft) => (draft.requestItemId === itemId ? { ...draft, ...patch } : draft)));
  };

  const chosen = useMemo(
    () => drafts.filter((draft) => draft.include && parseQuantityInput(draft.receivedQty) > 0),
    [drafts],
  );
  const directUseChosen = useMemo(() => chosen.filter((draft) => draft.directUse), [chosen]);

  const submit = async () => {
    if (!locationId) {
      setError("Informe o local de destino do material recebido.");
      return;
    }
    if (request.flowRevision === 3) {
      if (!invoiceNumber.trim()) {
        setError("Informe o número da nota fiscal do fornecedor.");
        return;
      }
      if (!invoiceDate) {
        setError("Informe a data da nota fiscal.");
        return;
      }
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
      (draft) => !draft.productId && draft.newProduct && draft.newProductName.trim().length < 2,
    );
    if (missingProductName) {
      setError(
        `Vincule um produto existente ou informe o nome do produto para o item ${missingProductName.label}.`,
      );
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
        invoiceNumber: invoiceNumber || null,
        invoiceSeries: invoiceSeries || null,
        invoiceDate: invoiceDate || null,
        invoiceTotal: invoiceTotal ? parseQuantityInput(invoiceTotal) : undefined,
        notes: notes || null,
        directUseReason: directUseChosen.length > 0 ? directUseReason.trim() : null,
        items: chosen.map((draft) => ({
          requestItemId: draft.requestItemId,
          receivedQty: parseQuantityInput(draft.receivedQty),
          unitPrice: draft.unitPrice ? parseQuantityInput(draft.unitPrice) : undefined,
          hasDiscrepancy: draft.hasDiscrepancy,
          discrepancyNote: draft.discrepancyNote || null,
          directUse: draft.directUse,
          productId: draft.productId || undefined,
          newProduct:
            !draft.productId && draft.newProduct
              ? {
                  name: draft.newProductName.trim(),
                  uomId: draft.newProductUomId || null,
                }
              : undefined,
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
          <Field label="Documento" hint="Romaneio, protocolo ou referência interna." htmlFor="receiptDoc">
            <Input id="receiptDoc" value={documentRef} onChange={(event) => setDocumentRef(event.target.value)} />
          </Field>
          {request.flowRevision === 3 ? (
            <>
              <Field label="Nota fiscal" required hint="Número da NF do fornecedor." htmlFor="receiptInvoice">
                <Input
                  id="receiptInvoice"
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  maxLength={60}
                />
              </Field>
              <Field label="Série" hint="Opcional." htmlFor="receiptInvoiceSeries">
                <Input
                  id="receiptInvoiceSeries"
                  value={invoiceSeries}
                  onChange={(event) => setInvoiceSeries(event.target.value)}
                  maxLength={20}
                />
              </Field>
              <Field label="Data da nota" required htmlFor="receiptInvoiceDate">
                <Input
                  id="receiptInvoiceDate"
                  type="date"
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                />
              </Field>
              <Field label="Total da nota (R$)" hint="Opcional; confira contra os itens." htmlFor="receiptInvoiceTotal">
                <Input
                  id="receiptInvoiceTotal"
                  value={invoiceTotal}
                  onChange={(event) => setInvoiceTotal(event.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </Field>
            </>
          ) : null}
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
                        Item sem produto no catálogo. Vincule a um produto existente (recomendado) ou
                        cadastre um novo agora. O vínculo fica permanente no item da solicitação.
                      </p>
                      <div className="mt-2">
                        <Field label="Produto existente" htmlFor={`receiptProduct-${draft.requestItemId}`}>
                          <ProductPicker
                            id={`receiptProduct-${draft.requestItemId}`}
                            value={draft.productId}
                            onChange={(productId) =>
                              updateDraft(draft.requestItemId, { productId })
                            }
                            disabled={!draft.include}
                            ariaLabel={`Produto para ${draft.label}`}
                            placeholder="Buscar produto no catálogo..."
                          />
                        </Field>
                      </div>
                      {!draft.productId ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                          <Field label="Ou cadastre um produto novo" htmlFor={`receiptNewProduct-${draft.requestItemId}`}>
                            <Input
                              id={`receiptNewProduct-${draft.requestItemId}`}
                              value={draft.newProductName}
                              onChange={(event) =>
                                updateDraft(draft.requestItemId, { newProductName: event.target.value })
                              }
                              placeholder="Nome do produto"
                              aria-label={`Nome do produto novo para ${draft.label}`}
                              disabled={!draft.include}
                            />
                          </Field>
                          <Field label="Unidade" htmlFor={`receiptNewProductUom-${draft.requestItemId}`}>
                            <Select
                              id={`receiptNewProductUom-${draft.requestItemId}`}
                              value={draft.newProductUomId}
                              onChange={(event) =>
                                updateDraft(draft.requestItemId, { newProductUomId: event.target.value })
                              }
                              disabled={!draft.include}
                            >
                              <option value="">Padrão (UN)</option>
                              {(uoms.data ?? []).filter((uom) => uom.isActive).map((uom) => (
                                <option key={uom.id} value={uom.id}>
                                  {uom.code} — {uom.name}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                      ) : null}
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
