import { useState } from "react";
import { locationLabel } from "@shared/locations";
import { PERMISSIONS } from "@shared/permissions";
import { apiErrorMessage, apiGet, apiPatch, apiPost, apiPut, fieldErrors } from "../lib/api";
import { formatRelative, plural } from "../lib/format";
import { useAsync, useDebounced } from "../lib/hooks";
import { useLocations, useUnits } from "../lib/lookups";
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
  Tabs,
  Textarea,
  useToast,
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface UserRow {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  roleCode: string;
  unitId: string | null;
  unitName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  departmentIsPurchasing: boolean;
  managedDepartmentIds: string[];
  employeeCode: string | null;
  phone: string | null;
  jobTitle: string | null;
  notes: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  locationScope: { id: string; path: string }[];
}

interface RoleRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  userCount: number;
  permissions: string[];
}

interface PermissionGroup {
  key: string;
  label: string;
  codes: { code: string; label: string }[];
}

interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  isPurchasing: boolean;
  isActive: boolean;
  notes: string | null;
  managers: { id: string; name: string }[];
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function UsersPage() {
  const [tab, setTab] = useState<"users" | "departments" | "roles">("users");

  return (
    <div>
      <PageHeader
        title="Usuários e permissões"
        description="Contas de acesso, setores, gestores responsáveis e a matriz de permissões aplicada pelo servidor em cada requisição."
      />
      <Tabs
        tabs={[
          { value: "users", label: "Usuários" },
          { value: "departments", label: "Setores e gestores" },
          { value: "roles", label: "Perfis e permissões" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "users" ? <UsersTab /> : null}
      {tab === "departments" ? <DepartmentsTab /> : null}
      {tab === "roles" ? <RolesTab /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Usuários                                                                   */
/* -------------------------------------------------------------------------- */

function UsersTab() {
  const { can, user: currentUser } = useSession();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const [roleId, setRoleId] = useState("");
  const [isActive, setIsActive] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [scopesFor, setScopesFor] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const roles = useAsync(async () => {
    const result = await apiGet<{ items: RoleRow[] }>("/api/users/roles");
    return result.items;
  }, []);
  const departments = useAsync(async () => {
    const result = await apiGet<{ items: DepartmentRow[] }>("/api/users/departments");
    return result.items;
  }, []);

  const state = useAsync(
    () =>
      apiGet<{ items: UserRow[]; total: number; page: number; pageSize: number }>("/api/users/users", {
        search: debounced || undefined,
        roleId: roleId || undefined,
        isActive: isActive || undefined,
        page,
        pageSize: 25,
      }),
    [debounced, roleId, isActive, page],
  );

  const manage = can(PERMISSIONS.USERS_MANAGE);

  const columns: Column<UserRow>[] = [
    {
      key: "person",
      header: "Colaborador",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">
            {row.name}
            {row.id === currentUser?.id ? <span className="text-slate-400"> (você)</span> : null}
          </p>
          <p className="truncate text-xs text-slate-500">{row.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Perfil e setor",
      cell: (row) => (
        <div className="text-xs">
          <Badge tone="blue">{row.roleName}</Badge>
          <p className="mt-1 text-slate-500">
            {row.departmentName ?? "Sem setor"}
            {row.unitName ? ` · ${row.unitName}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "job",
      header: "Cargo",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.jobTitle ?? "-"}</p>
          <p className="text-slate-500">{row.employeeCode ?? ""}</p>
        </div>
      ),
    },
    {
      key: "scopes",
      header: "Locais",
      hideOnMobile: true,
      cell: (row) =>
        row.locationScope.length === 0 ? (
          <span className="text-xs text-slate-500">Todos os locais da unidade</span>
        ) : (
          <span className="text-xs text-slate-600">
            {row.locationScope.length} {plural(row.locationScope.length, "local", "locais")}: {row.locationScope.map((scope) => scope.path).join(", ")}
          </span>
        ),
    },
    {
      key: "access",
      header: "Último acesso",
      hideOnMobile: true,
      cell: (row) => (
        <div className="text-xs text-slate-600">
          <p>{row.lastLoginAt ? formatRelative(row.lastLoginAt) : "Nunca acessou"}</p>
          {row.mustChangePassword ? <p className="text-amber-700">Troca de senha pendente</p> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (row.isActive ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setScopesFor(row)}>
              Locais
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setResetting(row)}>
              Nova senha
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Nome, e-mail ou matricula..."
          className="w-full sm:w-64"
        />
        <Select
          value={roleId}
          onChange={(event) => {
            setRoleId(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-52"
          aria-label="Perfil"
        >
          <option value="">Todos os perfis</option>
          {(roles.data ?? []).map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </Select>
        <Select
          value={isActive}
          onChange={(event) => {
            setIsActive(event.target.value);
            setPage(1);
          }}
          className="w-full sm:w-40"
          aria-label="Situação"
        >
          <option value="">Ativos e inativos</option>
          <option value="true">Somente ativos</option>
          <option value="false">Somente inativos</option>
        </Select>
        {manage ? (
          <div className="ml-auto">
            <Button onClick={() => setCreating(true)}>Novo usuário</Button>
          </div>
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
              empty={<EmptyState title="Nenhum usuário" description="Nada encontrado com os filtros atuais." />}
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

      {creating ? (
        <UserDialog
          roles={roles.data ?? []}
          departments={departments.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            state.reload();
          }}
        />
      ) : null}

      {editing ? (
        <UserDialog
          user={editing}
          roles={roles.data ?? []}
          departments={departments.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}

      {scopesFor ? (
        <ScopesDialog
          user={scopesFor}
          onClose={() => setScopesFor(null)}
          onSaved={() => {
            setScopesFor(null);
            state.reload();
          }}
        />
      ) : null}

      {resetting ? (
        <ResetPasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => {
            setResetting(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function UserDialog({
  user,
  roles,
  departments,
  onClose,
  onSaved,
}: {
  user?: UserRow;
  roles: RoleRow[];
  departments: DepartmentRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const units = useUnits();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [roleId, setRoleId] = useState(user?.roleId ?? "");
  const [unitId, setUnitId] = useState(user?.unitId ?? "");
  const [departmentId, setDepartmentId] = useState(user?.departmentId ?? "");
  const [managedDepartmentIds, setManagedDepartmentIds] = useState<string[]>(
    user?.managedDepartmentIds ?? [],
  );
  const [employeeCode, setEmployeeCode] = useState(user?.employeeCode ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? "");
  const [notes, setNotes] = useState(user?.notes ?? "");
  const [password, setPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(user?.mustChangePassword ?? true);
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      if (user) {
        await apiPatch(`/api/users/users/${user.id}`, {
          name,
          email,
          roleId,
          unitId: unitId || null,
          departmentId: departmentId || null,
          managedDepartmentIds,
          employeeCode: employeeCode || null,
          phone: phone || null,
          jobTitle: jobTitle || null,
          notes: notes || null,
          isActive,
        });
        toast.success("Usuário atualizado.");
        onSaved();
      } else {
        const result = await apiPost<{ id: string; temporaryPassword?: string }>("/api/users/users", {
          name,
          email,
          roleId,
          unitId: unitId || null,
          departmentId: departmentId || null,
          managedDepartmentIds,
          employeeCode: employeeCode || null,
          phone: phone || null,
          jobTitle: jobTitle || null,
          notes: notes || null,
          password: password || undefined,
          mustChangePassword,
        });
        if (result.temporaryPassword) {
          setTemporaryPassword(result.temporaryPassword);
          toast.success("Usuário criado. Entregue a senha temporária exibida na tela.");
        } else {
          toast.success("Usuário criado.");
          onSaved();
        }
      }
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setErrors(fieldErrors(cause));
    } finally {
      setSaving(false);
    }
  };

  if (temporaryPassword) {
    return (
      <Dialog
        open
        title="Senha temporária gerada"
        description="Esta senha aparece UMA ÚNICA VEZ. Copie e entregue ao colaborador."
        onClose={onSaved}
        footer={
          <Button onClick={onSaved}>Entendi, já anotei</Button>
        }
      >
        <div className="space-y-4">
          <Alert tone="amber" title="Anote agora">
            A senha não pode ser consultada depois. Se perder o acesso, gere outra em "Nova senha".
          </Alert>
          <p className="select-all rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-lg text-slate-900">
            {temporaryPassword}
          </p>
          {mustChangePassword ? (
            <p className="text-sm text-slate-600">
              O colaborador será obrigado a trocar a senha no primeiro acesso.
            </p>
          ) : null}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      wide
      title={user ? `Editar ${user.name}` : "Novo usuário"}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" required error={errors.name} htmlFor="userName">
            <Input id="userName" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label="E-mail" required error={errors.email} htmlFor="userEmail">
            <Input
              id="userEmail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Field label="Perfil de acesso" required error={errors.roleId} htmlFor="userRole">
            <Select id="userRole" value={roleId} onChange={(event) => setRoleId(event.target.value)}>
              <option value="">Selecione...</option>
              {roles
                .filter((role) => role.isActive || role.id === user?.roleId)
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Unidade" htmlFor="userUnit">
            <Select id="userUnit" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
              <option value="">Sem unidade</option>
              {(units.data ?? []).map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Setor"
            hint="O gestor do setor aprova as solicitações de compra dele."
            htmlFor="userDepartment"
          >
            <Select
              id="userDepartment"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">Sem setor</option>
              {departments
                .filter((department) => department.isActive || department.id === user?.departmentId)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                    {department.isPurchasing ? " (Compras)" : ""}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Matricula" htmlFor="userCode">
            <Input id="userCode" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} />
          </Field>
          <Field label="Telefone" htmlFor="userPhone">
            <Input id="userPhone" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </Field>
          <Field label="Cargo" htmlFor="userJob">
            <Input id="userJob" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
          </Field>
          {!user ? (
            <Field
              label="Senha inicial"
              error={errors.password}
              hint="Mínimo 10 caracteres. Em branco gera uma senha temporária."
              htmlFor="userPassword"
            >
              <Input
                id="userPassword"
                type="text"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
          ) : null}
        </div>

        <Field label="Observações" htmlFor="userNotes">
          <Textarea id="userNotes" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-700">Setores que este usuário gerencia</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Um gestor pode responder por vários setores. Ele aprova as solicitações desses setores e vê
            apenas as compras deles.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {departments
              .filter((department) => department.isActive)
              .map((department) => (
                <Checkbox
                  key={department.id}
                  label={`${department.name}${department.isPurchasing ? " (Compras)" : ""}`}
                  checked={managedDepartmentIds.includes(department.id)}
                  onChange={(checked) =>
                    setManagedDepartmentIds((current) =>
                      checked
                        ? [...new Set([...current, department.id])]
                        : current.filter((id) => id !== department.id),
                    )
                  }
                />
              ))}
          </div>
        </div>

        {!user ? (
          <Checkbox
            label="Exigir troca de senha no primeiro acesso"
            checked={mustChangePassword}
            onChange={setMustChangePassword}
          />
        ) : (
          <Checkbox
            label="Usuário ativo"
            hint="Desativar bloqueia o login sem apagar o histórico do usuário."
            checked={isActive}
            onChange={setIsActive}
          />
        )}
      </div>
    </Dialog>
  );
}

function ScopesDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const locations = useLocations();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(user.locationScope.map((scope) => scope.id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/api/users/users/${user.id}/location-scopes`, { locationIds: [...selected] });
      toast.success(
        selected.size === 0
          ? "Restrição removida: o usuário passa a ver os locais permitidos pelo perfil/unidade."
          : `Escopo salvo com ${selected.size} ${plural(selected.size, "local", "locais")}.`,
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
      title={`Locais de ${user.name}`}
      description="Sem nenhum local marcado, o usuário ve todos os locais permitidos pela unidade. Marcado, ve somente os escolhidos."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar escopo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {locations.loading && !locations.data ? (
          <LoadingBlock />
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {(locations.data ?? []).map((location) => (
              <label
                key={location.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                  checked={selected.has(location.id)}
                  onChange={(event) => toggle(location.id, event.target.checked)}
                />
                {locationLabel(location)}
              </label>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await apiPost<{ temporaryPassword: string }>(`/api/users/users/${user.id}/reset-password`, {
        mustChangePassword: true,
      });
      setTemporaryPassword(result.temporaryPassword);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title={`Nova senha para ${user.name}`}
      description="A senha anterior deixa de funcionar e as sessões abertas são encerradas."
      onClose={onClose}
      footer={
        temporaryPassword ? (
          <Button onClick={onSaved}>Entendi, já anotei</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={reset} loading={saving}>
              Gerar nova senha
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {temporaryPassword ? (
          <>
            <Alert tone="amber" title="Anote agora">
              Esta senha aparece uma única vez e exige troca no próximo acesso.
            </Alert>
            <p className="select-all rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-lg text-slate-900">
              {temporaryPassword}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Gere uma senha temporária para entregar pessoalmente ao colaborador.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Setores e gestores                                                         */
/* -------------------------------------------------------------------------- */

function DepartmentsTab() {
  const { can } = useSession();
  const manage = can(PERMISSIONS.USERS_MANAGE);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const state = useAsync(async () => {
    const result = await apiGet<{ items: DepartmentRow[] }>("/api/users/departments");
    return result.items;
  }, []);
  const users = useAsync(async () => {
    const result = await apiGet<{ items: UserRow[] }>("/api/users/users", {
      isActive: "true",
      pageSize: 100,
    });
    return result.items;
  }, []);

  const columns: Column<DepartmentRow>[] = [
    {
      key: "department",
      header: "Setor",
      cell: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-500">{row.code}</p>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Tipo",
      cell: (row) =>
        row.isPurchasing ? <Badge tone="violet">Setor de Compras</Badge> : <Badge tone="slate">Setor solicitante</Badge>,
    },
    {
      key: "managers",
      header: "Gestores responsáveis",
      cell: (row) =>
        row.managers.length === 0 ? (
          <span className="text-xs text-amber-700">Sem gestor — ninguém aprova este setor</span>
        ) : (
          <span className="text-xs text-slate-600">{row.managers.map((manager) => manager.name).join(", ")}</span>
        ),
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (
        <Badge tone={row.isActive ? "green" : "slate"}>{row.isActive ? "Ativo" : "Inativo"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
            Editar
          </Button>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <div>
          <p className="text-sm font-medium text-slate-800">Hierarquia de setores</p>
          <p className="text-xs text-slate-500">
            O gestor aprova a necessidade do setor; o setor de Compras autoriza e o comprador executa.
          </p>
        </div>
        {manage ? <Button onClick={() => setCreating(true)}>Novo setor</Button> : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <Table
            columns={columns}
            rows={state.data ?? []}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nenhum setor" description="Crie o primeiro setor para organizar as compras." />}
          />
        )}
      </div>
      {creating ? (
        <DepartmentDialog
          users={users.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            state.reload();
          }}
        />
      ) : null}
      {editing ? (
        <DepartmentDialog
          department={editing}
          users={users.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function DepartmentDialog({
  department,
  users,
  onClose,
  onSaved,
}: {
  department?: DepartmentRow;
  users: UserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState(department?.code ?? "");
  const [name, setName] = useState(department?.name ?? "");
  const [isPurchasing, setIsPurchasing] = useState(department?.isPurchasing ?? false);
  const [isActive, setIsActive] = useState(department?.isActive ?? true);
  const [notes, setNotes] = useState(department?.notes ?? "");
  const [managerIds, setManagerIds] = useState<string[]>(
    department?.managers.map((manager) => manager.id) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        isPurchasing,
        isActive,
        notes: notes || null,
      };
      let departmentId = department?.id;
      if (department) {
        await apiPatch(`/api/users/departments/${department.id}`, payload);
      } else {
        const created = await apiPost<{ id: string }>("/api/users/departments", payload);
        departmentId = created.id;
      }
      if (departmentId) {
        await apiPut(`/api/users/departments/${departmentId}/managers`, { userIds: managerIds });
      }
      toast.success(department ? "Setor atualizado." : "Setor criado.");
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
      title={department ? `Editar ${department.name}` : "Novo setor"}
      description="O setor organiza a solicitação; os gestores escolhidos aprovam as compras dele."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar setor
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" required hint="Curto, em maiúsculas. Ex.: MAN." htmlFor="departmentCode">
            <Input
              id="departmentCode"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={20}
            />
          </Field>
          <Field label="Nome" required htmlFor="departmentName">
            <Input id="departmentName" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        </div>
        <Checkbox
          label="Este é o setor de Compras"
          hint="Membros deste setor veem toda a fila e o responsável autoriza as compras."
          checked={isPurchasing}
          onChange={setIsPurchasing}
        />
        <Checkbox
          label="Setor ativo"
          hint="Setores inativos não aparecem em novas solicitações."
          checked={isActive}
          onChange={setIsActive}
        />
        <Field label="Observações" htmlFor="departmentNotes">
          <Textarea
            id="departmentNotes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-700">Gestores do setor</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Selecione uma ou mais pessoas. Sem gestor, a solicitação fica sem aprovador.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {users.map((user) => (
              <Checkbox
                key={user.id}
                label={`${user.name}${user.departmentName ? ` · ${user.departmentName}` : ""}`}
                checked={managerIds.includes(user.id)}
                onChange={(checked) =>
                  setManagerIds((current) =>
                    checked ? [...new Set([...current, user.id])] : current.filter((id) => id !== user.id),
                  )
                }
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Perfis                                                                     */
/* -------------------------------------------------------------------------- */

function RolesTab() {
  const { can } = useSession();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<RoleRow | null>(null);

  const state = useAsync(async () => {
    const result = await apiGet<{ items: RoleRow[] }>("/api/users/roles");
    return result.items;
  }, []);

  const canManage = can(PERMISSIONS.USERS_PERMISSIONS);

  const toggleActive = async (role: RoleRow) => {
    try {
      await apiPatch(`/api/users/roles/${role.id}`, { isActive: !role.isActive });
      toast.success(role.isActive ? "Perfil desativado." : "Perfil reativado.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  const columns: Column<RoleRow>[] = [
    {
      key: "role",
      header: "Perfil",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">
            {row.name}
            {row.isSystem ? <span className="ml-2 text-xs text-slate-400">(padrão do sistema)</span> : null}
          </p>
          <p className="truncate text-xs text-slate-500">
            {row.code} · {row.description ?? "sem descrição"}
          </p>
        </div>
      ),
    },
    {
      key: "users",
      header: "Usuários",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-700">{row.userCount}</span>,
    },
    {
      key: "permissions",
      header: "Permissões",
      align: "right",
      cell: (row) => <span className="tabular-nums text-slate-700">{row.permissions.length}</span>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (row.isActive ? <Badge tone="green">Ativo</Badge> : <Badge tone="slate">Inativo</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {!row.isSystem || row.code !== "admin" ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
                Editar
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setPermissionsFor(row)}>
              Permissões
            </Button>
            {!row.isSystem ? (
              <Button variant="ghost" size="sm" onClick={() => void toggleActive(row)}>
                {row.isActive ? "Desativar" : "Reativar"}
              </Button>
            ) : null}
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex items-center justify-between border-b border-slate-100 p-4">
        <p className="text-sm text-slate-600">
          O perfil Administrador é imutável. As demais matrizes podem ser ajustadas sem ampliar os
          próprios poderes de quem edita.
        </p>
        {canManage ? <Button onClick={() => setCreating(true)}>Novo perfil</Button> : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <Table
            columns={columns}
            rows={state.data ?? []}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nenhum perfil" description="Cadastre perfis para agrupar permissões." />}
          />
        )}
      </div>

      {creating ? (
        <RoleDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            state.reload();
          }}
        />
      ) : null}

      {editing ? (
        <RoleDialog
          role={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}

      {permissionsFor ? (
        <PermissionsDialog
          role={permissionsFor}
          onClose={() => setPermissionsFor(null)}
          onSaved={() => {
            setPermissionsFor(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function RoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role?: RoleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(role?.name ?? "");
  const [code, setCode] = useState(role?.code ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      if (role) {
        await apiPatch(`/api/users/roles/${role.id}`, { name, description: description || null });
        toast.success("Perfil atualizado.");
      } else {
        await apiPost("/api/users/roles", { name, code, description: description || null });
        toast.success("Perfil criado. Ajuste as permissões em seguida.");
      }
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
      title={role ? `Editar ${role.name}` : "Novo perfil"}
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
        <Field label="Nome" required htmlFor="roleName">
          <Input id="roleName" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field
          label="Código"
          required
          hint="Letras minusculas, números e sublinhado. Não pode ser alterado depois."
          htmlFor="roleCode"
        >
          <Input
            id="roleCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toLowerCase())}
            disabled={Boolean(role)}
          />
        </Field>
        <Field label="Descrição" htmlFor="roleDescription">
          <Textarea
            id="roleDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

function PermissionsDialog({
  role,
  onClose,
  onSaved,
}: {
  role: RoleRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { can } = useSession();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissions));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = useAsync(async () => {
    const result = await apiGet<{ groups: PermissionGroup[] }>("/api/users/permissions");
    return result.groups;
  }, []);

  const toggle = (code: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiPut(`/api/users/roles/${role.id}/permissions`, { permissions: [...selected].sort() });
      toast.success(
        role.code === "admin" ? "O perfil Administrador mantem todas as permissões." : "Permissões salvas.",
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
      title={`Permissões de ${role.name}`}
      description="Você só pode conceder ou revogar permissões que você mesmo possui (menor privilegio)."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!can(PERMISSIONS.USERS_PERMISSIONS)}>
            Salvar permissões
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        {catalog.loading && !catalog.data ? (
          <LoadingBlock />
        ) : catalog.error ? (
          <ErrorBlock message={catalog.error} onRetry={catalog.reload} />
        ) : (
          <div className="space-y-5">
            {(catalog.data ?? []).map((group) => (
              <div key={group.key}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.label}
                </p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {group.codes.map((entry) => (
                    <label
                      key={entry.code}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
                        checked={selected.has(entry.code)}
                        onChange={(event) => toggle(entry.code, event.target.checked)}
                      />
                      {entry.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
