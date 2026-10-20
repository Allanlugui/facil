-- =============================================================================
-- Facil - Migration 0013 - Checklist de execucao na ordem de servico (F-09)
--
-- O tecnico responsavel (e os gestores) montam na propria OS a lista de etapas
-- do servico, marcam o que ja foi executado e anexam fotos por etapa. O
-- checklist e pessoal do operador: cada item guarda quem criou, quem concluiu
-- e quando.
--
-- As fotos usam o modulo de anexos existente, com
-- `entity_type = 'work_order_checklist_item'` (nada de armazenamento novo).
--
-- A linha do tempo da OS passa a registrar a checklist, o que exige o novo
-- valor 'checklist' no CHECK de `work_order_events.type`. SQLite nao altera
-- CHECK: a tabela e reconstruida copiando as linhas (mesmo padrao da 0012).
-- =============================================================================

CREATE TABLE work_order_checklist_items (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  notes         TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_done       INTEGER NOT NULL DEFAULT 0 CHECK (is_done IN (0, 1)),
  done_at       TEXT,
  done_by       TEXT REFERENCES users(id),
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_wo_checklist_wo ON work_order_checklist_items(work_order_id, sort_order);

ALTER TABLE work_order_events RENAME TO work_order_events_legacy;

CREATE TABLE work_order_events (
  id            TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('created','status_change','comment','material_use','assignment','checklist')),
  from_status   TEXT,
  to_status     TEXT,
  body          TEXT,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);

INSERT INTO work_order_events (id, work_order_id, type, from_status, to_status, body, user_id, created_at)
  SELECT id, work_order_id, type, from_status, to_status, body, user_id, created_at
    FROM work_order_events_legacy;

DROP TABLE work_order_events_legacy;

CREATE INDEX idx_wo_events_wo ON work_order_events(work_order_id);
