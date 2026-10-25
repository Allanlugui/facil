/**
 * LGPD - Incidentes de segurança (Art. 48, Lei 13.709/2018).
 *
 * Registro de incidentes com os elementos da comunicação obrigatória à ANPD e
 * aos titulares.
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

interface IncidentRow {
  id: string;
  code: string;
  title: string;
  description: string;
  severity: string;
  detected_at: string;
  data_affected: string;
  subjects_affected: string;
  security_measures: string | null;
  risks: string | null;
  communication_delay_reason: string | null;
  mitigation_measures: string | null;
  status: string;
  anpd_notified_at: string | null;
  subjects_notified_at: string | null;
  notification_medium: string | null;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  resolved_at: string | null;
  resolution_summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default function SecurityIncidentsPage() {
  const { permissions } = useSession();
  const { push } = useToast();
  const canManage = permissions.has(PERMISSIONS.INCIDENT_MANAGE);

  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "medium",
    detected_at: "",
    data_affected: "",
    subjects_affected: "",
    security_measures: "",
    risks: "",
    communication_delay_reason: "",
    mitigation_measures: "",
    status: "detected",
    anpd_notified_at: "",
    subjects_notified_at: "",
    notification_medium: "",
    responsible_user_id: "",
    resolved_at: "",
    resolution_summary: "",
  });

  const incidentsState = useAsync<{ items: IncidentRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: IncidentRow[]; total: number }>("/api/incident/");
      return data;
    },
    [],
  );

  useEffect(() => {
    incidentsState.reload();
  }, [incidentsState.reload]);

  /* --- Handlers --- */
  const openCreate = () => {
    setEditingId(null);
    setForm({
      title: "",
      description: "",
      severity: "medium",
      detected_at: new Date().toISOString().slice(0, 16),
      data_affected: "",
      subjects_affected: "",
      security_measures: "",
      risks: "",
      communication_delay_reason: "",
      mitigation_measures: "",
      status: "detected",
      anpd_notified_at: "",
      subjects_notified_at: "",
      notification_medium: "",
      responsible_user_id: "",
      resolved_at: "",
      resolution_summary: "",
    });
    setOpenDialog(true);
  };

  const openEdit = (row: IncidentRow) => {
    setEditingId(row.id);
    setForm({
      title: row.title,
      description: row.description,
      severity: row.severity,
      detected_at: row.detected_at.slice(0, 16),
      data_affected: row.data_affected,
      subjects_affected: row.subjects_affected,
      security_measures: row.security_measures ?? "",
      risks: row.risks ?? "",
      communication_delay_reason: row.communication_delay_reason ?? "",
      mitigation_measures: row.mitigation_measures ?? "",
      status: row.status,
      anpd_notified_at: row.anpd_notified_at ?? "",
      subjects_notified_at: row.subjects_notified_at ?? "",
      notification_medium: row.notification_medium ?? "",
      responsible_user_id: row.responsible_user_id ?? "",
      resolved_at: row.resolved_at ?? "",
      resolution_summary: row.resolution_summary ?? "",
    });
    setOpenDialog(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await apiPatch(`/api/incident/${editingId}`, {
          title: form.title,
          description: form.description,
          severity: form.severity,
          detected_at: form.detected_at,
          data_affected: form.data_affected,
          subjects_affected: form.subjects_affected,
          security_measures: form.security_measures || null,
          risks: form.risks || null,
          communication_delay_reason: form.communication_delay_reason || null,
          mitigation_measures: form.mitigation_measures || null,
          status: form.status,
          anpd_notified_at: form.anpd_notified_at || null,
          subjects_notified_at: form.subjects_notified_at || null,
          notification_medium: form.notification_medium || null,
          responsible_user_id: form.responsible_user_id || null,
          resolved_at: form.resolved_at || null,
          resolution_summary: form.resolution_summary || null,
        });
      } else {
        await apiPost("/api/incident/", {
          title: form.title,
          description: form.description,
          severity: form.severity,
          detected_at: form.detected_at,
          data_affected: form.data_affected,
          subjects_affected: form.subjects_affected,
          security_measures: form.security_measures || null,
          risks: form.risks || null,
          communication_delay_reason: form.communication_delay_reason || null,
          mitigation_measures: form.mitigation_measures || null,
          responsible_user_id: form.responsible_user_id || null,
        });
      }
      setOpenDialog(false);
      incidentsState.reload();
      push("Incidente salvo com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  const severityTone = (s: string) => {
    switch (s) {
      case "low": return "green";
      case "medium": return "amber";
      case "high": return "blue";
      case "critical": return "red";
      default: return "slate";
    }
  };
  const severityLabel = (s: string) => {
    const labels: Record<string, string> = {
      low: "Baixa",
      medium: "Média",
      high: "Alta",
      critical: "Crítica",
    };
    return labels[s] ?? s;
  };
  const statusLabel = (s: string) => {
    const labels: Record<string, string> = {
      detected: "Detectado",
      in_analysis: "Em análise",
      communicating: "Comunicando",
      communicated: "Comunicado",
      resolved: "Resolvido",
    };
    return labels[s] ?? s;
  };
  const statusTone = (s: string) => {
    switch (s) {
      case "detected": return "red";
      case "in_analysis": return "amber";
      case "communicating": return "blue";
      case "communicated": return "violet";
      case "resolved": return "green";
      default: return "slate";
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="LGPD - Incidentes de segurança"
        description="Comunicação de incidentes à ANPD e aos titulares (Art. 48, Lei 13.709/2018)"
      />

      <div className="flex justify-between items-center mb-4">
        <Stat label="Incidentes registrados" value={incidentsState.data?.items.length ?? 0} />
        {canManage && (
          <Button variant="primary" onClick={openCreate}>
            Novo incidente
          </Button>
        )}
      </div>

      {incidentsState.loading ? (
        <LoadingBlock />
      ) : incidentsState.error ? (
        <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
          {incidentsState.error}
        </div>
      ) : incidentsState.data?.items.length === 0 ? (
        <EmptyState
          title="Nenhum incidente registrado"
          description="Registre incidentes de segurança com os elementos da comunicação obrigatória."
          action={
            canManage ? (
              <Button variant="primary" onClick={openCreate}>
                Registrar primeiro incidente
              </Button>
            ) : null
          }
        />
      ) : (
        <Table<IncidentRow>
          columns={[
            { key: "code", header: "Código", cell: (r) => r.code },
            { key: "title", header: "Título", cell: (r) => r.title },
            {
              key: "severity",
              header: "Gravidade",
              cell: (r) => <Badge tone={severityTone(r.severity)}>{severityLabel(r.severity)}</Badge>,
            },
            {
              key: "status",
              header: "Status",
              cell: (r) => <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>,
            },
            {
              key: "anpd_notified_at",
              header: "ANPD notificada",
              cell: (r) =>
                r.anpd_notified_at ? (
                  <Badge tone="green">Sim</Badge>
                ) : (
                  <Badge tone="red">Não</Badge>
                ),
            },
            {
              key: "detected_at",
              header: "Detectado em",
              cell: (r) => r.detected_at.slice(0, 16),
            },
          ]}
          rows={incidentsState.data?.items ?? []}
          keyOf={(r) => r.id}
          empty={<EmptyState title="Nenhum incidente encontrado" />}
          onRowClick={canManage ? openEdit : undefined}
        />
      )}

      {/* Dialog */}
      <Dialog
        open={openDialog}
        onClose={() => setOpenDialog(false)}
        title={editingId ? "Editar incidente" : "Novo incidente"}
        wide={true}
      >
        <form onSubmit={save} className="space-y-4">
          <Field label="Título" required>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Descrição da natureza do incidente" required>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Gravidade" required>
              <Select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </Select>
            </Field>
            <Field label="Data/hora da detecção" required>
              <Input
                type="datetime-local"
                value={form.detected_at}
                onChange={(e) => setForm({ ...form, detected_at: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Natureza dos dados pessoais afetados (Art. 48, I)" required>
            <Textarea value={form.data_affected} onChange={(e) => setForm({ ...form, data_affected: e.target.value })} />
          </Field>
          <Field label="Titulares envolvidos (Art. 48, II)" required>
            <Textarea value={form.subjects_affected} onChange={(e) => setForm({ ...form, subjects_affected: e.target.value })} />
          </Field>
          <Field label="Medidas de segurança utilizadas (Art. 48, III)">
            <Textarea value={form.security_measures} onChange={(e) => setForm({ ...form, security_measures: e.target.value })} />
          </Field>
          <Field label="Riscos relacionados (Art. 48, IV)">
            <Textarea value={form.risks} onChange={(e) => setForm({ ...form, risks: e.target.value })} />
          </Field>
          <Field label="Motivo da demora na comunicação (Art. 48, V)">
            <Textarea value={form.communication_delay_reason} onChange={(e) => setForm({ ...form, communication_delay_reason: e.target.value })} />
          </Field>
          <Field label="Medidas de reversão/mitigação (Art. 48, VI)">
            <Textarea value={form.mitigation_measures} onChange={(e) => setForm({ ...form, mitigation_measures: e.target.value })} />
          </Field>
          {editingId && (
            <>
              <Field label="Status">
                <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="detected">Detectado</option>
                  <option value="in_analysis">Em análise</option>
                  <option value="communicating">Comunicando</option>
                  <option value="communicated">Comunicado</option>
                  <option value="resolved">Resolvido</option>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Comunicação à ANPD (data)">
                  <Input type="date" value={form.anpd_notified_at} onChange={(e) => setForm({ ...form, anpd_notified_at: e.target.value })} />
                </Field>
                <Field label="Comunicação aos titulares (data)">
                  <Input type="date" value={form.subjects_notified_at} onChange={(e) => setForm({ ...form, subjects_notified_at: e.target.value })} />
                </Field>
              </div>
              <Field label="Meio da comunicação aos titulares">
                <Input value={form.notification_medium} onChange={(e) => setForm({ ...form, notification_medium: e.target.value })} />
              </Field>
              <Field label="Responsável (usuário)">
                <Input value={form.responsible_user_id} onChange={(e) => setForm({ ...form, responsible_user_id: e.target.value })} />
              </Field>
              <Field label="Resolvido em (data)">
                <Input type="date" value={form.resolved_at} onChange={(e) => setForm({ ...form, resolved_at: e.target.value })} />
              </Field>
              <Field label="Resumo da resolução">
                <Textarea value={form.resolution_summary} onChange={(e) => setForm({ ...form, resolution_summary: e.target.value })} />
              </Field>
            </>
          )}
          <div className="dialog-footer flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenDialog(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!form.title || !form.description || !form.detected_at || !form.data_affected || !form.subjects_affected}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
