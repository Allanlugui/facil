import { useState } from "react";
import { useSession } from "../lib/session";
import { PasswordChangeCard } from "../lib/password-card";
import { plural } from "../lib/format";
import { Badge, Card, PageHeader, useToast } from "../lib/ui";
import { ThemePicker } from "../lib/theme-picker";
import { apiErrorMessage } from "../lib/api";
import { themeLabel } from "@shared/themes";
import { PERMISSION_GROUPS } from "@shared/permissions";

/** Dados da própria conta: identificação, permissões efetivas e troca de senha. */
export function ProfilePage() {
  const { user, permissions, app } = useSession();

  const grantedGroups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    granted: group.codes.filter((entry) => permissions.has(entry.code)),
  })).filter((group) => group.granted.length > 0);

  return (
    <div>
      <PageHeader title="Meu perfil" description="Seus dados de acesso e permissões efetivas." />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card title="Identificação">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Nome</dt>
                <dd className="mt-0.5 text-slate-800">{user?.name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">E-mail</dt>
                <dd className="mt-0.5 break-all text-slate-800">{user?.email}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Perfil</dt>
                <dd className="mt-0.5 text-slate-800">{user?.roleName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Fuso horário</dt>
                <dd className="mt-0.5 text-slate-800">{app.timezone}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Locais visíveis
                </dt>
                <dd className="mt-0.5 text-slate-800">
                  {user && user.locationScope.length > 0
                    ? `${user.locationScope.length} ${plural(user.locationScope.length, "local", "locais")}`
                    : "Todos"}
                </dd>
              </div>
            </dl>
          </Card>

          <AppearanceCard />

          <Card title="Senha">
            <PasswordChangeCard />
          </Card>
        </div>

        <Card
          title="Permissões desta conta"
          description="A lista reflete o que o servidor autoriza agora; alterações de perfil tem efeito imediato."
        >
          <div className="space-y-4">
            {grantedGroups.map((group) => (
              <div key={group.module}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {group.label}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.granted.map((entry) => (
                    <li key={entry.code}>
                      <Badge tone="brand">{entry.label}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {grantedGroups.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma permissão atribuída.</p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Escolha pessoal de tema; "Tema do sistema" volta a seguir o padrão do admin. */
function AppearanceCard() {
  const { user, app, setThemePreference } = useSession();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const choose = async (theme: string | null) => {
    setSaving(true);
    try {
      await setThemePreference(theme);
      toast.success(
        theme
          ? `Tema definido como ${themeLabel(theme)}.`
          : "Agora sua conta segue o tema padrão do sistema.",
      );
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Aparência"
      description="Vale só para a sua conta. O tema muda cores, fonte, cantos e o traço dos ícones."
    >
      <ThemePicker
        value={user?.theme ?? null}
        systemTheme={app.theme}
        allowSystem
        disabled={saving}
        onChange={(theme) => void choose(theme)}
      />
    </Card>
  );
}
