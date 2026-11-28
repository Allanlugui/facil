import { useState } from "react";
import { apiGet } from "../lib/api";
import { fromLocalInput, formatDateTime } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useActiveUsers } from "../lib/lookups";
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
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string;
  module: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  result: string;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface FacetsResponse {
  modules: { module: string; count: number }[];
  actions: { module: string; action: string; count: number }[];
}

const MODULE_LABEL: Record<string, string> = {
  auth: "Acesso",
  structure: "Estrutura",
  users: "Usuários",
  catalog: "Catálogo",
  stock: "Estoque",
  consumption: "Consumo",
  inventory: "Inventário",
  tickets: "Chamados",
  workorders: "Ordens de serviço",
  purchases: "Compras",
  settings: "Configurações",
  reports: "Relatórios",
};

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function AuditPage() {
  const users = useActiveUsers();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [module, setModule] = useState("");
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [result, setResult] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const facets = useAsync(() => apiGet<FacetsResponse>("/api/audit/facets"), []);

  const state = useAsync(
    () =>
      apiGet<{ items: AuditRow[]; total: number; page: number; pageSize: number }>("/api/audit", {
        search: debounced || undefined,
        module: module || undefined,
        action: action || undefined,
        actorId: actorId || undefined,
        result: result || undefined,
        entityType: entityType || undefined,
        from: from ? fromLocalInput(`${from}T00:00`) : undefined,
        to: to ? fromLocalInput(`${to}T23:59`) : undefined,
        page,
        pageSize: 50,
      }),
    [debounced, module, action, actorId, result, entityType, from, to, page],
  );

  const moduleActions = (facets.data?.actions ?? []).filter(
    (entry) => !module || entry.module === module,
  );

  const columns: Column<AuditRow>[] = [
    {
      key: "when",
      header: "Quando",
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{formatDateTime(row.createdAt)}</p>
          <p className="text-slate-500">{row.ip ?? "IP não registrado"}</p>
        </div>
      ),
    },
    {
      key: "actor",
      header: "Quem",
      cell: (row) => (
        <div className="text-xs">
          <p className="text-slate-800">{row.actorName}</p>
          <p className="text-slate-500">{row.actorId ? "usuário autenticado" : "sistema"}</p>
        </div>
      ),
    },
    {
      key: "action",
      header: "Ação",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {MODULE_LABEL[row.module] ?? row.module} · {row.action}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.entityType ? `${row.entityType}${row.entityId ? ` · ${row.entityId}` : ""}` : "sem entidade"}
          </p>
        </div>
      ),
    },
    {
      key: "result",
      header: "Resultado",
      cell: (row) =>
        row.result === "success" ? <Badge tone="green">Sucesso</Badge> : <Badge tone="red">Negado</Badge>,
    },
    {
      key: "reason",
      header: "Motivo",
      hideOnMobile: true,
      cell: (row) => <span className="text-xs text-slate-600">{row.reason ?? "-"}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) => (
        <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>
          Detalhes
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Trilha imutável de ações: quem fez, quando, o que mudou e o que foi negado."
        backTo="/configuracoes/administracao"
        backLabel="Voltar à administração"
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Pessoa, ação, entidade ou motivo..."
            className="w-full sm:w-64"
          />
          <Select
            value={module}
            onChange={(event) => {
              setModule(event.target.value);
              setAction("");
              setPage(1);
            }}
            className="w-full sm:w-44"
            aria-label="Módulo"
          >
            <option value="">Todos os módulos</option>
            {(facets.data?.modules ?? []).map((entry) => (
              <option key={entry.module} value={entry.module}>
                {MODULE_LABEL[entry.module] ?? entry.module} ({entry.count})
              </option>
            ))}
          </Select>
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-52"
            aria-label="Ação"
          >
            <option value="">Todas as ações</option>
            {moduleActions.map((entry) => (
              <option key={entry.action} value={entry.action}>
                {entry.action} ({entry.count})
              </option>
            ))}
          </Select>
          <Select
            value={actorId}
            onChange={(event) => {
              setActorId(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-48"
            aria-label="Usuário"
          >
            <option value="">Todos os usuários</option>
            {(users.data ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
          <Select
            value={result}
            onChange={(event) => {
              setResult(event.target.value);
              setPage(1);
            }}
            className="w-full sm:w-40"
            aria-label="Resultado"
          >
            <option value="">Todos os resultados</option>
            <option value="success">Sucesso</option>
            <option value="failure">Negado</option>
          </Select>
          <Input
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
            placeholder="Tipo de entidade (ex.: product)"
            className="w-full sm:w-56"
            aria-label="Tipo de entidade"
          />
          <Field label="De" className="w-full sm:w-40" htmlFor="auditFrom">
            <Input
              id="auditFrom"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Até" className="w-full sm:w-40" htmlFor="auditTo">
            <Input
              id="auditTo"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </Field>
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
                    title="Nenhum registro"
                    description="Nada encontrado com os filtros atuais. Ajuste o período ou limpe os filtros."
                  />
                }
              />
              <div className="mt-3">
                <Pagination
                  page={state.data?.page ?? 1}
                  pageSize={state.data?.pageSize ?? 50}
                  total={state.data?.total ?? 0}
                  onPage={setPage}
                />
              </div>
            </>
          )}
        </div>
      </Card>

      {detail ? (
        <AuditDetailDialog
          id={detail.id}
          onClose={() => {
            setDetail(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AuditDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const state = useAsync(() => apiGet<AuditRow>(`/api/audit/${id}`), [id]);

  return (
    <Dialog open wide title="Detalhe do registro" onClose={onClose}>
      {state.loading && !state.data ? (
        <LoadingBlock />
      ) : state.error ? (
        <ErrorBlock message={state.error} onRetry={state.reload} />
      ) : state.data ? (
        <div className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Quando" value={formatDateTime(state.data.createdAt)} />
            <Info label="Quem" value={state.data.actorName} />
            <Info label="Módulo" value={MODULE_LABEL[state.data.module] ?? state.data.module} />
            <Info label="Ação" value={state.data.action} />
            <Info
              label="Entidade"
              value={
                state.data.entityType
                  ? `${state.data.entityType}${state.data.entityId ? ` · ${state.data.entityId}` : ""}`
                  : "-"
              }
            />
            <Info
              label="Resultado"
              value={state.data.result === "success" ? "Sucesso" : "Negado"}
            />
            <Info label="IP" value={state.data.ip ?? "-"} />
            <Info label="Navegador" value={state.data.userAgent ?? "-"} />
          </div>

          {state.data.reason ? (
            <Alert tone="slate" title="Motivo / justificativa">
              {state.data.reason}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <JsonBlock title="Antes" value={state.data.before} />
            <JsonBlock title="Depois" value={state.data.after} />
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
      <p className="mt-0.5 break-words text-slate-800">{value}</p>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
        {value === null || value === undefined ? "sem dados" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
