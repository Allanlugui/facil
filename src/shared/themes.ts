/**
 * Temas da interface (F-18).
 *
 * Aqui ficam apenas os identificadores, rótulos e a cor da barra do navegador.
 * O visual de cada tema vive em `src/client/styles.css` (blocos `[data-theme=...]`),
 * para que as variáveis CSS valham tanto no sistema inteiro quanto em prévias
 * dentro de uma página.
 *
 * Convenção de armazenamento:
 * - `settings['ui.theme']`   → tema padrão do sistema (admin escolhe);
 * - `users.theme`            → preferência do usuário; NULL = seguir o sistema.
 */

export const THEME_IDS = ["classico", "corporativo", "escuro", "violeta", "ambar"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
  /** Cor da barra do navegador (`meta[name=theme-color]`). */
  themeColor: string;
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "classico",
    label: "Clássico",
    description: "Verde-petróleo com cantos suaves. O visual original do Facil.",
    themeColor: "#0f766e",
  },
  {
    id: "corporativo",
    label: "Corporativo",
    description: "Azul, cantos retos e traço firme. Sóbrio para o dia a dia.",
    themeColor: "#1d4ed8",
  },
  {
    id: "escuro",
    label: "Noturno",
    description: "Superfícies escuras, para ambientes com pouca luz.",
    themeColor: "#0a1120",
  },
  {
    id: "violeta",
    label: "Violeta",
    description: "Roxo moderno, cantos bem arredondados e letra Manrope.",
    themeColor: "#6d28d9",
  },
  {
    id: "ambar",
    label: "Âmbar",
    description: "Tons quentes, cantos macios e letra Nunito Sans.",
    themeColor: "#c2410c",
  },
];

export const DEFAULT_THEME: ThemeId = "classico";

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value !== null && value !== undefined && (THEME_IDS as readonly string[]).includes(value);
}

export function themeLabel(id: string | null | undefined): string {
  const theme = THEMES.find((entry) => entry.id === id);
  return theme?.label ?? String(id ?? "");
}
