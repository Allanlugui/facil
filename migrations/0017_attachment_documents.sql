-- -----------------------------------------------------------------------------
-- F-08: anexos auxiliares (documento) em chamado/OS são de gestão.
--
-- "Anexos (PDF/planilha) somente para superiores": o técnico executante
-- registra a evidência por foto, capturada pela câmera no fluxo de execução
-- (F-07); documento (PDF, planilha ou texto) vinculado a chamado ou ordem de
-- serviço fica restrito a quem tem `attachments.documents` — administração e
-- gerência de facilities. Imagem continua livre para quem enxerga a entidade
-- (é a evidência de campo); a checagem é feita pelo servidor, por tipo de
-- arquivo, em `src/worker/routes/attachments.ts`.
-- -----------------------------------------------------------------------------

INSERT INTO permissions (code, module, action, description) VALUES
  ('attachments.documents', 'attachments', 'documents', 'Anexar documentos (PDF, planilha ou texto) a chamados e ordens de serviço');

INSERT INTO role_permissions (role_id, permission_code) VALUES
  ('role_admin', 'attachments.documents'),
  ('role_manager', 'attachments.documents');
