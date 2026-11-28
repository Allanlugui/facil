import { useState, type ReactNode } from "react";
import { PERMISSIONS } from "@shared/permissions";
import { apiErrorMessage, apiDelete, apiGet, apiPatch, apiPost, fieldErrors } from "../lib/api";
import { plural } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";
import {
  Badge,
  Button,
  ChevronIcon,
  Dialog,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
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

interface UnitRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  locationCount: number;
}

interface LocationTypeRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
}

interface LocationRow {
  id: string;
  unitId: string;
  unitName: string | null;
  parentId: string | null;
  parentName: string | null;
  typeId: string;
  typeName: string | null;
  typeCode: string | null;
  name: string;
  code: string | null;
  path: string;
  notes: string | null;
  isActive: boolean;
  childCount: number | undefined;
}

type Tab = "units" | "types" | "locations";

/* -------------------------------------------------------------------------- */
/* Página principal                                                           */
/* -------------------------------------------------------------------------- */

export default function StructurePage() {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));
  const raw = params.get("tab");
  const tab: Tab = raw === "types" || raw === "locations" ? raw : "units";

  return (
    <div>
      <PageHeader
        title="Estrutura"
        description="Unidades, tipos de local e hierarquia de ambientes da empresa."
      />
      <Tabs
        tabs={[
          { value: "units", label: "Unidades" },
          { value: "types", label: "Tipos de local" },
          { value: "locations", label: "Locais" },
        ]}
        value={tab}
        onChange={(value) => {
          const next = new URLSearchParams(params);
          next.set("tab", value);
          setParams(next);
        }}
      />
      {tab === "units" ? <UnitsTab /> : null}
      {tab === "types" ? <TypesTab /> : null}
      {tab === "locations" ? <LocationsTab /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Unidades                                                                   */
/* -------------------------------------------------------------------------- */

function UnitsTab() {
  const { can } = useSession();
  const manage = can(PERMISSIONS.STRUCTURE_MANAGE);
  const toast = useToast();
  const state = useAsync(() => apiGet<{ items: UnitRow[] }>("/api/structure/units"), []);
  const [editing, setEditing] = useState<UnitRow | "new" | null>(null);

  const columns: Column<UnitRow>[] = [
    {
      key: "unit",
      header: "Unidade",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-slate-500">{row.code}</p>
        </div>
      ),
    },
    { key: "address", header: "Endereço", hideOnMobile: true, cell: (row) => row.address ?? "—" },
    { key: "locations", header: "Locais", cell: (row) => row.locationCount },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge tone={row.isActive ? "green" : "slate"}>{row.isActive ? "Ativo" : "Inativo"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        manage ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
            Editar
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{state.data?.items.length ?? 0} unidades</p>
        {manage ? <Button onClick={() => setEditing("new")}>Nova unidade</Button> : null}
      </div>
      {state.loading ? <LoadingBlock /> : null}
      {state.error ? <ErrorBlock message={state.error} onRetry={state.reload} /> : null}
      {state.data ? (
        state.data.items.length === 0 ? (
          <EmptyState title="Nenhuma unidade" description="Cadastre a primeira unidade da empresa." />
        ) : (
          <Table<UnitRow> columns={columns} rows={state.data?.items ?? []} keyOf={(row) => row.id} empty={<EmptyState title="Nenhuma unidade" description="Cadastre a primeira unidade." />} />
        )
      ) : null}
      {editing ? (
        <UnitDialog
          unit={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
            toast.success("Unidade salva.");
          }}
        />
      ) : null}
    </div>
  );
}

function UnitDialog({
  unit,
  onClose,
  onSaved,
}: {
  unit: UnitRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(unit?.name ?? "");
  const [code, setCode] = useState(unit?.code ?? "");
  const [address, setAddress] = useState(unit?.address ?? "");
  const [notes, setNotes] = useState(unit?.notes ?? "");
  const [isActive, setIsActive] = useState(unit?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = { name, code, address: address || null, notes: notes || null, isActive };
      if (unit) {
        await apiPatch(`/api/structure/units/${unit.id}`, body);
      } else {
        await apiPost("/api/structure/units", { name, code, address: address || null, notes: notes || null });
      }
      onSaved();
    } catch (error) {
      const fe = fieldErrors(error);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={unit ? "Editar unidade" : "Nova unidade"}>
      <div className="space-y-4">
        <Field label="Nome" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Código" error={errors.code}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!unit} />
        </Field>
        <Field label="Endereço" error={errors.address}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Observações" error={errors.notes}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {unit ? (
          <Field label="Status">
            <Select value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </Field>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Tipos de local                                                             */
/* -------------------------------------------------------------------------- */

function TypesTab() {
  const { can } = useSession();
  const manage = can(PERMISSIONS.STRUCTURE_MANAGE);
  const toast = useToast();
  const state = useAsync(() => apiGet<{ items: LocationTypeRow[] }>("/api/structure/location-types"), []);
  const [editing, setEditing] = useState<LocationTypeRow | "new" | null>(null);

  const columns: Column<LocationTypeRow>[] = [
    {
      key: "type",
      header: "Tipo",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-slate-500">{row.code}</p>
        </div>
      ),
    },
    { key: "description", header: "Descrição", hideOnMobile: true, cell: (row) => row.description ?? "—" },
    { key: "order", header: "Ordem", hideOnMobile: true, cell: (row) => row.sortOrder },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge tone={row.isActive ? "green" : "slate"}>{row.isActive ? "Ativo" : "Inativo"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        manage ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
            Editar
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{state.data?.items.length ?? 0} tipos</p>
        {manage ? <Button onClick={() => setEditing("new")}>Novo tipo</Button> : null}
      </div>
      {state.loading ? <LoadingBlock /> : null}
      {state.error ? <ErrorBlock message={state.error} onRetry={state.reload} /> : null}
      {state.data ? (
        state.data.items.length === 0 ? (
          <EmptyState title="Nenhum tipo" description="Cadastre os tipos de local usados na estrutura." />
        ) : (
          <Table<LocationTypeRow> columns={columns} rows={state.data?.items ?? []} keyOf={(row) => row.id} empty={<EmptyState title="Nenhum tipo" description="Cadastre tipos de local." />} />
        )
      ) : null}
      {editing ? (
        <TypeDialog
          type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
            toast.success("Tipo salvo.");
          }}
        />
      ) : null}
    </div>
  );
}

function TypeDialog({
  type,
  onClose,
  onSaved,
}: {
  type: LocationTypeRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(type?.name ?? "");
  const [code, setCode] = useState(type?.code ?? "");
  const [description, setDescription] = useState(type?.description ?? "");
  const [sortOrder, setSortOrder] = useState(type?.sortOrder ?? 100);
  const [isActive, setIsActive] = useState(type?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      if (type) {
        await apiPatch(`/api/structure/location-types/${type.id}`, {
          name,
          code,
          description: description || null,
          sortOrder,
          isActive,
        });
      } else {
        await apiPost("/api/structure/location-types", {
          name,
          code,
          description: description || null,
          sortOrder,
        });
      }
      onSaved();
    } catch (error) {
      const fe = fieldErrors(error);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={type ? "Editar tipo de local" : "Novo tipo de local"}>
      <div className="space-y-4">
        <Field label="Nome" error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Código" error={errors.code}>
          <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!type} />
        </Field>
        <Field label="Descrição" error={errors.description}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Ordem" error={errors.sortOrder}>
          <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </Field>
        {type ? (
          <Field label="Status">
            <Select value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </Field>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Locais                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * F-14: alvo de edição na aba Locais — criação de raiz, sublocal a partir de
 * um nó da árvore (pai pré-selecionado) ou edição.
 */
type LocationTarget =
  | { mode: "new" }
  | { mode: "child"; parent: LocationRow }
  | { mode: "edit"; row: LocationRow };

function LocationsTab() {
  const { can } = useSession();
  const manage = can(PERMISSIONS.STRUCTURE_MANAGE);
  const toast = useToast();
  const [unitFilter, setUnitFilter] = useState("");
  const [view, setView] = useState<"tree" | "table">("tree");
  const [target, setTarget] = useState<LocationTarget | null>(null);

  const units = useAsync(() => apiGet<{ items: { id: string; name: string }[] }>("/api/structure/units"), []);
  const types = useAsync(() => apiGet<{ items: LocationTypeRow[] }>("/api/structure/location-types"), []);
  const state = useAsync(
    () =>
      apiGet<{ items: LocationRow[] }>("/api/structure/locations", {
        unitId: unitFilter || undefined,
        limit: 2000,
      }),
    [unitFilter],
  );

  const unitOptions = units.data?.items ?? [];
  const typeOptions = types.data?.items ?? [];
  const items = state.data?.items ?? [];
  const showUnit = !unitFilter;

  const columns: Column<LocationRow>[] = [
    {
      key: "location",
      header: "Local",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-slate-500">
            {row.typeName ?? row.typeCode ?? "—"}
            {row.code ? ` · ${row.code}` : ""}
          </p>
        </div>
      ),
    },
    { key: "unit", header: "Unidade", hideOnMobile: true, cell: (row) => row.unitName ?? "—" },
    { key: "parent", header: "Superior", hideOnMobile: true, cell: (row) => row.parentName ?? "—" },
    { key: "path", header: "Caminho", hideOnMobile: true, cell: (row) => <span className="text-xs text-slate-500">{row.path}</span> },
    {
      key: "status",
      header: "Status",
      cell: (row) => <Badge tone={row.isActive ? "green" : "slate"}>{row.isActive ? "Ativo" : "Inativo"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      cell: (row) =>
        manage ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setTarget({ mode: "edit", row })}>
              Editar
            </Button>
            {row.isActive ? (
              <Button size="sm" variant="ghost" onClick={() => deactivate(row)}>
                Desativar
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  const deactivate = async (row: LocationRow) => {
    if (!window.confirm(`Desativar "${row.name}"?`)) return;
    try {
      await apiDelete(`/api/structure/locations/${row.id}`);
      state.reload();
      toast.success("Local desativado.");
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-48">
          <option value="">Todas as unidades</option>
          {unitOptions.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Modo de visualização">
          <button
            type="button"
            onClick={() => setView("tree")}
            className={
              view === "tree"
                ? "rounded-md bg-white px-3 py-1 text-sm font-medium text-slate-800 shadow-sm"
                : "rounded-md px-3 py-1 text-sm text-slate-600 hover:text-slate-800"
            }
          >
            Árvore
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={
              view === "table"
                ? "rounded-md bg-white px-3 py-1 text-sm font-medium text-slate-800 shadow-sm"
                : "rounded-md px-3 py-1 text-sm text-slate-600 hover:text-slate-800"
            }
          >
            Tabela
          </button>
        </div>
        <div className="ml-auto">
          {manage ? <Button onClick={() => setTarget({ mode: "new" })}>Novo local</Button> : null}
        </div>
      </div>
      {state.loading ? <LoadingBlock /> : null}
      {state.error ? <ErrorBlock message={state.error} onRetry={state.reload} /> : null}
      {state.data ? (
        items.length === 0 ? (
          <EmptyState title="Nenhum local" description="Cadastre locais para esta unidade." />
        ) : view === "tree" ? (
          <LocationsTree
            items={items}
            manage={manage}
            showUnit={showUnit}
            onEdit={(row) => setTarget({ mode: "edit", row })}
            onAddChild={(parent) => setTarget({ mode: "child", parent })}
            onDeactivate={deactivate}
          />
        ) : (
          <Table<LocationRow> columns={columns} rows={items} keyOf={(row) => row.id} empty={<EmptyState title="Nenhum local" description="Cadastre locais para esta unidade." />} />
        )
      ) : null}
      {target ? (
        <LocationDialog
          location={target.mode === "edit" ? target.row : null}
          defaultParentId={target.mode === "child" ? target.parent.id : undefined}
          defaultUnitId={target.mode === "child" ? target.parent.unitId : undefined}
          units={unitOptions}
          types={typeOptions}
          allLocations={items}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            state.reload();
            toast.success("Local salvo.");
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * F-14: visão em árvore dos locais da unidade — o usuário enxerga a hierarquia
 * (antes só via colunas "Superior"/"Caminho"), expande/recolhe ramos e cria
 * sublocais direto no nó, sem sair da tela.
 */
function LocationsTree({
  items,
  manage,
  showUnit,
  onEdit,
  onAddChild,
  onDeactivate,
}: {
  items: LocationRow[];
  manage: boolean;
  showUnit: boolean;
  onEdit: (row: LocationRow) => void;
  onAddChild: (row: LocationRow) => void;
  onDeactivate: (row: LocationRow) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const ids = new Set(items.map((item) => item.id));
  const childrenOf = new Map<string, LocationRow[]>();
  const roots: LocationRow[] = [];
  for (const item of items) {
    const key = item.parentId && ids.has(item.parentId) ? item.parentId : "";
    if (key === "") roots.push(item);
    else {
      const bucket = childrenOf.get(key) ?? [];
      bucket.push(item);
      childrenOf.set(key, bucket);
    }
  }
  const byPath = (a: LocationRow, b: LocationRow) => a.path.localeCompare(b.path, "pt-BR");
  roots.sort(byPath);
  for (const bucket of childrenOf.values()) bucket.sort(byPath);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderNodes = (nodes: LocationRow[], depth: number): ReactNode =>
    nodes.map((node) => {
      const children = childrenOf.get(node.id) ?? [];
      const isCollapsed = collapsed.has(node.id);
      return (
        <li key={node.id}>
          <div
            className="flex items-start gap-1.5 rounded-lg px-2 py-1.5 hover:bg-slate-50"
            style={{ marginLeft: depth * 20 }}
          >
            {children.length > 0 ? (
              <button
                type="button"
                onClick={() => toggle(node.id)}
                aria-label={isCollapsed ? `Expandir ${node.name}` : `Recolher ${node.name}`}
                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
              >
                <ChevronIcon
                  className={`size-3.5 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                />
              </button>
            ) : (
              <span className="mt-0.5 inline-block w-5 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800">{node.name}</p>
              <p className="truncate text-xs text-slate-500">
                {node.typeName ?? node.typeCode ?? "—"}
                {node.code ? ` · ${node.code}` : ""}
                {showUnit && node.unitName ? ` · ${node.unitName}` : ""}
                {children.length > 0
                  ? ` · ${children.length} ${plural(children.length, "sublocal", "sublocais")}`
                  : ""}
              </p>
            </div>
            {!node.isActive ? <Badge tone="slate">Inativo</Badge> : null}
            {manage ? (
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => onEdit(node)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onAddChild(node)}>
                  + Sublocal
                </Button>
                {node.isActive ? (
                  <Button size="sm" variant="ghost" onClick={() => onDeactivate(node)}>
                    Desativar
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          {children.length > 0 && !isCollapsed ? <ul>{renderNodes(children, depth + 1)}</ul> : null}
        </li>
      );
    });

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white px-1 py-1">
      {renderNodes(roots, 0)}
    </ul>
  );
}

function LocationDialog({
  location,
  defaultParentId,
  defaultUnitId,
  units,
  types,
  allLocations,
  onClose,
  onSaved,
}: {
  location: LocationRow | null;
  defaultParentId?: string;
  defaultUnitId?: string;
  units: { id: string; name: string }[];
  types: LocationTypeRow[];
  allLocations: LocationRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [unitId, setUnitId] = useState(location?.unitId ?? defaultUnitId ?? (units[0]?.id ?? ""));
  const [parentId, setParentId] = useState(location?.parentId ?? defaultParentId ?? "");
  const [typeId, setTypeId] = useState(location?.typeId ?? (types[0]?.id ?? ""));
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [notes, setNotes] = useState(location?.notes ?? "");
  const [isActive, setIsActive] = useState(location?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const body = {
        unitId,
        parentId: parentId || null,
        typeId,
        name,
        code: code || null,
        notes: notes || null,
        isActive,
      };
      if (location) {
        await apiPatch(`/api/structure/locations/${location.id}`, body);
      } else {
        await apiPost("/api/structure/locations", body);
      }
      onSaved();
    } catch (error) {
      const fe = fieldErrors(error);
      if (Object.keys(fe).length > 0) setErrors(fe);
      else toast.error(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const parentOptions = allLocations.filter((l) => l.unitId === unitId && l.id !== location?.id);

  return (
    <Dialog open onClose={onClose} title={location ? "Editar local" : "Novo local"}>
      <div className="space-y-4">
        <Field label="Unidade" error={errors.unitId}>
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de local" error={errors.typeId}>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Local superior (opcional)" error={errors.parentId}>
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Nenhum (raiz)</option>
            {parentOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.path}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome" error={errors.name}>
          <Input id="locationFormName" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {/* F-14: menos campos por tela — código e observações ficam sob demanda. */}
        <details
          open={Boolean(location?.code || location?.notes)}
          className="rounded-lg border border-slate-200 px-3 py-2"
        >
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Mais opções</summary>
          <div className="mt-3 space-y-3">
            <Field label="Código" error={errors.code}>
              <Input id="locationFormCode" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="Observações" error={errors.notes}>
              <Textarea id="locationFormNotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </details>
        {location ? (
          <Field label="Status">
            <Select value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
              <option value="1">Ativo</option>
              <option value="0">Inativo</option>
            </Select>
          </Field>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}


