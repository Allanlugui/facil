-- =============================================================================
-- Facil - Migration 0002 - Dados de referência
--
-- Catálogo de permissões, perfis (matriz de menor privilegio), unidades de
-- medida, tipos de local, categorias de atendimento e configurações iniciais.
-- IDs de dados de sistema usam slugs estáveis (role_admin, ...) por serem
-- valores de referência deterministas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Unidades de medida
-- -----------------------------------------------------------------------------
INSERT INTO uoms (id, code, name, allows_decimal, created_at) VALUES
  ('uom_un',  'UN',  'Unidade',              0, '2026-01-01T00:00:00.000Z'),
  ('uom_cx',  'CX',  'Caixa',               0, '2026-01-01T00:00:00.000Z'),
  ('uom_pct', 'PCT', 'Pacote',              0, '2026-01-01T00:00:00.000Z'),
  ('uom_fd',  'FD',  'Fardo',               0, '2026-01-01T00:00:00.000Z'),
  ('uom_gal', 'GAL', 'Galão',               0, '2026-01-01T00:00:00.000Z'),
  ('uom_rl',  'RL',  'Rolo',                0, '2026-01-01T00:00:00.000Z'),
  ('uom_dz',  'DZ',  'Dúzia',               0, '2026-01-01T00:00:00.000Z'),
  ('uom_kg',  'KG',  'Quilograma',          1, '2026-01-01T00:00:00.000Z'),
  ('uom_l',   'L',   'Litro',               1, '2026-01-01T00:00:00.000Z'),
  ('uom_ml',  'ML',  'Mililitro',           1, '2026-01-01T00:00:00.000Z'),
  ('uom_m',   'M',   'Metro',               1, '2026-01-01T00:00:00.000Z'),
  ('uom_cx100','CX100','Caixa com 100 un',  0, '2026-01-01T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Tipos de local (a hierarquia e livre; estes são os tipos iniciais)
-- -----------------------------------------------------------------------------
INSERT INTO location_types (id, name, code, description, sort_order, created_at, updated_at) VALUES
  ('lt_unidade',      'Unidade / Filial', 'unidade',      'Unidade ou filial da empresa',            10, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_predio',       'Prédio',           'prédio',       'Bloco ou edificação',                     20, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_andar',        'Andar',            'andar',        'Pavimento',                               30, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_setor',        'Setor',            'setor',        'Setor organizacional',                    40, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_sala',         'Sala',             'sala',         'Sala genérica',                           50, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_sala_reuniao', 'Sala de reunião',  'sala_reuniao', 'Sala de reunião',                         60, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_recepcao',     'Recepção',         'recepção',     'Área de recepção',                        70, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_copa',         'Copa',             'copa',         'Copa / cozinha',                          80, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_banheiro',     'Banheiro',         'banheiro',     'Banheiro / lavabo',                       90, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_almoxarifado', 'Almoxarifado',     'almoxarifado', 'Local de armazenamento de estoque',      100, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_area_tecnica', 'Área técnica',     'area_tecnica', 'Casa de máquinas, shaft, área técnica',  110, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_auditorio',    'Auditório',        'auditório',    'Auditório / sala de treinamento',        120, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_estacionamento','Estacionamento',  'estacionamento','Garagem ou pátio',                      130, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('lt_outro',        'Outro',            'outro',         'Ambiente personalizado',                 200, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Categorias de atendimento (tickets / ordens de serviço)
-- -----------------------------------------------------------------------------
INSERT INTO ticket_categories (id, name, code, default_kind, sort_order, created_at, updated_at) VALUES
  ('tc_limpeza',     'Limpeza',              'limpeza',     'cleaning',    10, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_hidraulica',  'Hidráulica',           'hidráulica',  'maintenance', 20, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_eletrica',    'Elétrica',             'elétrica',    'maintenance', 30, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_estrutura',   'Estrutura predial',    'estrutura',   'maintenance', 40, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_mobiliario',  'Mobiliário',           'mobiliário',  'maintenance', 50, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_equipamentos','Equipamentos',         'equipamentos','maintenance', 60, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_climatizacao','Climatização',         'climatização','maintenance', 70, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('tc_outros',      'Outros',               'outros',      'other',      200, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Categorias de produtos
-- -----------------------------------------------------------------------------
INSERT INTO product_categories (id, name, sort_order, created_at, updated_at) VALUES
  ('pc_limpeza',    'Limpeza',                    10, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_higiene',    'Higiene e descartáveis',     20, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_alimentos',  'Alimentos e bebidas',        30, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_ferramentas','Ferramentas',                40, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_eletricos',  'Materiais elétricos',        50, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_hidraulicos','Materiais hidráulicos',      60, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_pecas',      'Peças e componentes',        70, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_escritorio', 'Material de escritório',     80, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('pc_outros',     'Outros',                    200, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Catálogo de permissões (módulo.ação)
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module, action, description) VALUES
  ('dashboard.view',        'dashboard',  'view',        'Visualizar painel principal'),
  ('structure.view',        'structure',  'view',        'Visualizar unidades e locais'),
  ('structure.manage',      'structure',  'manage',      'Gerenciar unidades, tipos e locais'),
  ('users.view',            'users',      'view',        'Visualizar usuários e equipes'),
  ('users.manage',          'users',      'manage',      'Criar, editar e desativar usuários'),
  ('users.permissions',     'users',      'permissions', 'Alterar perfis e permissões'),
  ('catalog.view',          'catalog',    'view',        'Visualizar produtos, categorias e fornecedores'),
  ('catalog.manage',        'catalog',    'manage',      'Gerenciar produtos, categorias, unidades e fornecedores'),
  ('stock.view',            'stock',      'view',        'Visualizar saldos e movimentações'),
  ('stock.issue',           'stock',      'issue',       'Registrar saída definitiva de material'),
  ('stock.transfer',        'stock',      'transfer',    'Registrar transferência entre locais'),
  ('stock.replenish',       'stock',      'replenish',   'Repor material em ambientes (almoxarifado para ambiente)'),
  ('stock.adjust',          'stock',      'adjust',      'Ajustar saldo de estoque com justificativa'),
  ('stock.loss',            'stock',      'loss',        'Registrar perda, descarte ou vencimento'),
  ('consumption.view',      'consumption','view',        'Visualizar lançamentos de consumo'),
  ('consumption.create',    'consumption','create',      'Registrar consumo operacional'),
  ('consumption.cancel',    'consumption','cancel',      'Cancelar lançamento de consumo'),
  ('inventory.view',        'inventory',  'view',        'Visualizar inventários'),
  ('inventory.create',      'inventory',  'create',      'Abrir ciclo de inventário'),
  ('inventory.count',       'inventory',  'count',       'Contar e conferir itens do inventário'),
  ('inventory.adjust',      'inventory',  'adjust',      'Aplicar ajuste de inventário'),
  ('inventory.close',       'inventory',  'close',       'Fechar ciclo de inventário'),
  ('inventory.reopen',      'inventory',  'reopen',      'Reabrir inventário encerrado'),
  ('tickets.view',          'tickets',    'view',        'Visualizar tickets próprios'),
  ('tickets.view_all',      'tickets',    'view_all',    'Visualizar todos os tickets'),
  ('tickets.create',        'tickets',    'create',      'Abrir ticket'),
  ('tickets.assign',        'tickets',    'assign',      'Atribuir ticket a responsável'),
  ('tickets.resolve',       'tickets',    'resolve',     'Resolver ticket diretamente'),
  ('tickets.cancel',        'tickets',    'cancel',      'Cancelar ticket'),
  ('workorders.view',       'workorders', 'view',        'Visualizar ordens de serviço'),
  ('workorders.create',     'workorders', 'create',      'Criar ordem de serviço'),
  ('workorders.execute',    'workorders', 'execute',     'Executar e movimentar status da ordem'),
  ('workorders.material',   'workorders', 'material',    'Registrar material utilizado na ordem'),
  ('workorders.close',      'workorders', 'close',       'Concluir ordem de serviço'),
  ('workorders.cancel',     'workorders', 'cancel',      'Cancelar ordem de serviço'),
  ('purchases.view',        'purchases',  'view',        'Visualizar solicitações, pedidos e recebimentos'),
  ('purchases.create',      'purchases',  'create',      'Criar solicitação de compra'),
  ('purchases.approve',     'purchases',  'approve',     'Aprovar ou rejeitar solicitação'),
  ('purchases.order',       'purchases',  'order',       'Registrar pedido e fornecedor'),
  ('purchases.receive',     'purchases',  'receive',     'Registrar recebimento de material'),
  ('purchases.cancel',      'purchases',  'cancel',      'Cancelar solicitação ou recebimento'),
  ('reports.view',          'reports',    'view',        'Acessar relatórios'),
  ('reports.export',        'reports',    'export',      'Exportar relatórios em CSV'),
  ('audit.view',            'audit',      'view',        'Consultar trilha de auditoria'),
  ('settings.view',         'settings',   'view',        'Visualizar configurações'),
  ('settings.manage',       'settings',   'manage',      'Alterar configurações do sistema');

-- -----------------------------------------------------------------------------
-- Perfis
-- -----------------------------------------------------------------------------
INSERT INTO roles (id, name, code, description, is_system, created_at, updated_at) VALUES
  ('role_admin',      'Administrador do sistema', 'admin',           'Acesso irrestrito, incluindo configurações do sistema.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_manager',    'Gerente de Facilities',    'facilities_manager','Gestão completa da operação; sem alterar configurações de sistema.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_buyer',      'Comprador',                'buyer',           'Conduz cotação, pedido e recebimento de compras.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_stock',      'Responsável pelo estoque', 'stock_keeper',    'Administra catálogo, saldos, movimentações e inventário.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_clean_lead', 'Líder de limpeza',         'cleaning_lead',   'Registra consumo da equipe e confere itens do inventário.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_clean',      'Colaborador da limpeza',   'cleaning_staff',  'Registra consumo e repoe ambientes sob sua responsabilidade.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_reception',  'Recepcionista',            'receptionist',    'Repoe ambientes e abre chamados. Sem acesso a ajustes de estoque.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_tech',       'Técnico de manutenção',    'maintenance_tech','Executa ordens de serviço e registra material utilizado.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('role_requester',  'Solicitante de serviços',  'requester',       'Abre e acompanha os próprios chamados.', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Matriz de permissões por perfil (menor privilegio)
-- -----------------------------------------------------------------------------

-- Administrador: todas as permissões do catálogo
INSERT INTO role_permissions (role_id, permission_code)
SELECT 'role_admin', code FROM permissions;

-- Gerente de Facilities: tudo, exceto alterar configurações de sistema
INSERT INTO role_permissions (role_id, permission_code)
SELECT 'role_manager', code FROM permissions WHERE code <> 'settings.manage';

-- Comprador: compras ponta a ponta (sem aprovar), catálogo e leitura de estoque
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_buyer','dashboard.view'),
  ('role_buyer','structure.view'),
  ('role_buyer','catalog.view'),
  ('role_buyer','catalog.manage'),
  ('role_buyer','stock.view'),
  ('role_buyer','purchases.view'),
  ('role_buyer','purchases.create'),
  ('role_buyer','purchases.order'),
  ('role_buyer','purchases.receive'),
  ('role_buyer','purchases.cancel'),
  ('role_buyer','reports.view'),
  ('role_buyer','reports.export'),
  ('role_buyer','tickets.view_all');

-- Responsável pelo estoque: operação completa de estoque/consumo/inventário
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_stock','dashboard.view'),
  ('role_stock','structure.view'),
  ('role_stock','users.view'),
  ('role_stock','catalog.view'),
  ('role_stock','catalog.manage'),
  ('role_stock','stock.view'),
  ('role_stock','stock.issue'),
  ('role_stock','stock.transfer'),
  ('role_stock','stock.replenish'),
  ('role_stock','stock.adjust'),
  ('role_stock','stock.loss'),
  ('role_stock','consumption.view'),
  ('role_stock','consumption.create'),
  ('role_stock','consumption.cancel'),
  ('role_stock','inventory.view'),
  ('role_stock','inventory.create'),
  ('role_stock','inventory.count'),
  ('role_stock','inventory.adjust'),
  ('role_stock','inventory.close'),
  ('role_stock','inventory.reopen'),
  ('role_stock','tickets.view'),
  ('role_stock','tickets.view_all'),
  ('role_stock','tickets.create'),
  ('role_stock','workorders.view'),
  ('role_stock','purchases.view'),
  ('role_stock','purchases.create'),
  ('role_stock','reports.view'),
  ('role_stock','reports.export');

-- Líder de limpeza: consumo da equipe + conferência de inventário
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_clean_lead','dashboard.view'),
  ('role_clean_lead','structure.view'),
  ('role_clean_lead','catalog.view'),
  ('role_clean_lead','stock.view'),
  ('role_clean_lead','stock.replenish'),
  ('role_clean_lead','consumption.view'),
  ('role_clean_lead','consumption.create'),
  ('role_clean_lead','inventory.view'),
  ('role_clean_lead','inventory.count'),
  ('role_clean_lead','tickets.view'),
  ('role_clean_lead','tickets.create'),
  ('role_clean_lead','reports.view');

-- Colaborador da limpeza: consumo e reposição no próprio escopo
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_clean','dashboard.view'),
  ('role_clean','structure.view'),
  ('role_clean','catalog.view'),
  ('role_clean','stock.view'),
  ('role_clean','stock.replenish'),
  ('role_clean','consumption.view'),
  ('role_clean','consumption.create'),
  ('role_clean','tickets.view'),
  ('role_clean','tickets.create');

-- Recepcionista: repoe ambientes e abre chamados.
-- NÃO recebe stock.adjust, stock.loss, users.*, consumption.cancel.
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_reception','dashboard.view'),
  ('role_reception','structure.view'),
  ('role_reception','catalog.view'),
  ('role_reception','stock.view'),
  ('role_reception','stock.replenish'),
  ('role_reception','tickets.view'),
  ('role_reception','tickets.create');

-- Técnico de manutenção: executa ordens e consome material
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_tech','dashboard.view'),
  ('role_tech','structure.view'),
  ('role_tech','catalog.view'),
  ('role_tech','stock.view'),
  ('role_tech','stock.replenish'),
  ('role_tech','tickets.view'),
  ('role_tech','tickets.view_all'),
  ('role_tech','tickets.create'),
  ('role_tech','tickets.resolve'),
  ('role_tech','workorders.view'),
  ('role_tech','workorders.create'),
  ('role_tech','workorders.execute'),
  ('role_tech','workorders.material'),
  ('role_tech','workorders.close'),
  ('role_tech','consumption.view'),
  ('role_tech','consumption.create'),
  ('role_tech','reports.view');

-- Solicitante: abre e acompanha os próprios chamados
INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_requester','dashboard.view'),
  ('role_requester','tickets.view'),
  ('role_requester','tickets.create');

-- -----------------------------------------------------------------------------
-- Configurações iniciais
-- -----------------------------------------------------------------------------
INSERT INTO settings (key, value, description, updated_at) VALUES
  ('company.name',            'Minha Empresa',            'Nomé exibido no topo da aplicação',            '2026-01-01T00:00:00.000Z'),
  ('company.timezone',        'America/Sao_Paulo',        'Fuso horário de apresentação',                 '2026-01-01T00:00:00.000Z'),
  ('stock.allow_negative',    'false',                    'Permitir estoque negativo (não recomendado)',  '2026-01-01T00:00:00.000Z'),
  ('stock.low_stock_scope',   'per_location',             'Escopo do alerta de estoque mínimo',           '2026-01-01T00:00:00.000Z'),
  ('consumption.periodicity', 'weekly',                   'Periodicidade padrão dos lançamentos de consumo','2026-01-01T00:00:00.000Z'),
  ('inventory.periodicity',   'monthly',                  'Periodicidade padrão do inventário',           '2026-01-01T00:00:00.000Z'),
  ('purchases.require_approval','true',                   'Exigir aprovação antes de comprar',            '2026-01-01T00:00:00.000Z'),
  ('attachments.max_bytes',   '409600',                   'Tamanho máximo de anexo em bytes',             '2026-01-01T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Contadores de código
-- -----------------------------------------------------------------------------
INSERT INTO counters (name, value) VALUES
  ('ticket', 0), ('work_order', 0), ('purchase_request', 0),
  ('purchase_receipt', 0), ('inventory', 0), ('consumption', 0);
