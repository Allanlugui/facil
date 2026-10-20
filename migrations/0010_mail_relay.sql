-- -----------------------------------------------------------------------------
-- Relay de e-mail (F-13)
--
-- O provedor `relay` entrega a caixa de saída a uma URL HTTPS que faz o envio
-- real -- por exemplo, um Web App do Google Apps Script ligado a uma conta
-- Gmail (custo zero, envio para qualquer destinatário). `mail.relay_url`
-- aponta para o Web App e `mail.relay_secret` autentica as chamadas.
--
-- O guia de configuração está em `docs/email-relay-gmail.md`.
-- -----------------------------------------------------------------------------

INSERT INTO settings (key, value, description, updated_at)
VALUES
  ('mail.relay_url',    '', 'URL do relay de e-mail (Web App do Apps Script ou webhook compatível)', '2026-10-18T00:00:00.000Z'),
  ('mail.relay_secret', '', 'Segredo compartilhado com o relay de e-mail',                                '2026-10-18T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
