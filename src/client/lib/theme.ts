import { DEFAULT_THEME, THEMES, isThemeId, type ThemeId } from "@shared/themes";

/**
 * Aplicação do tema na interface.
 *
 * O valor efetivo é sempre: preferência do usuário → tema padrão do sistema →
 * Clássico. O atributo `data-theme` no `<html>` liga o bloco de tokens em
 * `styles.css`; a cópia em localStorage serve apenas para pintar a tela antes
 * do bootstrap (sem "piscar" o tema padrão).
 */

export function resolveTheme(userTheme: string | null | undefined, systemTheme: string | null | undefined): ThemeId {
  if (isThemeId(userTheme)) return userTheme;
  if (isThemeId(systemTheme)) return systemTheme;
  return DEFAULT_THEME;
}

export function applyTheme(theme: string): void {
  const id: ThemeId = isThemeId(theme) ? theme : DEFAULT_THEME;
  const root = document.documentElement;
  root.setAttribute("data-theme", id);

  const definition = THEMES.find((entry) => entry.id === id);
  if (definition) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", definition.themeColor);
  }

  try {
    localStorage.setItem("facil.theme", id);
  } catch {
    // Sem localStorage a tela ainda funciona; apenas perde o preparo pré-boot.
  }
}
