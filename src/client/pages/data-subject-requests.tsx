/**
 * LGPD - Direitos do titular (Arts. 18 e 19, Lei 13.709/2018).
 *
 * Tela de gestão de solicitações de direitos do titular.
 */

import { useState } from "react";
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

interface DataSubjectRequestRow {
  id: string;
  code: string;
  data_subject_id: string;
  data_subject_code: string | null;
  data_subject_name: string | null;
  request_type: string;
  status: string;
  requested_at: string;
  due_date: string;
  responded_at: string | null;
  response_summary: string | null;
  response_details: string | null;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default function DataSubjectRequestsPage() {
  const { permissions } = useSession();
  const { push } = useToast();
  const canManage = permissions.has(PERMISSIONS.DSR_MANAGE);

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    data_subject_id: "",
    request_type: "access",
    requested_at: "",
    status: "received",
    response_summary: "",
    response_details: "",
    responsible_user_id: "",
    responded_at: "",
  });

  const dsrState = useAsync<{ items: DataSubjectRequestRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: DataSubjectRequestRow[]; total: number }>("/api/dsr/");
      return data;
    },
    [],
  );

  /* --- Handlers --- */
  const openCreate = () => {
    setEditingId(null);
    setForm({
      data_subject_id: "",
      request_type: "access",
      requested_at: new Date().toISOString().slice(0, 10),
      status: "received",
      response_summary: "",
      response_details: "",
      responsible_user_id: "",
      responded_at: "",
    });
    setOpenDialog(true);
  };

  const openEdit = (row: DataSubjectRequestRow) => {
    setEditingId(row.id);
    setForm({
      data_subject_id: row.data_subject_id,
      request_type: row.request_type,
      requested_at: row.requested_at.slice(0, 10),
      status: row.status,
      response_summary: row.response_summary ?? "",
      response_details: row.response_details ?? "",
      responsible_user_id: row.responsible_user_id ?? "",
      responded_at: row.responded_at ?? "",
    });
    setOpenDialog(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await apiPatch(`/api/dsr/${editingId}`, {
          status: form.status,
          response_summary: form.response_summary || null,
          response_details: form.response_details || null,
          responsible_user_id: form.responsible_user_id || null,
          responded_at: form.responded_at || null,
        });
      } else {
        await apiPost("/api/dsr/", {
          data_subject_id: form.data_subject_id,
          request_type: form.request_type,
          requested_at: form.requested_at,
          status: form.status,
          response_summary: form.response_summary || null,
          response_details: form.response_details || null,
          responsible_user_id: form.responsible_user_id || null,
          responded_at: form.responded_at || null,
        });
      }
      setOpenDialog(false);
      dsrState.reload();
      push("Solicitação salva com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  const requestTypeLabel = (t: string) => {
    const labels: Record<string, string> = {
      access: "Acesso aos dados",
      correction: "Correção de dados",
      deletion: "Eliminação/anonymização/bloqueio",
      portability: "Portabilidade",
      revocation: "Revogação de consentimento",
      information: "Informação de compartilhamento",
      consequences: "Consequências da negativa",
      other: "Outro",
    };
    return labels[t] ?? t;
  };

  const statusTone = (s: string) => {
    switch (s) {
      case "received": return "slate";
      case "in_progress": return "amber";
      case "responded": return "green";
      case "rejected": return "red";
      default: return "slate";
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="LGPD - Direitos do titular"
        description="Solicitações de exercício de direitos (Arts. 18 e 19, Lei 13.709/2018)"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <Stat label="Solicitações" value={dsrState.data?.items.length ?? 0} />
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            Nova solicitação
          </Button>
        )}
      </div>

      {dsrState.loading ? (
        <LoadingBlock />
      ) : dsrState.error ? (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
          {dsrState.error}
        </div>
      ) : dsrState.data?.items.length === 0 ? (
        <EmptyState
          title="Nenhuma solicitação cadastrada"
          description="Registre a primeira solicitação de exercício de direitos do titular."
          action={
            canManage ? (
              <Button variant="primary" onClick={openCreate}>
                Criar primeira solicitação
              </Button>
            ) : null
          }
        />
      ) : (
        <Table<DataSubjectRequestRow>
          columns={[
            { key: "code", header: "Código", cell: (r) => r.code },
            { key: "data_subject_name", header: "Titular", cell: (r) => r.data_subject_name ?? "—" },
            { key: "request_type", header: "Direito", cell: (r) => requestTypeLabel(r.request_type) },
            {
              key: "status",
              header: "Status",
              cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            },
            {
              key: "requested_at",
              header: "Solicitado em",
              cell: (r) => r.requested_at.slice(0, 10),
            },
            {
              key: "due_date",
              header: "Prazo (15 dias)",
              cell: (r) => r.due_date.slice(0, 10),
            },
          ]}
          rows={dsrState.data?.items ?? []}
          keyOf={(r) => r.id}
          empty={<EmptyState title="Nenhuma solicitação encontrada" />}
          onRowClick={canManage ? openEdit : undefined}
        />
      )}

      {/* Dialog */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        title={editingId ? "Editar solicitação" : "Nova solicitação"}
        wide={true}
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Titular" required>
            <Input value={form.data_subject_id} disabled readOnly />
          </Field>
          <Field label="Tipo de direito" required>
            <Select value={form.request_type} onChange={(e) => setForm({ ...form, request_type: e.target.value })}>
              <option value="access">Acesso aos dados</option>
              <option value="correction">Correção de dados</option>
              <option value="deletion">Eliminação/anonymização/bloqueio</option>
              <option value="portability">Portabilidade</option>
              <option value="revocation">Revogação de consentimento</option>
              <option value="information">Informação de compartilhamento</option>
              <option value="consequences">Consequências da negativa</option>
              <option value="other">Outro</option>
            </Select>
          </Field>
          <Field label="Data da solicitação" required>
            <Input type="date" value={form.requested_at} onChange={(e) => setForm({ ...form, requested_at: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="received">Recebida</option>
              <option value="in_progress">Em andamento</option>
              <option value="responded">Respondida</option>
              <option value="rejected">Rejeitada</option>
            </Select>
          </Field>
          <Field label="Resumo da resposta">
            <Textarea value={form.response_summary} onChange={(e) => setForm({ ...form, response_summary: e.target.value })} />
          </Field>
          <Field label="Detalhes da resposta">
            <Textarea value={form.response_details} onChange={(e) => setForm({ ...form, response_details: e.target.value })} />
          </Field>
          <Field label="Responsável (usuário)">
            <Input value={form.responsible_user_id} onChange={(e) => setForm({ ...form, responsible_user_id: e.target.value })} />
          </Field>
          <Field label="Data da resposta">
            <Input type="date" value={form.responded_at} onChange={(e) => setForm({ ...form, responded_at: e.target.value })} />
          </Field>
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!form.data_subject_id || !form.request_type || !form.requested_at}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
