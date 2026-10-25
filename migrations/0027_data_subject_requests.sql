-- =============================================================================
-- Facil - Migration 0027 - Direitos do titular (LGPD - Lei 13.709/2018, Arts. 18 e 19)
--
-- Art. 18: o titular tem direito, a qualquer momento e mediante requisição, a:
--  (I) confirmação de existência de tratamento; (II) acesso aos dados;
--  (III) correção de dados incompletos/inexatos/desatualizados;
--  (IV) anonimização, bloqueio ou eliminação; (V) portabilidade;
--  (VI) eliminação; (VII) informação de compartilhamento; (VIII) informação
--  sobre consequências da negativa; (IX) revogação do consentimento.
-- Art. 19: a confirmação/acesso será providenciada em formato simplificado,
-- imediatamente, ou por declaração clara e completa em até 15 dias.
--
-- 1) data_subject_requests: solicitações de exercício de direitos do titular,
--    vinculadas a um titular (data_subjects), com tipo de direito, status,
--    data da solicitação, prazo de 15 dias, resposta e responsável.
-- 2) Nunca é apagada: apenas atualizada de status e resposta, preservando
--    auditoria para provar o cumprimento do prazo legal.
-- 3) Permissões: dsr.view, dsr.manage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Solicitações de exercício de direitos do titular (Arts. 18 e 19)
-- -----------------------------------------------------------------------------
CREATE TABLE data_subject_requests (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,          -- DSR-2026-000001
  data_subject_id      TEXT NOT NULL REFERENCES data_subjects(id),
  request_type         TEXT NOT NULL                   -- tipo de direito solicitado
                       CHECK (request_type IN (
                         'access',          -- confirmação de existência / acesso
                         'correction',      -- correção de dados
                         'deletion',        -- eliminação/anonymização/bloqueio
                         'portability',     -- portabilidade dos dados
                         'revocation',      -- revogação do consentimento
                         'information',     -- informação de compartilhamento
                         'consequences',    -- consequências da negativa
                         'other'            -- outro
                       )),
  status               TEXT NOT NULL DEFAULT 'received'
                       CHECK (status IN ('received', 'in_progress', 'responded', 'rejected')),
  requested_at         TEXT NOT NULL,                  -- data da solicitação pelo titular
  due_date             TEXT NOT NULL,                  -- prazo de 15 dias (Art. 19)
  responded_at         TEXT,                           -- data da resposta
  response_summary     TEXT,                           -- resumo da resposta dada ao titular
  response_details     TEXT,                           -- detalhes completos da resposta
  responsible_user_id  TEXT REFERENCES users(id),      -- quem está tratando
  created_by           TEXT NOT NULL REFERENCES users(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_dsr_subject   ON data_subject_requests(data_subject_id);
CREATE INDEX idx_dsr_status    ON data_subject_requests(status);
CREATE INDEX idx_dsr_type      ON data_subject_requests(request_type);
CREATE INDEX idx_dsr_due_date  ON data_subject_requests(due_date);
CREATE UNIQUE INDEX idx_dsr_code ON data_subject_requests(code);

-- -----------------------------------------------------------------------------
-- Permissões do módulo Direitos do titular
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('dsr.view',   'dsr',  'view',   'Visualizar solicitações de direitos do titular'),
  ('dsr.manage', 'dsr',  'manage', 'Criar, editar e responder solicitações de direitos do titular');

-- Admin: todas
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'dsr.%';

-- Gerente de Facilities: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','dsr.view'),
  ('role_manager','dsr.manage');

-- DPO / Encarregado: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_dpo','dsr.view'),
  ('role_dpo','dsr.manage');

-- Diretor de Operações: visão executiva
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','dsr.view');
