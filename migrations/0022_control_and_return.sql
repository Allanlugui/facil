-- =============================================================================
-- Facil - Migration 0022 - Devolucao ao solicitante e exclusao controlada
--
-- 1) Compras v3: o gestor de Compras (ou a triagem) pode devolver a solicitacao
--    ao solicitante para ajustes. O status armazenado continua `pending_approval`
--    (o CHECK de `status` nao aceita um valor novo sem rebuild) e a devolucao
--    passa a ser identificada pelos campos abaixo:
--      - returned_at NOT NULL -> aguardando ajuste do solicitante;
--      - reenvio limpa os tres campos e volta para a fila da etapa.
--
-- 2) Cadastros com exclusao controlada: em vez de apenas desativar, o
--    administrador pode excluir. Quando o registro tem historico, a linha e
--    preservada (tombstone) e marcada com `deleted_at`; sem historico, a linha
--    e removida de verdade. O historico continua integro e as telas exibem
--    "(excluido)" ao lado do nome original.
-- =============================================================================

ALTER TABLE purchase_requests ADD COLUMN returned_at TEXT;
ALTER TABLE purchase_requests ADD COLUMN returned_by TEXT REFERENCES users(id);
ALTER TABLE purchase_requests ADD COLUMN returned_reason TEXT;

ALTER TABLE units ADD COLUMN deleted_at TEXT;
ALTER TABLE units ADD COLUMN deleted_by TEXT;

ALTER TABLE location_types ADD COLUMN deleted_at TEXT;
ALTER TABLE location_types ADD COLUMN deleted_by TEXT;

ALTER TABLE locations ADD COLUMN deleted_at TEXT;
ALTER TABLE locations ADD COLUMN deleted_by TEXT;

ALTER TABLE product_categories ADD COLUMN deleted_at TEXT;
ALTER TABLE product_categories ADD COLUMN deleted_by TEXT;

ALTER TABLE uoms ADD COLUMN deleted_at TEXT;
ALTER TABLE uoms ADD COLUMN deleted_by TEXT;

ALTER TABLE suppliers ADD COLUMN deleted_at TEXT;
ALTER TABLE suppliers ADD COLUMN deleted_by TEXT;

ALTER TABLE products ADD COLUMN deleted_at TEXT;
ALTER TABLE products ADD COLUMN deleted_by TEXT;

ALTER TABLE departments ADD COLUMN deleted_at TEXT;
ALTER TABLE departments ADD COLUMN deleted_by TEXT;

ALTER TABLE cost_centers ADD COLUMN deleted_at TEXT;
ALTER TABLE cost_centers ADD COLUMN deleted_by TEXT;

ALTER TABLE ticket_categories ADD COLUMN deleted_at TEXT;
ALTER TABLE ticket_categories ADD COLUMN deleted_by TEXT;

ALTER TABLE payment_methods ADD COLUMN deleted_at TEXT;
ALTER TABLE payment_methods ADD COLUMN deleted_by TEXT;

ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE users ADD COLUMN deleted_by TEXT;

CREATE INDEX IF NOT EXISTS idx_locations_deleted ON locations(deleted_at);
CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at);
CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_returned ON purchase_requests(returned_at);
