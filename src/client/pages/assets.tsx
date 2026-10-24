import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ASSET_ACTIVE_STATUSES,
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  ASSET_CRITICALITIES,
  ASSET_CRITICALITY_LABELS,
  ASSET_STATUS_LABELS,
  ASSET_STATUS_TONES,
  ASSET_STATUSES,
  ASSET_TERMINAL_STATUSES,
  type AssetCondition,
  type AssetCriticality,
  type AssetStatus,
} from "@shared/assets";
import { PERMISSIONS } from "@shared/permissions";
import { apiErrorMessage, apiGet, apiPatch, apiPost, fieldErrors } from "../lib/api";
import {
  formatCurrencyFromCents,
  formatDate,
  formatDateTime,
  plural,
} from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { AttachmentsCard } from "../lib/attachments-card";
import { useSession } from "../lib/session";
import {
  Alert,
  ArrowLeftIcon,
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

interface AssetRow {
  id: string;
  code: string;
  tag: string | null;
  name: string;
  categoryId: string;
  categoryName: string;
  status: AssetStatus;
  condition: AssetCondition;
  criticality: AssetCriticality;
  locationId: string;
  locationName: string;
  locationPath: string | null;
  departmentId: string | null;
  departmentName: string | null;
  custodianUserId: string | null;
  custodianName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  acquisitionDate: string | null;
  acquisitionValueCents: number | null;
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  warrantyUntil: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  manufactureYear: number | null;
  description: string | null;
  notes: string | null;
  retiredAt: string | null;
  retiredReason: string | null;
  retiredByName: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MovementRow {
  id: string;
  type: string;
  typeLabel: string;
  fromLocationName: string | null;
  toLocationName: string | null;
  fromUserName: string | null;
  toUserName: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  fromCondition: string | null;
  toCondition: string | null;
  reason: string | null;
  movementDate: string;
  createdByName: string | null;
}

interface AssetDetail {
  asset: AssetRow;
  movements: MovementRow[];
}

interface Options {
  categories: Array<{ id: string; code: string; name: string }>;
  locations: Array<{ id: string; name: string; path: string }>;
  departments: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  costCenters: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
}

interface Summary {
  total: number;
  active: number;
  terminal: number;
  activeValueCents: number;
  warrantyExpiring: number;
  byStatus: Array<{ status: AssetStatus; total: number }>;
  byCategory: Array<{ id: string; name: string; total: number }>;
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  assetCount: number;
}

type MovementMode = "transfer" | "assignment" | "status" | "condition" | "maintenance" | "inventory";

/* -------------------------------------------------------------------------- */
/* Rótulos auxiliares                                                         */
/* -------------------------------------------------------------------------- */

function statusLabel(status: string | null | undefined): string {
  return status ? (ASSET_STATUS_LABELS[status as AssetStatus] ?? status) : "—";
}

function conditionLabel(condition: string | null | undefined): string {
  return condition ? (ASSET_CONDITION_LABELS[condition as AssetCondition] ?? condition) : "—";
}

function statusTone(status: AssetStatus): Tone {
  const tone = ASSET_STATUS_TONES[status];
  return tone === "orange" ? "amber" : tone;
}

function criticalityTone(criticality: AssetCriticality): Tone {
  switch (criticality) {
    case "critical":
      return "red";
    case "high":
      return "amber";
    case "low":
      return "slate";
    default:
      return "blue";
  }
}

function conditionTone(condition: AssetCondition): Tone {
  switch (condition) {
    case "new":
    case "good":
      return "green";
    case "fair":
      return "amber";
    default:
      return "red";
  }
}

function movementSummary(movement: MovementRow): string {
  switch (movement.type) {
    case "transfer":
      return `${movement.fromLocationName ?? "—"} → ${movement.toLocationName ?? "—"}`;
    case "assignment":
      return `${movement.fromUserName ?? "Sem responsável"} → ${movement.toUserName ?? "Sem responsável"}`;
    case "status_change":
    case "disposal":
      return `${statusLabel(movement.fromStatus)} → ${statusLabel(movement.toStatus)}`;
    case "condition_change":
      return `${conditionLabel(movement.fromCondition)} → ${conditionLabel(movement.toCondition)}`;
    case "inventory":
      return `${movement.fromLocationName ?? "—"} → ${movement.toLocationName ?? "—"}`;
    case "maintenance":
      return movement.toStatus && movement.toStatus !== movement.fromStatus
        ? `${statusLabel(movement.fromStatus)} → ${statusLabel(movement.toStatus)}`
        : "Manutenção registrada";
    case "acquisition":
      return `Entrada em ${movement.toLocationName ?? "—"}`;
    default:
      return movement.typeLabel;
  }
}

/* -------------------------------------------------------------------------- */
/* Página de lista                                                            */
/* -------------------------------------------------------------------------- */

export function AssetsPage() {
  const navigate = useNavigate();
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ id: string | null } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const manage = can(PERMISSIONS.ASSETS_MANAGE);
  const options = useAssetsOptions();
  const summary = useAsync(() => apiGet<Summary>("/api/assets/summary"), []);
  const list = useAsync(
    () =>
      apiGet<{ items: AssetRow[]; total: number; page: number; pageSize: number }>("/api/assets", {
        search: debounced,
        categoryId: categoryId || undefined,
        status: status || undefined,
        locationId: locationId || undefined,
        page,
        pageSize: 25,
      }),
    [debounced, categoryId, status, locationId, page],
  );

  const maintenanceCount =
    summary.data?.byStatus.find((row) => row.status === "maintenance")?.total ?? 0;

  const columns: Column<AssetRow>[] = [
    {
      key: "asset",
      header: "Ativo",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-slate-500">
            {row.code}
            {row.tag ? ` · ${row.tag}` : ""} · {row.categoryName}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={statusTone(row.status)}>{ASSET_STATUS_LABELS[row.status]}</Badge>
          {row.condition !== "good" ? (
            <Badge tone={conditionTone(row.condition)} size="sm">
              {ASSET_CONDITION_LABELS[row.condition]}
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "location",
      header: "Local",
      hideOnMobile: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-700">{row.locationName}</p>
          {row.departmentName ? (
            <p className="truncate text-xs text-slate-500">{row.departmentName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "custodian",
      header: "Responsável",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-slate-600">{row.custodianName ?? "—"}</span>
      ),
    },
    {
      key: "value",
      header: "Valor",
      align: "right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums text-sm text-slate-700">
          {row.acquisitionValueCents != null
            ? formatCurrencyFromCents(row.acquisitionValueCents)
            : "—"}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Patrimônio"
        description="Ativos fixos, localização, responsáveis e histórico de movimentações."
        actions={
          <>
            {manage ? (
              <Button variant="secondary" onClick={() => setCategoriesOpen(true)}>
                Categorias
              </Button>
            ) : null}
            {manage ? <Button onClick={() => setForm({ id: null })}>Novo ativo</Button> : null}
          </>
        }
      />

      {summary.loading && !summary.data ? <LoadingBlock label="Carregando resumo..." /> : null}
      {summary.error ? <ErrorBlock message={summary.error} onRetry={summary.reload} /> : null}
      {summary.data ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Ativos em operação"
            value={summary.data.active}
            hint={`${summary.data.total} no total · ${summary.data.terminal} baixados/descartados`}
          />
          <Stat
            label="Valor em operação"
            value={formatCurrencyFromCents(summary.data.activeValueCents)}
            hint="Soma dos ativos não baixados"
          />
          <Stat
            label="Em manutenção"
            value={maintenanceCount}
            tone="amber"
            hint={maintenanceCount > 0 ? "Equipamentos fora de operação" : "Nenhum equipamento parado"}
          />
          <Stat
            label="Garantias a vencer"
            value={summary.data.warrantyExpiring}
            tone={summary.data.warrantyExpiring > 0 ? "amber" : "green"}
            alert={summary.data.warrantyExpiring > 0}
            hint="Próximos 30 dias"
          />
        </div>
      ) : null}

      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Buscar por nome, código, etiqueta, série ou modelo"
            className="w-full lg:max-w-sm"
          />
          <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <Select
              aria-label="Filtrar por categoria"
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as categorias</option>
              {(options.data?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filtrar por situação"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as situações</option>
              {ASSET_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ASSET_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filtrar por local"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos os locais</option>
              {(options.data?.locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.path || location.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="p-4">
          {list.loading && !list.data ? (
            <LoadingBlock />
          ) : list.error ? (
            <ErrorBlock message={list.error} onRetry={list.reload} />
          ) : (
            <>
              <Table
                columns={columns}
                rows={list.data?.items ?? []}
                keyOf={(row) => row.id}
                onRowClick={(row) => navigate(`/patrimonio/${row.id}`)}
                empty={
                  <EmptyState
                    title="Nenhum ativo encontrado"
                    description={
                      debounced || categoryId || status || locationId
                        ? "Ajuste os filtros para ver outros ativos."
                        : "Cadastre o primeiro bem patrimonial para começar o controle."
                    }
                    action={
                      manage && !debounced && !categoryId && !status && !locationId ? (
                        <Button onClick={() => setForm({ id: null })}>Novo ativo</Button>
                      ) : undefined
                    }
                  />
                }
              />
              {list.data ? (
                <Pagination
                  page={list.data.page}
                  pageSize={list.data.pageSize}
                  total={list.data.total}
                  onPage={setPage}
                />
              ) : null}
            </>
          )}
        </div>
      </Card>

      {form ? (
        <AssetFormDialog
          assetId={form.id}
          options={options.data}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            list.reload();
            summary.reload();
          }}
        />
      ) : null}

      {categoriesOpen ? (
        <CategoriesDialog
          onClose={() => setCategoriesOpen(false)}
          onChanged={() => {
            options.reload();
            list.reload();
            summary.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Página de detalhe                                                          */
/* -------------------------------------------------------------------------- */

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [movement, setMovement] = useState<MovementMode | null>(null);
  const options = useAssetsOptions();
  const detail = useAsync(() => apiGet<AssetDetail>(`/api/assets/${id}`), [id]);

  if (detail.loading && !detail.data) {
    return (
      <div>
        <BackLink />
        <LoadingBlock label="Carregando ativo..." />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <div>
        <BackLink />
        <ErrorBlock message={detail.error ?? "Ativo não encontrado."} onRetry={detail.reload} />
      </div>
    );
  }

  const { asset, movements } = detail.data;
  const manage = can(PERMISSIONS.ASSETS_MANAGE);
  const move = can(PERMISSIONS.ASSETS_MOVE);
  const terminal = ASSET_TERMINAL_STATUSES.includes(asset.status);

  const reload = () => {
    detail.reload();
    options.reload();
  };

  const historyColumns: Column<MovementRow>[] = [
    {
      key: "when",
      header: "Quando",
      cell: (row) => (
        <div>
          <p className="whitespace-nowrap text-sm text-slate-700">{formatDateTime(row.movementDate)}</p>
          <p className="text-xs text-slate-500">{row.createdByName ?? "—"}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Movimento",
      cell: (row) => (
        <div>
          <Badge tone="blue">{row.typeLabel}</Badge>
          <p className="mt-1 text-xs text-slate-600">{movementSummary(row)}</p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Motivo",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-sm text-slate-600">{row.reason ?? "—"}</span>
      ),
    },
  ];

  return (
    <div>
      <BackLink />

      <PageHeader
        title={asset.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{asset.code}</span>
            {asset.tag ? <Badge tone="slate">{asset.tag}</Badge> : null}
            <Badge tone={statusTone(asset.status)}>{ASSET_STATUS_LABELS[asset.status]}</Badge>
            <Badge tone={conditionTone(asset.condition)}>{ASSET_CONDITION_LABELS[asset.condition]}</Badge>
            <Badge tone={criticalityTone(asset.criticality)}>
              Criticidade {ASSET_CRITICALITY_LABELS[asset.criticality].toLowerCase()}
            </Badge>
          </span>
        }
        actions={
          <>
            {manage ? (
              <Button variant="secondary" onClick={() => setFormOpen(true)}>
                Editar
              </Button>
            ) : null}
            {move && !terminal ? (
              <Button onClick={() => setMovement("status")}>Situação</Button>
            ) : null}
          </>
        }
      />

      {terminal ? (
        <Alert tone="slate" title="Ativo encerrado">
          Este ativo foi {asset.status === "retired" ? "baixado" : "descartado"}
          {asset.retiredAt ? ` em ${formatDate(asset.retiredAt)}` : ""}
          {asset.retiredReason ? `: ${asset.retiredReason}` : "."} Novas movimentações estão bloqueadas;
          o histórico permanece disponível.
        </Alert>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Identificação">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Info label="Categoria" value={asset.categoryName} />
              <Info label="Local" value={asset.locationPath || asset.locationName} />
              <Info label="Setor" value={asset.departmentName} />
              <Info label="Responsável" value={asset.custodianName} />
              <Info label="Centro de custo" value={asset.costCenterName} />
              <Info label="Fornecedor" value={asset.supplierName} />
              <Info label="Série" value={asset.serialNumber} />
              <Info label="Fabricante / modelo" value={[asset.manufacturer, asset.model].filter(Boolean).join(" · ")} />
              <Info label="Ano de fabricação" value={asset.manufactureYear?.toString()} />
              <Info label="Cadastrado por" value={asset.createdByName} />
            </dl>
            {asset.description ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Descrição</p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{asset.description}</p>
              </div>
            ) : null}
            {asset.notes ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Observações</p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{asset.notes}</p>
              </div>
            ) : null}
          </Card>

          <Card title="Aquisição e garantia">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Info label="Data de aquisição" value={formatDate(asset.acquisitionDate)} />
              <Info
                label="Valor de aquisição"
                value={
                  asset.acquisitionValueCents != null
                    ? formatCurrencyFromCents(asset.acquisitionValueCents)
                    : null
                }
              />
              <Info label="Nota fiscal" value={[asset.invoiceNumber, asset.invoiceSeries].filter(Boolean).join(" / ")} />
              <Info label="Garantia até" value={formatDate(asset.warrantyUntil)} />
              <Info label="Última atualização" value={formatDateTime(asset.updatedAt)} />
            </dl>
          </Card>

          <Card title="Histórico de movimentações" padded={false}>
            <div className="p-4">
              <Table
                columns={historyColumns}
                rows={movements}
                keyOf={(row) => row.id}
                dense
                empty={
                  <EmptyState
                    title="Sem movimentações"
                    description="Transferências, atribuições e mudanças de situação aparecem aqui."
                  />
                }
              />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {move && !terminal ? (
            <Card
              title="Ações do ativo"
              description="Cada ação registra uma movimentação no histórico."
            >
              <div className="grid gap-2">
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMovement("transfer")}
                >
                  Transferir de local
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMovement("assignment")}
                >
                  Atribuir responsável
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMovement("maintenance")}
                >
                  Registrar manutenção
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMovement("inventory")}
                >
                  Conferir inventário
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setMovement("condition")}
                >
                  Mudar condição
                </Button>
              </div>
            </Card>
          ) : null}

          <Card title="Resumo">
            <dl className="space-y-3 text-sm">
              <Info label="Situação" value={ASSET_STATUS_LABELS[asset.status]} />
              <Info label="Condição" value={ASSET_CONDITION_LABELS[asset.condition]} />
              <Info label="Criticidade" value={ASSET_CRITICALITY_LABELS[asset.criticality]} />
              <Info label="Local atual" value={asset.locationName} />
              <Info label="Responsável" value={asset.custodianName ?? "Sem responsável"} />
            </dl>
          </Card>

          <AttachmentsCard
            entityType="asset"
            entityId={asset.id}
            title="Anexos do ativo"
            description="Nota fiscal, termo de responsabilidade, fotos e laudos."
          />
        </div>
      </div>

      {formOpen ? (
        <AssetFormDialog
          assetId={asset.id}
          options={options.data}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            toast.success("Ativo atualizado.");
            reload();
          }}
        />
      ) : null}

      {movement && options.data ? (
        <MovementDialog
          mode={movement}
          asset={asset}
          options={options.data}
          canManage={manage}
          onClose={() => setMovement(null)}
          onSaved={(message) => {
            setMovement(null);
            toast.success(message);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/patrimonio"
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-brand-800"
    >
      <ArrowLeftIcon className="size-4" />
      Voltar para o patrimônio
    </Link>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{value || "—"}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Opções                                                                     */
/* -------------------------------------------------------------------------- */

function useAssetsOptions() {
  return useAsync(() => apiGet<Options>("/api/assets/options"), []);
}

/* -------------------------------------------------------------------------- */
/* Formulário do ativo                                                        */
/* -------------------------------------------------------------------------- */

function AssetFormDialog({
  assetId,
  options,
  onClose,
  onSaved,
}: {
  assetId: string | null;
  options: Options | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detail = useAsync(
    () => (assetId ? apiGet<AssetDetail>(`/api/assets/${assetId}`) : Promise.resolve(null)),
    [assetId],
  );

  if (assetId && detail.loading && !detail.data) {
    return (
      <Dialog open title="Editar ativo" onClose={onClose}>
        <LoadingBlock />
      </Dialog>
    );
  }
  if (assetId && detail.error) {
    return (
      <Dialog open title="Editar ativo" onClose={onClose}>
        <ErrorBlock message={detail.error} onRetry={detail.reload} />
      </Dialog>
    );
  }

  return (
    <AssetForm
      asset={detail.data?.asset ?? null}
      options={options}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function AssetForm({
  asset,
  options,
  onClose,
  onSaved,
}: {
  asset: AssetRow | null;
  options: Options | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(asset);
  const [name, setName] = useState(asset?.name ?? "");
  const [categoryId, setCategoryId] = useState(asset?.categoryId ?? "");
  const [tag, setTag] = useState(asset?.tag ?? "");
  const [locationId, setLocationId] = useState(asset?.locationId ?? "");
  const [status, setStatus] = useState<AssetStatus>(asset?.status ?? "in_use");
  const [condition, setCondition] = useState<AssetCondition>(asset?.condition ?? "good");
  const [criticality, setCriticality] = useState<AssetCriticality>(asset?.criticality ?? "normal");
  const [departmentId, setDepartmentId] = useState(asset?.departmentId ?? "");
  const [custodianUserId, setCustodianUserId] = useState(asset?.custodianUserId ?? "");
  const [costCenterId, setCostCenterId] = useState(asset?.costCenterId ?? "");
  const [supplierId, setSupplierId] = useState(asset?.supplierId ?? "");
  const [acquisitionDate, setAcquisitionDate] = useState(asset?.acquisitionDate ?? "");
  const [acquisitionValue, setAcquisitionValue] = useState(
    asset?.acquisitionValueCents != null ? (asset.acquisitionValueCents / 100).toFixed(2) : "",
  );
  const [invoiceNumber, setInvoiceNumber] = useState(asset?.invoiceNumber ?? "");
  const [invoiceSeries, setInvoiceSeries] = useState(asset?.invoiceSeries ?? "");
  const [warrantyUntil, setWarrantyUntil] = useState(asset?.warrantyUntil ?? "");
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? "");
  const [manufacturer, setManufacturer] = useState(asset?.manufacturer ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [manufactureYear, setManufactureYear] = useState(
    asset?.manufactureYear != null ? String(asset.manufactureYear) : "",
  );
  const [description, setDescription] = useState(asset?.description ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setError(null);
    setErrors({});
    setSaving(true);
    const value = acquisitionValue.trim();
    const payload: Record<string, unknown> = {
      name,
      categoryId,
      tag: tag.trim() || null,
      criticality,
      departmentId: departmentId || null,
      costCenterId: costCenterId || null,
      supplierId: supplierId || null,
      acquisitionDate: acquisitionDate || null,
      acquisitionValueCents: value ? Math.round(Number(value.replace(",", ".")) * 100) : null,
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceSeries: invoiceSeries.trim() || null,
      warrantyUntil: warrantyUntil || null,
      serialNumber: serialNumber.trim() || null,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      manufactureYear: manufactureYear.trim() ? Number(manufactureYear) : null,
      description: description.trim() || null,
      notes: notes.trim() || null,
    };
    if (!editing) {
      payload.locationId = locationId;
      payload.status = status;
      payload.condition = condition;
      payload.custodianUserId = custodianUserId || null;
    }

    try {
      if (asset) {
        await apiPatch(`/api/assets/${asset.id}`, payload);
        toast.success("Ativo atualizado.");
      } else {
        await apiPost("/api/assets", payload);
        toast.success("Ativo cadastrado.");
      }
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setErrors(fieldErrors(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title={editing ? "Editar ativo" : "Novo ativo"}
      description={
        editing
          ? "Local, responsável, situação e condição mudam pelas ações do ativo e ficam no histórico."
          : "O código patrimonial é gerado automaticamente ao salvar."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error ? <Alert tone="red">{error}</Alert> : null}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Identificação</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" required error={errors.name} htmlFor="assetName" className="sm:col-span-2">
              <Input
                id="assetName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                placeholder="Ex.: Notebook Dell Latitude 5440"
              />
            </Field>
            <Field label="Categoria" required error={errors.categoryId} htmlFor="assetCategory">
              <Select
                id="assetCategory"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Selecione...</option>
                {(options?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Etiqueta patrimonial"
              error={errors.tag}
              hint="Opcional; não pode repetir."
              htmlFor="assetTag"
            >
              <Input id="assetTag" value={tag} onChange={(event) => setTag(event.target.value)} />
            </Field>
            <Field label="Criticidade" htmlFor="assetCriticality">
              <Select
                id="assetCriticality"
                value={criticality}
                onChange={(event) => setCriticality(event.target.value as AssetCriticality)}
              >
                {ASSET_CRITICALITIES.map((value) => (
                  <option key={value} value={value}>
                    {ASSET_CRITICALITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            {!editing ? (
              <Field label="Situação inicial" htmlFor="assetStatus">
                <Select
                  id="assetStatus"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as AssetStatus)}
                >
                  {ASSET_ACTIVE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {ASSET_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {!editing ? (
              <Field label="Condição inicial" htmlFor="assetCondition">
                <Select
                  id="assetCondition"
                  value={condition}
                  onChange={(event) => setCondition(event.target.value as AssetCondition)}
                >
                  {ASSET_CONDITIONS.map((value) => (
                    <option key={value} value={value}>
                      {ASSET_CONDITION_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Descrição" htmlFor="assetDescription" className="sm:col-span-2">
              <Textarea
                id="assetDescription"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Local e responsabilidade</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing ? (
              <Field label="Local" required error={errors.locationId} htmlFor="assetLocation">
                <Select
                  id="assetLocation"
                  value={locationId}
                  onChange={(event) => setLocationId(event.target.value)}
                >
                  <option value="">Selecione...</option>
                  {(options?.locations ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.path || location.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Setor" htmlFor="assetDepartment">
              <Select
                id="assetDepartment"
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">Sem setor</option>
                {(options?.departments ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </Field>
            {!editing ? (
              <Field label="Responsável" htmlFor="assetCustodian">
                <Select
                  id="assetCustodian"
                  value={custodianUserId}
                  onChange={(event) => setCustodianUserId(event.target.value)}
                >
                  <option value="">Sem responsável</option>
                  {(options?.users ?? []).map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label="Centro de custo" htmlFor="assetCostCenter">
              <Select
                id="assetCostCenter"
                value={costCenterId}
                onChange={(event) => setCostCenterId(event.target.value)}
              >
                <option value="">Sem centro de custo</option>
                {(options?.costCenters ?? []).map((costCenter) => (
                  <option key={costCenter.id} value={costCenter.id}>
                    {costCenter.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Aquisição e garantia</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data de aquisição" error={errors.acquisitionDate} htmlFor="assetAcquisitionDate">
              <Input
                id="assetAcquisitionDate"
                type="date"
                value={acquisitionDate}
                onChange={(event) => setAcquisitionDate(event.target.value)}
              />
            </Field>
            <Field label="Valor de aquisição (R$)" error={errors.acquisitionValueCents} htmlFor="assetValue">
              <Input
                id="assetValue"
                type="number"
                min="0"
                step="0.01"
                value={acquisitionValue}
                onChange={(event) => setAcquisitionValue(event.target.value)}
                placeholder="0,00"
              />
            </Field>
            <Field label="Nota fiscal" htmlFor="assetInvoice">
              <Input
                id="assetInvoice"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </Field>
            <Field label="Série da NF" htmlFor="assetInvoiceSeries">
              <Input
                id="assetInvoiceSeries"
                value={invoiceSeries}
                onChange={(event) => setInvoiceSeries(event.target.value)}
              />
            </Field>
            <Field label="Garantia até" error={errors.warrantyUntil} htmlFor="assetWarranty">
              <Input
                id="assetWarranty"
                type="date"
                value={warrantyUntil}
                onChange={(event) => setWarrantyUntil(event.target.value)}
              />
            </Field>
            <Field label="Fornecedor" htmlFor="assetSupplier">
              <Select
                id="assetSupplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
              >
                <option value="">Sem fornecedor</option>
                {(options?.suppliers ?? []).map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Número de série" htmlFor="assetSerial">
              <Input
                id="assetSerial"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
              />
            </Field>
            <Field label="Fabricante" htmlFor="assetManufacturer">
              <Input
                id="assetManufacturer"
                value={manufacturer}
                onChange={(event) => setManufacturer(event.target.value)}
              />
            </Field>
            <Field label="Modelo" htmlFor="assetModel">
              <Input id="assetModel" value={model} onChange={(event) => setModel(event.target.value)} />
            </Field>
            <Field label="Ano de fabricação" error={errors.manufactureYear} htmlFor="assetYear">
              <Input
                id="assetYear"
                type="number"
                min="1900"
                max="2100"
                value={manufactureYear}
                onChange={(event) => setManufactureYear(event.target.value)}
              />
            </Field>
          </div>
        </section>

        <Field label="Observações internas" htmlFor="assetNotes">
          <Textarea
            id="assetNotes"
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
/* Diálogo de movimentação                                                    */
/* -------------------------------------------------------------------------- */

const MOVEMENT_TITLES: Record<MovementMode, string> = {
  transfer: "Transferir ativo",
  assignment: "Atribuir responsável",
  status: "Mudar situação",
  condition: "Mudar condição",
  maintenance: "Registrar manutenção",
  inventory: "Conferir inventário",
};

function MovementDialog({
  mode,
  asset,
  options,
  canManage,
  onClose,
  onSaved,
}: {
  mode: MovementMode;
  asset: AssetRow;
  options: Options;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [locationId, setLocationId] = useState(mode === "transfer" ? "" : asset.locationId);
  const [userId, setUserId] = useState(asset.custodianUserId ?? "");
  const [status, setStatus] = useState<AssetStatus>(
    mode === "maintenance" ? "maintenance" : asset.status,
  );
  const [condition, setCondition] = useState<AssetCondition>(asset.condition);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (mode === "transfer") {
        await apiPost(`/api/assets/${asset.id}/transfer`, {
          toLocationId: locationId,
          reason: reason.trim() || null,
        });
        onSaved("Transferência registrada.");
      } else if (mode === "assignment") {
        await apiPost(`/api/assets/${asset.id}/assignment`, {
          custodianUserId: userId || null,
          reason: reason.trim() || null,
        });
        onSaved("Responsável atualizado.");
      } else if (mode === "status") {
        await apiPost(`/api/assets/${asset.id}/status`, {
          status,
          reason: reason.trim() || null,
        });
        onSaved("Situação atualizada.");
      } else if (mode === "condition") {
        await apiPost(`/api/assets/${asset.id}/condition`, {
          condition,
          reason: reason.trim() || null,
        });
        onSaved("Condição atualizada.");
      } else if (mode === "maintenance") {
        await apiPost(`/api/assets/${asset.id}/maintenance`, {
          reason: reason.trim(),
          status: status === asset.status ? null : status,
        });
        onSaved("Manutenção registrada.");
      } else {
        await apiPost(`/api/assets/${asset.id}/inventory`, {
          locationId: locationId || null,
          condition,
          reason: reason.trim() || null,
        });
        onSaved("Conferência registrada.");
      }
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const targetTerminal = mode === "status" && ASSET_TERMINAL_STATUSES.includes(status);
  const maintenanceStatuses: AssetStatus[] = ["maintenance", "in_use", "in_stock"];

  return (
    <Dialog
      open
      title={MOVEMENT_TITLES[mode]}
      description={`${asset.name} · ${asset.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            loading={saving}
            variant={targetTerminal ? "danger" : "primary"}
            disabled={
              (mode === "maintenance" && reason.trim().length < 3) ||
              (mode === "transfer" && !locationId) ||
              (mode === "status" && status === asset.status) ||
              (mode === "condition" && condition === asset.condition)
            }
          >
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        {mode === "transfer" ? (
          <Field label="Local de destino" required htmlFor="movementLocation">
            <Select
              id="movementLocation"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Selecione...</option>
              {options.locations
                .filter((location) => location.id !== asset.locationId)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.path || location.name}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}

        {mode === "assignment" ? (
          <Field
            label="Responsável"
            hint="Deixe em branco para devolver o ativo sem responsável."
            htmlFor="movementUser"
          >
            <Select
              id="movementUser"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">Sem responsável</option>
              {options.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {mode === "status" ? (
          <Field label="Nova situação" required htmlFor="movementStatus">
            <Select
              id="movementStatus"
              value={status}
              onChange={(event) => setStatus(event.target.value as AssetStatus)}
            >
              {ASSET_STATUSES.map((value) => (
                <option
                  key={value}
                  value={value}
                  disabled={ASSET_TERMINAL_STATUSES.includes(value) && !canManage}
                >
                  {ASSET_STATUS_LABELS[value]}
                  {ASSET_TERMINAL_STATUSES.includes(value) ? " (terminal)" : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {mode === "condition" ? (
          <Field label="Nova condição" required htmlFor="movementCondition">
            <Select
              id="movementCondition"
              value={condition}
              onChange={(event) => setCondition(event.target.value as AssetCondition)}
            >
              {ASSET_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {ASSET_CONDITION_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {mode === "maintenance" ? (
          <Field label="Situação após o registro" htmlFor="movementMaintenanceStatus">
            <Select
              id="movementMaintenanceStatus"
              value={status}
              onChange={(event) => setStatus(event.target.value as AssetStatus)}
            >
              {maintenanceStatuses.map((value) => (
                <option key={value} value={value}>
                  {ASSET_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {mode === "inventory" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Local encontrado" htmlFor="inventoryLocation">
              <Select
                id="inventoryLocation"
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {options.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.path || location.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Condição encontrada" htmlFor="inventoryCondition">
              <Select
                id="inventoryCondition"
                value={condition}
                onChange={(event) => setCondition(event.target.value as AssetCondition)}
              >
                {ASSET_CONDITIONS.map((value) => (
                  <option key={value} value={value}>
                    {ASSET_CONDITION_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}

        <Field
          label={mode === "maintenance" ? "Descrição da manutenção" : "Motivo / observação"}
          required={mode === "maintenance"}
          htmlFor="movementReason"
        >
          <Textarea
            id="movementReason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              mode === "transfer"
                ? "Ex.: mudança de sala, envio para o almoxarifado..."
                : mode === "maintenance"
                  ? "Ex.: troca da fonte, limpeza interna, revisão preventiva..."
                  : "Opcional"
            }
          />
        </Field>

        {targetTerminal ? (
          <Alert tone="amber" title="Ação terminal">
            Baixar ou descartar encerra a vida operacional do ativo. O histórico é preservado e
            novas movimentações ficam bloqueadas.
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Categorias                                                                 */
/* -------------------------------------------------------------------------- */

function CategoriesDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState<CategoryRow | "new" | null>(null);
  const state = useAsync(
    () => apiGet<{ items: CategoryRow[] }>("/api/assets/categories?includeInactive=1"),
    [],
  );

  const toggle = async (row: CategoryRow) => {
    try {
      await apiPatch(`/api/assets/categories/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? "Categoria desativada." : "Categoria reativada.");
      state.reload();
      onChanged();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  const columns: Column<CategoryRow>[] = [
    {
      key: "category",
      header: "Categoria",
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-800">
            {row.name} <span className="font-mono text-xs text-slate-400">{row.code}</span>
          </p>
          {row.description ? <p className="text-xs text-slate-500">{row.description}</p> : null}
          {!row.isActive ? (
            <span className="mt-1 inline-block md:hidden">
              <Badge tone="slate">Inativa</Badge>
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "assets",
      header: "Ativos",
      align: "right",
      hideOnMobile: true,
      cell: (row) => <span className="tabular-nums text-slate-600">{row.assetCount}</span>,
    },
    {
      key: "status",
      header: "Situação",
      hideOnMobile: true,
      cell: (row) =>
        row.isActive ? <Badge tone="green">Ativa</Badge> : <Badge tone="slate">Inativa</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
            Editar
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void toggle(row)}>
            {row.isActive ? "Desativar" : "Reativar"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Dialog
      open
      wide
      title="Categorias de patrimônio"
      description="Agrupam os ativos nos filtros e relatórios. A exclusão com impacto fica na Central de Controle."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => navigate("/controle")}>
            Abrir Central de Controle
          </Button>
          <Button onClick={() => setEditing("new")}>Nova categoria</Button>
        </>
      }
    >
      {state.loading && !state.data ? <LoadingBlock /> : null}
      {state.error ? <ErrorBlock message={state.error} onRetry={state.reload} /> : null}
      {state.data ? (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {state.data.items.length}{" "}
            {plural(state.data.items.length, "categoria cadastrada", "categorias cadastradas")}.
          </p>
          <Table
            columns={columns}
            rows={state.data.items}
            keyOf={(row) => row.id}
            dense
            empty={<EmptyState title="Nenhuma categoria" description="Crie a primeira categoria." />}
          />
        </>
      ) : null}

      {editing ? (
        <CategoryFormDialog
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
            onChanged();
          }}
        />
      ) : null}
    </Dialog>
  );
}

function CategoryFormDialog({
  category,
  onClose,
  onSaved,
}: {
  category: CategoryRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(category?.code ?? "");
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 100));
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setError(null);
    setErrors({});
    setSaving(true);
    try {
      if (category) {
        await apiPatch(`/api/assets/categories/${category.id}`, {
          name,
          description: description.trim() || null,
          sortOrder: Number(sortOrder) || 0,
          isActive,
        });
        toast.success("Categoria atualizada.");
      } else {
        await apiPost("/api/assets/categories", {
          code,
          name,
          description: description.trim() || null,
          sortOrder: Number(sortOrder) || 0,
        });
        toast.success("Categoria criada.");
      }
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setErrors(fieldErrors(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={category ? "Editar categoria" : "Nova categoria"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Código"
            required
            error={errors.code}
            hint={category ? "O código não muda depois de criado." : "Ex.: TI, MOB, SEG."}
            htmlFor="categoryCode"
          >
            <Input
              id="categoryCode"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              disabled={Boolean(category)}
              autoFocus={!category}
            />
          </Field>
          <Field label="Ordem" error={errors.sortOrder} htmlFor="categorySort">
            <Input
              id="categorySort"
              type="number"
              min="0"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </Field>
          <Field label="Nome" required error={errors.name} htmlFor="categoryName" className="sm:col-span-2">
            <Input
              id="categoryName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus={Boolean(category)}
            />
          </Field>
        </div>
        <Field label="Descrição" htmlFor="categoryDescription">
          <Textarea
            id="categoryDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {category ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Categoria ativa (aparece nos seletores)
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}
