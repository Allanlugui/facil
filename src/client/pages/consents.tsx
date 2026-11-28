/**
 * LGPD - Consentimento para tratamento de dados pessoais (Art. 8º,
 * Lei 13.709/2018).
 *
 * Tela de gestão de titulares de dados e consentimentos.
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
  useToast,
} from "../lib/ui";
import { useSession } from "../lib/session";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface DataSubjectRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  document: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ConsentRow {
  id: string;
  code: string;
  data_subject_id: string;
  data_subject_code: string | null;
  data_subject_name: string | null;
  operation_id: string;
  operation_code: string | null;
  operation_name: string | null;
  legal_base_id: string;
  legal_base_code: string | null;
  legal_base_name: string | null;
  medium: string;
  consented_at: string;
  consented_by: string;
  consented_by_name: string | null;
  text_version: string;
  highlighted_clause: boolean;
  ip_address: string | null;
  user_agent: string | null;
  status: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_by_name: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default function ConsentsPage() {
  const { permissions } = useSession();
  const { push } = useToast();
  const canManage = permissions.has(PERMISSIONS.CONSENT_MANAGE);
  const [activeTab, setActiveTab] = useState<"subjects" | "consents">("subjects");

  /* --- Estado de formulário (titular) --- */
  const [openSubjectDialog, setOpenSubjectDialog] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [subjectForm, setSubjectForm] = useState({
    code: "",
    name: "",
    email: "",
    document: "",
    role: "cliente",
  });

  /* --- Estado de formulário (consentimento) --- */
  const [openConsentDialog, setOpenConsentDialog] = useState(false);
  const [editingConsentId, setEditingConsentId] = useState<string | null>(null);
  const [consentForm, setConsentForm] = useState({
    data_subject_id: "",
    operation_id: "",
    legal_base_id: "",
    medium: "electronic",
    text_version: "",
    highlighted_clause: false,
    ip_address: "",
    user_agent: "",
  });

  /* --- Dados --- */
  const subjectsState = useAsync<{ items: DataSubjectRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: DataSubjectRow[]; total: number }>("/api/consent/subjects");
      return data;
    },
    [],
  );

  const consentsState = useAsync<{ items: ConsentRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: ConsentRow[]; total: number }>("/api/consent/");
      return data;
    },
    [],
  );

  useEffect(() => {
    if (activeTab === "subjects") subjectsState.reload();
    else consentsState.reload();
  }, [activeTab, subjectsState.reload, consentsState.reload]);

  /* --- Handlers: titular --- */
  const openCreateSubject = () => {
    setEditingSubjectId(null);
    setSubjectForm({ code: "", name: "", email: "", document: "", role: "cliente" });
    setOpenSubjectDialog(true);
  };

  const openEditSubject = (row: DataSubjectRow) => {
    setEditingSubjectId(row.id);
    setSubjectForm({
      code: row.code,
      name: row.name,
      email: row.email ?? "",
      document: row.document ?? "",
      role: row.role,
    });
    setOpenSubjectDialog(true);
  };

  const saveSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSubjectId) {
        await apiPatch(`/api/consent/subjects/${editingSubjectId}`, {
          name: subjectForm.name,
          email: subjectForm.email || null,
          document: subjectForm.document || null,
          role: subjectForm.role,
        });
      } else {
        await apiPost("/api/consent/subjects", {
          code: subjectForm.code,
          name: subjectForm.name,
          email: subjectForm.email || null,
          document: subjectForm.document || null,
          role: subjectForm.role,
        });
      }
      setOpenSubjectDialog(false);
      subjectsState.reload();
      push("Titular salvo com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  /* --- Handlers: consentimento --- */
  const openCreateConsent = () => {
    setEditingConsentId(null);
    setConsentForm({
      data_subject_id: "",
      operation_id: "",
      legal_base_id: "",
      medium: "electronic",
      text_version: "",
      highlighted_clause: false,
      ip_address: "",
      user_agent: "",
    });
    setOpenConsentDialog(true);
  };

  const openEditConsent = (row: ConsentRow) => {
    setEditingConsentId(row.id);
    setConsentForm({
      data_subject_id: row.data_subject_id,
      operation_id: row.operation_id,
      legal_base_id: row.legal_base_id,
      medium: row.medium,
      text_version: row.text_version,
      highlighted_clause: row.highlighted_clause,
      ip_address: row.ip_address ?? "",
      user_agent: row.user_agent ?? "",
    });
    setOpenConsentDialog(true);
  };

  const saveConsent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingConsentId) {
        await apiPatch(`/api/consent/${editingConsentId}`, {
          medium: consentForm.medium,
          text_version: consentForm.text_version,
          highlighted_clause: consentForm.highlighted_clause,
          ip_address: consentForm.ip_address || null,
          user_agent: consentForm.user_agent || null,
        });
      } else {
        await apiPost("/api/consent/", {
          data_subject_id: consentForm.data_subject_id,
          operation_id: consentForm.operation_id,
          legal_base_id: consentForm.legal_base_id,
          medium: consentForm.medium,
          text_version: consentForm.text_version,
          highlighted_clause: consentForm.highlighted_clause,
          ip_address: consentForm.ip_address || null,
          user_agent: consentForm.user_agent || null,
        });
      }
      setOpenConsentDialog(false);
      consentsState.reload();
      push("Consentimento salvo com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  const mediumLabel = (m: string) => {
    const labels: Record<string, string> = {
      written: "Escrito",
      electronic: "Eletrônico",
      verbal: "Verbal",
      form: "Formulário",
    };
    return labels[m] ?? m;
  };

  const statusTone = (s: string) => {
    switch (s) {
      case "active": return "green";
      case "revoked": return "red";
      case "expired": return "amber";
      default: return "slate";
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="LGPD - Consentimento"
        description="Titulares de dados e consentimentos (Art. 8º, Lei 13.709/2018)"
        backTo="/configuracoes/administracao"
        backLabel="Voltar à administração"
      />

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 mb-4 pb-px">
        <Button
          variant={activeTab === "subjects" ? "primary" : "ghost"}
          onClick={() => setActiveTab("subjects")}
        >
          Titulares de dados
        </Button>
        <Button
          variant={activeTab === "consents" ? "primary" : "ghost"}
          onClick={() => setActiveTab("consents")}
        >
          Consentimentos
        </Button>
      </div>

      {/* Aba: Titulares de dados */}
      {activeTab === "subjects" && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <Stat label="Titulares cadastrados" value={subjectsState.data?.items.length ?? 0} />
            {canManage && (
              <Button variant="primary" onClick={openCreateSubject}>
                Novo titular
              </Button>
            )}
          </div>

          {subjectsState.loading ? (
            <LoadingBlock />
          ) : subjectsState.error ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
              {subjectsState.error}
            </div>
          ) : subjectsState.data?.items.length === 0 ? (
            <EmptyState
              title="Nenhum titular cadastrado"
              description="Cadastre ao menos um titular antes de registrar consentimentos."
              action={
                canManage ? (
                  <Button variant="primary" onClick={openCreateSubject}>
                    Criar primeiro titular
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table<DataSubjectRow>
              columns={[
                { key: "code", header: "Código", cell: (r) => r.code },
                { key: "name", header: "Nome", cell: (r) => r.name },
                { key: "email", header: "E-mail", cell: (r) => r.email ?? "—" },
                { key: "document", header: "Documento", cell: (r) => r.document ?? "—" },
                { key: "role", header: "Função", cell: (r) => r.role },
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
              rows={subjectsState.data?.items ?? []}
              keyOf={(r) => r.id}
              empty={<EmptyState title="Nenhum titular encontrado" />}
              onRowClick={canManage ? openEditSubject : undefined}
            />
          )}
        </>
      )}

      {/* Aba: Consentimentos */}
      {activeTab === "consents" && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <Stat label="Consentimentos" value={consentsState.data?.items.length ?? 0} />
            {canManage && (
              <Button variant="primary" onClick={openCreateConsent}>
                Novo consentimento
              </Button>
            )}
          </div>

          {consentsState.loading ? (
            <LoadingBlock />
          ) : consentsState.error ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
              {consentsState.error}
            </div>
          ) : consentsState.data?.items.length === 0 ? (
            <EmptyState
              title="Nenhum consentimento cadastrado"
              description="Registre o primeiro consentimento vinculando um titular a uma operação de tratamento."
              action={
                canManage ? (
                  <Button variant="primary" onClick={openCreateConsent}>
                    Criar primeiro consentimento
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table<ConsentRow>
              columns={[
                { key: "code", header: "Código", cell: (r) => r.code },
                { key: "data_subject_name", header: "Titular", cell: (r) => r.data_subject_name ?? "—" },
                { key: "operation_name", header: "Operação", cell: (r) => r.operation_name ?? "—" },
                { key: "medium", header: "Meio", cell: (r) => mediumLabel(r.medium) },
                {
                  key: "status",
                  header: "Situação",
                  cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                },
                {
                  key: "consented_at",
                  header: "Consentido em",
                  cell: (r) => r.consented_at.slice(0, 16),
                },
              ]}
              rows={consentsState.data?.items ?? []}
              keyOf={(r) => r.id}
              empty={<EmptyState title="Nenhum consentimento encontrado" />}
              onRowClick={canManage ? openEditConsent : undefined}
            />
          )}
        </>
      )}

      {/* Dialog: Titular */}
      <Dialog
        open={openSubjectDialog}
        onClose={() => setOpenSubjectDialog(false)}
        title={editingSubjectId ? "Editar titular" : "Novo titular"}
      >
        <form onSubmit={saveSubject} className="space-y-4">
          <Field label="Código" hint="Ex: SUBJ-2026-000001" required>
            <Input
              value={subjectForm.code}
              onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value })}
              disabled={!!editingSubjectId}
            />
          </Field>
          <Field label="Nome" required>
            <Input value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} />
          </Field>
          <Field label="E-mail">
            <Input value={subjectForm.email} onChange={(e) => setSubjectForm({ ...subjectForm, email: e.target.value })} />
          </Field>
          <Field label="Documento (CPF/CNPJ)">
            <Input value={subjectForm.document} onChange={(e) => setSubjectForm({ ...subjectForm, document: e.target.value })} />
          </Field>
          <Field label="Função">
            <Input value={subjectForm.role} onChange={(e) => setSubjectForm({ ...subjectForm, role: e.target.value })} />
          </Field>
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenSubjectDialog(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!subjectForm.code || !subjectForm.name}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: Consentimento */}
      <Dialog
        open={openConsentDialog}
        onClose={() => setOpenConsentDialog(false)}
        title={editingConsentId ? "Editar consentimento" : "Novo consentimento"}
        wide={true}
      >
        <form onSubmit={saveConsent} className="space-y-4">
          <Field label="Titular" required>
            <Select
              value={consentForm.data_subject_id}
              onChange={(e) => setConsentForm({ ...consentForm, data_subject_id: e.target.value })}
            >
              <option value="">Selecione um titular</option>
              {subjectsState.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} - {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Operação de tratamento" required>
            <Select
              value={consentForm.operation_id}
              onChange={(e) => setConsentForm({ ...consentForm, operation_id: e.target.value })}
            >
              <option value="">Selecione uma operação</option>
            </Select>
          </Field>
          <Field label="Base legal" required>
            <Select
              value={consentForm.legal_base_id}
              onChange={(e) => setConsentForm({ ...consentForm, legal_base_id: e.target.value })}
            >
              <option value="">Selecione uma base legal</option>
            </Select>
          </Field>
          <Field label="Meio do consentimento" required>
            <Select
              value={consentForm.medium}
              onChange={(e) => setConsentForm({ ...consentForm, medium: e.target.value })}>
              <option value="written">Escrito</option>
              <option value="electronic">Eletrônico</option>
              <option value="verbal">Verbal</option>
              <option value="form">Formulário</option>
            </Select>
          </Field>
          <Field label="Versão do texto apresentado" hint="Versão do texto de consentimento mostrado ao titular" required>
            <Input value={consentForm.text_version} onChange={(e) => setConsentForm({ ...consentForm, text_version: e.target.value })} />
          </Field>
          <Field label="Cláusula destacada (escrito)">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consentForm.highlighted_clause}
                onChange={(e) => setConsentForm({ ...consentForm, highlighted_clause: e.target.checked })}
              />
              <span>
                A cláusula de consentimento foi apresentada destacada (obrigatório para consentimento por escrito)
              </span>
            </label>
          </Field>
          <Field label="IP do titular">
            <Input value={consentForm.ip_address} onChange={(e) => setConsentForm({ ...consentForm, ip_address: e.target.value })} />
          </Field>
          <Field label="User-Agent">
            <Input value={consentForm.user_agent} onChange={(e) => setConsentForm({ ...consentForm, user_agent: e.target.value })} />
          </Field>
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenConsentDialog(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                !consentForm.data_subject_id ||
                !consentForm.operation_id ||
                !consentForm.legal_base_id ||
                !consentForm.text_version
              }
            >
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>

    </div>
  );
}
