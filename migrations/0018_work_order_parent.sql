-- -----------------------------------------------------------------------------
-- F-10: OS filha — uma ordem de serviço pode nascer vinculada a outra (OS pai),
-- formando uma árvore de manutenção (ex.: o gestor abre uma OS de elétrica
-- vinculada à OS de reforma do andar). O vínculo é definido na criação e não
-- muda depois; o detalhe da OS mostra a árvore para quem tem `workorders.create`
-- (informação de gestão — o plano de complementos define a visão como de
-- gestores).
-- -----------------------------------------------------------------------------

ALTER TABLE work_orders ADD COLUMN parent_work_order_id TEXT REFERENCES work_orders(id);

CREATE INDEX idx_wo_parent ON work_orders(parent_work_order_id);
