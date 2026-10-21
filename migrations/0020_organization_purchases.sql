-- =============================================================================
-- Facil - Migration 0020 - Setores, gestores e fluxo de compras v3
--
-- 1) Setores (`departments`) e gestores de setor (`department_managers`).
--    Um mesmo gestor pode responder por varios setores, e o setor de compras
--    e identificado por `is_purchasing = 1`.
--
-- 2) O fluxo de compras v3 convive com o v1 e o v2. As solicitacoes existentes
--    permanecem na revisao 2; toda solicitacao nova nasce na revisao 3.
--    A revisao 3 usa as mesmas etapas de `approval_stage`:
--      manager    -> gestor do setor aprova a necessidade;
--      purchasing -> responsavel de compras autoriza cotacao/orcamento/compra direta;
--      buyer      -> comprador cota, pede e acompanha;
--      receipt    -> responsavel do estoque confere e lanca itens e nota fiscal.
--
-- 3) Formas de pagamento (`payment_methods`) com duas politicas:
--    - `requires_authorization`: a forma exige autorizacao do responsavel de compras;
--    - `requires_quote`: a forma nao aceita compra direta (exige cotacao/orcamento).
--    A forma escolhida acompanha a solicitacao, a proposta e o pedido.
--
-- 4) Recebimento passa a registrar a nota fiscal (numero, serie, data e total).
--
-- Nada e destrutivo: apenas ALTER TABLE ADD COLUMN, novas tabelas e novos
-- registros de referencia. Nenhum CHECK existente e alterado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Setores
-- -----------------------------------------------------------------------------
CREATE TABLE departments (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  is_purchasing INTEGER NOT NULL DEFAULT 0 CHECK (is_purchasing IN (0,1)),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_departments_purchasing ON departments(is_purchasing, is_active);

CREATE TABLE department_managers (
  department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX idx_department_managers_user ON department_managers(user_id);

ALTER TABLE users ADD COLUMN department_id TEXT REFERENCES departments(id);
CREATE INDEX idx_users_department ON users(department_id);

INSERT INTO departments (id, code, name, is_purchasing, is_active, notes, created_at, updated_at) VALUES
  ('dept_adm',      'ADM',      'Administrativo',        0, 1, 'Diretoria, financeiro e administracao.',        '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('dept_ope',      'OPE',      'Operacoes',             0, 1, 'Operacao predial e servicos gerais.',           '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('dept_man',      'MAN',      'Manutencao',            0, 1, 'Equipe tecnica e materiais de manutencao.',     '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('dept_lim',      'LIM',      'Limpeza e conservacao', 0, 1, 'Materiais, equipamentos e insumos de limpeza.', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('dept_compras',  'COMPRAS',  'Compras',               1, 1, 'Setor responsavel por autorizar e executar compras.', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Formas de pagamento
-- -----------------------------------------------------------------------------
CREATE TABLE payment_methods (
  id                     TEXT PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  requires_authorization INTEGER NOT NULL DEFAULT 1 CHECK (requires_authorization IN (0,1)),
  requires_quote         INTEGER NOT NULL DEFAULT 0 CHECK (requires_quote IN (0,1)),
  is_active              INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order             INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

INSERT INTO payment_methods
  (id, code, name, requires_authorization, requires_quote, is_active, sort_order, notes, created_at, updated_at) VALUES
  ('pay_pix',         'pix',         'Pix',                    0, 0, 1, 10, 'Pagamento imediato.',                              '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('pay_transfer',    'transfer',    'Transferencia bancaria', 0, 0, 1, 20, 'Transferencia para o fornecedor.',                 '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('pay_boleto',      'boleto',      'Boleto',                 1, 0, 1, 30, 'Vencimento e linha digitavel na proposta.',        '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('pay_card',        'card',        'Cartao corporativo',     1, 0, 1, 40, 'Exige autorizacao previa do setor de compras.',    '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('pay_invoice',     'invoice',     'Faturado 30 dias',       1, 0, 1, 50, 'Pagamento contra fatura e nota fiscal.',           '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z'),
  ('pay_advance',     'advance',     'Adiantamento',           1, 1, 1, 60, 'Exige cotacao ou orcamento; nao aceita compra direta.', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Solicitacao de compra: revisao do fluxo, setor, modo e pagamento
-- -----------------------------------------------------------------------------
ALTER TABLE purchase_requests ADD COLUMN flow_revision INTEGER NOT NULL DEFAULT 2
  CHECK (flow_revision IN (1,2,3));
ALTER TABLE purchase_requests ADD COLUMN department_id TEXT REFERENCES departments(id);
ALTER TABLE purchase_requests ADD COLUMN purchase_mode TEXT
  CHECK (purchase_mode IS NULL OR purchase_mode IN ('quote','budget','direct'));
ALTER TABLE purchase_requests ADD COLUMN payment_method_id TEXT REFERENCES payment_methods(id);
ALTER TABLE purchase_requests ADD COLUMN payment_terms TEXT;
ALTER TABLE purchase_requests ADD COLUMN purchasing_authorized_by TEXT REFERENCES users(id);
ALTER TABLE purchase_requests ADD COLUMN purchasing_authorized_at TEXT;

CREATE INDEX idx_pr_flow_revision ON purchase_requests(flow_revision, approval_stage);
CREATE INDEX idx_pr_department    ON purchase_requests(department_id);
CREATE INDEX idx_pr_payment       ON purchase_requests(payment_method_id);

UPDATE purchase_requests
   SET flow_revision = CASE WHEN workflow_version = 1 THEN 1 ELSE 2 END;

-- A proposta e o pedido carregam a forma de pagamento negociada.
ALTER TABLE purchase_quotes ADD COLUMN payment_method_id TEXT REFERENCES payment_methods(id);
ALTER TABLE purchase_quotes ADD COLUMN payment_terms TEXT;
ALTER TABLE purchase_orders ADD COLUMN payment_method_id TEXT REFERENCES payment_methods(id);
ALTER TABLE purchase_orders ADD COLUMN payment_terms TEXT;

-- -----------------------------------------------------------------------------
-- Recebimento: nota fiscal e conferencia do responsavel de estoque
-- -----------------------------------------------------------------------------
ALTER TABLE purchase_receipts ADD COLUMN invoice_number TEXT;
ALTER TABLE purchase_receipts ADD COLUMN invoice_series TEXT;
ALTER TABLE purchase_receipts ADD COLUMN invoice_date TEXT;
ALTER TABLE purchase_receipts ADD COLUMN invoice_total_cents INTEGER
  CHECK (invoice_total_cents IS NULL OR invoice_total_cents >= 0);

-- -----------------------------------------------------------------------------
-- Permissoes do fluxo v3
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('purchases.approve_department', 'purchases', 'approve_department',
   'Aprovar a necessidade das solicitacoes do setor que gerencia');

INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_admin', 'purchases.approve_department'),
  ('role_manager', 'purchases.approve_department'),
  -- O gestor de Compras passa a ser o responsavel que autoriza cotacao,
  -- orcamento e compra direta no fluxo v3.
  ('role_purchasing_manager', 'purchases.authorize'),
  -- O responsavel pelo estoque confere o recebimento e lanca a nota fiscal.
  -- A permissao tambem libera a visao da fila inteira de compras.
  ('role_stock', 'purchases.receive');
