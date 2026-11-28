/**
 * LGPD - Registro de base legal para tratamento de dados pessoais (Art. 7º,
 * Lei 13.709/2018).
 *
 * Tela de gestão de bases legais e operações de tratamento.
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

interface LegalBaseRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  article_ref: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface DataProcessingOperationRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  legal_base_id: string;
  legal_base_code: string | null;
  legal_base_name: string | null;
  purpose: string;
  data_categories: string[];
  data_subjects: string[];
  retention_period: string | null;
  retention_justification: string | null;
  controller: string | null;
  dpo_contact: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export default function LegalPage() {
  const { permissions } = useSession();
  const { push } = useToast();
  const canManage = permissions.has(PERMISSIONS.LEGAL_MANAGE);
  const [activeTab, setActiveTab] = useState<"bases" | "operations">("bases");

  /* --- Estado de formulário (base legal) --- */
  const [openBaseDialog, setOpenBaseDialog] = useState(false);
  const [editingBaseId, setEditingBaseId] = useState<string | null>(null);
  const [baseForm, setBaseForm] = useState({
    code: "",
    name: "",
    description: "",
    article_ref: "",
  });

  /* --- Estado de formulário (operação) --- */
  const [openOpDialog, setOpenOpDialog] = useState(false);
  const [editingOpId, setEditingOpId] = useState<string | null>(null);
  const [opForm, setOpForm] = useState({
    name: "",
    description: "",
    legal_base_id: "",
    purpose: "",
    data_categories: [] as string[],
    data_subjects: [] as string[],
    retention_period: "",
    retention_justification: "",
    controller: "",
    dpo_contact: "",
    is_active: true,
  });

  /* --- Dados --- */
  const basesState = useAsync<{ items: LegalBaseRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: LegalBaseRow[]; total: number }>("/api/legal/bases/catalog");
      return data;
    },
    [],
  );

  const opsState = useAsync<{ items: DataProcessingOperationRow[]; total: number }>(
    async () => {
      const data = await apiGet<{ items: DataProcessingOperationRow[]; total: number }>(
        "/api/legal/operations",
        { page: "1", pageSize: "50" },
      );
      return data;
    },
    [],
  );

  useEffect(() => {
    if (activeTab === "bases") basesState.reload();
    else opsState.reload();
  }, [activeTab, basesState.reload, opsState.reload]);

  /* --- Handlers: base legal --- */
  const openCreateBase = () => {
    setEditingBaseId(null);
    setBaseForm({ code: "", name: "", description: "", article_ref: "" });
    setOpenBaseDialog(true);
  };

  const openEditBase = (row: LegalBaseRow) => {
    setEditingBaseId(row.id);
    setBaseForm({
      code: row.code,
      name: row.name,
      description: row.description ?? "",
      article_ref: row.article_ref ?? "",
    });
    setOpenBaseDialog(true);
  };

  const saveBase = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingBaseId) {
        await apiPatch(`/api/legal/bases/${editingBaseId}`, {
          name: baseForm.name,
          description: baseForm.description || null,
          article_ref: baseForm.article_ref || null,
        });
      } else {
        await apiPost("/api/legal/bases", {
          code: baseForm.code,
          name: baseForm.name,
          description: baseForm.description || null,
          article_ref: baseForm.article_ref || null,
        });
      }
      setOpenBaseDialog(false);
      basesState.reload();
      push("Base legal salva com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  /* --- Handlers: operação de tratamento --- */
  const openCreateOp = () => {
    setEditingOpId(null);
    setOpForm({
      name: "",
      description: "",
      legal_base_id: "",
      purpose: "",
      data_categories: [],
      data_subjects: [],
      retention_period: "",
      retention_justification: "",
      controller: "",
      dpo_contact: "",
      is_active: true,
    });
    setOpenOpDialog(true);
  };

  const openEditOp = (row: DataProcessingOperationRow) => {
    setEditingOpId(row.id);
    setOpForm({
      name: row.name,
      description: row.description ?? "",
      legal_base_id: row.legal_base_id,
      purpose: row.purpose,
      data_categories: row.data_categories,
      data_subjects: row.data_subjects,
      retention_period: row.retention_period ?? "",
      retention_justification: row.retention_justification ?? "",
      controller: row.controller ?? "",
      dpo_contact: row.dpo_contact ?? "",
      is_active: row.is_active,
    });
    setOpenOpDialog(true);
  };

  const saveOp = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingOpId) {
        await apiPatch(`/api/legal/operations/${editingOpId}`, {
          name: opForm.name,
          description: opForm.description || null,
          legal_base_id: opForm.legal_base_id,
          purpose: opForm.purpose,
          data_categories: opForm.data_categories,
          data_subjects: opForm.data_subjects,
          retention_period: opForm.retention_period || null,
          retention_justification: opForm.retention_justification || null,
          controller: opForm.controller || null,
          dpo_contact: opForm.dpo_contact || null,
          is_active: opForm.is_active,
        });
      } else {
        await apiPost("/api/legal/operations", {
          name: opForm.name,
          description: opForm.description || null,
          legal_base_id: opForm.legal_base_id,
          purpose: opForm.purpose,
          data_categories: opForm.data_categories,
          data_subjects: opForm.data_subjects,
          retention_period: opForm.retention_period || null,
          retention_justification: opForm.retention_justification || null,
          controller: opForm.controller || null,
          dpo_contact: opForm.dpo_contact || null,
        });
      }
      setOpenOpDialog(false);
      opsState.reload();
      push("Operação de tratamento salva com sucesso.", "green");
    } catch (err) {
      push(apiErrorMessage(err), "red");
    }
  };

  const addChip = (arr: string[], value: string, set: (v: string[]) => void) => {
    const trimmed = value.trim();
    if (trimmed && !arr.includes(trimmed)) set([...arr, trimmed]);
  };
  const removeChip = (arr: string[], idx: number, set: (v: string[]) => void) => {
    set(arr.filter((_, i) => i !== idx));
  };

  const chipRow = (items: string[], set: (v: string[]) => void, placeholder: string) => (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-sm">
          {item}
          <button
            type="button"
            onClick={() => removeChip(items, i, set)}
            className="ml-1 hover:text-red-600 transition-colors"
          >
            ×
          </button>
        </span>
      ))}
      <Input
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addChip(items, (e.target as HTMLInputElement).value, set);
            (e.target as HTMLInputElement).value = "";
          }
        }}
        className="flex-1 min-w-[140px]"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="LGPD - Base legal"
        description="Registro de bases legais e operações de tratamento (Art. 7º, Lei 13.709/2018)"
        backTo="/configuracoes/administracao"
        backLabel="Voltar à administração"
      />

      {/* Tabs simples */}
      <div className="flex gap-2 overflow-x-auto border-b border-slate-200 mb-4 pb-px">
        <Button
          variant={activeTab === "bases" ? "primary" : "ghost"}
          onClick={() => setActiveTab("bases")}
        >
          Bases legais
        </Button>
        <Button
          variant={activeTab === "operations" ? "primary" : "ghost"}
          onClick={() => setActiveTab("operations")}
        >
          Operações de tratamento
        </Button>
      </div>

      {/* Aba: Bases legais */}
      {activeTab === "bases" && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <Stat label="Bases legais cadastradas" value={basesState.data?.items.length ?? 0} />
            {canManage && (
              <Button variant="primary" onClick={openCreateBase}>
                Nova base legal
              </Button>
            )}
          </div>

          {basesState.loading ? (
            <LoadingBlock />
          ) : basesState.error ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
              {basesState.error}
            </div>
          ) : basesState.data?.items.length === 0 ? (
            <EmptyState
              title="Nenhuma base legal cadastrada"
              description="Cadastre ao menos uma base legal antes de criar operações de tratamento."
              action={
                canManage ? (
                  <Button variant="primary" onClick={openCreateBase}>
                    Criar primeira base
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table<LegalBaseRow>
              columns={[
                { key: "code", header: "Código", cell: (r) => r.code },
                { key: "name", header: "Nome", cell: (r) => r.name },
                {
                  key: "article_ref",
                  header: "Referência (Art.)",
                  cell: (r) => r.article_ref ?? "—",
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
              rows={basesState.data?.items ?? []}
              keyOf={(r) => r.id}
              empty={<EmptyState title="Nenhuma base legal encontrada" />}
              onRowClick={canManage ? openEditBase : undefined}
            />
          )}
        </>
      )}

      {/* Aba: Operações de tratamento */}
      {activeTab === "operations" && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <Stat label="Operações de tratamento" value={opsState.data?.items.length ?? 0} />
            {canManage && (
              <Button variant="primary" onClick={openCreateOp}>
                Nova operação
              </Button>
            )}
          </div>

          {opsState.loading ? (
            <LoadingBlock />
          ) : opsState.error ? (
            <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
              {opsState.error}
            </div>
          ) : opsState.data?.items.length === 0 ? (
            <EmptyState
              title="Nenhuma operação de tratamento cadastrada"
              description="Cadastre operações vinculando cada uma a uma base legal."
              action={
                canManage ? (
                  <Button variant="primary" onClick={openCreateOp}>
                    Criar primeira operação
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table<DataProcessingOperationRow>
              columns={[
                { key: "code", header: "Código", cell: (r) => r.code },
                { key: "name", header: "Nome", cell: (r) => r.name },
                {
                  key: "legal_base_name",
                  header: "Base legal",
                  cell: (r) => r.legal_base_name ?? "—",
                },
                {
                  key: "purpose",
                  header: "Finalidade",
                  cell: (r) => (r.purpose.length > 60 ? r.purpose.slice(0, 60) + "…" : r.purpose),
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
              rows={opsState.data?.items ?? []}
              keyOf={(r) => r.id}
              empty={<EmptyState title="Nenhuma operação encontrada" />}
              onRowClick={canManage ? openEditOp : undefined}
            />
          )}
        </>
      )}

      {/* Dialog: Base legal */}
      <Dialog
        open={openBaseDialog}
        onClose={() => setOpenBaseDialog(false)}
        title={editingBaseId ? "Editar base legal" : "Nova base legal"}
        wide={false}
      >
        <form onSubmit={saveBase} className="space-y-4">
          <Field label="Código" hint="Ex: CONSENTIMENTO, CONTRATO, OBRIGACAO_LEGAL" required>
            <Input
              value={baseForm.code}
              onChange={(e) => setBaseForm({ ...baseForm, code: e.target.value })}
              disabled={!!editingBaseId}
            />
          </Field>
          <Field label="Nome" hint="Ex: Consentimento do titular, Execução de contrato" required>
            <Input value={baseForm.name} onChange={(e) => setBaseForm({ ...baseForm, name: e.target.value })} />
          </Field>
          <Field label="Descrição">
            <Textarea value={baseForm.description} onChange={(e) => setBaseForm({ ...baseForm, description: e.target.value })} />
          </Field>
          <Field label="Referência (Artigo LGPD)" hint="Ex: Art. 7º, I">
            <Input value={baseForm.article_ref} onChange={(e) => setBaseForm({ ...baseForm, article_ref: e.target.value })} />
          </Field>
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenBaseDialog(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!baseForm.code || !baseForm.name}>
              Salvar
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: Operação de tratamento */}
      <Dialog
        open={openOpDialog}
        onClose={() => setOpenOpDialog(false)}
        title={editingOpId ? "Editar operação de tratamento" : "Nova operação de tratamento"}
        wide={true}
      >
        <form onSubmit={saveOp} className="space-y-4">
          <Field label="Nome da operação" hint="Ex: Cadastro de clientes, Folha de pagamento" required>
            <Input value={opForm.name} onChange={(e) => setOpForm({ ...opForm, name: e.target.value })} />
          </Field>
          <Field label="Descrição">
            <Textarea value={opForm.description} onChange={(e) => setOpForm({ ...opForm, description: e.target.value })} />
          </Field>
          <Field label="Base legal" required>
            <Select
              value={opForm.legal_base_id}
              onChange={(e) => setOpForm({ ...opForm, legal_base_id: e.target.value })}
            >
              <option value="">Selecione uma base legal</option>
              {basesState.data?.items.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} - {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Finalidade do tratamento" hint="Descreva de forma específica e legítima" required>
            <Textarea value={opForm.purpose} onChange={(e) => setOpForm({ ...opForm, purpose: e.target.value })} />
          </Field>
          <Field label="Categorias de dados tratados" hint="Ex: dados de identificação, dados financeiros" required>
            {chipRow(opForm.data_categories, (v) => setOpForm({ ...opForm, data_categories: v }), "Nova categoria…")}
          </Field>
          <Field label="Categorias de titulares" hint="Ex: clientes, funcionários, fornecedores" required>
            {chipRow(opForm.data_subjects, (v) => setOpForm({ ...opForm, data_subjects: v }), "Novo titular…")}
          </Field>
          <Field label="Prazo de guarda" hint="Ex: 5 anos, indefinido enquanto houver obrigação legal">
            <Input value={opForm.retention_period} onChange={(e) => setOpForm({ ...opForm, retention_period: e.target.value })} />
          </Field>
          <Field label="Justificativa do prazo">
            <Textarea value={opForm.retention_justification} onChange={(e) => setOpForm({ ...opForm, retention_justification: e.target.value })} />
          </Field>
          <Field label="Controlador" hint="Quem controla os dados (ex: nome da empresa)">
            <Input value={opForm.controller} onChange={(e) => setOpForm({ ...opForm, controller: e.target.value })} />
          </Field>
          <Field label="Contato do encarregado (DPO)">
            <Input value={opForm.dpo_contact} onChange={(e) => setOpForm({ ...opForm, dpo_contact: e.target.value })} />
          </Field>
          <div className="dialog-footer flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpenOpDialog(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                !opForm.name ||
                !opForm.purpose ||
                !opForm.legal_base_id ||
                opForm.data_categories.length === 0 ||
                opForm.data_subjects.length === 0
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
