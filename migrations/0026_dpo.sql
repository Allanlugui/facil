-- =============================================================================
-- Facil - Migration 0026 - Encarregado (DPO) - LGPD Art. 41
--
-- Art. 41: o controlador deverá indicar encarregado pelo tratamento de dados
-- pessoais. A identidade e contato devem ser divulgados publicamente; o
-- encarregado aceita reclamações, recebe comunicações da autoridade nacional,
-- orienta funcionários e executa demais atribuições.
--
-- 1) data_protection_officers: cadastro do(a) encarregado(a), com nome, contato,
--    ativo/inativo e período de vigência. Só um ativo por vez (regra de negócio).
-- 2) Permissões: dpo.view, dpo.manage
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Encarregado (DPO) pelo tratamento de dados pessoais
-- -----------------------------------------------------------------------------
CREATE TABLE data_protection_officers (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,          -- DPO-2026-000001
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  department    TEXT,                          -- setor/área a que pertence
  active_from   TEXT NOT NULL,                 -- data de início da designação
  active_until  TEXT,                          -- data de término (null = vigente)
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deactivated_at TEXT,
  deactivated_by TEXT REFERENCES users(id),
  deactivation_reason TEXT
);
CREATE INDEX idx_dpo_active ON data_protection_officers(is_active);
CREATE UNIQUE INDEX idx_dpo_code ON data_protection_officers(code);
CREATE UNIQUE INDEX idx_dpo_email ON data_protection_officers(email);

-- -----------------------------------------------------------------------------
-- Permissões do módulo Encarregado (DPO)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('dpo.view',   'dpo',  'view',   'Visualizar encarregado (DPO)'),
  ('dpo.manage', 'dpo',  'manage', 'Criar, editar e desativar encarregado (DPO)');

-- Admin: todas
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'dpo.%';

-- Gerente de Facilities: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','dpo.view'),
  ('role_manager','dpo.manage');

-- DPO / Encarregado: visualizar o próprio registro
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_dpo','dpo.view');

-- Diretor de Operações: visão executiva
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','dpo.view');
