-- =============================================================================
-- Facil - Migration 0003
--
-- Adiciona `counterparty` a `movements`: destino, setor ou responsável
-- informado na movimentação quando o material sai do controle de estoque
-- (por exemplo, uma saída entregue a um colaborador ou consumida em um setor).
--
-- Motivo: as colunas `from_location_id`/`to_location_id` representam apenas
-- locais cadastrados e sob controle de estoque. Uma saída definitiva não tem
-- local de destino, mas a operação exige registrar a finalidade/destino em
-- campo estruturado, e não apenas em texto livre.
--
-- Migração aditiva e reversível (coluna anulável, sem reescrita de dados).
-- =============================================================================

ALTER TABLE movements ADD COLUMN counterparty TEXT;
