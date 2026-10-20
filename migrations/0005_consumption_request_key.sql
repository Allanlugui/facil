-- =============================================================================
-- Idempotência dos lançamentos de consumo
-- =============================================================================
--
-- Todo POST /api/consumption leva um `requestKey` do cliente. Quando o
-- lançamento GERA baixa de estoque, a chave já era protegida pelo UNIQUE de
-- `movements.request_key`. Mas o lançamento de MEDIÇÃO (sem baixa) não tem
-- movimento nenhum: um duplo clique/reenvio criava dois lançamentos iguais.
--
-- Solução: guardar a chave de requisição no próprio lançamento e impedir
-- duplicidade por indice único parcial (indice parcial para que registros
-- antigos/sem chave continuem válidos com NULL).
-- =============================================================================

ALTER TABLE consumption_records ADD COLUMN request_key TEXT;

CREATE UNIQUE INDEX idx_consumption_request_key
  ON consumption_records(request_key)
  WHERE request_key IS NOT NULL;

-- =============================================================================
-- Periodicidade do lançamento de consumo
-- =============================================================================
--
-- O consumo e lançado por período (semanal, mensal...). Guardar a
-- periodicidade junto do lançamento permite relatórios por periodicidade e
-- deixa claro o que cada linha representa. O padrão e 'weekly' (mesmo valor de
-- `consumption.periodicity` em `settings`).
-- =============================================================================

ALTER TABLE consumption_records
  ADD COLUMN periodicity TEXT NOT NULL DEFAULT 'weekly'
    CHECK (periodicity IN ('daily','weekly','biweekly','monthly','quarterly','annual','custom'));

CREATE INDEX idx_consumption_periodicity ON consumption_records(periodicity);
