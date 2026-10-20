-- -----------------------------------------------------------------------------
-- O controle de estoque fica restrito aos perfis responsáveis por ele.
--
-- Decisão do usuário (18/10/2026): só a administração, o gerente de facilities
-- e o responsável pelo estoque enxergam o módulo de estoque. Os demais perfis
-- continuam com o consumo (quando aplicável) e registram material pelas ordens
-- de serviço e chamados — o menu some por permissão, não por esconder botão.
-- -----------------------------------------------------------------------------

DELETE FROM role_permissions
 WHERE permission_code IN ('stock.view', 'stock.replenish')
   AND role_id IN ('role_buyer', 'role_tech', 'role_clean_lead', 'role_clean', 'role_reception');
