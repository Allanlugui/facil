-- =============================================================================
-- Configurações passam a valer de verdade no banco
-- =============================================================================
--
-- `stock.allow_negative` estava listada como configuração editável, mas nada a
-- lia: os triggers de saldo bloqueavam negativos sempre. Uma configuração que
-- não muda nada e uma funcionalidade morta.
--
-- Aqui os triggers passam a consultar a configuração. O padrão continua sendo
-- NÃO permitir negativo (`false`), inclusive quando a chave não existir.
--
-- Reafirmando as garantias mantidas:
--   * AFTER INSERT -> barra saldo negativo em linha nova (o valor proposto e
--     checado após a inserção; o RAISE(ABORT) desfaz a instrução);
--   * BEFORE UPDATE OF qty_milli -> barra o resultado negativo vindo do UPSERT,
--     quando a linha já existe.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_stock_no_negative_insert;
DROP TRIGGER IF EXISTS trg_stock_no_negative_update;

CREATE TRIGGER trg_stock_no_negative_insert
AFTER INSERT ON stock
WHEN NEW.qty_milli < 0
 AND COALESCE((SELECT value FROM settings WHERE key = 'stock.allow_negative'), 'false') <> 'true'
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;

CREATE TRIGGER trg_stock_no_negative_update
BEFORE UPDATE OF qty_milli ON stock
WHEN NEW.qty_milli < 0
 AND COALESCE((SELECT value FROM settings WHERE key = 'stock.allow_negative'), 'false') <> 'true'
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;
