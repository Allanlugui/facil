-- =============================================================================
-- Facil - Migration 0024 - Registro de base legal e operações de tratamento (LGPD - Lei 13.709/2018)
--
-- Art. 7º: tratamento de dados pessoais somente com base legal identificada.
-- Art. 37: registro das operações de tratamento de dados pessoais.
--
-- 1) legal_bases: catálogo de bases legais (consentimento, contrato, obrigação
--    legal, interesse legítimo, etc.).
-- 2) data_processing_operations: operações de tratamento vinculadas a uma
--    base legal, com finalidade, categorias de dados e titulares, prazo de guarda.
-- 3) Permissões: legal.view, legal.manage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Catálogo de bases legais (Art. 7º LGPD)
-- -----------------------------------------------------------------------------
CREATE TABLE legal_bases (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  article_ref TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_legal_bases_active ON legal_bases(is_active);
CREATE UNIQUE INDEX idx_legal_bases_code ON legal_bases(code);

-- Bases legais padrão (Art. 7º LGPD)
INSERT INTO legal_bases (id, code, name, description, article_ref, is_active, created_at, updated_at) VALUES
  ('lb_consent',   'CONSENTIMENTO',   'Consentimento do titular',            'Tratamento com base no consentimento do titular.', 'Art. 7º, I', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_contract',  'CONTRATO',        'Execução de contrato',                'Necessário para execução de contrato ou preliminares.', 'Art. 7º, V', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_legal',     'OBRIGACAO_LEGAL', 'Cumprimento de obrigação legal',      'Obrigatoriedade imposta por lei ou regulamento.', 'Art. 7º, II', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_public',    'PODER_PUBLICO',   'Políticas públicas',                  'Execução de políticas públicas pelo poder público.', 'Art. 7º, III', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_study',     'ESTUDO_PESQUISA', 'Estudos por órgão de pesquisa',        'Estudos com anonimização, quando possível.', 'Art. 7º, IV', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_exercise',  'EXERCICIO_DIREITO','Exercício regular de direitos',       'Exercício regular de direitos em processo judicial/administrativo.', 'Art. 7º, VI', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_life',      'TUTELA_VIDA',     'Proteção da vida ou incolumidade',    'Proteção da vida ou da incolumidade física.', 'Art. 7º, VII', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_health',    'SAUDE',           'Tutela da saúde',                     'Procedimento por profissionais/serviços de saúde.', 'Art. 7º, VIII', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_legitimate','INTERESSE_LEGITIMO','Interesse legítimo do controlador', 'Interesses legítimos, exceto se prevalecerem direitos do titular.', 'Art. 7º, IX', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z'),
  ('lb_credit',    'PROTECAO_CREDITO','Proteção do crédito',                 'Proteção do crédito, nos termos da legislação pertinente.', 'Art. 7º, X', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Operações de tratamento de dados (Art. 7º/37 LGPD) - criado ANTES de 0025
-- para satisfazer a FK em consents.operation_id
-- -----------------------------------------------------------------------------
CREATE TABLE data_processing_operations (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  legal_base_id       TEXT NOT NULL REFERENCES legal_bases(id),
  purpose             TEXT NOT NULL,
  data_categories     TEXT NOT NULL,
  data_subjects       TEXT NOT NULL,
  retention_period    TEXT,
  retention_justification TEXT,
  controller          TEXT DEFAULT 'Facil',
  dpo_contact         TEXT,
  is_active           INTEGER DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by          TEXT REFERENCES users(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT,
  deleted_by          TEXT REFERENCES users(id)
);
CREATE INDEX idx_dpo_operations_legal_base ON data_processing_operations(legal_base_id);
CREATE INDEX idx_dpo_operations_active     ON data_processing_operations(is_active);
CREATE INDEX idx_dpo_operations_created    ON data_processing_operations(created_at);
CREATE UNIQUE INDEX idx_dpo_operations_code ON data_processing_operations(code);

-- -----------------------------------------------------------------------------
-- Perfil DPO / Encarregado (criado antes das permissões que o referenciam)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, name, code, description, is_system, created_at, updated_at) VALUES
  ('role_dpo', 'Encarregado de Dados (DPO)', 'dpo', 'Encarregado pelo tratamento de dados pessoais (LGPD Art. 41).', 1, '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Permissões do módulo Legal/LGPD
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('legal.view',   'legal',  'view',   'Visualizar bases legais e operações de tratamento'),
  ('legal.manage', 'legal',  'manage', 'Criar, editar e desativar bases legais e operações de tratamento');

-- Admin: todas
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'legal.%';

-- Gerente de Facilities: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','legal.view'),
  ('role_manager','legal.manage');

-- Diretor de Operações: visão executiva
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','legal.view');

-- DPO / Encarregado: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_dpo','legal.view'),
  ('role_dpo','legal.manage');