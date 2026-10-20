-- -----------------------------------------------------------------------------
-- Temas da interface (F-18)
--
-- - `settings['ui.theme']`: tema padrão do sistema, escolhido pelo administrador.
-- - `users.theme`: preferência individual; NULL = seguir o tema do sistema.
--
-- Os identificadores válidos espelham `src/shared/themes.ts`.
-- -----------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN theme TEXT;

INSERT INTO settings (key, value, description, updated_at)
VALUES ('ui.theme', 'classico', 'Tema padrão da interface', '2026-10-17T00:00:00.000Z')
ON CONFLICT(key) DO NOTHING;
