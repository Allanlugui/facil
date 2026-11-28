/**
 * LGPD - Encarregado (DPO) pelo tratamento de dados pessoais (Art. 41,
 * Lei 13.709/2018).
 *
 * Tela de gestão do encarregado (DPO).
 */

import { useState, useEffect } from "react";
import { PERMISSIONS } from "@shared/permissions";
import { apiErrorMessage, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAsync } from "../lib/hooks";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Stat,
  Table,
  useToast,
} from "../lib/ui";
import { useSession } from "../lib/session";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface DpoRow {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  active_from: string;
  active_until: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default function DpoPage() {
  const { permissions } = useSession();
  const { push } = useToast();
  const canManage = permissions.has(PERMISSIONS.DPO_MANAGE);

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    email: "",
    phone: "",
    department: "",
    active_from: "",
    active_until: "",
  });

  const dposState = useAsync<{ items: DpoRow[]; total: number }>(async () => {
    const data = await apiGet<{ items: DpoRow[]; total: number }>("/api/dpo/");
    return data;
  }, []);

  const activeState = useAsync<{ item: DpoRow | null }>(async () => {
    const data = await apiGet<{ item: DpoRow | null }>("/api/dpo/active");
    return data;
  }, []);

  useEffect(() => {
    dposState.reload();
    activeState.reload();
  }, [dposState.reload, activeState.reload]);

  /* --- Handlers --- */
  const openCreate = () => {
    setEditingId(null);
    setForm({
      code: "",
      name: "",
      email: "",
      phone: "",
      department: "",
      active_from: "",
      active_until: "",
    });
    setOpenDialog(true);
  };

  const openEdit = (row: DpoRow) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      email: row.email,
      phone: row.phone ?? "",
      department: row.department ?? "",
      active_from: row.active_from,
      active_until: row.active_until ?? "",
    });
    setOpenDialog(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await apiPatch(`/api/dpo/${editingId}`, {
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          department: form.department || null,
          active_from: form.active_from,
          active_until: form.active_until || null,
        });
      } else {
        await apiPost("/api/dpo/", {
          code: form.code,
          name: form.name,
          email: form.email,
          phone: form.phone || null,
          department: form.department || null,
          active_from: form.active_from,
          active_until: form.active_until || null,
        });
      }
      setOpenDialog(false);
      dposState.reload();
      activeState.reload();
      push("Encarregado salvo com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="LGPD - Encarregado (DPO)"
        description="Encarregado pelo tratamento de dados pessoais (Art. 41, Lei 13.709/2018)"
        backTo="/configuracoes/administracao"
        backLabel="Voltar à administração"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <Stat label="Encarregado ativo" value={activeState.data?.item ? "Sim" : "Não"} />
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            Novo encarregado
          </Button>
        )}
      </div>

      {dposState.loading ? (
        <LoadingBlock />
      ) : dposState.error ? (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
          {dposState.error}
        </div>
      ) : dposState.data?.items.length === 0 ? (
        <EmptyState
          title="Nenhum encarregado cadastrado"
          description="Cadastre o encarregado (DPO) responsável pelo tratamento de dados pessoais."
          action={
            canManage ? (
              <Button variant="primary" onClick={openCreate}>
                Cadastrar encarregado
              </Button>
            ) : null
          }
        />
      ) : (
        <Table<DpoRow>
          columns={[
            { key: "code", header: "Código", cell: (r) => r.code },
            { key: "name", header: "Nome", cell: (r) => r.name },
            { key: "email", header: "E-mail", cell: (r) => r.email },
            { key: "department", header: "Departamento", cell: (r) => r.department ?? "—" },
            {
              key: "active_from",
              header: "Designado em",
              cell: (r) => r.active_from.slice(0, 10),
            },
            {
              key: "is_active",
              header: "Situação",
              cell: (r) => (
                <Badge tone={r.is_active ? "green" : "slate"}>
                  {r.is_active ? "Ativo" : "Inativo"}
                </Badge>
              ),
            },
          ]}
          rows={dposState.data?.items ?? []}
          keyOf={(r) => r.id}
          empty={<EmptyState title="Nenhum encarregado encontrado" />}
          onRowClick={canManage ? openEdit : undefined}
        />
      )}

      {activeState.data?.item && (
        <div className="mt-4 p-4 rounded-lg border border-brand-200 bg-brand-50">
          <h3 className="text-sm font-semibold text-brand-800 mb-2">
            Encarregado vigente
          </h3>
          <p className="text-sm text-brand-700">
            {activeState.data.item.name} — {activeState.data.item.email}
            {activeState.data.item.phone ? ` • ${activeState.data.item.phone}` : ""}
          </p>
        </div>
      )}

      {/* Dialog */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        title={editingId ? "Editar encarregado" : "Novo encarregado"}
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Código" hint="Ex: DPO-2026-000001" required>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              disabled={!!editingId}
            />
          </Field>
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="E-mail" required>
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Departamento / Área">
            <Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </Field>
          <Field label="Designado em (início)" required>
            <Input
              type="date"
              value={form.active_from}
              onChange={(e) => setForm({ ...form, active_from: e.target.value })}
            />
          </Field>
          <Field label="Término (opcional)">
            <Input
              type="date"
              value={form.active_until}
              onChange={(e) => setForm({ ...form, active_until: e.target.value })}
            />
          </Field>
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!form.code || !form.name || !form.email || !form.active_from}
            >
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
