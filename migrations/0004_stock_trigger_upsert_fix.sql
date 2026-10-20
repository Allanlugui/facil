-- =============================================================================
-- Correção dos triggers de saldo versus UPSERT
-- =============================================================================
--
-- Problema encontrado nos testes de integração: dar saída de estoque de um item
-- que JÁ tinha saldo falhava com INSUFFICIENT_STOCK.
--
-- Causa: `stockDeltaStatement` grava o saldo com
--   INSERT INTO stock (...) VALUES (...)
--   ON CONFLICT(product_id, location_id) DO UPDATE SET qty_milli = stock.qty_milli + excluded.qty_milli
--
-- Em SQLite, o trigger BEFORE INSERT roda com os valores PROPOSTOS antes de o
-- conflito ser resolvido. Como o delta negativo (ex.: -12500) era o valor
-- proposto, `NEW.qty_milli < 0` era verdadeiro e o RAISE(ABORT) acontecia --
-- mesmo quando a linha existia e o saldo final seria positivo.
--
-- Correção: a verificação de saldo negativo passa a ocorrer no evento que
-- realmente grava cada linha:
--   * AFTER INSERT -> cobre inserção de saldo negativo (linha nova);
--   * BEFORE UPDATE OF qty_milli (mantido de 0001) -> cobre o caminho de
--     conflito do UPSERT, quando a linha existente e atualizada.
--
-- Nenhuma proteção é perdida: RAISE(ABORT) em trigger AFTER desfaz a instrução
-- inteira, e o batch do D1 e transacional (aborta o lote completo).
-- =============================================================================

DROP TRIGGER IF EXISTS trg_stock_no_negative_insert;

CREATE TRIGGER trg_stock_no_negative_insert
AFTER INSERT ON stock
WHEN NEW.qty_milli < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;
