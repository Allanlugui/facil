-- =============================================================================
-- Facil - Migration 0028 - Medidas de segurança (LGPD - Lei 13.709/2018, Arts. 46 e 49)
--
-- Art. 46: os agentes de tratamento devem adotar medidas de segurança, técnicas
-- e administrativas aptas a proteger os dados pessoais de acessos não
-- autorizados e de situações acidentais ou ilícitas de destruição, perda,
-- alteração, comunicação ou qualquer forma de tratamento inadequado ou ilícito.
-- As medidas devem ser observadas desde a fase de concepção até a execução.
-- Art. 49: os sistemas utilizados para o tratamento de dados pessoais devem ser
-- estruturados de forma a atender aos requisitos de segurança, aos padrões de
-- boas práticas e de governança e aos princípios gerais previstos nesta Lei.
--
-- 1) security_measures: inventário de medidas de segurança técnica e
--    administrativa, com tipo (técnica/administrativa), categoria, status de
--    implementação, responsável, periodicidade de revisão e evidência.
-- 2) Nunca é apagada: medida substituída é desativada com motivo.
-- 3) Permissões: sec.view, sec.manage
-- =============================================================================

CREATE TABLE security_measures (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,          -- SEC-2026-000001
  name              TEXT NOT NULL,
  description       TEXT,
  type              TEXT NOT NULL                   -- técnica ou administrativa
                    CHECK (type IN ('technical','administrative')),
  category          TEXT NOT NULL                   -- categoria da medida
                    CHECK (category IN (
                      'encryption',        -- criptografia
                      'access_control',    -- controle de acesso
                      'backup',            -- backup e recuperação
                      'logging',           -- logs e auditoria
                      'training',          -- treinamento e conscientização
                      'incident_response', -- resposta a incidentes
                      'governance',        -- governança e boas práticas
                      'network',           -- segurança de rede
                      'other'              -- outro
                    )),
  implementation_status TEXT NOT NULL DEFAULT 'planned'
                        CHECK (implementation_status IN (
                          'implemented',       -- implementada
                          'partially',         -- parcialmente implementada
                          'planned',           -- planejada
                          'not_implemented'    -- não implementada
                        )),
  responsible_user_id TEXT REFERENCES users(id),     -- responsável pela medida
  review_frequency  TEXT,                           -- periodicidade de revisão (ex: anual, trimestral)
  last_review_at    TEXT,                           -- data da última revisão
  next_review_at    TEXT,                           -- próxima revisão prevista
  evidence          TEXT,                           -- evidência de implementação (referência, documento, controle)
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  deactivated_at    TEXT,
  deactivated_by    TEXT REFERENCES users(id),
  deactivation_reason TEXT,
  created_by        TEXT NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX idx_sec_code       ON security_measures(code);
CREATE INDEX idx_sec_active     ON security_measures(is_active);
CREATE INDEX idx_sec_type       ON security_measures(type);
CREATE INDEX idx_sec_category   ON security_measures(category);
CREATE INDEX idx_sec_status     ON security_measures(implementation_status);
CREATE UNIQUE INDEX idx_sec_code_unique ON security_measures(code);

-- -----------------------------------------------------------------------------
-- Permissões do módulo Segurança
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('sec.view',   'sec',  'view',   'Visualizar inventário de medidas de segurança (LGPD Arts. 46/49)'),
  ('sec.manage', 'sec',  'manage', 'Criar, editar e desativar medidas de segurança');

-- Admin: todas
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'sec.%';

-- Gerente de Facilities: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','sec.view'),
  ('role_manager','sec.manage');

-- DPO / Encarregado: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_dpo','sec.view'),
  ('role_dpo','sec.manage');

-- Diretor de Operações: visão executiva
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','sec.view');
