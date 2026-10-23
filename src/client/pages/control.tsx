import { useCallback, useEffect, useMemo, useState } from "react";
import { apiErrorMessage, apiGet, apiPost } from "../lib/api";
import { useAsync } from "../lib/hooks";
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
  Spinner,
  Table,
  Textarea,
  useToast,
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface ControlEntity {
  key: string;
  label: string;
  plural: string;
  permission: string;
  alwaysArchive: boolean;
}

interface ControlledRow {
  id: string;
  label: string;
  code: string | null;
  isActive: boolean;
  deletedAt: string | null;
}

interface ImpactItem {
  key: string;
  label: string;
  count: number;
  blocking: boolean;
  hint: string | null;
}

interface Impact {
  entity: string;
  entityLabel: string;
  id: string;
  label: string;
  code: string | null;
  isActive: boolean;
  deletedAt: string | null;
  mode: "blocked" | "archive" | "delete";
  references: ImpactItem[];
  totalReferences: number;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Central de controle: um lugar único para enxergar e excluir cadastros de
 * qualquer módulo, com prévia de impacto calculada no servidor.
 *
 * A exclusão nunca quebra histórico: quando existe referência, o registro é
 * arquivado (tombstone) e as telas antigas continuam exibindo o nome original
 * com a marca "(excluído)". Sem referência, a linha é removida de verdade.
 */
export function ControlPage() {
  const toast = useToast();
  const entitiesState = useAsync(() => apiGet<{ items: ControlEntity[] }>("/api/control/entities"), []);
  const entities = useMemo(() => entitiesState.data?.items ?? [], [entitiesState.data]);

  const [entityKey, setEntityKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [rows, setRows] = useState<ControlledRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ControlledRow | null>(null);

  useEffect(() => {
    if (!entityKey && entities.length > 0) setEntityKey(entities[0]!.key);
  }, [entities, entityKey]);

  const entity = entities.find((item) => item.key === entityKey) ?? null;

  const load = useCallback(async () => {
    if (!entityKey) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (includeDeleted) params.set("includeDeleted", "1");
      const query = params.toString();
      const result = await apiGet<{ items: ControlledRow[] }>(
        `/api/control/${entityKey}${query ? `?${query}` : ""}`,
      );
      setRows(result.items);
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [entityKey, search, includeDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<ControlledRow>[] = [
    {
      key: "label",
      header: "Registro",
      cell: (row) => (
        <div className="min-w-0">
          <p className={`truncate font-medium ${row.deletedAt ? "text-slate-400 line-through" : "text-slate-800"}`}>
            {row.label}
          </p>
          {row.code ? <p className="truncate text-xs text-slate-500">{row.code}</p> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) =>
        row.deletedAt ? (
          <Badge tone="slate">Excluído</Badge>
        ) : row.isActive ? (
          <Badge tone="green">Ativo</Badge>
        ) : (
          <Badge tone="amber">Inativo</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        row.deletedAt ? (
          <span className="text-xs text-slate-400">Histórico preservado</span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>
            Excluir
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Controle do sistema"
        description="Exclua cadastros com prévia de impacto. O histórico nunca é apagado: registros em uso são arquivados e continuam visíveis como “(excluído)”."
      />

      {entitiesState.loading ? <LoadingBlock /> : null}
      {entitiesState.error ? <ErrorBlock message={entitiesState.error} onRetry={entitiesState.reload} /> : null}

      {entities.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {entities.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setEntityKey(item.key)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                item.key === entityKey
                  ? "border-brand-700 bg-brand-700 text-white"
                  : "border-slate-200 bg-surface text-slate-600 hover:border-brand-300 hover:text-brand-800"
              }`}
            >
              {item.plural}
            </button>
          ))}
        </div>
      ) : null}

      {entity ? (
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-xs">
              <Field label={`Buscar em ${entity.plural.toLowerCase()}`} htmlFor="controlSearch">
                <Input
                  id="controlSearch"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome ou código"
                />
              </Field>
            </div>
            <div className="flex items-center gap-3 pb-1">
              <Checkbox
                label="Mostrar excluídos"
                checked={includeDeleted}
                onChange={(checked) => setIncludeDeleted(checked)}
              />
              <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                {loading ? <Spinner /> : null} Atualizar
              </Button>
            </div>
          </div>

          {error ? <ErrorBlock message={error} onRetry={() => void load()} /> : null}
          {loading && rows.length === 0 ? <LoadingBlock /> : null}

          {!error ? (
            <Table<ControlledRow>
              columns={columns}
              rows={rows}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="Nenhum registro"
                  description={
                    search
                      ? "Nenhum resultado para a busca."
                      : `Nenhum registro em ${entity.plural.toLowerCase()}.`
                  }
                />
              }
            />
          ) : null}
        </Card>
      ) : null}

      {deleting && entity ? (
        <DeleteDialog
          entity={entity}
          row={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(mode) => {
            toast.success(
              mode === "archive"
                ? "Registro arquivado. O histórico continua exibindo o nome original."
                : "Registro excluído definitivamente.",
            );
            setDeleting(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Diálogo de exclusão                                                        */
/* -------------------------------------------------------------------------- */

function DeleteDialog({
  entity,
  row,
  onClose,
  onDeleted,
}: {
  entity: ControlEntity;
  row: ControlledRow;
  onClose: () => void;
  onDeleted: (mode: "archive" | "delete") => void;
}) {
  const toast = useToast();
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<Impact>(`/api/control/${entity.key}/${row.id}/impact`)
      .then((result) => {
        if (alive) setImpact(result);
      })
      .catch((caught) => {
        if (alive) setError(apiErrorMessage(caught));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [entity.key, row.id]);

  const confirm = async () => {
    setSubmitting(true);
    try {
      const result = await apiPost<{ mode: "archive" | "delete" }>(
        `/api/control/${entity.key}/${row.id}/delete`,
        { reason: reason.trim() || null },
      );
      onDeleted(result.mode);
    } catch (caught) {
      toast.error(apiErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const blocked = impact?.mode === "blocked";
  const archive = impact?.mode === "archive";

  return (
    <Dialog
      open
      title={`Excluir ${entity.label.toLowerCase()}: ${row.label}`}
      description="O servidor recalcula o impacto antes de executar. Nada é apagado se houver risco para o histórico."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant={blocked ? "secondary" : archive ? "primary" : "danger"}
            onClick={() => void confirm()}
            disabled={loading || blocked || submitting || !impact}
          >
            {submitting ? <Spinner /> : null}
            {archive ? "Arquivar e preservar histórico" : "Excluir definitivamente"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
          <Spinner /> Calculando impacto...
        </div>
      ) : null}
      {error ? <ErrorBlock message={error} /> : null}

      {impact ? (
        <div className="space-y-4">
          <Alert tone={blocked ? "red" : archive ? "amber" : "red"} title={blocked ? "Exclusão bloqueada" : archive ? "Este registro tem histórico" : "Sem histórico vinculado"}>
            {impact.message}
          </Alert>

          {impact.references.length > 0 ? (
            <div>
              <p className="text-sm font-semibold text-slate-800">O que aponta para este registro</p>
              <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {impact.references.map((item) => (
                  <li key={item.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2 text-slate-700">
                        <span className="capitalize">{item.label}</span>
                        <Badge tone="slate">{item.count}</Badge>
                      </span>
                      {item.hint ? <span className="block text-xs text-slate-500">{item.hint}</span> : null}
                    </span>
                    {item.blocking ? <Badge tone="red">Bloqueia</Badge> : <Badge tone="slate">Histórico</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Nenhum registro aponta para este cadastro. Ele pode ser removido sem afetar o histórico.
            </p>
          )}

          <Field label="Motivo (opcional)" htmlFor="controlReason" hint="Fica registrado na auditoria e no aviso enviado aos administradores.">
            <Textarea
              id="controlReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ex.: sala demolida na reforma do 2º andar"
            />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}
