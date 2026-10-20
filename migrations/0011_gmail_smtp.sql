-- -----------------------------------------------------------------------------
-- Gmail por SMTP com senha de app (F-13)
--
-- O provedor `gmail` envia pela própria conta Google do usuário, falando SMTP
-- direto com smtp.gmail.com (porta 465, TLS) e autenticando com uma senha de
-- app de 16 letras -- sem Apps Script, sem domínio, sem custo. `mail.from` é o
-- endereço Gmail autenticado; `mail.gmail_app_password` guarda a senha de app.
--
-- O guia de configuração está em `docs/email-gmail-senha-app.md`.
-- -----------------------------------------------------------------------------

INSERT INTO settings (key, value, description, updated_at)
VALUES
  ('mail.gmail_app_password', '', 'Senha de app do Gmail (16 letras; espaços são ignorados)', '2026-10-18T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
