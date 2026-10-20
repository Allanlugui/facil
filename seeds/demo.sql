-- =============================================================================
-- Facil - Dados de demonstração (banco LOCAL de desenvolvimento)
-- =============================================================================
--
-- Uso:
--   npm run db:migrate      (se ainda não rodou)
--   npm run seed
--
-- Requisitos:
--   - Schema criado pelas migrations 0001..0006.
--   - Instalação já concluída (/setup ou scripts/smoke.ps1). Este seed NÃO cria
--     o administrador de propósito: a instalação e um fluxo real do sistema.
--
-- Idempotente: usa INSERT OR IGNORE, então rodar de novo NÃO sobrescreve nada
-- que você já tenha editado pela interface.
--
-- O que cria:
--   - 1 unidade, 8 locais, 4 fornecedores, 16 produtos (catálogo real).
--   - 6 usuários de demonstração com senha conhecida (abaixo).
--
-- O que NÃO cria (de propósito):
--   - Saldo de estoque e movimentos. Entradas precisam passar pelo motor de
--     estoque (Estoque > Entrada / Compras > Recebimento) para que movimento,
--     saldo, auditoria e idempotência fiquem coerentes. Inventário também e
--     gerado pela própria tela.
--
-- Credenciais de demonstração (senha única para todos):
--   ana.souza@demo.local       Gerente de Facilities
--   bruno.lima@demo.local      Comprador
--   carla.mendes@demo.local    Responsável pelo estoque
--   diego.rocha@demo.local     Técnico de manutenção
--   elisa.prado@demo.local     Colaboradora da limpeza
--   fabio.torres@demo.local    Solicitante de serviços
--   Senha: Demo@Facil2026
--
-- ATENÇÃO: credenciais públicas e fixas. NUNCA rode este seed em produção.

-- -----------------------------------------------------------------------------
-- Estrutura
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO units (id, name, code, address, notes, is_active, created_at, updated_at) VALUES
  ('un_demo', 'Edifício Sede (Demonstração)', 'DEMO',
   'Av. Exemplo, 1000 - São Paulo/SP',
   'Unidade criada pelo seed de demonstração.', 1,
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO locations (id, unit_id, parent_id, type_id, name, code, path, notes, is_active, created_at, updated_at) VALUES
  ('loc_demo_almox',      'un_demo', NULL, 'lt_almoxarifado', 'Almoxarifado Central',   'ALM-01', 'Almoxarifado Central',   'Estoque principal da unidade.',        1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_recepcao',   'un_demo', NULL, 'lt_recepcao',     'Recepção Térreo',        'REC-01', 'Recepção Térreo',        'Recepção e espera do térreo.',          1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_copa',       'un_demo', NULL, 'lt_copa',         'Copa 1º Andar',          'COP-01', 'Copa 1º Andar',          'Copa com geladeira e micro-ondas.',     1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_sala',       'un_demo', NULL, 'lt_sala_reuniao', 'Sala de Reunião 1',      'SAL-01', 'Sala de Reunião 1',      'Sala de reuniões principal.',           1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_banheiro',   'un_demo', NULL, 'lt_banheiro',     'Banheiro Térreo',        'BAN-01', 'Banheiro Térreo',        'Banheiros masculino e feminino.',       1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_maquinas',   'un_demo', NULL, 'lt_area_tecnica', 'Casa de Máquinas',       'CT-01',  'Casa de Máquinas',       'Bombas, quadros elétricos e HVAC.',     1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_auditorio',  'un_demo', NULL, 'lt_auditorio',    'Auditório',              'AUD-01', 'Auditório',              'Auditório para treinamentos.',          1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('loc_demo_patio',      'un_demo', NULL, 'lt_estacionamento','Estacionamento',        'EST-01', 'Estacionamento',         'Pátio de veículos.',                    1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- -----------------------------------------------------------------------------
-- Fornecedores
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO suppliers (id, name, doc, contact_name, phone, email, notes, is_active, created_at, updated_at) VALUES
  ('sup_higienemax', 'HigieneMax Distribuidora', '12.345.678/0001-90', 'Marcos Vieira',  '(11) 3555-1001', 'vendas@higienemax.demo',
   'Materiais de limpeza e higiene.', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sup_construforte', 'Construforte Materiais', '98.765.432/0001-10', 'Renata Alves',  '(11) 3555-2002', 'comercial@construforte.demo',
   'Hidráulica, elétrica e ferramentas.', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sup_papelaria', 'Papelaria Central', '11.222.333/0001-44', 'João Pires', '(11) 3555-3003', 'pedidos@papelaria-central.demo',
   'Papelaria e escritório.', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sup_tecpecas', 'TecnoPecas Manutenção', '55.666.777/0001-88', 'Sandra Luz', '(11) 3555-4004', 'atendimento@tecnopecas.demo',
   'Peças e componentes de manutenção.', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- -----------------------------------------------------------------------------
-- Catálogo de produtos
-- -----------------------------------------------------------------------------
-- min_qty_milli e o estoque mínimo em milesimos da unidade de consumo
-- (ex.: 12000 = 12 unidades). A unidade de consumo e `uom_id`.
INSERT OR IGNORE INTO products (id, sku, name, description, category_id, uom_id, pack_uom_id, pack_factor, min_qty_milli, default_supplier_id, requires_location, is_active, notes, created_at, updated_at) VALUES
  ('prd_detergente', 'PROD-DET-500',  'Detergente Neutro 500ml',        'Detergente para uso geral.',              'pc_limpeza',     'uom_un',  'uom_cx',  24, 12000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_agua_sanitaria','PROD-AGUA-1L','Água Sanitária 1L',              'Desinfecção de pisos e banheiros.',       'pc_limpeza',     'uom_un',  'uom_cx',  12, 10000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_desinfetante', 'PROD-DES-1L',  'Desinfetante Lavanda 1L',        'Uso geral em pisos laváveis.',            'pc_limpeza',     'uom_un',  'uom_cx',  12,  8000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_sabao_po',     'PROD-SAB-1KG', 'Sabão em Pó 1kg',                'Limpeza pesada de pisos.',                'pc_limpeza',     'uom_kg',  'uom_cx',  10, 10000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_saco_100',     'PROD-SAC-100L','Saco de Lixo 100L (pacote 50)',  'Sacos reforcados para containers.',       'pc_limpeza',     'uom_pct', 'uom_fd',   5, 10000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_papel_hig',    'PROD-PHI-30M', 'Papel Higiênico Rolo 30m',       'Folha dupla, 12 rolos por pacote.',       'pc_higiene',     'uom_un',  'uom_pct', 12, 48000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_toalha',       'PROD-TOA-INT', 'Toalha de Papel Interfolha',     'Fardo com 20 pacotes.',                   'pc_higiene',     'uom_fd',  'uom_fd',   1,  4000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_alcool',       'PROD-ALC-70',  'Álcool 70% 1L',                  'Higienização de superfícies.',            'pc_higiene',     'uom_un',  'uom_cx',  12, 12000, 'sup_higienemax',  1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_cafe',         'PROD-CAF-500', 'Café Torrado e Moído 500g',      'Copa e salas de reunião.',                'pc_alimentos',   'uom_pct', 'uom_cx',  10,  6000, 'sup_papelaria',   1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_acucar',       'PROD-ACU-1KG', 'Açúcar Refinado 1kg',            'Copa e eventos.',                         'pc_alimentos',   'uom_kg',  'uom_fd',  10,  5000, 'sup_papelaria',   1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_lampada_led',  'PROD-LED-9W',  'Lâmpada LED 9W E27',             'Reposição de iluminação.',                'pc_eletricos',   'uom_un',  'uom_cx',  10, 20000, 'sup_construforte',1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_fita_iso',     'PROD-FIT-20M', 'Fita Isolante 20m',              'Manutenção elétrica.',                    'pc_eletricos',   'uom_rl',  'uom_cx',  10,  6000, 'sup_construforte',1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_torneira',     'PROD-TOR-MES', 'Torneira de Mesa Metal',         'Reposição hidráulica.',                   'pc_hidraulicos', 'uom_un',  'uom_cx',  12,  3000, 'sup_construforte',1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_sifao',        'PROD-SIF-112', 'Sifão Universal 1.1/2',          'Reposição hidráulica de pias.',           'pc_hidraulicos', 'uom_un',  'uom_cx',  12,  3000, 'sup_construforte',1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_caneta',       'PROD-CAN-AZ',  'Caneta Esferográfica Azul',      'Material de escritório.',                 'pc_escritorio',  'uom_un',  'uom_cx',  50, 24000, 'sup_papelaria',   1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('prd_pilha_aa',     'PROD-PIL-AA',  'Pilha Alcalina AA (cartela 4)',  'Controles, relógios e sensores.',         'pc_escritorio',  'uom_pct', 'uom_cx',  20,  4000, 'sup_tecpecas',    1, 1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- -----------------------------------------------------------------------------
-- Usuários de demonstração
-- -----------------------------------------------------------------------------
-- Mesmo par salt/hash (PBKDF2-SHA256, 100000 iterações, 256 bits) da senha
-- Demo@Facil2026, no formato exato do src/worker/util.ts. Senha pública de
-- demonstração: exige troca imediata em uso real (must_change_password = 0 aqui
-- apenas para facilitar o primeiro acesso na avaliação).
INSERT OR IGNORE INTO users (id, name, email, password_hash, password_salt, password_iterations, role_id, unit_id, employee_code, phone, job_title, notes, is_active, must_change_password, last_login_at, created_at, updated_at) VALUES
  ('usr_demo_manager',  'Ana Souza',    'ana.souza@demo.local',   '6dcoMeEElvXMiA3SmKae3jxk7d7AN1T/Ghj0fkDqX0A=', 'GPRDZxphuCB6HoX3cPu2vg==', 100000, 'role_manager',   'un_demo', 'DEMO-0001', '(11) 90000-0001', 'Gerente de Facilities', 'Usuário do seed de demonstração.', 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr_demo_buyer',    'Bruno Lima',   'bruno.lima@demo.local',  '6dcoMeEElvXMiA3SmKae3jxk7d7AN1T/Ghj0fkDqX0A=', 'GPRDZxphuCB6HoX3cPu2vg==', 100000, 'role_buyer',     'un_demo', 'DEMO-0002', '(11) 90000-0002', 'Comprador',            'Usuário do seed de demonstração.', 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr_demo_stock',    'Carla Mendes', 'carla.mendes@demo.local','6dcoMeEElvXMiA3SmKae3jxk7d7AN1T/Ghj0fkDqX0A=', 'GPRDZxphuCB6HoX3cPu2vg==', 100000, 'role_stock',     'un_demo', 'DEMO-0003', '(11) 90000-0003', 'Almoxarife',           'Usuário do seed de demonstração.', 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr_demo_tech',     'Diego Rocha',  'diego.rocha@demo.local', '6dcoMeEElvXMiA3SmKae3jxk7d7AN1T/Ghj0fkDqX0A=', 'GPRDZxphuCB6HoX3cPu2vg==', 100000, 'role_tech',      'un_demo', 'DEMO-0004', '(11) 90000-0004', 'Técnico de Manutenção','Usuário do seed de demonstração.', 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr_demo_cleaning', 'Elisa Prado',  'elisa.prado@demo.local', '6dcoMeEElvXMiA3SmKae3jxk7d7AN1T/Ghj0fkDqX0A=', 'GPRDZxphuCB6HoX3cPu2vg==', 100000, 'role_clean',     'un_demo', 'DEMO-0005', '(11) 90000-0005', 'Auxiliar de Limpeza',  'Usuário do seed de demonstração.', 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('usr_demo_requester','Fabio Torres', 'fabio.torres@demo.local','6dcoMeEElvXMiA3SmKae3jxk7d7AN1T/Ghj0fkDqX0A=', 'GPRDZxphuCB6HoX3cPu2vg==', 100000, 'role_requester', 'un_demo', 'DEMO-0006', '(11) 90000-0006', 'Analista Administrativo','Usuário do seed de demonstração.', 1, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- -----------------------------------------------------------------------------
-- Ajustes de contexto (somente se ninguem personalizou ainda)
-- -----------------------------------------------------------------------------
UPDATE settings
   SET value = 'Empresa Demonstração', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE key = 'company.name' AND value = 'Minha Empresa';
