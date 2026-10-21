-- =============================================================================
-- Facil - Migration 0019 - Fluxo corporativo de compras e preparacao de ERP
--
-- 1) Duas versoes de fluxo convivem no mesmo banco:
--    - versao 1 (legado): solicitacao -> aprovacao unica -> cotacao/pedido;
--    - versao 2 (corporativo): gestor do setor -> direcao -> compras, com
--      envio direto ao setor de compras e autorizacao de compra direta.
--    Solicitacoes existentes permanecem na versao 1. Toda solicitacao nova
--    nasce na versao 2, salvo quando o cliente declara `workflowVersion: 1`.
--
-- 2) O fluxo 2 registra centro de custo, conta contabil, orcamento, etapas de
--    aprovacao e adjudicacao item a item. Os pedidos ganham tabela propria,
--    por fornecedor, prontos para exportacao ao NetSuite.
--
-- 3) `integration_outbox` e o ponto de extensao idempotente para NetSuite,
--    ServiceNow ou qualquer outro sistema. O Worker grava o evento na mesma
--    transacao da operacao; o integrador consome depois, sem acoplar o ERP ao
--    caminho critico do prototipo.
--
-- 4) O intake externo de tickets prepara o ServiceNow: um usuario tecnico
--    recebe os chamados e os dados de contato ficam no proprio ticket.
--
-- Nada e destrutivo: apenas ALTER TABLE ADD COLUMN e novas tabelas. O SQLite
-- nao permite adicionar CHECK a coluna existente, mas as novas colunas ja
-- nascem com CHECK e DEFAULT. As solicitacoes antigas sao marcadas com a
-- versao 1 e continuam funcionando pelo caminho legado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Centros de custo (referencia inicial; a empresa pode editar depois)
-- -----------------------------------------------------------------------------
CREATE TABLE cost_centers (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO cost_centers (id, code, name, is_active, notes, created_at, updated_at) VALUES
  ('cc_adm', 'CC-ADM', 'Administrativo',       1, 'Estrutura administrativa e diretoria.',        '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('cc_ope', 'CC-OPE', 'Operacoes',            1, 'Operacao predial e servicos gerais.',          '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('cc_man', 'CC-MAN', 'Manutencao',           1, 'Equipe tecnica e materiais de manutencao.',    '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('cc_lim', 'CC-LIM', 'Limpeza e conservacao', 1, 'Materiais, equipamentos e insumos de limpeza.', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Solicitacao de compra: colunas do fluxo corporativo
-- -----------------------------------------------------------------------------
ALTER TABLE purchase_requests ADD COLUMN workflow_version INTEGER NOT NULL DEFAULT 1
  CHECK (workflow_version IN (1,2));
ALTER TABLE purchase_requests ADD COLUMN approval_stage TEXT NOT NULL DEFAULT 'completed'
  CHECK (approval_stage IN ('manager','direction','purchasing','buyer','award','receipt','completed'));
ALTER TABLE purchase_requests ADD COLUMN routing TEXT NOT NULL DEFAULT 'standard'
  CHECK (routing IN ('standard','direct_to_purchasing'));
ALTER TABLE purchase_requests ADD COLUMN budget_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (budget_status IN ('pending','approved','rejected','not_required'));
ALTER TABLE purchase_requests ADD COLUMN budget_notes TEXT;
ALTER TABLE purchase_requests ADD COLUMN cost_center_id TEXT REFERENCES cost_centers(id);
ALTER TABLE purchase_requests ADD COLUMN gl_account TEXT;
ALTER TABLE purchase_requests ADD COLUMN external_ref TEXT;
ALTER TABLE purchase_requests ADD COLUMN finance_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (finance_status IN ('pending','committed','received','not_required'));
ALTER TABLE purchase_requests ADD COLUMN manager_approved_by TEXT REFERENCES users(id);
ALTER TABLE purchase_requests ADD COLUMN manager_approved_at TEXT;
ALTER TABLE purchase_requests ADD COLUMN direction_approved_by TEXT REFERENCES users(id);
ALTER TABLE purchase_requests ADD COLUMN direction_approved_at TEXT;
ALTER TABLE purchase_requests ADD COLUMN direct_authorized_by TEXT REFERENCES users(id);
ALTER TABLE purchase_requests ADD COLUMN direct_authorized_at TEXT;

CREATE INDEX idx_pr_workflow_stage ON purchase_requests(workflow_version, approval_stage);
CREATE INDEX idx_pr_cost_center    ON purchase_requests(cost_center_id);
CREATE INDEX idx_pr_external_ref   ON purchase_requests(external_ref);

-- Etapa coerente para os registros que ja existiam (fluxo legado).
UPDATE purchase_requests
   SET workflow_version = 1,
       approval_stage = CASE
         WHEN status IN ('received','rejected','cancelled') THEN 'completed'
         WHEN status IN ('ordered','partially_received') THEN 'receipt'
         WHEN status IN ('approved','quoting','quote_returned','quote_approved','purchasing') THEN 'buyer'
         ELSE 'manager'
       END,
       finance_status = CASE
         WHEN status IN ('received') THEN 'received'
         WHEN status IN ('ordered','partially_received') THEN 'committed'
         ELSE 'not_required'
       END,
       budget_status = 'not_required';

-- -----------------------------------------------------------------------------
-- Adjudicacao item a item (uma proposta pode ganhar alguns itens e perder
-- outros; o mesmo fornecedor pode vencer todos os itens ou apenas parte).
-- -----------------------------------------------------------------------------
CREATE TABLE purchase_awards (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  request_item_id TEXT NOT NULL UNIQUE REFERENCES purchase_request_items(id) ON DELETE CASCADE,
  quote_id        TEXT NOT NULL REFERENCES purchase_quotes(id),
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  awarded_by      TEXT NOT NULL REFERENCES users(id),
  awarded_at      TEXT NOT NULL,
  notes           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_purchase_awards_request  ON purchase_awards(request_id);
CREATE INDEX idx_purchase_awards_quote    ON purchase_awards(quote_id);
CREATE INDEX idx_purchase_awards_supplier ON purchase_awards(supplier_id);

-- -----------------------------------------------------------------------------
-- Pedidos por fornecedor (um pedido por fornecedor; a solicitacao pode ter
-- varios). O total e os campos fiscais ficam prontos para exportacao.
-- -----------------------------------------------------------------------------
CREATE TABLE purchase_orders (
  id              TEXT PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  request_id      TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  supplier_id     TEXT NOT NULL REFERENCES suppliers(id),
  order_ref       TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','sent','confirmed','partially_received','received','cancelled')),
  currency        TEXT NOT NULL DEFAULT 'BRL',
  total_cents     INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  cost_center_id  TEXT REFERENCES cost_centers(id),
  gl_account      TEXT,
  external_system TEXT,
  external_id     TEXT,
  external_status TEXT,
  sync_status     TEXT NOT NULL DEFAULT 'pending'
                    CHECK (sync_status IN ('pending','synced','error','not_applicable')),
  sync_error      TEXT,
  notes           TEXT,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_purchase_orders_request  ON purchase_orders(request_id);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_sync     ON purchase_orders(sync_status);

CREATE TABLE purchase_order_items (
  id              TEXT PRIMARY KEY,
  order_id        TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  request_item_id TEXT NOT NULL REFERENCES purchase_request_items(id),
  qty_milli       INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  received_qty_milli INTEGER NOT NULL DEFAULT 0 CHECK (received_qty_milli >= 0),
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_purchase_order_items_order ON purchase_order_items(order_id);
CREATE INDEX idx_purchase_order_items_item  ON purchase_order_items(request_item_id);

ALTER TABLE purchase_receipts ADD COLUMN purchase_order_id TEXT REFERENCES purchase_orders(id);
ALTER TABLE purchase_receipt_items ADD COLUMN purchase_order_item_id TEXT REFERENCES purchase_order_items(id);
CREATE INDEX idx_receipts_order ON purchase_receipts(purchase_order_id);
CREATE INDEX idx_receipt_items_order_item ON purchase_receipt_items(purchase_order_item_id);

-- -----------------------------------------------------------------------------
-- Outbox de integracao: idempotente, sem dependencia de servico externo.
-- `idempotency_key` evita duplicar o mesmo evento em retries.
-- -----------------------------------------------------------------------------
CREATE TABLE integration_outbox (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  aggregate_type  TEXT NOT NULL,
  aggregate_id    TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','sent','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  processed_at    TEXT
);
CREATE INDEX idx_outbox_status_created ON integration_outbox(status, created_at);
CREATE INDEX idx_outbox_aggregate      ON integration_outbox(aggregate_type, aggregate_id);

-- -----------------------------------------------------------------------------
-- Intake externo de tickets (ServiceNow / pagina publica futura)
-- -----------------------------------------------------------------------------
ALTER TABLE tickets ADD COLUMN source TEXT NOT NULL DEFAULT 'internal'
  CHECK (source IN ('internal','api','servicenow','public'));
ALTER TABLE tickets ADD COLUMN external_ref TEXT;
ALTER TABLE tickets ADD COLUMN intake_name TEXT;
ALTER TABLE tickets ADD COLUMN intake_email TEXT;
ALTER TABLE tickets ADD COLUMN intake_phone TEXT;
CREATE UNIQUE INDEX idx_tickets_source_external
  ON tickets(source, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE ticket_intake_events (
  id          TEXT PRIMARY KEY,
  source      TEXT NOT NULL,
  ip          TEXT,
  external_ref TEXT,
  ticket_id   TEXT REFERENCES tickets(id),
  outcome     TEXT NOT NULL CHECK (outcome IN ('accepted','rejected','duplicate')),
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_intake_events_ip_created ON ticket_intake_events(ip, created_at);

-- Usuario tecnico usado como solicitante dos tickets externos. Nao tem senha
-- utilizavel; o contato real fica gravado em `intake_name`/`intake_email`.
-- Em banco novo (sem nenhum usuario) a insercao e adiada para o primeiro intake,
-- senao a tela de instalacao inicial entenderia que ja existe administrador.
-- Em banco existente o usuario tecnico e criado agora para manter o historico.
INSERT OR IGNORE INTO users
  (id, name, email, password_hash, password_salt, password_iterations, role_id,
   unit_id, employee_code, phone, job_title, notes, is_active, must_change_password,
   last_login_at, created_at, updated_at)
SELECT
  'user_intake', 'Integracao externa', 'intake@local.invalid', NULL, NULL, NULL,
  'role_requester', NULL, NULL, NULL, 'Canal externo',
  'Solicitante tecnico dos tickets recebidos por API. Nao utilize para login.',
  1, 0, NULL, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM users);

-- -----------------------------------------------------------------------------
-- Permissoes e perfis do fluxo corporativo
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, action, description) VALUES
  ('purchases.view_all', 'purchases', 'view_all', 'Visualizar todas as solicitacoes de compra'),
  ('purchases.authorize', 'purchases', 'authorize', 'Autorizar compra apos a analise de necessidade e orcamento'),
  ('purchases.award',    'purchases', 'award',    'Adjudicar cotacao por item e escolher fornecedores'),
  ('purchases.direct',   'purchases', 'direct',   'Autorizar compra direta sem cotacao');

INSERT INTO roles (id, name, code, description, is_system, created_at, updated_at) VALUES
  ('role_director', 'Diretor de Operacoes', 'operations_director',
   'Autoriza compras depois da analise do gestor do setor; sem operacao de compra.', 1, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('role_purchasing_manager', 'Gestor de Compras', 'purchasing_manager',
   'Recebe o fluxo de compras, autoriza compra direta e adjudica cotacoes.', 1, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');

-- Administrador recebe todo o catalogo (incluindo as quatro permissoes novas).
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions;

-- Gestor do setor: aprova a necessidade e encaminha; nao opera compra nem
-- adjudica cotacao. A separacao de funcoes e intencional.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_manager','purchases.view_all');
DELETE FROM role_permissions
 WHERE role_id = 'role_manager'
   AND permission_code IN ('purchases.order','purchases.receive');

-- Comprador: enxerga a fila completa e conduz cotacao, pedido e recebimento.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_buyer','purchases.view_all');

-- Lider de limpeza: pode abrir e acompanhar as proprias solicitacoes.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_clean_lead','purchases.view'),
  ('role_clean_lead','purchases.create');

-- Direcao: visao executiva e autorizacao, sem executar compra.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_director','dashboard.view'),
  ('role_director','structure.view'),
  ('role_director','users.view'),
  ('role_director','catalog.view'),
  ('role_director','stock.view'),
  ('role_director','inventory.view'),
  ('role_director','tickets.view'),
  ('role_director','tickets.view_all'),
  ('role_director','workorders.view'),
  ('role_director','purchases.view'),
  ('role_director','purchases.view_all'),
  ('role_director','purchases.authorize'),
  ('role_director','purchases.cancel'),
  ('role_director','reports.view'),
  ('role_director','reports.export'),
  ('role_director','audit.view');

-- Gestor de compras: recebe o envio direto, decide triagem, adjudica e opera.
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_purchasing_manager','dashboard.view'),
  ('role_purchasing_manager','structure.view'),
  ('role_purchasing_manager','users.view'),
  ('role_purchasing_manager','catalog.view'),
  ('role_purchasing_manager','catalog.manage'),
  ('role_purchasing_manager','stock.view'),
  ('role_purchasing_manager','inventory.view'),
  ('role_purchasing_manager','tickets.view'),
  ('role_purchasing_manager','tickets.view_all'),
  ('role_purchasing_manager','workorders.view'),
  ('role_purchasing_manager','purchases.view'),
  ('role_purchasing_manager','purchases.view_all'),
  ('role_purchasing_manager','purchases.create'),
  ('role_purchasing_manager','purchases.award'),
  ('role_purchasing_manager','purchases.direct'),
  ('role_purchasing_manager','purchases.order'),
  ('role_purchasing_manager','purchases.receive'),
  ('role_purchasing_manager','purchases.cancel'),
  ('role_purchasing_manager','reports.view'),
  ('role_purchasing_manager','reports.export'),
  ('role_purchasing_manager','audit.view');
