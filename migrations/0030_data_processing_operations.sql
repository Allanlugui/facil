-- =============================================================================
-- Facil - Migration 0030 - Índices adicionais para operações de tratamento (LGPD Art. 7º/37)
--
-- A tabela data_processing_operations foi criada na migration 0024 (antes de 0025
-- para satisfazer a FK em consents.operation_id). Esta migration apenas garante
-- que os índices existam (idempotente via IF NOT EXISTS).
-- =============================================================================

-- Índices (CREATE INDEX IF NOT EXISTS é suportado no SQLite 3.38.0+ / D1)
CREATE INDEX IF NOT EXISTS idx_dpo_operations_legal_base ON data_processing_operations(legal_base_id);
CREATE INDEX IF NOT EXISTS idx_dpo_operations_active     ON data_processing_operations(is_active);
CREATE INDEX IF NOT EXISTS idx_dpo_operations_created    ON data_processing_operations(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpo_operations_code ON data_processing_operations(code);