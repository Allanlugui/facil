-- =============================================================================
-- Facil - Plataforma Unificada de Gestão de Facilities
-- Migration 0001 - Schema base
--
-- Convenções:
--   * IDs: TEXT (UUID v4 gerado pela aplicação)
--   * Quantidades: INTEGER em "milli-unidades" (1000 = 1 unidade de consumo).
--     Evita ponto flutuante e garante aritmética exata de estoque.
--   * Dinheiro: INTEGER em centavos.
--   * Datas: TEXT ISO-8601 em UTC (ex: 2026-10-16T22:36:22.000Z).
--     A conversão para America/Sao_Paulo ocorre apenas na apresentação.
--   * Movimentos são a FONTE DE VERDADE do estoque. A tabela `stock` e o saldo
--     materializado, atualizado na MESMA transação do movimento.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- Estrutura organizacional e de locais
-- -----------------------------------------------------------------------------

CREATE TABLE units (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  address     TEXT,
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Tipos de local configuráveis (o .bat da empresa define os seus)
CREATE TABLE location_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Hierarquia livre: Unidade > Prédio > Andar > Setor > Ambiente
CREATE TABLE locations (
  id          TEXT PRIMARY KEY,
  unit_id     TEXT NOT NULL REFERENCES units(id),
  parent_id   TEXT REFERENCES locations(id),
  type_id     TEXT NOT NULL REFERENCES location_types(id),
  name        TEXT NOT NULL,
  code        TEXT,
  path        TEXT NOT NULL DEFAULT '',
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_locations_unit   ON locations(unit_id);
CREATE INDEX idx_locations_parent ON locations(parent_id);
CREATE INDEX idx_locations_type   ON locations(type_id);
CREATE UNIQUE INDEX idx_locations_unit_name ON locations(unit_id, parent_id, name);

-- -----------------------------------------------------------------------------
-- Usuários, perfis, permissões e sessões
-- -----------------------------------------------------------------------------

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Catálogo de permissões no formato módulo.ação
CREATE TABLE permissions (
  code        TEXT PRIMARY KEY,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT,
  password_salt        TEXT,
  password_iterations  INTEGER,
  role_id              TEXT NOT NULL REFERENCES roles(id),
  unit_id              TEXT REFERENCES units(id),
  employee_code        TEXT,
  phone                TEXT,
  job_title            TEXT,
  notes                TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  last_login_at        TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_users_role ON users(role_id);

-- Escopo opcional por local. Sem linhas = sem restrição de local.
CREATE TABLE user_location_scopes (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- -----------------------------------------------------------------------------
-- Catálogo de materiais
-- -----------------------------------------------------------------------------

CREATE TABLE product_categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES product_categories(id),
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_categories_parent_name ON product_categories(parent_id, name);

-- Unidades de medida (UN, CX, PCT, FD, KG, L, RL ...)
CREATE TABLE uoms (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  allows_decimal INTEGER NOT NULL DEFAULT 0 CHECK (allows_decimal IN (0,1)),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE suppliers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  doc          TEXT,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  notes        TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  sku                 TEXT UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  category_id         TEXT REFERENCES product_categories(id),
  -- unidade de consumo
  uom_id              TEXT NOT NULL REFERENCES uoms(id),
  -- embalagem comercial e fator de conversão (1 embalagem = pack_factor unidades de consumo)
  pack_uom_id         TEXT REFERENCES uoms(id),
  pack_factor         INTEGER NOT NULL DEFAULT 1 CHECK (pack_factor > 0),
  min_qty_milli       INTEGER NOT NULL DEFAULT 0 CHECK (min_qty_milli >= 0),
  default_supplier_id TEXT REFERENCES suppliers(id),
  requires_location   INTEGER NOT NULL DEFAULT 1 CHECK (requires_location IN (0,1)),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active   ON products(is_active);

-- -----------------------------------------------------------------------------
-- Estoque: saldo materializado
-- -----------------------------------------------------------------------------

CREATE TABLE stock (
  product_id  TEXT NOT NULL REFERENCES products(id),
  location_id TEXT NOT NULL REFERENCES locations(id),
  qty_milli   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id)
);
CREATE INDEX idx_stock_location ON stock(location_id);

-- Garantia no banco: estoque nunca fica negativo, independentemente de bug de
-- aplicação. Como o batch do D1 e transacional, o RAISE aborta o lote inteiro.
CREATE TRIGGER trg_stock_no_negative_insert
BEFORE INSERT ON stock
WHEN NEW.qty_milli < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;

CREATE TRIGGER trg_stock_no_negative_update
BEFORE UPDATE OF qty_milli ON stock
WHEN NEW.qty_milli < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;

-- -----------------------------------------------------------------------------
-- Movimentações: fonte de verdade
-- -----------------------------------------------------------------------------

CREATE TABLE movements (
  id                   TEXT PRIMARY KEY,
  request_key          TEXT NOT NULL UNIQUE,
  type                 TEXT NOT NULL CHECK (type IN (
                         'purchase_receipt',  -- entrada por recebimento de compra
                         'issue',             -- saída definitiva / consumo direto
                         'transfer',          -- transferência entre locais
                         'replenish',         -- reposição de ambiente (almoxarifado -> ambiente)
                         'consumption',       -- baixa por consumo medido
                         'maintenance_use',   -- consumo vinculado a ticket/OS
                         'return',            -- devolução ao estoque
                         'loss',              -- perda, descarte ou vencimento
                         'inventory_adjust',  -- ajuste de inventário
                         'correction'         -- lançamento corretivo / reversão
                       )),
  product_id           TEXT NOT NULL REFERENCES products(id),
  qty_milli            INTEGER NOT NULL CHECK (qty_milli > 0),
  from_location_id     TEXT REFERENCES locations(id),
  to_location_id       TEXT REFERENCES locations(id),
  reason               TEXT,
  ref_type             TEXT CHECK (ref_type IS NULL OR ref_type IN (
                         'ticket','work_order','purchase_request','purchase_receipt',
                         'inventory','consumption','manual'
                       )),
  ref_id               TEXT,
  reverses_movement_id TEXT REFERENCES movements(id),
  user_id              TEXT NOT NULL REFERENCES users(id),
  occurred_at          TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  notes                TEXT,
  unit_cost_cents      INTEGER,
  CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
  CHECK (from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id)
);
CREATE INDEX idx_movements_product   ON movements(product_id);
CREATE INDEX idx_movements_created   ON movements(created_at);
CREATE INDEX idx_movements_from      ON movements(from_location_id);
CREATE INDEX idx_movements_to        ON movements(to_location_id);
CREATE INDEX idx_movements_ref       ON movements(ref_type, ref_id);
CREATE INDEX idx_movements_user      ON movements(user_id);

-- Vista de reconciliação: saldo derivado exclusivamente dos movimentos.
-- Deve ser sempre igual a `stock`.
CREATE VIEW stock_from_movements AS
SELECT product_id, location_id,
       SUM(delta_milli) AS qty_milli
FROM (
  SELECT product_id, from_location_id AS location_id, (-1 * qty_milli) AS delta_milli
    FROM movements WHERE from_location_id IS NOT NULL
  UNION ALL
  SELECT product_id, to_location_id AS location_id, qty_milli AS delta_milli
    FROM movements WHERE to_location_id IS NOT NULL
)
GROUP BY product_id, location_id;

-- -----------------------------------------------------------------------------
-- Consumo operacional medido
-- -----------------------------------------------------------------------------

CREATE TABLE consumption_records (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  location_id  TEXT REFERENCES locations(id),
  scope_note   TEXT,
  status       TEXT NOT NULL DEFAULT 'registered'
                 CHECK (status IN ('draft','registered','cancelled')),
  notes        TEXT,
  cancel_reason TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES users(id),
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TEXT NOT NULL,
  CHECK (period_end >= period_start)
);
CREATE INDEX idx_consumption_period   ON consumption_records(period_start, period_end);
CREATE INDEX idx_consumption_location ON consumption_records(location_id);

CREATE TABLE consumption_items (
  id             TEXT PRIMARY KEY,
  consumption_id TEXT NOT NULL REFERENCES consumption_records(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id),
  qty_milli      INTEGER NOT NULL CHECK (qty_milli > 0),
  location_id    TEXT REFERENCES locations(id),
  -- vínculo com a baixa efetiva de estoque. UNIQUE impede dupla dedução.
  movement_id    TEXT UNIQUE REFERENCES movements(id),
  notes          TEXT
);
CREATE INDEX idx_consumption_items_rec ON consumption_items(consumption_id);
CREATE INDEX idx_consumption_items_prd ON consumption_items(product_id);

-- -----------------------------------------------------------------------------
-- Inventário periódico
-- -----------------------------------------------------------------------------

CREATE TABLE inventories (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  period_label  TEXT NOT NULL,
  location_id   TEXT NOT NULL REFERENCES locations(id),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','closed','cancelled')),
  opened_by     TEXT NOT NULL REFERENCES users(id),
  opened_at     TEXT NOT NULL,
  closed_by     TEXT REFERENCES users(id),
  closed_at     TEXT,
  reopen_count  INTEGER NOT NULL DEFAULT 0,
  notes         TEXT
);
CREATE INDEX idx_inventories_status   ON inventories(status);
CREATE INDEX idx_inventories_location ON inventories(location_id);

CREATE TABLE inventory_items (
  id                    TEXT PRIMARY KEY,
  inventory_id          TEXT NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_id            TEXT NOT NULL REFERENCES products(id),
  system_qty_milli      INTEGER NOT NULL,
  counted_qty_milli     INTEGER CHECK (counted_qty_milli IS NULL OR counted_qty_milli >= 0),
  difference_milli      INTEGER,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','counted','divergent','adjusted','skipped')),
  counted_by            TEXT REFERENCES users(id),
  counted_at            TEXT,
  justification         TEXT,
  notes                 TEXT,
  is_inactive_product   INTEGER NOT NULL DEFAULT 0 CHECK (is_inactive_product IN (0,1)),
  adjustment_movement_id TEXT UNIQUE REFERENCES movements(id),
  UNIQUE (inventory_id, product_id)
);
CREATE INDEX idx_inventory_items_status ON inventory_items(inventory_id, status);

-- Histórico de recontagens (preserva a contagem original)
CREATE TABLE inventory_counts (
  id                 TEXT PRIMARY KEY,
  inventory_item_id  TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  counted_qty_milli  INTEGER NOT NULL CHECK (counted_qty_milli >= 0),
  system_qty_milli   INTEGER NOT NULL,
  justification      TEXT,
  notes              TEXT,
  counted_by         TEXT NOT NULL REFERENCES users(id),
  counted_at         TEXT NOT NULL,
  is_correction      INTEGER NOT NULL DEFAULT 0 CHECK (is_correction IN (0,1)),
  superseded_by      TEXT REFERENCES inventory_counts(id)
);
CREATE INDEX idx_inventory_counts_item ON inventory_counts(inventory_item_id);

-- -----------------------------------------------------------------------------
-- Tickets e ordens de serviço
-- -----------------------------------------------------------------------------

CREATE TABLE ticket_categories (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  code         TEXT,
  default_kind TEXT NOT NULL DEFAULT 'maintenance'
                 CHECK (default_kind IN ('cleaning','maintenance','other')),
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE tickets (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT,
  category_id   TEXT REFERENCES ticket_categories(id),
  location_id   TEXT REFERENCES locations(id),
  priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','waiting_material','resolved','converted','cancelled')),
  requester_id  TEXT NOT NULL REFERENCES users(id),
  assignee_id   TEXT REFERENCES users(id),
  resolution    TEXT,
  resolved_at   TEXT,
  resolved_by   TEXT REFERENCES users(id),
  cancel_reason TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_tickets_status    ON tickets(status);
CREATE INDEX idx_tickets_requester ON tickets(requester_id);
CREATE INDEX idx_tickets_location  ON tickets(location_id);
CREATE INDEX idx_tickets_created   ON tickets(created_at);

CREATE TABLE work_orders (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  ticket_id     TEXT UNIQUE REFERENCES tickets(id),
  title         TEXT NOT NULL,
  description   TEXT,
  category_id   TEXT REFERENCES ticket_categories(id),
  location_id   TEXT REFERENCES locations(id),
  assignee_id   TEXT REFERENCES users(id),
  priority      TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','planned','in_progress','waiting_material','done','cancelled')),
  requires_material INTEGER NOT NULL DEFAULT 0 CHECK (requires_material IN (0,1)),
  planned_at    TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  result        TEXT,
  cancel_reason TEXT,
  notes         TEXT,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_wo_status   ON work_orders(status);
CREATE INDEX idx_wo_assignee ON work_orders(assignee_id);
CREATE INDEX idx_wo_location ON work_orders(location_id);

CREATE TABLE work_order_events (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('created','status_change','comment','material_use','assignment')),
  from_status   TEXT,
  to_status     TEXT,
  body          TEXT,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_wo_events_wo ON work_order_events(work_order_id);

CREATE TABLE ticket_comments (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0,1)),
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ticket_comments_ticket ON ticket_comments(ticket_id);

-- -----------------------------------------------------------------------------
-- Compras e recebimentos
-- -----------------------------------------------------------------------------

CREATE TABLE purchase_requests (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  requester_id   TEXT NOT NULL REFERENCES users(id),
  location_id    TEXT REFERENCES locations(id),
  justification  TEXT,
  priority       TEXT NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','urgent')),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                   'draft','pending_approval','approved','rejected','quoting',
                   'purchasing','ordered','partially_received','received','cancelled')),
  desired_date   TEXT,
  approved_by    TEXT REFERENCES users(id),
  approved_at    TEXT,
  approval_notes TEXT,
  cancel_reason  TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_pr_status    ON purchase_requests(status);
CREATE INDEX idx_pr_requester ON purchase_requests(requester_id);

CREATE TABLE purchase_request_items (
  id                  TEXT PRIMARY KEY,
  request_id          TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  product_id          TEXT REFERENCES products(id),
  description         TEXT,
  qty_milli           INTEGER NOT NULL CHECK (qty_milli > 0),
  uom_id              TEXT REFERENCES uoms(id),
  qty_approved_milli  INTEGER CHECK (qty_approved_milli IS NULL OR qty_approved_milli >= 0),
  qty_ordered_milli   INTEGER CHECK (qty_ordered_milli IS NULL OR qty_ordered_milli >= 0),
  qty_received_milli  INTEGER NOT NULL DEFAULT 0 CHECK (qty_received_milli >= 0),
  supplier_id         TEXT REFERENCES suppliers(id),
  order_ref           TEXT,
  unit_price_cents    INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending','approved','rejected','ordered',
                        'partially_received','received','cancelled')),
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_pri_request ON purchase_request_items(request_id);
CREATE INDEX idx_pri_status  ON purchase_request_items(status);

CREATE TABLE purchase_receipts (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  request_key  TEXT NOT NULL UNIQUE,          -- idempotência do recebimento
  request_id   TEXT REFERENCES purchase_requests(id),
  supplier_id  TEXT REFERENCES suppliers(id),
  received_by  TEXT NOT NULL REFERENCES users(id),
  received_at  TEXT NOT NULL,
  document_ref TEXT,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('draft','confirmed','cancelled')),
  cancel_reason TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_receipts_request ON purchase_receipts(request_id);

CREATE TABLE purchase_receipt_items (
  id               TEXT PRIMARY KEY,
  receipt_id       TEXT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  request_item_id  TEXT REFERENCES purchase_request_items(id),
  product_id       TEXT REFERENCES products(id),
  qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
  to_location_id   TEXT REFERENCES locations(id),
  -- 1 movimento de entrada por linha de recebimento; UNIQUE evita duplicidade
  movement_id      TEXT UNIQUE REFERENCES movements(id),
  has_discrepancy  INTEGER NOT NULL DEFAULT 0 CHECK (has_discrepancy IN (0,1)),
  discrepancy_note TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_receipt_items_receipt ON purchase_receipt_items(receipt_id);
CREATE INDEX idx_receipt_items_pri     ON purchase_receipt_items(request_item_id);

-- -----------------------------------------------------------------------------
-- Anexos (armazenados no próprio banco com limite de tamanho; R2 e o caminho
-- natural de evolução quando o volume crescer)
-- -----------------------------------------------------------------------------

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
  content     BLOB NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- Auditoria (append-only por convenção de aplicação; sem UPDATE/DELETE exposto)
-- -----------------------------------------------------------------------------

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT REFERENCES users(id),
  actor_name  TEXT NOT NULL,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  before_json TEXT,
  after_json  TEXT,
  result      TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  reason      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_actor   ON audit_log(actor_id);
CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_module  ON audit_log(module, action);

-- -----------------------------------------------------------------------------
-- Contadores de código sequencial (TCK-2026-000001, OS-..., SC-..., REC-..., INV-...)
-- -----------------------------------------------------------------------------

CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- Configurações
-- -----------------------------------------------------------------------------

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id)
);

-- -----------------------------------------------------------------------------
-- Notificações internas (alertas derivados de regras de negocio)
-- -----------------------------------------------------------------------------

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  entity_type TEXT,
  entity_id   TEXT,
  read_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
