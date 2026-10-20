-- -----------------------------------------------------------------------------
-- A recepção também consome itens (água, café, material do balcão) e precisa
-- lançar os itens utilizados.
--
-- Pedido do usuário (19/10/2026): "a recepção consome itens do estoque também e
-- a recepção precisa lançar os itens utilizados". O consumo é um módulo
-- operacional separado do controle de estoque (que segue restrito a
-- administração, gerente e estoquista — D-24/0014): quem tem
-- 'consumption.view'/'consumption.create' registra o que foi usado, com
-- desconto de saldo apenas quando um local de baixa é informado.
--
-- Mesma condição da limpeza (líder e equipe): visualizar e lançar consumo.
-- -----------------------------------------------------------------------------

INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_reception', 'consumption.view'),
  ('role_reception', 'consumption.create');
