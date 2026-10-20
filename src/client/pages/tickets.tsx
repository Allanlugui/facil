import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import {
  PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  type Paginated,
  type Priority,
  type TicketStatus,
} from "@shared/types";
import { apiDelete, apiErrorMessage, apiGet, apiPost, apiUpload } from "../lib/api";
import { PRIORITY_TONE, formatBytes, formatDateTime, formatQuantity, plural } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import {
  useActiveUsers,
  useLocations,
  useTicketCategories,
} from "../lib/lookups";
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

export interface TicketRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  locationId: string | null;
  locationName: string | null;
  locationPath: string | null;
  priority: Priority;
  status: TicketStatus;
  requesterId: string;
  requesterName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  workOrderId: string | null;
  workOrderCode: string | null;
  workOrderStatus: string | null;
}

export interface TicketComment {
  id: string;
  body: string;
  isInternal: boolean;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface MaterialUseRow {
  id: string;
  productId: string;
  productName: string;
  sku: string | null;
  uomCode: string;
  qtyMilli: number;
  locationId: string | null;
  locationName: string | null;
  userId: string;
  userName: string;
  occurredAt: string;
  notes: string | null;
  reversesMovementId: string | null;
}

export interface TicketHistoryEntry {
  id: string;
  action: string;
  actorName: string;
  detail: unknown;
  createdAt: string;
}

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  open: "blue",
  in_progress: "amber",
  waiting_material: "amber",
  resolved: "green",
  converted: "violet",
  cancelled: "slate",
};

/* -------------------------------------------------------------------------- */
/* Lista                                                                      */
/* -------------------------------------------------------------------------- */

export function TicketsPage() {
  const { can, user } = useSession();
  const navigate = useNavigate();
  const categories = useTicketCategories();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  // Atalho vindo do painel por perfil: /chamados?novo=1 abre o formulário
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
      apiGet<Paginated<TicketRow>>("/api/tickets", {
        search: debounced || undefined,
        status: status || undefined,
        priority: priority || undefined,
        categoryId: categoryId || undefined,
        assigneeId: assignedToMe ? user?.id : undefined,
        open: onlyOpen ? "true" : undefined,
        page,
        pageSize: 25,
      }),
    [debounced, status, priority, categoryId, assignedToMe, user?.id, onlyOpen, page],
  );

  const columns: Column<TicketRow>[] = [
    {
      key: "ticket",
      header: "Chamado",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {row.code} · {row.title}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.categoryName ?? "Sem categoria"} · {row.locationPath ?? row.locationName ?? "Sem local"}
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
          <Badge tone={TICKET_STATUS_TONE[row.status]}>{TICKET_STATUS_LABEL[row.status]}</Badge>
          {row.workOrderCode ? <Badge tone="violet">OS {row.workOrderCode}</Badge> : null}
        </div>
      ),
    },
    {
      key: "people",
      header: "Solicitante / responsável",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>Por: {row.requesterName}</p>
          <p className="text-slate-500">Com: {row.assigneeName ?? "sem responsável"}</p>
        </div>
      ),
    },
    {
      key: "dates",
      header: "Aberto em",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{formatDateTime(row.createdAt)}</p>
          <p className="text-slate-500">{row.commentCount} {plural(row.commentCount, "comentário", "comentários")}</p>
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="secondary" size="sm" onClick={() => navigate(`/chamados/${row.id}`)}>
          Abrir
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Chamados"
        description="Registro, triagem e resolução de solicitações de manutenção e serviços."
        actions={
          can(PERMISSIONS.TICKETS_CREATE) ? (
            <Button onClick={() => setCreating(true)}>Novo chamado</Button>
          ) : null
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Titulo, descrição ou código..." className="w-full sm:w-64" />
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
            {Object.entries(TICKET_STATUS_LABEL).map(([code, label]) => (
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
          <Select
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-48"
            aria-label="Filtrar por categoria"
          >
            <option value="">Todas as categorias</option>
            {(categories.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
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
            Somente abertos
          </label>
          {can(PERMISSIONS.TICKETS_ASSIGN) ? (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                checked={assignedToMe}
                onChange={(event) => {
                  setAssignedToMe(event.target.checked);
                  setPage(1);
                }}
              />
              Atribuídos a mim
            </label>
          ) : null}
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
                empty={<EmptyState title="Nenhum chamado" description="Nada encontrado com os filtros atuais." />}
                onRowClick={(row) => navigate(`/chamados/${row.id}`)}
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
        <CreateTicketDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/chamados/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}

export function CreateTicketDialog({
  onClose,
  onCreated,
  initialTitle,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  initialTitle?: string;
}) {
  const toast = useToast();
  const locations = useLocations();
  const categories = useTicketCategories();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ id: string; code: string }>("/api/tickets", {
        title,
        description: description || null,
        categoryId: categoryId || null,
        locationId: locationId || null,
        priority,
      });
      toast.success(`Chamado ${result.code} aberto.`);
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
      title="Novo chamado"
      description="Descreva o problema; a triagem define responsável e prioridade final."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Abrir chamado
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Assunto" required htmlFor="ticketTitle">
          <Input
            id="ticketTitle"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ex.: Vazamento na pia do banheiro do 2º andar"
            autoFocus
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" htmlFor="ticketCategory">
            <Select id="ticketCategory" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">Sem categoria</option>
              {(categories.data ?? [])
                .filter((category) => category.isActive)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Local" htmlFor="ticketLocation">
            <Select id="ticketLocation" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">Sem local específico</option>
              {(locations.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Prioridade" htmlFor="ticketPriority">
          <Select
            id="ticketPriority"
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
        <Field label="Descrição" htmlFor="ticketDescription">
          <Textarea
            id="ticketDescription"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="O que aconteceu, onde e desde quando."
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Detalhe                                                                    */
/* -------------------------------------------------------------------------- */

interface TicketDetailResponse {
  ticket: TicketRow;
  comments: TicketComment[];
  materials: MaterialUseRow[];
  history: TicketHistoryEntry[];
}

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const { can } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [assigning, setAssigning] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [converting, setConverting] = useState(false);
  const [usingMaterial, setUsingMaterial] = useState(false);

  const state = useAsync(() => apiGet<TicketDetailResponse>(`/api/tickets/${id}`), [id]);

  if (state.loading && !state.data) return <LoadingBlock label="Carregando o chamado..." />;
  if (state.error && !state.data) return <ErrorBlock message={state.error} onRetry={state.reload} />;
  if (!state.data) return null;

  const { ticket, comments, materials, history } = state.data;
  const active = !["resolved", "closed", "cancelled", "converted"].includes(ticket.status);

  return (
    <div>
      <PageHeader
        title={`${ticket.code} · ${ticket.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TICKET_STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABEL[ticket.status]}</Badge>
            <Badge tone={PRIORITY_TONE[ticket.priority]}>Prioridade {PRIORITY_LABEL[ticket.priority]}</Badge>
            {ticket.categoryName ? <Badge tone="slate">{ticket.categoryName}</Badge> : null}
            {ticket.workOrderCode ? (
              <Link to={`/ordens/${ticket.workOrderId}`} className="text-brand-700 hover:underline">
                <Badge tone="violet">OS {ticket.workOrderCode}</Badge>
              </Link>
            ) : null}
          </span>
        }
        actions={
          <>
            <Link to="/chamados">
              <Button variant="secondary">Voltar</Button>
            </Link>
            {can(PERMISSIONS.TICKETS_ASSIGN) && active ? (
              <Button variant="secondary" onClick={() => setAssigning(true)}>
                {ticket.assigneeId ? "Alterar responsável" : "Atribuir"}
              </Button>
            ) : null}
            {can(PERMISSIONS.WORKORDERS_CREATE) && active && !ticket.workOrderId ? (
              <Button variant="secondary" onClick={() => setConverting(true)}>
                Gerar ordem de serviço
              </Button>
            ) : null}
            {can(PERMISSIONS.WORKORDERS_MATERIAL) && active && !ticket.workOrderId ? (
              <Button variant="secondary" onClick={() => setUsingMaterial(true)}>
                Registrar material
              </Button>
            ) : null}
            {can(PERMISSIONS.TICKETS_RESOLVE) && active ? (
              <Button onClick={() => setResolving(true)}>Resolver</Button>
            ) : null}
            {can(PERMISSIONS.TICKETS_CANCEL) && active ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                Cancelar
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Descrição">
            <p className="whitespace-pre-wrap text-sm text-slate-700">
              {ticket.description ?? "Sem descrição registrada."}
            </p>
            {ticket.resolution ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resolução</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{ticket.resolution}</p>
                <p className="mt-1 text-xs text-slate-500">Concluída em {formatDateTime(ticket.resolvedAt)}</p>
              </div>
            ) : null}
            {ticket.cancelReason ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-600">Cancelamento</p>
                <p className="mt-1 text-sm text-slate-700">{ticket.cancelReason}</p>
              </div>
            ) : null}
          </Card>

          <Card title={`Comentários (${comments.length})`}>
            <CommentBox ticketId={ticket.id} onSaved={state.reload} />
            <ul className="mt-4 space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{comment.userName}</span>
                    <span>{formatDateTime(comment.createdAt)}</span>
                  </div>
                  {comment.isInternal ? (
                    <span className="mt-1 inline-block">
                      <Badge tone="amber">Nota interna</Badge>
                    </span>
                  ) : null}
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">{comment.body}</p>
                </li>
              ))}
              {comments.length === 0 ? (
                <li className="text-sm text-slate-500">Nenhum comentário ainda.</li>
              ) : null}
            </ul>
          </Card>

          <Card title={`Material utilizado (${materials.length})`}>
            {materials.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum material registrado. O consumo de material gera movimentação de estoque vinculada.
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
        </div>

        <div className="space-y-5">
          <Card title="Ficha do chamado">
            <dl className="space-y-3 text-sm">
              <InfoRow label="Solicitante" value={ticket.requesterName} />
              <InfoRow label="Responsável" value={ticket.assigneeName ?? "Sem responsável"} />
              <InfoRow label="Local" value={ticket.locationPath ?? ticket.locationName ?? "-"} />
              <InfoRow label="Aberto em" value={formatDateTime(ticket.createdAt)} />
              <InfoRow label="Atualizado em" value={formatDateTime(ticket.updatedAt)} />
            </dl>
          </Card>

          <AttachmentsCard ticketId={ticket.id} />

          <Card title="Histórico" description="Trilha de auditoria do chamado, em ordem cronológica.">
            <ol className="space-y-3">
              {history.map((entry) => (
                <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                  <p className="text-sm text-slate-700">{historyLabel(entry.action)}</p>
                  <p className="text-xs text-slate-500">
                    {entry.actorName} · {formatDateTime(entry.createdAt)}
                  </p>
                </li>
              ))}
              {history.length === 0 ? <li className="text-sm text-slate-500">Sem eventos.</li> : null}
            </ol>
          </Card>
        </div>
      </div>

      {assigning ? (
        <AssignDialog
          ticket={ticket}
          onClose={() => setAssigning(false)}
          onSaved={() => {
            setAssigning(false);
            toast.success("Responsável atualizado.");
            state.reload();
          }}
        />
      ) : null}

      {resolving ? (
        <ResolveDialog
          ticket={ticket}
          onClose={() => setResolving(false)}
          onSaved={() => {
            setResolving(false);
            state.reload();
          }}
        />
      ) : null}

      {cancelling ? (
        <CancelTicketDialog
          ticket={ticket}
          onClose={() => setCancelling(false)}
          onSaved={() => {
            setCancelling(false);
            state.reload();
          }}
        />
      ) : null}

      {converting ? (
        <ConvertDialog
          ticket={ticket}
          onClose={() => setConverting(false)}
          onSaved={(workOrderId) => {
            setConverting(false);
            state.reload();
            navigate(`/ordens/${workOrderId}`);
          }}
        />
      ) : null}

      {usingMaterial ? (
        <MaterialDialog
          ticketId={ticket.id}
          onClose={() => setUsingMaterial(false)}
          onSaved={() => {
            setUsingMaterial(false);
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

function historyLabel(action: string): string {
  const labels: Record<string, string> = {
    "ticket.create": "Chamado criado",
    "ticket.assign": "Responsável alterado",
    "ticket.update": "Dados atualizados",
    "ticket.resolve": "Chamado resolvido",
    "ticket.cancel": "Chamado cancelado",
    "ticket.convert": "Convertido em ordem de serviço",
    "ticket.material": "Material registrado",
  };
  return labels[action] ?? action;
}

/* -------------------------------------------------------------------------- */
/* Anexos                                                                     */
/* -------------------------------------------------------------------------- */

interface TicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
  url: string;
}

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif";
const ATTACHMENT_ACCEPT = `${IMAGE_ACCEPT},application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx`;

function AttachmentsCard({ ticketId }: { ticketId: string }) {
  const { user, can } = useSession();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<TicketAttachment | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  // F-08: documento (PDF/planilha/texto) só entra com `attachments.documents`
  // (gestão). Quem atende em campo anexa fotos; o servidor confere de novo.
  const canAttachDocuments = can(PERMISSIONS.ATTACHMENTS_DOCUMENTS);

  const state = useAsync(
    () =>
      apiGet<{ items: TicketAttachment[] }>("/api/attachments", {
        entityType: "ticket",
        entityId: ticketId,
      }),
    [ticketId],
  );

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", "ticket");
      form.append("entityId", ticketId);
      await apiUpload("/api/attachments", form);
      toast.success("Anexo enviado.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveLoading(true);
    try {
      await apiDelete(`/api/attachments/${removing.id}`);
      toast.success("Anexo removido.");
      setRemoving(null);
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setRemoveLoading(false);
    }
  };

  const items = state.data?.items ?? [];

  return (
    <Card
      title="Anexos"
      description={
        canAttachDocuments
          ? "Fotos, PDFs e planilhas ligados ao chamado; tamanho e tipo são validados pelo servidor."
          : "Fotos do atendimento ligadas ao chamado; documentos (PDF/planilha) são anexados pela gestão."
      }
      actions={
        <>
          <input
            ref={inputRef}
            type="file"
            accept={canAttachDocuments ? ATTACHMENT_ACCEPT : IMAGE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {canAttachDocuments ? "Anexar arquivo" : "Anexar foto"}
          </Button>
        </>
      }
    >
      {state.loading && !state.data ? <LoadingBlock label="Carregando anexos..." /> : null}
      {state.error ? <ErrorBlock message={state.error} onRetry={state.reload} /> : null}
      {state.data && items.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum anexo neste chamado.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-brand-700 hover:underline"
                >
                  {item.filename}
                </a>
                <p className="text-xs text-slate-500">
                  {formatBytes(item.sizeBytes)} · {item.uploadedByName} · {formatDateTime(item.createdAt)}
                </p>
              </div>
              {user?.id === item.uploadedBy || can(PERMISSIONS.SETTINGS_MANAGE) ? (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(item)}>
                  Remover
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {removing ? (
        <Dialog
          open
          title="Remover anexo"
          description={`O arquivo "${removing.filename}" será removido permanentemente.`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={removeLoading} onClick={confirmRemove}>
                Remover
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">A remoção fica registrada na auditoria do chamado.</p>
        </Dialog>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Ações do chamado                                                           */
/* -------------------------------------------------------------------------- */

function CommentBox({ ticketId, onSaved }: { ticketId: string; onSaved: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (body.trim().length === 0) {
      setError("Escreva um comentário.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/tickets/${ticketId}/comments`, { body, isInternal });
      setBody("");
      setIsInternal(false);
      toast.success("Comentário publicado.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {error ? <Alert tone="red">{error}</Alert> : null}
      <Textarea
        rows={3}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Escreva uma atualização para o chamado..."
        aria-label="Novo comentário"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {can(PERMISSIONS.TICKETS_VIEW_ALL) ? (
          <Checkbox
            label="Nota interna"
            hint="Visível apenas para a equipe com acesso total aos chamados."
            checked={isInternal}
            onChange={setIsInternal}
          />
        ) : (
          <span />
        )}
        <Button size="sm" loading={saving} onClick={submit}>
          Comentar
        </Button>
      </div>
    </div>
  );
}

function AssignDialog({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const users = useActiveUsers();
  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/tickets/${ticket.id}/assign`, { assigneeId: assigneeId || null });
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
      title="Responsável pelo chamado"
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
        <Field label="Responsável" hint="Deixe em branco para remover a atribuição." htmlFor="assigneeId">
          <Select id="assigneeId" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} autoFocus>
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

function ResolveDialog({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [resolution, setResolution] = useState("");
  const [status, setStatus] = useState<"resolved" | "waiting_material" | "in_progress">("resolved");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (resolution.trim().length < 5) {
      setError("Descreva o que foi feito (mínimo 5 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiPost(`/api/tickets/${ticket.id}/resolve`, { resolution, status });
      toast.success(status === "resolved" ? "Chamado resolvido." : "Chamado atualizado.");
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
      title={`Registrar atendimento de ${ticket.code}`}
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
        <Field label="O que foi feito" required htmlFor="resolution">
          <Textarea
            id="resolution"
            rows={4}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
            autoFocus
          />
        </Field>
        <Field
          label="Resultado"
          hint="Use 'aguardando material' quando faltar peça; o chamado permanece aberto."
          htmlFor="resolveStatus"
        >
          <Select
            id="resolveStatus"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="resolved">Resolvido</option>
            <option value="waiting_material">Aguardando material</option>
            <option value="in_progress">Em andamento</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function CancelTicketDialog({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketRow;
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
      await apiPost(`/api/tickets/${ticket.id}/cancel`, { reason });
      toast.success("Chamado cancelado.");
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
      title={`Cancelar ${ticket.code}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Cancelar chamado
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Motivo" required htmlFor="ticketCancelReason">
          <Input
            id="ticketCancelReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: resolvido no local sem gerar registro"
            autoFocus
          />
        </Field>
      </div>
    </Dialog>
  );
}

function ConvertDialog({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketRow;
  onClose: () => void;
  onSaved: (workOrderId: string) => void;
}) {
  const users = useActiveUsers();
  const [title, setTitle] = useState(ticket.title);
  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId ?? "");
  const [priority, setPriority] = useState<Priority>(ticket.priority);
  const [plannedAt, setPlannedAt] = useState("");
  const [requiresMaterial, setRequiresMaterial] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ workOrder: { id: string; code: string }; idempotentReplay?: boolean }>(
        `/api/tickets/${ticket.id}/convert`,
        {
          title,
          assigneeId: assigneeId || null,
          priority,
          plannedAt: plannedAt || null,
          requiresMaterial,
        },
      );
      onSaved(result.workOrder.id);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={"Gerar ordem de serviço"}
      description={`A OS herda os dados de ${ticket.code}. O chamado fica marcado como convertido.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Gerar OS
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Titulo da OS" required htmlFor="woTitle">
          <Input id="woTitle" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsável" htmlFor="woAssignee">
            <Select id="woAssignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">Definir depois</option>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prioridade" htmlFor="woPriority">
            <Select
              id="woPriority"
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
        </div>
        <Field label="Execução planejada para" htmlFor="woPlannedAt">
          <Input
            id="woPlannedAt"
            type="date"
            value={plannedAt}
            onChange={(event) => setPlannedAt(event.target.value)}
          />
        </Field>
        <Checkbox
          label="Vai consumir material do estoque"
          hint="Marca a OS como dependente de material; registre o consumo na ordem."
          checked={requiresMaterial}
          onChange={setRequiresMaterial}
        />
      </div>
    </Dialog>
  );
}

interface MaterialDraft {
  productId: string;
  qty: string;
}

function MaterialDialog({
  ticketId,
  onClose,
  onSaved,
}: {
  ticketId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const [fromLocationId, setFromLocationId] = useState("");
  const [items, setItems] = useState<MaterialDraft[]>([{ productId: "", qty: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestKey] = useState(() => `ui-ticket-mat-${crypto.randomUUID()}`);

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
      await apiPost(`/api/tickets/${ticketId}/materials`, {
        requestKey,
        fromLocationId,
        items: parsed,
      });
      toast.success("Material registrado e baixado do estoque.");
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
      title="Registrar material utilizado"
      description="Cada item gera uma movimentação de consumo vinculada a este chamado."
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
        <Field label="Retirado de" required htmlFor="materialFrom">
          <Select
            id="materialFrom"
            value={fromLocationId}
            onChange={(event) => setFromLocationId(event.target.value)}
          >
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
      </div>
    </Dialog>
  );
}
