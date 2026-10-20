import { THEMES, themeLabel } from "@shared/themes";
import { CheckIcon, MenuIcon } from "./ui";

/**
 * Seletor de tema com pré-visualização real.
 *
 * Cada miniatura aplica `data-theme` no próprio quadro, então ela usa de
 * verdade as cores, a fonte, os cantos e o traço de ícone do tema — sem
 * duplicar valores no JavaScript. Funciona tanto para o tema padrão do
 * sistema (Configurações › Aparência) quanto para a escolha do usuário no
 * perfil (`allowSystem`).
 */
export function ThemePicker({
  value,
  systemTheme,
  allowSystem = false,
  disabled = false,
  onChange,
}: {
  /** Tema selecionado; `null` = seguir o sistema (somente com `allowSystem`). */
  value: string | null;
  /** Tema padrão do sistema; usado no cartão "Tema do sistema". */
  systemTheme: string;
  allowSystem?: boolean;
  disabled?: boolean;
  onChange: (theme: string | null) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {allowSystem ? (
        <ThemeCard
          selected={value === null}
          disabled={disabled}
          label="Tema do sistema"
          description={`Segue o padrão definido pelo administrador: ${themeLabel(systemTheme)}.`}
          thumbTheme={systemTheme}
          onSelect={() => onChange(null)}
        />
      ) : null}
      {THEMES.map((theme) => (
        <ThemeCard
          key={theme.id}
          selected={value === theme.id}
          disabled={disabled}
          label={theme.label}
          description={theme.description}
          thumbTheme={theme.id}
          onSelect={() => onChange(theme.id)}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  selected,
  disabled,
  label,
  description,
  thumbTheme,
  onSelect,
}: {
  selected: boolean;
  disabled: boolean;
  label: string;
  description: string;
  thumbTheme: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border bg-surface p-3 text-left transition ${
        selected ? "border-brand-600 ring-2 ring-brand-200" : "border-slate-200 hover:border-slate-300"
      } ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
    >
      <ThemeThumb theme={thumbTheme} />
      <span className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-800">{label}</span>
        {selected ? (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white">
            <CheckIcon className="size-3" />
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
    </button>
  );
}

/** Miniatura de interface dentro do escopo do tema informado. */
function ThemeThumb({ theme }: { theme: string }) {
  return (
    <span data-theme={theme} className="block rounded-lg border border-slate-200 bg-slate-50 p-3">
      <span className="block rounded-md bg-surface p-2.5 shadow-sm">
        <span className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-brand-700 text-[10px] font-bold text-white">
            F
          </span>
          <span className="h-2 w-16 rounded-full bg-slate-200" />
          <span className="ml-auto h-2 w-6 rounded-full bg-slate-100" />
        </span>
        <span className="mt-2.5 flex items-center gap-1.5">
          <span className="rounded-md bg-brand-700 px-2 py-1 text-[9px] font-semibold text-white">Salvar</span>
          <span className="rounded-md border border-slate-200 px-2 py-1 text-[9px] font-medium text-slate-600">
            Ação
          </span>
          <MenuIcon className="ml-auto size-3.5 text-slate-400" />
        </span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <span className="whitespace-nowrap text-[11px] font-semibold text-slate-800">Aa Bb 123</span>
          <span className="h-1.5 w-10 rounded-full bg-slate-200" />
        </span>
      </span>
    </span>
  );
}
