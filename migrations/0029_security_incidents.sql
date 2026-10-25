-- =============================================================================
-- Facil - Migration 0029 - Incidentes de segurança (LGPD - Lei 13.709/2018, Art. 48)
--
-- Art. 48: o controlador deverá comunicar à autoridade nacional e ao titular a
-- ocorrência de incidente de segurança que possa acarretar risco ou dano
-- relevante aos titulares.
-- §1º A comunicação será feita em prazo razoável e deverá mencionar, no mínimo:
--   I - a descrição da natureza dos dados pessoais afetados;
--   II - as informações sobre os titulares envolvidos;
--   III - a indicação das medidas técnicas e de segurança utilizadas;
--   IV - os riscos relacionados ao incidente;
--   V - os motivos da demora, no caso de a comunicação não ter sido imediata;
--   VI - as medidas que foram ou serão adotadas para reverter/mitigar os efeitos.
--
-- 1) security_incidents: registro do incidente com todos os elementos da
--    comunicação obrigatória, status, comunicação à ANPD e aos titulares.
-- 2) Nunca é apagado: apenas atualizado de status, preservando auditoria.
-- 3) Permissões: incident.view, incident.manage
-- =============================================================================

CREATE TABLE security_incidents (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,          -- INC-2026-000001
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,                 -- natureza do incidente
  severity              TEXT NOT NULL DEFAULT 'medium'
                        CHECK (severity IN ('low','medium','high','critical')),
  detected_at           TEXT NOT NULL,                 -- data/hora da detecção
  data_affected         TEXT NOT NULL,                 -- JSON: natureza dos dados pessoais afetados (I)
  subjects_affected     TEXT NOT NULL,                 -- JSON/descrição: titulares envolvidos (II)
  security_measures     TEXT,                          -- medidas de proteção usadas (III)
  risks                 TEXT,                          -- riscos relacionados (IV)
  communication_delay_reason TEXT,                     -- motivo da demora (V)
  mitigation_measures   TEXT,                          -- medidas de reversão/mitigação (VI)
  status                TEXT NOT NULL DEFAULT 'detected'
                        CHECK (status IN ('detected','in_analysis','communicating','communicated','resolved')),
  anpd_notified_at      TEXT,                          -- comunicação à autoridade nacional
  subjects_notified_at  TEXT,                          -- comunicação aos titulares
  notification_medium   TEXT,                          -- meio da comunicação aos titulares
  responsible_user_id   TEXT REFERENCES users(id),     -- responsável pelo tratamento do incidente
  resolved_at           TEXT,
  resolution_summary    TEXT,
  created_by            TEXT NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_inc_code      ON security_incidents(code);
CREATE INDEX idx_inc_status    ON security_incidents(status);
CREATE INDEX idx_inc_severity  ON security_incidents(severity);
CREATE INDEX idx_inc_detected  ON security_incidents(detected_at);
CREATE UNIQUE INDEX idx_inc_code_unique ON security_incidents(code);

-- -----------------------------------------------------------------------------
-- Permissões do módulo Incidentes
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('incident.view',   'incident',  'view',   'Visualizar incidentes de segurança'),
  ('incident.manage', 'incident',  'manage', 'Registrar, atualizar e comunicar incidentes de segurança');

-- Admin: todas
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'incident.%';

-- Gerente de Facilities: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','incident.view'),
  ('role_manager','incident.manage');

-- DPO / Encarregado: gerenciar
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_dpo','incident.view'),
  ('role_dpo','incident.manage');

-- Diretor de Operações: visão executiva
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','incident.view');
