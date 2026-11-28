/**
 * LGPD - Medidas de segurança técnica e administrativa (Arts. 46 e 49,
 * Lei 13.709/2018).
 *
 * Inventário de medidas de segurança com status de implementação, responsável
 * e evidência.
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
  Select,
  Stat,
  Table,
  Textarea,
  useToast,
} from "../lib/ui";
import { useSession } from "../lib/session";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface SecurityMeasureRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  category: string;
  implementation_status: string;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  review_frequency: string | null;
  last_review_at: string | null;
  next_review_at: string | null;
  evidence: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default function SecurityMeasuresPage() {
  const { permissions } = useSession();
  const { push } = useToast();
  const canManage = permissions.has(PERMISSIONS.SEC_MANAGE);

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    type: "technical",
    category: "access_control",
    implementation_status: "planned",
    responsible_user_id: "",
    review_frequency: "",
    last_review_at: "",
    next_review_at: "",
    evidence: "",
  });

  const secState = useAsync<{ items: SecurityMeasureRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: SecurityMeasureRow[]; total: number }>("/api/sec/");
      return data;
    },
    [],
  );

  useEffect(() => {
    secState.reload();
  }, [secState.reload]);

  /* --- Handlers --- */
  const openCreate = () => {
    setEditingId(null);
    setForm({
      code: "",
      name: "",
      description: "",
      type: "technical",
      category: "access_control",
      implementation_status: "planned",
      responsible_user_id: "",
      review_frequency: "",
      last_review_at: "",
      next_review_at: "",
      evidence: "",
    });
    setOpenDialog(true);
  };

  const openEdit = (row: SecurityMeasureRow) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      description: row.description ?? "",
      type: row.type,
      category: row.category,
      implementation_status: row.implementation_status,
      responsible_user_id: row.responsible_user_id ?? "",
      review_frequency: row.review_frequency ?? "",
      last_review_at: row.last_review_at ?? "",
      next_review_at: row.next_review_at ?? "",
      evidence: row.evidence ?? "",
    });
    setOpenDialog(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await apiPatch(`/api/sec/${editingId}`, {
          name: form.name,
          description: form.description || null,
          type: form.type,
          category: form.category,
          implementation_status: form.implementation_status,
          responsible_user_id: form.responsible_user_id || null,
          review_frequency: form.review_frequency || null,
          last_review_at: form.last_review_at || null,
          next_review_at: form.next_review_at || null,
          evidence: form.evidence || null,
        });
      } else {
        await apiPost("/api/sec/", {
          code: form.code,
          name: form.name,
          description: form.description || null,
          type: form.type,
          category: form.category,
          implementation_status: form.implementation_status,
          responsible_user_id: form.responsible_user_id || null,
          review_frequency: form.review_frequency || null,
          last_review_at: form.last_review_at || null,
          next_review_at: form.next_review_at || null,
          evidence: form.evidence || null,
        });
      }
      setOpenDialog(false);
      secState.reload();
      push("Medida de segurança salva com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  const deactivate = async (row: SecurityMeasureRow) => {
    if (!window.confirm("Tem certeza que deseja desativar esta medida?")) return;
    try {
      await apiPost(`/api/sec/${row.id}/deactivate`, {});
      secState.reload();
      push("Medida desativada com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  const typeLabel = (t: string) => (t === "technical" ? "Técnica" : "Administrativa");
  const statusTone = (s: string) => {
    switch (s) {
      case "implemented": return "green";
      case "partially": return "amber";
      case "planned": return "blue";
      case "not_implemented": return "red";
      default: return "slate";
    }
  };
  const statusLabel = (s: string) => {
    const labels: Record<string, string> = {
      implemented: "Implementada",
      partially: "Parcialmente",
      planned: "Planejada",
      not_implemented: "Não implementada",
    };
    return labels[s] ?? s;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="LGPD - Medidas de segurança"
        description="Inventário de medidas técnicas e administrativas (Arts. 46 e 49, Lei 13.709/2018)"
        backTo="/configuracoes/administracao"
        backLabel="Voltar à administração"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <Stat label="Medidas ativas" value={secState.data?.items.filter((r) => r.is_active).length ?? 0} />
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            Nova medida
          </Button>
        )}
      </div>

      {secState.loading ? (
        <LoadingBlock />
      ) : secState.error ? (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
          {secState.error}
        </div>
      ) : secState.data?.items.length === 0 ? (
        <EmptyState
          title="Nenhuma medida de segurança cadastrada"
          description="Cadastre as medidas técnicas e administrativas que protegem dados pessoais."
          action={
            canManage ? (
              <Button variant="primary" onClick={openCreate}>
                Cadastrar primeira medida
              </Button>
            ) : null
          }
        />
      ) : (
        <Table<SecurityMeasureRow>
          columns={[
            { key: "code", header: "Código", cell: (r) => r.code },
            { key: "name", header: "Nome", cell: (r) => r.name },
            { key: "type", header: "Tipo", cell: (r) => typeLabel(r.type) },
            {
              key: "implementation_status",
              header: "Situação",
              cell: (r) => <Badge tone={statusTone(r.implementation_status)}>{statusLabel(r.implementation_status)}</Badge>,
            },
            {
              key: "responsible_user_name",
              header: "Responsável",
              cell: (r) => r.responsible_user_name ?? "—",
            },
            {
              key: "is_active",
              header: "Ativa",
              cell: (r) => (
                <Badge tone={r.is_active ? "green" : "slate"}>
                  {r.is_active ? "Ativa" : "Inativa"}
                </Badge>
              ),
            },
          ]}
          rows={secState.data?.items ?? []}
          keyOf={(r) => r.id}
          empty={<EmptyState title="Nenhuma medida encontrada" />}
          onRowClick={canManage ? openEdit : undefined}
        />
      )}

      {/* Dialog */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        title={editingId ? "Editar medida de segurança" : "Nova medida de segurança"}
        wide={true}
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Código" hint="Ex: SEC-2026-000001" required>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              disabled={!!editingId}
            />
          </Field>
          <Field label="Nome da medida" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Descrição">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Tipo" required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="technical">Técnica</option>
              <option value="administrative">Administrativa</option>
            </Select>
          </Field>
          <Field label="Categoria" required>
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="encryption">Criptografia</option>
              <option value="access_control">Controle de acesso</option>
              <option value="backup">Backup e recuperação</option>
              <option value="logging">Logs e auditoria</option>
              <option value="training">Treinamento e conscientização</option>
              <option value="incident_response">Resposta a incidentes</option>
              <option value="governance">Governança e boas práticas</option>
              <option value="network">Segurança de rede</option>
              <option value="other">Outro</option>
            </Select>
          </Field>
          <Field label="Situação de implementação" required>
            <Select
              value={form.implementation_status}
              onChange={(e) => setForm({ ...form, implementation_status: e.target.value })}
            >
              <option value="implemented">Implementada</option>
              <option value="partially">Parcialmente implementada</option>
              <option value="planned">Planejada</option>
              <option value="not_implemented">Não implementada</option>
            </Select>
          </Field>
          <Field label="Responsável (usuário)">
            <Input value={form.responsible_user_id} onChange={(e) => setForm({ ...form, responsible_user_id: e.target.value })} />
          </Field>
          <Field label="Periodicidade de revisão" hint="Ex: anual, trimestral, semestral">
            <Input value={form.review_frequency} onChange={(e) => setForm({ ...form, review_frequency: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Última revisão">
              <Input type="date" value={form.last_review_at} onChange={(e) => setForm({ ...form, last_review_at: e.target.value })} />
            </Field>
            <Field label="Próxima revisão">
              <Input type="date" value={form.next_review_at} onChange={(e) => setForm({ ...form, next_review_at: e.target.value })} />
            </Field>
          </div>
          <Field label="Evidência" hint="Referência do documento, controle ou auditoria que comprova a implementação">
            <Textarea value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
          </Field>
          {canManage && !editingId ? null : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const row = secState.data?.items.find((r) => r.id === editingId);
                if (row) deactivate(row);
              }}
            >
              Desativar medida
            </Button>
          )}
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!form.code || !form.name}
            >
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
