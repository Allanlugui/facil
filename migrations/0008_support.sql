-- =============================================================================
-- Facil - Migration 0008 - Central de suporte
--
-- Novo modulo "Suporte": pedidos de ajuda (fila de atendimento + conversa),
-- base de conhecimento (artigos/FAQ/informativos publicados pelo administrador)
-- e caixa de saida de e-mails (o envio real depende de provedor configurado
-- nas configuracoes `mail.*`; sem provedor, tudo fica registrado na caixa).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pedidos de suporte
-- -----------------------------------------------------------------------------
CREATE TABLE support_requests (
  id                     TEXT PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  kind                   TEXT NOT NULL CHECK (kind IN ('password_reset','help')),
  status                 TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','resolved')),
  requester_name         TEXT NOT NULL,
  requester_email        TEXT NOT NULL,
  requester_sector       TEXT,
  requester_registration TEXT,
  reason                 TEXT NOT NULL,
  -- Preenchido quando o pedido e aberto por um usuario logado.
  user_id                TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Apenas o hash do token de acompanhamento; o token em si so existe no link.
  token_hash             TEXT NOT NULL UNIQUE,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  resolved_at            TEXT,
  resolved_by            TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_support_requests_status ON support_requests(status, created_at);
CREATE INDEX idx_support_requests_user ON support_requests(user_id);
CREATE INDEX idx_support_requests_email ON support_requests(requester_email);

-- -----------------------------------------------------------------------------
-- Mensagens da conversa (uma thread por pedido)
-- -----------------------------------------------------------------------------
CREATE TABLE support_messages (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL CHECK (author_type IN ('requester','staff')),
  author_name TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_support_messages_request ON support_messages(request_id, created_at);

-- -----------------------------------------------------------------------------
-- Base de conhecimento (blog interno: informativos, dicas, FAQ)
-- -----------------------------------------------------------------------------
CREATE TABLE support_articles (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general','security','news','faq')),
  summary    TEXT,
  body       TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
  published  INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0,1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_support_articles_pub ON support_articles(published, pinned, updated_at);

-- -----------------------------------------------------------------------------
-- Caixa de saida de e-mails
-- -----------------------------------------------------------------------------
-- Cada mensagem de suporte gera registros aqui (para o solicitante e para o
-- administrador). Com provedor configurado (`mail.provider`), o envio acontece
-- na hora; sem provedor, o e-mail permanece "pending" e pode ser reenviado
-- depois pela propria interface (aba E-mails).
CREATE TABLE email_outbox (
  id         TEXT PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  related_id TEXT,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error      TEXT,
  created_at TEXT NOT NULL,
  sent_at    TEXT
);
CREATE INDEX idx_email_outbox_status ON email_outbox(status, created_at);

-- -----------------------------------------------------------------------------
-- Permissao: atender pedidos de suporte (somente administradores por padrao)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO permissions (code, module, action, description) VALUES
  ('support.manage', 'support', 'manage', 'Atender pedidos de suporte e publicar conteúdo de ajuda');

INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES
  ('role_admin', 'support.manage');

-- -----------------------------------------------------------------------------
-- Configuracoes de e-mail
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO settings (key, value, description, updated_at) VALUES
  ('mail.enabled',  'false',              'Habilitar envio de e-mails de suporte',        '2026-10-17T00:00:00.000Z'),
  ('mail.provider', 'none',               'Provedor de envio de e-mails (none, resend, brevo)', '2026-10-17T00:00:00.000Z'),
  ('mail.api_key',  '',                   'Chave de API do provedor de e-mail',           '2026-10-17T00:00:00.000Z'),
  ('mail.from',     'suporte@facil.local','Remetente dos e-mails de suporte',             '2026-10-17T00:00:00.000Z');

-- -----------------------------------------------------------------------------
-- Contador do codigo legivel (SUP-2026-000001)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO counters (name, value) VALUES ('support', 0);

-- -----------------------------------------------------------------------------
-- Artigos iniciais (editaveis pelo administrador na aba Conteúdo)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO support_articles (id, title, category, summary, body, pinned, published, created_by, created_at, updated_at) VALUES
  ('art_welcome', 'Como pedir suporte (e acompanhar a resposta)', 'general',
   'Dois caminhos para pedir ajuda: dentro do sistema ou pela tela de login (sem acesso).',
   'Você pode pedir ajuda de duas formas, sem sair do sistema:

• Dentro do sistema: abra Suporte no menu lateral, clique em "Abrir pedido" e descreva o que precisa.
• Sem acesso (por exemplo, esqueceu a senha): na tela de login, clique em "Esqueceu a senha?" e preencha o formulário.

Depois de enviar, guarde o link de acompanhamento — ele abre a conversa com o suporte e mostra a sua posição na fila. Cada mensagem enviada no chat também gera um e-mail para quem está do outro lado.

Os pedidos são atendidos por ordem de chegada pelo administrador do sistema (TI).',
   1, 1, NULL, '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z'),
  ('art_password_faq', 'Esqueci minha senha. O que eu faço?', 'faq',
   'Passo a passo para solicitar a redefinição da senha com segurança.',
   '1. Na tela de login, clique em "Esqueceu a senha? Clique aqui".
2. Preencha nome completo, setor, matrícula, e-mail e o motivo do pedido.
3. Envie e guarde o link de acompanhamento exibido: é por ele que você conversa com o suporte.
4. O administrador confirma a sua identidade (setor + matrícula) e define uma nova senha.
5. Acompanhe a conversa pelo link — as respostas também são enviadas por e-mail.

Por segurança, ninguém consegue ver a senha atual: o administrador define uma nova, que você troca no primeiro acesso.',
   0, 1, NULL, '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z'),
  ('art_security', 'Dicas de segurança', 'security',
   'Boas práticas para manter a sua conta e o sistema protegidos.',
   '• Use uma senha longa e única; nunca compartilhe a sua senha com colegas.
• Desconfie de mensagens que pedem senha ou códigos: a equipe de TI nunca pede a sua senha.
• Ao se afastar do computador, clique em "Sair" para encerrar a sessão.
• Avise o suporte imediatamente se desconfiar de acesso indevido à sua conta.
• Mantenha os informativos desta central em dia — o administrador publica novidades e lembretes aqui.',
   0, 1, NULL, '2026-10-17T00:00:00.000Z', '2026-10-17T00:00:00.000Z');
