import { useEffect, useState } from "react";

/**
 * Versão visível do produto (D-65).
 *
 * Lê o `/build-info.json` público gerado pelo `sign` — o mesmo artefato que a
 * produção expõe. É a versão do build em execução, não um literal no código
 * (que descolaria do `package.json` no primeiro esquecimento). Falha
 * silenciosa: sem versão, o rodapé só não mostra nada.
 */

interface BuildInfo {
  version: string;
}

let cached: Promise<string | null> | null = null;

function fetchVersion(): Promise<string | null> {
  if (!cached) {
    cached = fetch("/build-info.json", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((info: BuildInfo | null) =>
        info && typeof info.version === "string" ? info.version : null,
      )
      .catch(() => null);
  }
  return cached;
}

export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetchVersion().then((value) => {
      if (active) setVersion(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return version;
}
