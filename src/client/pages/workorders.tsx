import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  PRIORITY_LABEL,
  WORK_ORDER_STATUS_LABEL,
  WORK_ORDER_TRANSITIONS,
  type Paginated,
  type Priority,
  type WorkOrderStatus,
} from "@shared/types";
import { apiDelete, apiErrorMessage, apiGet, apiPatch, apiPost, apiUpload, ApiError } from "../lib/api";
import { CameraCaptureDialog } from "../lib/camera";
import {
  PRIORITY_TONE,
  entityName,
  formatBytes,
  formatDate,
  formatDateTime,
  formatQuantity,
  plural,
} from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useActiveUsers, useLocations, useOpenTickets } from "../lib/lookups";
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

interface WorkOrderRow {
  id: string;
  code: string;
  ticketId: string | null;
  ticketCode: string | null;
  ticketStatus: string | null;
  ticketTitle: string | null;
  parentWorkOrderId: string | null;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  locationId: string | null;
  locationName: string | null;
  locationPath: string | null;
  locationDeleted: boolean;
  assigneeId: string | null;
  assigneeName: string | null;
  priority: Priority;
  status: WorkOrderStatus;
  requiresMaterial: boolean;
  plannedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  eventCount: number;
  checklistCount: number;
  checklistDoneCount: number;
  materialItemCount: number;
  materialQtyMilli: number;
}

interface WorkOrderEvent {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  body: string | null;
  userId: string;
  userName: string;
  createdAt: string;
}

interface MaterialUseRow {
  id: string;
  productName: string;
  sku: string | null;
  uomCode: string;
  qtyMilli: number;
  locationName: string | null;
  userName: string;
  occurredAt: string;
  reversesMovementId: string | null;
}

interface ChecklistPhoto {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
  url: string;
}

interface ChecklistItem {
  id: string;
  label: string;
  notes: string | null;
  order: number;
  done: boolean;
  doneAt: string | null;
  doneById: string | null;
  doneByName: string | null;
  createdById: string;
  createdByName: string | null;
  createdByManager: boolean;
  createdAt: string;
  updatedAt: string;
  photos: ChecklistPhoto[];
}

const STATUS_TONE: Record<WorkOrderStatus, Tone> = {
  open: "blue",
  planned: "blue",
  in_progress: "amber",
  waiting_material: "amber",
  done: "green",
  cancelled: "slate",
};

/* -------------------------------------------------------------------------- */
/* Lista                                                                      */
/* -------------------------------------------------------------------------- */

export function WorkOrdersPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const state = useAsync(
    () =>
      apiGet<Paginated<WorkOrderRow>>("/api/workorders", {
        search: debounced || undefined,
        status: status || undefined,
        priority: priority || undefined,
        open: onlyOpen ? "true" : undefined,
        mine: mine ? "true" : undefined,
        page,
        pageSize: 25,
      }),
    [debounced, status, priority, onlyOpen, mine, page],
  );

  const columns: Column<WorkOrderRow>[] = [
    {
      key: "wo",
      header: "Ordem de serviço",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {row.code} · {row.title}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.locationDeleted ? entityName(row.locationName, true) : row.locationPath ?? row.locationName ?? "Sem local"}
            {row.ticketCode ? ` · chamado ${row.ticketCode}` : ""}
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
        <div className="flex flex-col items-start gap-1">
          <Badge tone={STATUS_TONE[row.status]}>{WORK_ORDER_STATUS_LABEL[row.status]}</Badge>
          {row.requiresMaterial ? <Badge tone="amber">Usa material</Badge> : null}
        </div>
      ),
    },
    {
      key: "assignee",
      header: "Responsável",
      hideOnMobile: true,
      cell: (row) => <span className="text-sm text-slate-600">{row.assigneeName ?? "Sem responsável"}</span>,
    },
    {
      key: "dates",
      header: "Planejado / material",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.plannedAt ? formatDate(row.plannedAt) : "Sem data planejada"}</p>
          <p className="text-slate-500">
            {row.materialItemCount > 0
              ? `${row.materialItemCount} ${plural(row.materialItemCount, "item", "itens")}, ${formatQuantity(row.materialQtyMilli)}`
              : "Sem material registrado"}
          </p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="secondary" size="sm" onClick={() => navigate(`/ordens/${row.id}`)}>
          Abrir
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Ordens de serviço"
        description="Execução de manutenções com registro de material, eventos e resultado."
        actions={
          can(PERMISSIONS.WORKORDERS_CREATE) ? (
            <Button onClick={() => setCreating(true)}>Nova ordem</Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Titulo, código ou descrição..." className="w-full sm:w-64" />
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
            {Object.entries(WORK_ORDER_STATUS_LABEL).map(([code, label]) => (
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
              checked={onlyOpen}
              onChange={(event) => {
                setOnlyOpen(event.target.checked);
                setPage(1);
              }}
            />
            Somente abertas
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
              checked={mine}
              onChange={(event) => {
                setMine(event.target.checked);
                setPage(1);
              }}
            />
            Minhas ordens
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
                empty={<EmptyState title="Nenhuma ordem" description="Nada encontrado com os filtros atuais." />}
                onRowClick={(row) => navigate(`/ordens/${row.id}`)}
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
        <WorkOrderDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/ordens/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Criação / edição                                                           */
/* -------------------------------------------------------------------------- */

export function WorkOrderDialog({
  workOrder,
  parent,
  onClose,
  onCreated,
}: {
  workOrder?: WorkOrderRow;
  /** F-10: quando presente, a OS nasce vinculada a esta OS pai. */
  parent?: { id: string; code: string; title: string; locationId: string | null };
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const users = useActiveUsers();
  const tickets = useOpenTickets();
  const [title, setTitle] = useState(workOrder?.title ?? "");
  const [description, setDescription] = useState(workOrder?.description ?? "");
  const [ticketId, setTicketId] = useState(workOrder?.ticketId ?? "");
  const [locationId, setLocationId] = useState(workOrder?.locationId ?? parent?.locationId ?? "");
  const [assigneeId, setAssigneeId] = useState(workOrder?.assigneeId ?? "");
  const [priority, setPriority] = useState<Priority>(workOrder?.priority ?? "normal");
  const [plannedAt, setPlannedAt] = useState(workOrder?.plannedAt ?? "");
  const [requiresMaterial, setRequiresMaterial] = useState(workOrder?.requiresMaterial ?? false);
  const [notes, setNotes] = useState(workOrder?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      title,
      description: description || null,
      ticketId: ticketId || null,
      parentWorkOrderId: parent?.id ?? null,
      locationId: locationId || null,
      assigneeId: assigneeId || null,
      priority,
      requiresMaterial,
      plannedAt: plannedAt || null,
      notes: notes || null,
    };
    try {
      if (workOrder) {
        const { ticketId: _ignored, parentWorkOrderId: _ignoredParent, ...rest } = payload;
        void _ignored;
        void _ignoredParent;
        await apiPatch(`/api/workorders/${workOrder.id}`, rest);
        toast.success("Ordem atualizada.");
        onCreated(workOrder.id);
      } else {
        const result = await apiPost<{ id: string; code: string }>("/api/workorders", payload);
        toast.success(`Ordem ${result.code} criada.`);
        onCreated(result.id);
      }
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
      title={workOrder ? `Editar ${workOrder.code}` : parent ? "Nova OS filha" : "Nova ordem de serviço"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            {workOrder ? "Salvar alterações" : "Criar ordem"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {parent && !workOrder ? (
          <Alert tone="brand">
            Será criada como <strong>OS filha</strong> de {parent.code} · {parent.title}.
          </Alert>
        ) : null}
        <Field label="Titulo" required htmlFor="woFormTitle">
          <Input id="woFormTitle" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </Field>
        {!workOrder ? (
          <Field
            label="Chamado de origem"
            hint="Vincular um chamado marca o chamado como convertido."
            htmlFor="woTicket"
          >
            <Select id="woTicket" value={ticketId} onChange={(event) => setTicketId(event.target.value)}>
              <option value="">Sem chamado vinculado</option>
              {(tickets.data ?? [])
                .filter((ticket) => !ticket.workOrderId)
                .map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>
                    {ticket.code} · {ticket.title}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Local" htmlFor="woLocation">
            <Select id="woLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Sem local específico</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsável" htmlFor="woAssigneeForm">
            <Select id="woAssigneeForm" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">Definir depois</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade" htmlFor="woPriorityForm">
            <Select
              id="woPriorityForm"
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
          <Field label="Execução planejada para" htmlFor="woPlannedForm">
            <Input
              id="woPlannedForm"
              type="date"
              value={plannedAt ?? ""}
              onChange={(event) => setPlannedAt(event.target.value)}
            />
          </Field>
        </div>
        <Checkbox
          label="Vai consumir material do estoque"
          checked={requiresMaterial}
          onChange={setRequiresMaterial}
        />
        <Field label="Descrição" htmlFor="woDescription">
          <Textarea
            id="woDescription"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Observações internas" htmlFor="woNotes">
          <Textarea id="woNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhe                                                                    */
/* -------------------------------------------------------------------------- */

interface WorkOrderDetailResponse {
  workOrder: WorkOrderRow;
  events: WorkOrderEvent[];
  checklist: ChecklistItem[];
  materials: MaterialUseRow[];
  /** Árvore de gestão (F-10): OS pai e OS filhas, resumidas. */
  parent: RelatedWorkOrder | null;
  children: RelatedWorkOrder[];
}

interface RelatedWorkOrder {
  id: string;
  code: string;
  title: string;
  status: WorkOrderStatus;
  priority: Priority;
  assigneeName: string | null;
}

export function WorkOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can, user } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const [usingMaterial, setUsingMaterial] = useState(false);
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [creatingChild, setCreatingChild] = useState(false);

  const state = useAsync(() => apiGet<WorkOrderDetailResponse>(`/api/workorders/${id}`), [id]);

  if (state.loading && !state.data) return <LoadingBlock label="Carregando a ordem..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;

  const { workOrder, events, checklist, materials, parent, children } = state.data;
  const active = !["done", "closed", "cancelled"].includes(workOrder.status);
  // "done" só pela ação de conclusão (resultado + checklist); cancelar exige
  // a permissão própria, então não aparece para quem não pode.
  const transitions = (WORK_ORDER_TRANSITIONS[workOrder.status] ?? []).filter(
    (status) =>
      status !== "done" &&
      (status !== "cancelled" || can(PERMISSIONS.WORKORDERS_CANCEL)),
  );
  // F-10: a árvore pai/filha é informação de gestão (mesmo critério do painel).
  const isManagerView = user?.roleCode === "facilities_manager" || user?.roleCode === "admin";

  return (
    <div>
      <PageHeader
        title={`${workOrder.code} · ${workOrder.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[workOrder.status]}>{WORK_ORDER_STATUS_LABEL[workOrder.status]}</Badge>
            <Badge tone={PRIORITY_TONE[workOrder.priority]}>Prioridade {PRIORITY_LABEL[workOrder.priority]}</Badge>
            {workOrder.ticketCode ? (
              <Link to={`/chamados/${workOrder.ticketId}`} className="text-brand-700 hover:underline">
                <Badge tone="violet">Chamado {workOrder.ticketCode}</Badge>
              </Link>
            ) : null}
            {workOrder.requiresMaterial ? <Badge tone="amber">Depende de material</Badge> : null}
          </span>
        }
        actions={
          <>
            <Link to="/ordens">
              <Button variant="secondary">Voltar</Button>
            </Link>
            {can(PERMISSIONS.WORKORDERS_EXECUTE) && active ? (
              <>
                <Button variant="secondary" onClick={() => setAssigning(true)}>
                  {workOrder.assigneeId ? "Trocar responsável" : "Atribuir"}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Editar
                </Button>
                {transitions.length > 0 ? (
                  <Button variant="secondary" onClick={() => setChangingStatus(true)}>
                    Mudar situação
                  </Button>
                ) : null}
              </>
            ) : null}
            {can(PERMISSIONS.WORKORDERS_MATERIAL) && active ? (
              <Button variant="secondary" onClick={() => setUsingMaterial(true)}>
                Registrar material
              </Button>
            ) : null}
            {can(PERMISSIONS.WORKORDERS_CLOSE) && active ? (
              <Button onClick={() => setClosing(true)}>Concluir</Button>
            ) : null}
            {can(PERMISSIONS.WORKORDERS_CANCEL) && active ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancelar
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Descrição e resultado">
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {workOrder.description ?? "Sem descrição registrada."}
            </p>
            {workOrder.result ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resultado</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{workOrder.result}</p>
              </div>
            ) : null}
            {workOrder.cancelReason ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Cancelamento</p>
                <p className="mt-1 text-sm text-slate-700">{workOrder.cancelReason}</p>
              </div>
            ) : null}
          </Card>

          <Card title={`Material utilizado (${materials.length})`}>
            {materials.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum material registrado. O consumo gera movimentação de estoque vinculada a ordem.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {materials.map((material) => (
                  <li key={material.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {material.productName} ·{" "}
                        <span className="font-normal">
                          {formatQuantity(material.qtyMilli)} {material.uomCode}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Retirado de {material.locationName ?? "-"} por {material.userName} em{" "}
                        {formatDateTime(material.occurredAt)}
                      </p>
                    </div>
                    {material.reversesMovementId ? <Badge tone="violet">Correção</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <ChecklistCard
            workOrderId={workOrder.id}
            code={workOrder.code}
            items={checklist}
            canExecute={can(PERMISSIONS.WORKORDERS_EXECUTE)}
            readOnly={workOrder.status === "cancelled"}
            onChanged={state.reload}
          />

          <Card title="Eventos" description="Linha do tempo da execução registrada pela equipe.">
            <ol className="space-y-3">
              {events.map((event) => (
                <li key={event.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm text-slate-700">
                    {eventLabel(event)}
                    {event.body ? <span className="text-slate-500"> · {event.body}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {event.userName} · {formatDateTime(event.createdAt)}
                  </p>
                </li>
              ))}
              {events.length === 0 ? <li className="text-sm text-slate-500">Sem eventos registrados.</li> : null}
            </ol>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Ficha da ordem">
            <dl className="space-y-3 text-sm">
              <InfoRow label="Responsável" value={workOrder.assigneeName ?? "Sem responsável"} />
              <InfoRow label="Local" value={workOrder.locationDeleted ? entityName(workOrder.locationName, true) : workOrder.locationPath ?? workOrder.locationName ?? "-"} />
              <InfoRow label="Criada por" value={`${workOrder.createdByName ?? "-"} em ${formatDateTime(workOrder.createdAt)}`} />
              <InfoRow label="Planejada para" value={workOrder.plannedAt ? formatDate(workOrder.plannedAt) : "-"} />
              <InfoRow label="Iniciada em" value={workOrder.startedAt ? formatDateTime(workOrder.startedAt) : "-"} />
              <InfoRow label="Finalizada em" value={workOrder.finishedAt ? formatDateTime(workOrder.finishedAt) : "-"} />
              <InfoRow
                label="Material acumulado"
                value={
                  workOrder.materialItemCount > 0
                    ? `${workOrder.materialItemCount} ${plural(workOrder.materialItemCount, "item", "itens")} · ${formatQuantity(workOrder.materialQtyMilli)}`
                    : "Nenhum"
                }
              />
            </dl>
          </Card>

          {isManagerView ? (
            <Card
              title="OS relacionadas"
              description="Vínculo pai/filha entre ordens de serviço (visão de gestão)."
              actions={
                workOrder.status !== "cancelled" ? (
                  <Button variant="secondary" size="sm" onClick={() => setCreatingChild(true)}>
                    Abrir OS filha
                  </Button>
                ) : null
              }
            >
              {parent ? (
                <div className="mb-3 rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">OS pai</p>
                  <Link
                    to={`/ordens/${parent.id}`}
                    className="mt-1 flex flex-wrap items-center gap-2 text-sm text-brand-700 hover:underline"
                  >
                    <span className="font-medium">{parent.code}</span>
                    <span className="min-w-0 truncate text-slate-600">{parent.title}</span>
                    <Badge tone={STATUS_TONE[parent.status]}>{WORK_ORDER_STATUS_LABEL[parent.status]}</Badge>
                  </Link>
                </div>
              ) : null}
              {children.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma OS filha registrada.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {children.map((child) => (
                    <li key={child.id} className="py-2">
                      <Link
                        to={`/ordens/${child.id}`}
                        className="flex flex-wrap items-center gap-2 text-sm text-brand-700 hover:underline"
                      >
                        <span className="font-medium">{child.code}</span>
                        <span className="min-w-0 truncate text-slate-600">{child.title}</span>
                        <Badge tone={STATUS_TONE[child.status]}>{WORK_ORDER_STATUS_LABEL[child.status]}</Badge>
                        <span className="text-xs text-slate-500">{child.assigneeName ?? "Sem responsável"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      </div>

      {editing ? (
        <WorkOrderDialog
          workOrder={workOrder}
          onClose={() => setEditing(false)}
          onCreated={() => {
            setEditing(false);
            state.reload();
          }}
        />
      ) : null}

      {assigning ? (
        <AssignWorkOrderDialog
          workOrder={workOrder}
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            state.reload();
          }}
        />
      ) : null}

      {changingStatus ? (
        <StatusDialog
          workOrder={workOrder}
          transitions={transitions}
          onClose={() => setChangingStatus(false)}
          onSaved={() => {
            setChangingStatus(false);
            state.reload();
          }}
        />
      ) : null}

      {usingMaterial ? (
        <WorkOrderMaterialDialog
          workOrderId={workOrder.id}
          onClose={() => setUsingMaterial(false)}
          onSaved={() => {
            setUsingMaterial(false);
            state.reload();
          }}
        />
      ) : null}

      {closing ? (
        <CloseWorkOrderDialog
          workOrder={workOrder}
          managerPendingLabels={checklist
            .filter((item) => item.createdByManager && !item.done)
            .map((item) => item.label)}
          onClose={() => setClosing(false)}
          onSaved={() => {
            setClosing(false);
            toast.success("Ordem concluída.");
            state.reload();
          }}
        />
      ) : null}

      {cancelling ? (
        <CancelWorkOrderDialog
          workOrder={workOrder}
          onClose={() => setCancelling(false)}
          onSaved={() => {
            setCancelling(false);
            state.reload();
          }}
        />
      ) : null}

      {creatingChild ? (
        <WorkOrderDialog
          parent={{
            id: workOrder.id,
            code: workOrder.code,
            title: workOrder.title,
            locationId: workOrder.locationId,
          }}
          onClose={() => setCreatingChild(false)}
          onCreated={(childId) => {
            setCreatingChild(false);
            navigate(`/ordens/${childId}`);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Checklist de execução (F-09)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Checklist pessoal do técnico dentro da ordem de serviço.
 *
 * Ele cria as etapas na própria OS, marca o que já executou e captura fotos
 * por etapa **pela câmera do aparelho** (F-07 — sem seletor de arquivo). Quem
 * tem `workorders.execute` edita (técnico e gestores); quem só enxerga a OS
 * acompanha. As fotos usam o módulo de anexos, com
 * `entity_type = 'work_order_checklist_item'`.
 */
function ChecklistCard({
  workOrderId,
  code,
  items,
  canExecute,
  readOnly,
  onChanged,
}: {
  workOrderId: string;
  code: string;
  items: ChecklistItem[];
  canExecute: boolean;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const { user, can } = useSession();
  const toast = useToast();
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [photoItemId, setPhotoItemId] = useState<string | null>(null);
  const [removingItem, setRemovingItem] = useState<ChecklistItem | null>(null);
  const [removingPhoto, setRemovingPhoto] = useState<ChecklistPhoto | null>(null);

  const done = items.filter((item) => item.done).length;
  const percent = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  const editable = canExecute && !readOnly;

  // Etapas criadas pelo gerente de facilities são obrigatórias: a conclusão da OS
  // fica bloqueada até serem marcadas (validado no servidor — D-22).
  const managerPending = items.filter((item) => item.createdByManager && !item.done);

  const addItem = async () => {
    const label = newLabel.trim();
    if (label.length < 3) {
      toast.error("Descreva a etapa em poucas palavras (mínimo 3 caracteres).");
      return;
    }
    setAdding(true);
    try {
      await apiPost(`/api/workorders/${workOrderId}/checklist`, { label });
      setNewLabel("");
      toast.success("Etapa adicionada ao checklist.");
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setAdding(false);
    }
  };

  const toggleItem = async (item: ChecklistItem, next: boolean) => {
    setBusyId(item.id);
    try {
      await apiPatch(`/api/workorders/${workOrderId}/checklist/${item.id}`, { done: next });
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemoveItem = async () => {
    if (!removingItem) return;
    setBusyId(removingItem.id);
    try {
      await apiDelete(`/api/workorders/${workOrderId}/checklist/${removingItem.id}`);
      toast.success("Etapa removida do checklist.");
      setRemovingItem(null);
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const uploadPhoto = async (file: File, itemId: string) => {
    if (!itemId) return;
    setUploadingId(itemId);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", "work_order_checklist_item");
      form.append("entityId", itemId);
      await apiUpload("/api/attachments", form);
      toast.success("Foto capturada e anexada à etapa.");
      setPhotoItemId(null);
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setUploadingId(null);
    }
  };

  const confirmRemovePhoto = async () => {
    if (!removingPhoto) return;
    try {
      await apiDelete(`/api/attachments/${removingPhoto.id}`);
      toast.success("Foto removida.");
      setRemovingPhoto(null);
      onChanged();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  return (
    <Card
      title={`Checklist de execução${items.length > 0 ? ` (${done}/${items.length})` : ""}`}
      description="Etapas do serviço criadas pelo próprio técnico, com foto por etapa."
      actions={
        items.length > 0 ? (
          <Badge tone={percent === 100 ? "green" : "slate"}>{percent}% concluído</Badge>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhuma etapa registrada nesta ordem.
          {editable ? " Adicione o primeiro passo do serviço abaixo." : ""}
        </p>
      ) : (
        <>
          {managerPending.length > 0 ? (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              {managerPending.length} etapa(s) definidas pelo gerente de facilities pendentes — a
              conclusão da ordem fica bloqueada até marcá-las.
            </p>
          ) : null}
          <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${percent === 100 ? "bg-emerald-500" : "bg-brand-600"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-slate-200 px-3 py-2.5">
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-700 focus:ring-brand-600 disabled:opacity-50"
                    checked={item.done}
                    disabled={!editable || busyId === item.id}
                    onChange={(event) => void toggleItem(item, event.target.checked)}
                    aria-label={`Marcar etapa como ${item.done ? "pendente" : "concluída"}: ${item.label}`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm font-medium ${
                          item.done ? "text-slate-500 line-through" : "text-slate-800"
                        }`}
                      >
                        {item.label}
                      </p>
                      {item.createdByManager ? (
                        <Badge tone={item.done ? "slate" : "amber"}>Obrigatório</Badge>
                      ) : null}
                    </div>
                    {item.notes ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{item.notes}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                      {item.done && item.doneByName
                        ? `Concluída por ${item.doneByName}${item.doneAt ? ` em ${formatDateTime(item.doneAt)}` : ""}`
                        : `Criada por ${item.createdByName ?? "-"} em ${formatDateTime(item.createdAt)}`}
                    </p>

                    {item.photos.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {item.photos.map((photo) => (
                          <li key={photo.id} className="group relative">
                            {photo.mimeType.startsWith("image/") ? (
                              <a
                                href={photo.url}
                                target="_blank"
                                rel="noreferrer"
                                title={`${photo.filename} · ${formatBytes(photo.sizeBytes)}`}
                              >
                                <img
                                  src={photo.url}
                                  alt={photo.filename}
                                  className="size-16 rounded-lg border border-slate-200 object-cover"
                                />
                              </a>
                            ) : (
                              <a
                                href={photo.url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-brand-700 hover:underline"
                              >
                                {photo.filename} · {formatBytes(photo.sizeBytes)}
                              </a>
                            )}
                            {editable && (photo.uploadedBy === user?.id || can(PERMISSIONS.SETTINGS_MANAGE)) ? (
                              <button
                                type="button"
                                onClick={() => setRemovingPhoto(photo)}
                                aria-label={`Remover foto ${photo.filename}`}
                                className="absolute -right-1.5 -top-1.5 hidden size-5 items-center justify-center rounded-full bg-slate-900/80 text-xs leading-none text-white group-hover:flex"
                              >
                                ×
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {editable ? (
                    <div className="flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={uploadingId !== null}
                        onClick={() => setPhotoItemId(item.id)}
                      >
                        {uploadingId === item.id ? "Enviando..." : "Tirar foto"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === item.id}
                        onClick={() => setRemovingItem(item)}
                      >
                        Remover
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editable ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-end">
          <Field label="Nova etapa" className="flex-1" htmlFor={`checklist-novo-${code}`}>
            <Input
              id={`checklist-novo-${code}`}
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addItem();
                }
              }}
              placeholder="Ex.: Desligar o quadro antes de trocar a lâmpada"
              maxLength={160}
            />
          </Field>
          <Button loading={adding} disabled={adding} onClick={() => void addItem()}>
            Adicionar etapa
          </Button>
        </div>
      ) : null}

      <CameraCaptureDialog
        open={photoItemId !== null}
        busy={uploadingId !== null}
        onClose={() => setPhotoItemId(null)}
        onCapture={(file) => void uploadPhoto(file, photoItemId ?? "")}
      />

      <Dialog
        open={removingItem !== null}
        title="Remover etapa do checklist"
        onClose={() => setRemovingItem(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemovingItem(null)}>
              Manter etapa
            </Button>
            <Button
              variant="danger"
              loading={removingItem !== null && busyId === removingItem.id}
              onClick={() => void confirmRemoveItem()}
            >
              Remover etapa
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          A etapa <strong>{removingItem?.label}</strong> sai do checklist junto com as fotos anexadas a ela.
          Esta ação não pode ser desfeita.
        </p>
      </Dialog>

      <Dialog
        open={removingPhoto !== null}
        title="Remover foto da etapa"
        onClose={() => setRemovingPhoto(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemovingPhoto(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => void confirmRemovePhoto()}>
              Remover foto
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Remover a foto <strong>{removingPhoto?.filename}</strong>? A etapa continua no checklist.
        </p>
      </Dialog>
    </Card>
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

function eventLabel(event: WorkOrderEvent): string {
  const labels: Record<string, string> = {
    created: "Ordem criada",
    status_change: `Situação alterada${event.fromStatus ? ` de ${WORK_ORDER_STATUS_LABEL[event.fromStatus as WorkOrderStatus] ?? event.fromStatus}` : ""}${
      event.toStatus ? ` para ${WORK_ORDER_STATUS_LABEL[event.toStatus as WorkOrderStatus] ?? event.toStatus}` : ""
    }`,
    assignment: "Responsável alterado",
    comment: "Comentário",
    material_use: "Material registrado",
    checklist: "Checklist",
  };
  return labels[event.type] ?? event.type;
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                      */
/* -------------------------------------------------------------------------- */

function AssignWorkOrderDialog({
  workOrder,
  onClose,
  onSaved,
}: {
  workOrder: WorkOrderRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const users = useActiveUsers();
  const [assigneeId, setAssigneeId] = useState(workOrder.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/workorders/${workOrder.id}/assign`, { assigneeId: assigneeId || null });
      toast.success("Responsável atualizado.");
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
      title="Responsável pela execução"
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
        <Field label="Responsável" hint="Deixe em branco para remover." htmlFor="woAssignSelect">
          <Select id="woAssignSelect" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} autoFocus>
            <option value="">Sem responsável</option>
            {(users.data ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.roleName})
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function StatusDialog({
  workOrder,
  transitions,
  onClose,
  onSaved,
}: {
  workOrder: WorkOrderRow;
  transitions: WorkOrderStatus[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<WorkOrderStatus>(transitions[0] ?? workOrder.status);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ ok: boolean; status: WorkOrderStatus; unchanged?: boolean }>(
        `/api/workorders/${workOrder.id}/status`,
        { status, body: body || null },
      );
      toast.success(result.unchanged ? "A ordem já estava nesta situação." : "Situação atualizada.");
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
      title="Mudar situação da ordem"
      description={`Situação atual: ${WORK_ORDER_STATUS_LABEL[workOrder.status]}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Atualizar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Nova situação" required htmlFor="woStatus">
          <Select
            id="woStatus"
            value={status}
            onChange={(event) => setStatus(event.target.value as WorkOrderStatus)}
          >
            {transitions.map((code) => (
              <option key={code} value={code}>
                {WORK_ORDER_STATUS_LABEL[code]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Observação" hint="Registrada no histórico de eventos." htmlFor="woStatusBody">
          <Textarea id="woStatusBody" rows={2} value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

interface MaterialDraft {
  productId: string;
  qty: string;
}

function WorkOrderMaterialDialog({
  workOrderId,
  onClose,
  onSaved,
}: {
  workOrderId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const [fromLocationId, setFromLocationId] = useState("");
  const [markWaitingOnFailure, setMarkWaitingOnFailure] = useState(true);
  const [items, setItems] = useState<MaterialDraft[]>([{ productId: "", qty: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-wo-mat-${crypto.randomUUID()}`);

  const updateItem = (index: number, patch: Partial<MaterialDraft>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const submit = async () => {
    const parsed = items
      .filter((item) => item.productId && Number(item.qty.replace(",", ".")) > 0)
      .map((item) => ({ productId: item.productId, qty: Number(item.qty.replace(",", ".")) }));
    if (!fromLocationId) {
      setError("Informe de qual local o material foi retirado.");
      return;
    }
    if (parsed.length === 0) {
      setError("Inclua ao menos um produto com quantidade.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/workorders/${workOrderId}/materials`, {
        requestKey,
        fromLocationId,
        markWaitingOnFailure,
        items: parsed,
      });
      toast.success("Material registrado e baixado do estoque.");
      onSaved();
    } catch (cause) {
      // Quando falta estoque e `markWaitingOnFailure` esta ativo, o servidor já
      // moveu a ordem para 'aguardando material' antes de recusar a baixa.
      if (cause instanceof ApiError && cause.code === "INSUFFICIENT_STOCK") {
        toast.error("Estoque insuficiente: a ordem ficou aguardando material e nada foi baixado.");
        onSaved();
      } else {
        setError(apiErrorMessage(cause));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="Registrar material utilizado"
      description="Cada item gera movimentação de consumo vinculada a esta ordem."
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
        <Field label="Retirado de" required htmlFor="woMaterialFrom">
          <Select id="woMaterialFrom" value={fromLocationId} onChange={(event) => setFromLocationId(event.target.value)}>
            <option value="">Selecione o local de estoque...</option>
            {(locations.data ?? []).map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Itens</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setItems((current) => [...current, { productId: "", qty: "" }])}
            >
              Adicionar
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_7rem_2rem]">
                <ProductPicker
                  value={item.productId}
                  onChange={(productId) => updateItem(index, { productId })}
                  ariaLabel={`Produto ${index + 1}`}
                  placeholder="Produto..."
                  activeOnly={false}
                />
                <Input
                  value={item.qty}
                  onChange={(event) => updateItem(index, { qty: event.target.value })}
                  placeholder="Qtd."
                  inputMode="decimal"
                  aria-label={`Quantidade ${index + 1}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={items.length === 1}
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                  aria-label="Remover"
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        </div>
        <Checkbox
          label="Marcar como aguardando material se o estoque não cobrir"
          hint="Nesse caso nenhum item e baixado: a retirada só acontece quando houver saldo."
          checked={markWaitingOnFailure}
          onChange={setMarkWaitingOnFailure}
        />
      </div>
    </Dialog>
  );
}

function CloseWorkOrderDialog({
  workOrder,
  managerPendingLabels,
  onClose,
  onSaved,
}: {
  workOrder: WorkOrderRow;
  managerPendingLabels: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (result.trim().length < 5) {
      setError("Descreva o resultado do serviço (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/workorders/${workOrder.id}/close`, { result, notes: notes || null });
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
      title={`Concluir ${workOrder.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={managerPendingLabels.length > 0}>
            Concluir ordem
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {managerPendingLabels.length > 0 ? (
          <Alert tone="amber">
            <p className="font-semibold">Conclusão bloqueada pelo checklist do gestor</p>
            <p className="mt-1 text-sm">
              Marque as etapas abaixo (definidas pelo gerente de facilities) antes de concluir a
              ordem:
            </p>
            <ul className="mt-1 list-inside list-disc text-sm">
              {managerPendingLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Field label="Resultado do serviço" required htmlFor="woResult">
          <Textarea
            id="woResult"
            rows={4}
            value={result}
            onChange={(event) => setResult(event.target.value)}
            placeholder="O que foi executado, peças trocadas e condições finais."
            autoFocus
          />
        </Field>
        <Field label="Observações" htmlFor="woCloseNotes">
          <Textarea id="woCloseNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function CancelWorkOrderDialog({
  workOrder,
  onClose,
  onSaved,
}: {
  workOrder: WorkOrderRow;
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
      await apiPost(`/api/workorders/${workOrder.id}/cancel`, { reason });
      toast.success("Ordem cancelada.");
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
      title={`Cancelar ${workOrder.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Cancelar ordem
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Alert tone="amber" title="Material já utilizado não e estornado automaticamente">
          Se a ordem consumiu material, faca a correção pelo estoque (reversão da movimentação).
        </Alert>
        <Field label="Motivo" required htmlFor="woCancelReason">
          <Input
            id="woCancelReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: serviço executado por terceiros"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}
