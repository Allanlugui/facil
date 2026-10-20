-- -----------------------------------------------------------------------------
-- 0007: estado do cadastro do produto (cadastro rápido no recebimento)
-- -----------------------------------------------------------------------------
-- Produtos criados as pressas durante o recebimento de compras entram apenas
-- com o nome e ficam com `catalog_status = 'incomplete'` até que alguem com
-- `catalog.manage` complete o cadastro no catálogo. O painel e o catálogo
-- mantem o alerta visível enquanto existir produto incompleto.
ALTER TABLE products ADD COLUMN catalog_status TEXT NOT NULL DEFAULT 'complete'
  CHECK (catalog_status IN ('complete', 'incomplete'));

CREATE INDEX idx_products_catalog_status ON products(catalog_status);
