/**
 * Validação de captcha (camada final, D-15).
 *
 * Provedor padrão: Cloudflare Turnstile. O endpoint de verificação é
 * `https://challenges.cloudflare.com/turnstile/v0/siteverify`, autenticado por
 * `captcha.secret_key` (configurado como setting secreta pelo administrador).
 *
 * O captcha fica DESLIGADO por padrão (`captcha.enabled` = false e sem chaves
 * configuradas), portanto não quebra nenhum fluxo até o titular ativar e
 * informar as chaves no painel de Configurações.
 */

export interface CaptchaConfig {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
}

export function readCaptchaConfig(settings: Record<string, string>): CaptchaConfig {
  return {
    enabled: settings["captcha.enabled"] === "1",
    siteKey: settings["captcha.site_key"] ?? "",
    secretKey: settings["captcha.secret_key"] ?? "",
  };
}

export function isCaptchaRequired(config: CaptchaConfig): boolean {
  return config.enabled && config.secretKey.length > 0;
}

/**
 * Verifica um token de captcha junto ao provedor. Retorna `true` quando o
 * token é válido, `false` quando o provedor recusa ou não responde.
 */
export async function verifyCaptchaToken(
  secretKey: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  if (!secretKey || !token) return false;
  try {
    const form = new FormData();
    form.set("secret", secretKey);
    form.set("response", token);
    if (remoteIp) form.set("remoteip", remoteIp);

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    if (!response.ok) return false;
    const json = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    return json.success === true;
  } catch {
    return false;
  }
}
