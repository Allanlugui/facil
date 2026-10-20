-- =============================================================================
-- Facil - Migration 0016 - Cotacao de compras (F-01/F-02)
--
-- 1) A analise do gestor passa a marcar cada item como compra direta ou
--    cotacao (`purchase_request_items.purchase_mode`).
-- 2) A solicitacao ganha os status `quote_returned` (cotacao devolvida pelo
--    comprador, aguardando aprovacao) e `quote_approved` (proposta escolhida,
--    pronta para virar pedido).
-- 3) Novas tabelas: `purchase_quotes` (proposta de um fornecedor) e
--    `purchase_quote_items` (valor por item da proposta).
--
-- SQLite nao permite alterar CHECK de coluna existente; `purchase_requests` e
-- reconstruida. Como as filhas referenciam a mae -- e o DROP da mae cascateia
-- as linhas de itens -- as tres tabelas filhas sao copiadas para tabelas de
-- apoio, derrubadas na ordem filha->mae e restauradas depois da troca,
-- preservando todos os ids. Como o projeto ainda nao tem producao publicada,
-- a operacao roda uma unica vez no banco de desenvolvimento/producao futuro.
-- =============================================================================

-- Tabela-mae nova, com o CHECK de status ampliado e as mesmas colunas da 0001.
CREATE TABLE purchase_requests_new (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  requester_id   TEXT NOT NULL REFERENCES users(id),
  location_id    TEXT REFERENCES locations(id),
  justification  TEXT,
  priority       TEXT NOT NULL DEFAULT 'normal'
                   CHECK (priority IN ('low','normal','high','urgent')),
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                   'draft','pending_approval','approved','rejected','quoting',
                   'quote_returned','quote_approved','purchasing','ordered',
                   'partially_received','received','cancelled')),
  desired_date   TEXT,
  approved_by    TEXT REFERENCES users(id),
  approved_at    TEXT,
  approval_notes TEXT,
  cancel_reason  TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

INSERT INTO purchase_requests_new
  (id, code, requester_id, location_id, justification, priority, status,
   desired_date, approved_by, approved_at, approval_notes, cancel_reason,
   notes, created_at, updated_at)
SELECT id, code, requester_id, location_id, justification, priority, status,
       desired_date, approved_by, approved_at, approval_notes, cancel_reason,
       notes, created_at, updated_at
  FROM purchase_requests;

-- Copias de apoio: o DROP de `purchase_requests` cascateia as linhas de itens,
-- entao cada filha e preservada antes da troca.
CREATE TABLE _bkp_purchase_request_items AS SELECT * FROM purchase_request_items;
CREATE TABLE _bkp_purchase_receipts      AS SELECT * FROM purchase_receipts;
CREATE TABLE _bkp_purchase_receipt_items  AS SELECT * FROM purchase_receipt_items;

-- Derrubada na ordem filha -> mae: nenhuma violacao de FK em momento algum,
-- inclusive com `foreign_keys` ligado.
DROP TABLE purchase_receipt_items;
DROP TABLE purchase_receipts;
DROP TABLE purchase_request_items;
DROP TABLE purchase_requests;

ALTER TABLE purchase_requests_new RENAME TO purchase_requests;

CREATE INDEX idx_pr_status    ON purchase_requests(status);
CREATE INDEX idx_pr_requester ON purchase_requests(requester_id);

-- Itens com a divisao direta/cotacao definida na analise (F-01).
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
  purchase_mode       TEXT CHECK (purchase_mode IS NULL OR purchase_mode IN ('direct','quote')),
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
  request_key  TEXT NOT NULL UNIQUE,          -- idempotencia do recebimento
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
  movement_id      TEXT UNIQUE REFERENCES movements(id),
  has_discrepancy  INTEGER NOT NULL DEFAULT 0 CHECK (has_discrepancy IN (0,1)),
  discrepancy_note TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_receipt_items_receipt ON purchase_receipt_items(receipt_id);
CREATE INDEX idx_receipt_items_pri     ON purchase_receipt_items(request_item_id);

-- Restauracao dos dados (mesmos ids; `purchase_mode` nasce NULL).
INSERT INTO purchase_request_items
  (id, request_id, product_id, description, qty_milli, uom_id,
   qty_approved_milli, qty_ordered_milli, qty_received_milli, supplier_id,
   order_ref, unit_price_cents, status, notes, created_at, updated_at)
SELECT id, request_id, product_id, description, qty_milli, uom_id,
       qty_approved_milli, qty_ordered_milli, qty_received_milli, supplier_id,
       order_ref, unit_price_cents, status, notes, created_at, updated_at
  FROM _bkp_purchase_request_items;

INSERT INTO purchase_receipts
SELECT * FROM _bkp_purchase_receipts;

INSERT INTO purchase_receipt_items
SELECT * FROM _bkp_purchase_receipt_items;

DROP TABLE _bkp_purchase_request_items;
DROP TABLE _bkp_purchase_receipts;
DROP TABLE _bkp_purchase_receipt_items;

-- Propostas de fornecedor (F-02): valor por item, registradas pelo comprador,
-- comparadas e aprovadas pelo gestor; o pedido nasce da proposta aprovada.
CREATE TABLE purchase_quotes (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  request_id     TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  supplier_id    TEXT NOT NULL REFERENCES suppliers(id),
  status         TEXT NOT NULL DEFAULT 'registered'
                   CHECK (status IN ('registered','approved','rejected')),
  notes          TEXT,
  created_by     TEXT NOT NULL REFERENCES users(id),
  approved_by    TEXT REFERENCES users(id),
  approved_at    TEXT,
  approval_notes TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_purchase_quotes_request  ON purchase_quotes(request_id);
CREATE INDEX idx_purchase_quotes_supplier ON purchase_quotes(supplier_id);

CREATE TABLE purchase_quote_items (
  id               TEXT PRIMARY KEY,
  quote_id         TEXT NOT NULL REFERENCES purchase_quotes(id) ON DELETE CASCADE,
  request_item_id  TEXT NOT NULL REFERENCES purchase_request_items(id) ON DELETE CASCADE,
  qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  notes            TEXT,
  created_at       TEXT NOT NULL,
  UNIQUE (quote_id, request_item_id)
);
CREATE INDEX idx_purchase_quote_items_quote ON purchase_quote_items(quote_id);
CREATE INDEX idx_purchase_quote_items_item  ON purchase_quote_items(request_item_id);
