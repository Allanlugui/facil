import { useNavigate } from "react-router-dom";
import { PasswordChangeCard } from "../lib/password-card";
import { useSession } from "../lib/session";
import { Card } from "../lib/ui";

/**
 * Tela dedicada para a troca obrigatória de senha.
 * Também acessível pelo menu do usuário enquanto a senha não for trocada.
 */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { mustChangePassword } = useSession();

  return (
    <div className="mx-auto max-w-lg py-6">
      <Card
        title="Trocar senha"
        description={
          mustChangePassword
            ? "Defina uma senha própria para continuar usando o sistema."
            : "Altere a senha da sua conta."
        }
      >
        <PasswordChangeCard onChanged={() => navigate("/", { replace: true })} />
      </Card>
    </div>
  );
}
