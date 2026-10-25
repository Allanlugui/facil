-- =============================================================================
-- Facil - Migration 0025 - Consentimento (LGPD - Lei 13.709/2018, Art. 8º)
--
-- Art. 8º: consentimento por escrito ou meio que demonstre manifestação de
-- vontade; cláusula destacada; ônus da prova do controlador; finalidades
-- determinadas; revogação a qualquer momento.
--
-- 1) data_subjects: titulares de dados cadastrados (pessoas cujos dados o
--    Facil trata em nome da empresa de contabilidade).
-- 2) consents: cada manifestação de consentimento, vinculada a uma operação
--    de tratamento (base legal 'consentimento'), com meio, versão do texto,
--    status (ativo/revogado) e prova. Nunca é apagado: revogado fica com
--    status e data da revogação para auditoria.
-- 3) Permissões: consent.view, consent.manage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Titulares de dados pessoais
-- -----------------------------------------------------------------------------
CREATE TABLE data_subjects (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- SUBJ-2026-000001
  name        TEXT NOT NULL,
  email       TEXT,
  document    TEXT,                          -- CPF/CNPJ (apenas dígitos)
  role        TEXT NOT NULL DEFAULT 'cliente',-- cliente, funcionario, fornecedor
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_data_subjects_code   ON data_subjects(code);
CREATE INDEX idx_data_subjects_active ON data_subjects(is_active);
CREATE UNIQUE INDEX idx_data_subjects_email ON data_subjects(email);

-- -----------------------------------------------------------------------------
-- Consentimentos (prova de manifestação de vontade, Art. 8º)
-- -----------------------------------------------------------------------------
CREATE TABLE consents (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,          -- CONS-2026-000001
  data_subject_id      TEXT NOT NULL REFERENCES data_subjects(id),
  operation_id         TEXT NOT NULL REFERENCES data_processing_operations(id),
  legal_base_id        TEXT NOT NULL REFERENCES legal_bases(id),
  medium               TEXT NOT NULL                   -- written, electronic, verbal, form
                       CHECK (medium IN ('written','electronic','verbal','form')),
  consented_at         TEXT NOT NULL,                  -- instante da manifestação
  consented_by         TEXT NOT NULL REFERENCES users(id),-- quem colheu/registrou
  text_version         TEXT NOT NULL,                  -- versão do texto apresentado ao titular
  highlighted_clause   INTEGER NOT NULL DEFAULT 0 CHECK (highlighted_clause IN (0,1)),
                      -- 1 se a cláusula de consentimento foi apresentada destacada (escrito)
  ip_address           TEXT,
  user_agent           TEXT,
  status               TEXT NOT NULL DEFAULT 'active'  -- active, revoked, expired
                       CHECK (status IN ('active','revoked','expired')),
  revoked_at           TEXT,
  revoked_by           TEXT REFERENCES users(id),
  revocation_reason    TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_consents_subject   ON consents(data_subject_id);
CREATE INDEX idx_consents_operation ON consents(operation_id);
CREATE INDEX idx_consents_status    ON consents(status);
CREATE INDEX idx_consents_created   ON consents(consented_at);
CREATE UNIQUE INDEX idx_consents_code ON consents(code);

-- -----------------------------------------------------------------------------
-- Permissões do módulo Consentimento
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('consent.view',  'consent',  'view',   'Visualizar titulares e consentimentos'),
  ('consent.manage','consent',  'manage', 'Criar, editar e revogar consentimentos');

-- Admin: todas
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'consent.%';

-- Gerente de Facilities: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','consent.view'),
  ('role_manager','consent.manage');

-- DPO / Encarregado: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_dpo','consent.view'),
  ('role_dpo','consent.manage');

-- Diretor: visão
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','consent.view');
