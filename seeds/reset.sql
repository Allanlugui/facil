-- =============================================================================
-- Facil - Reset de fábrica do banco LOCAL de desenvolvimento
-- =============================================================================
--
-- Uso:
--   npm run db:reset
--
-- O que faz:
--   Apaga TODOS os dados operacionais (movimentos, estoque, chamados, ordens,
--   compras, inventários, consumo, usuários, sessões, notificações, anexos,
--   auditoria, estrutura e catálogo criados pelo operador).
--
-- O que preserva:
--   O schema e os dados de referência das migrations: unidades de medida,
--   tipos de local, categorias de produto, categorias de chamado, catálogo de
--   permissões, perfis de sistema e configurações (settings).
--   Perfis criados pelo operador (is_system = 0) são removidos.
--
-- Depois deste script o sistema volta ao estado "instalação pendente":
--   a tela /setup (ou scripts/smoke.ps1) cria o novo administrador.
--
-- ATENÇÃO: não existe backup implicito. Confirme o banco alvo antes de rodar.

-- Vendas/consumo e itens primeiro (dependentes de movimentos e usuários).
DELETE FROM purchase_receipt_items;
DELETE FROM purchase_receipts;
DELETE FROM purchase_request_items;
DELETE FROM purchase_requests;

DELETE FROM work_order_events;
DELETE FROM work_orders;        -- referência tickets; sai antes deles
DELETE FROM ticket_comments;
DELETE FROM tickets;

DELETE FROM inventory_counts;
DELETE FROM inventory_items;    -- referência movements; sai antes dos movimentos
DELETE FROM inventories;

DELETE FROM consumption_items;
DELETE FROM consumption_records;

DELETE FROM movements;          -- fonte de verdade do estoque
DELETE FROM stock;

DELETE FROM notifications;
DELETE FROM attachments;
DELETE FROM audit_log;          -- trilha imutável: aqui é apagada de propósito

DELETE FROM user_location_scopes;
DELETE FROM sessions;
DELETE FROM users;

DELETE FROM products;
DELETE FROM suppliers;
DELETE FROM locations;
DELETE FROM units;

-- Perfis de operador; os perfis de sistema e a matriz de permissões ficam.
DELETE FROM roles WHERE is_system = 0;

-- Códigos sequenciais voltam ao início (CH-0001, OS-0001, ...).
UPDATE counters SET value = 0;
