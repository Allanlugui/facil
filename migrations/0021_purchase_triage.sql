-- =============================================================================
-- Facil - Migration 0021 - Triagem de compras antes da aprovacao do gestor
--
-- O fluxo v3 passa a ser:
--   solicitacao -> triagem do comprador -> aprovacao/refinamento do gestor de
--   compras -> comprador executa -> recebimento.
--
-- Para nao reconstruir `purchase_requests` (o CHECK de `approval_stage` nao
-- aceita um valor novo sem rebuild), a triagem usa a mesma etapa armazenada
-- `purchasing` e ganha um marco proprio:
--   - `triage_completed_at IS NULL`  -> aguardando triagem do comprador;
--   - `triage_completed_at NOT NULL` -> triagem concluida, aguardando o gestor.
-- A API converte o primeiro caso para `approvalStage = "triage"`, de modo que
-- a tela e os filtros enxergam a etapa correta sem alterar o CHECK legado.
--
-- Solicitacoes v3 em andamento:
--   - paradas no antigo `manager` (gestor do setor) voltam para a triagem;
--   - paradas no antigo `purchasing` (gestor ja aprovou) permanecem com o
--     gestor de compras e recebem o marco de triagem concluida.
-- =============================================================================

ALTER TABLE purchase_requests ADD COLUMN triage_completed_at TEXT;
ALTER TABLE purchase_requests ADD COLUMN triage_completed_by TEXT REFERENCES users(id);

CREATE INDEX idx_pr_triage
  ON purchase_requests(flow_revision, approval_stage, triage_completed_at);

-- Antigas solicitacoes v3 que ainda aguardavam o gestor do setor passam a
-- aguardar a triagem do comprador.
UPDATE purchase_requests
   SET approval_stage = 'purchasing',
       triage_completed_at = NULL,
       triage_completed_by = NULL
 WHERE flow_revision = 3
   AND status IN ('draft', 'pending_approval')
   AND approval_stage = 'manager';

-- Antigas solicitacoes v3 ja aprovadas pelo gestor do setor continuam com o
-- gestor de compras; o marco evita que voltem para a triagem.
UPDATE purchase_requests
   SET triage_completed_at = COALESCE(manager_approved_at, updated_at),
       triage_completed_by = manager_approved_by
 WHERE flow_revision = 3
   AND status = 'pending_approval'
   AND approval_stage = 'purchasing'
   AND triage_completed_at IS NULL
   AND manager_approved_at IS NOT NULL;
