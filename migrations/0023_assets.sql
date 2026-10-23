-- =============================================================================
-- Facil - Migration 0023 - Patrimônio (ativos fixos)
--
-- 1) Categorias de patrimônio (cadastro mestre com exclusão controlada)
-- 2) Ativos: registro principal com código gerado, etiqueta opcional, situação,
--    condição, criticidade, local, setor, responsável, centro de custo,
--    aquisição, garantia, identificação, notas.
-- 3) Histórico de movimentações do ativo (aquisição, transferência, atribuição,
--    mudança de situação/condição, manutenção, baixa, descarte, inventário).
-- 4) Permissões: assets.view, assets.manage, assets.move
-- 5) Controle do Sistema: categoria de patrimônio gerenciada pela central.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Categorias de patrimônio
-- -----------------------------------------------------------------------------
CREATE TABLE asset_categories (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  deleted_at  TEXT,
  deleted_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_asset_categories_deleted ON asset_categories(deleted_at);

-- Categorias padrão
INSERT INTO asset_categories (id, code, name, description, sort_order, is_active, created_at, updated_at) VALUES
  ('ac_eqp',   'EQP',  'Equipamentos',      'Máquinas, ferramentas e equipamentos operacionais',   10, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_mob',   'MOB',  'Mobiliário',        'Mesas, cadeiras, armários, estações de trabalho',       20, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_hvac',  'HVAC', 'Climatização',      'Ar-condicionado, ventiladores, exaustores',             30, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_elec',  'ELEC', 'Elétrica',          'Quadros, transformadores, geradores, nobreaks',          40, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_hyd',   'HYD',  'Hidráulica',        'Bombas, reservatórios, aquecedores, tratamento',         50, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_veh',   'VEH',  'Veículos',          'Carros, motos, utilitários, empilhadeiras',              60, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_it',    'IT',   'Tecnologia',        'Servidores, redes, endpoints, impressoras',              70, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_seg',   'SEG',  'Segurança',         'CFTV, alarmes, controle de acesso, extintores',          80, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z'),
  ('ac_oth',   'OUT',  'Outros',            'Demais bens patrimoniais não classificados acima',       90, 1, '2026-10-22T00:00:00.000Z', '2026-10-22T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Ativos (patrimônio)
-- -----------------------------------------------------------------------------
CREATE TABLE assets (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,          -- PAT-2026-000001
  tag                   TEXT UNIQUE,                   -- Etiqueta patrimonial (opcional, única quando preenchida)
  name                  TEXT NOT NULL,
  description           TEXT,
  category_id           TEXT NOT NULL REFERENCES asset_categories(id),
  status                TEXT NOT NULL DEFAULT 'in_use'
                        CHECK (status IN ('in_use','in_stock','maintenance','loaned','retired','disposed','lost')),
  condition             TEXT NOT NULL DEFAULT 'good'
                        CHECK (condition IN ('new','good','fair','poor','unserviceable')),
  criticality           TEXT NOT NULL DEFAULT 'normal'
                        CHECK (criticality IN ('low','normal','high','critical')),
  location_id           TEXT NOT NULL REFERENCES locations(id),
  department_id         TEXT REFERENCES departments(id),
  custodian_user_id     TEXT REFERENCES users(id),
  cost_center_id        TEXT REFERENCES cost_centers(id),
  supplier_id           TEXT REFERENCES suppliers(id),
  acquisition_date      TEXT,
  acquisition_value_cents INTEGER CHECK (acquisition_value_cents >= 0),
  invoice_number        TEXT,
  invoice_series        TEXT,
  warranty_until        TEXT,
  serial_number         TEXT,
  manufacturer          TEXT,
  model                 TEXT,
  manufacture_year      INTEGER CHECK (manufacture_year >= 1900 AND manufacture_year <= 2100),
  notes                 TEXT,
  retired_at            TEXT,
  retired_reason        TEXT,
  retired_by            TEXT REFERENCES users(id),
  created_by            TEXT NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_assets_code        ON assets(code);
CREATE INDEX idx_assets_tag         ON assets(tag);
CREATE INDEX idx_assets_category    ON assets(category_id);
CREATE INDEX idx_assets_status      ON assets(status);
CREATE INDEX idx_assets_location    ON assets(location_id);
CREATE INDEX idx_assets_department  ON assets(department_id);
CREATE INDEX idx_assets_custodian   ON assets(custodian_user_id);
CREATE INDEX idx_assets_cost_center ON assets(cost_center_id);
CREATE INDEX idx_assets_retired     ON assets(retired_at);

-- -----------------------------------------------------------------------------
-- Movimentações/histórico do ativo
-- -----------------------------------------------------------------------------
CREATE TABLE asset_movements (
  id                  TEXT PRIMARY KEY,
  asset_id            TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  type                TEXT NOT NULL
                      CHECK (type IN ('acquisition','transfer','assignment','status_change','condition_change','maintenance','disposal','inventory')),
  from_location_id    TEXT REFERENCES locations(id),
  to_location_id      TEXT REFERENCES locations(id),
  from_user_id        TEXT REFERENCES users(id),
  to_user_id          TEXT REFERENCES users(id),
  from_status         TEXT,
  to_status           TEXT,
  from_condition      TEXT,
  to_condition        TEXT,
  reason              TEXT,
  reference_type      TEXT,        -- ticket, work_order, purchase_receipt, etc.
  reference_id        TEXT,
  movement_date       TEXT NOT NULL,
  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL
);
CREATE INDEX idx_asset_movements_asset   ON asset_movements(asset_id);
CREATE INDEX idx_asset_movements_date    ON asset_movements(movement_date);
CREATE INDEX idx_asset_movements_type    ON asset_movements(type);
CREATE INDEX idx_asset_movements_ref     ON asset_movements(reference_type, reference_id);

-- -----------------------------------------------------------------------------
-- Permissões do módulo Patrimônio
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, action, description) VALUES
  ('assets.view',   'assets',  'view',   'Visualizar ativos, categorias, histórico e anexos'),
  ('assets.manage', 'assets',  'manage', 'Criar, editar, categorizar, baixar e descartar ativos'),
  ('assets.move',   'assets',  'move',   'Transferir local, atribuir responsável e mudar situação operacional');

-- Admin: todas
INSERT INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions WHERE code LIKE 'assets.%';

-- Gerente de Facilities: tudo
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','assets.view'),
  ('role_manager','assets.manage'),
  ('role_manager','assets.move');

-- Diretor de Operações: visão executiva
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','assets.view');

-- Gestor de Compras: visão (para receber ativos do recebimento)
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_purchasing_manager','assets.view');

-- Comprador: visão
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_buyer','assets.view');

-- Estoque: visão, mover, gerenciar (para conferência e transferência)
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_stock','assets.view'),
  ('role_stock','assets.move'),
  ('role_stock','assets.manage');

-- Técnico: visão (para ver equipamento na OS)
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_tech','assets.view');

-- Liderança de limpeza: visão
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_clean_lead','assets.view');

-- Recepção: visão
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_reception','assets.view');