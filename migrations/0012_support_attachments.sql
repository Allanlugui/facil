-- =============================================================================
-- Facil - Migration 0012 - Anexos do suporte em R2 (F-19)
--
-- A conversa da Central de Suporte passa a aceitar arquivos (prints, PDF,
-- documentos). O binario vai para o bucket R2 `facil-attachments` (binding
-- ATTACHMENTS do Worker) e os metadados continuam na tabela `attachments`,
-- que muda para aceitar:
--
--   - linhas sem blob local: `storage = 'r2'` + `r2_key` (o BLOB `content`
--     vira opcional -- linhas antigas continuam com `storage = 'd1'`);
--   - uploads sem usuario logado: o solicitante anonimo do suporte envia pelo
--     link/token e nao tem conta; `uploaded_by` vira opcional e `author_name`
--     guarda quem enviou.
--
-- SQLite nao permite afrouxar NOT NULL via ALTER TABLE; a tabela e reconstruida
-- copiando as linhas existentes (o projeto ainda nao tem producao publicada).
-- =============================================================================

ALTER TABLE attachments RENAME TO attachments_legacy;

CREATE TABLE attachments (
  id          TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes > 0),
  content     BLOB,
  storage     TEXT NOT NULL DEFAULT 'd1' CHECK (storage IN ('d1', 'r2')),
  r2_key      TEXT,
  uploaded_by TEXT REFERENCES users(id),
  author_name TEXT,
  created_at  TEXT NOT NULL,
  CHECK (content IS NOT NULL OR r2_key IS NOT NULL)
);

INSERT INTO attachments
  (id, entity_type, entity_id, filename, mime_type, size_bytes, content, storage, r2_key, uploaded_by, author_name, created_at)
  SELECT id, entity_type, entity_id, filename, mime_type, size_bytes, content, 'd1', NULL, uploaded_by, NULL, created_at
    FROM attachments_legacy;

DROP TABLE attachments_legacy;

CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- O teto de anexo sobe de 400 KB (limite imposto pelo D1) para 20 MB por
-- arquivo -- a Central de Suporte usa R2; valores ja ajustados pelo
-- administrador sao preservados (so o padrao antigo e atualizado).
UPDATE settings
   SET value = '20971520'
 WHERE key = 'attachments.max_bytes' AND value = '409600';
