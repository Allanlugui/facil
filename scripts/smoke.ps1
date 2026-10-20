# Smoke test HTTP do Facil.
#
# Valida o caminho real: assets -> Worker -> D1 -> sessao -> autorizacao.
# Uso:  powershell -File scripts/smoke.ps1
#
# Credenciais abaixo sao EXCLUSIVAS do banco local de desenvolvimento.
# A instalacao inicial de producao e feita pelo usuario na tela de setup.

param(
  [string]$Base = "http://127.0.0.1:8787",
  [string]$Email = "admin@facil.local",
  [string]$Password = "FacilDev#2026",
  [string]$CompanyName = "Empresa Demonstracao"
)

$ErrorActionPreference = "Continue"
$failures = 0

function Check($label, $condition, $detail) {
  if ($condition) {
    Write-Output "[ok]   $label"
  } else {
    Write-Output "[FAIL] $label -> $detail"
    $script:failures++
  }
}

# --- 1. Disponibilidade ------------------------------------------------------
$health = $null
for ($i = 0; $i -lt 90; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "$Base/api/health" -TimeoutSec 3
    break
  } catch {
    Start-Sleep -Milliseconds 1000
  }
}
Check "servidor responde /api/health" ($null -ne $health) "sem resposta apos 90s"
if ($null -eq $health) { exit 1 }

# --- 2. Assets estaticos (SPA) ----------------------------------------------
try {
  $index = Invoke-WebRequest -Uri "$Base/" -UseBasicParsing -TimeoutSec 10
  Check "SPA servida em /" ($index.StatusCode -eq 200 -and $index.Content -match 'id="root"') "status $($index.StatusCode)"
} catch {
  Check "SPA servida em /" $false $_.Exception.Message
}

# --- 3. 404 de API retorna JSON, nao HTML -----------------------------------
# curl.exe e usado aqui de proposito: o leitor de stream do PowerShell 5.1
# descarta o corpo de respostas 404 do workerd.
$raw = (curl.exe -s -w "`n%{http_code}" "$Base/api/rota-inexistente" 2>$null) -join "`n"
$lines = $raw -split "`n"
$code404 = $lines[-1].Trim()
$body404 = ($lines[0..($lines.Length - 2)] -join "`n")
Check "404 de API em JSON" ($code404 -eq "404" -and $body404 -match '"code"\s*:\s*"NOT_FOUND"') "code=$code404 body=$body404"

# --- 3b. Rota profunda sem asset cai no SPA (nao no Worker) -----------------
$deep = (curl.exe -s -o NUL -w "%{http_code}|%{content_type}" "$Base/estoque/qualquer-coisa" 2>$null)
Check "rota profunda do SPA responde HTML" ($deep -match "^200\|text/html") "resposta: $deep"

# --- 4. Autenticacao ---------------------------------------------------------
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$status = Invoke-RestMethod -Uri "$Base/api/auth/setup-status" -WebSession $session -TimeoutSec 10

if ($status.needsSetup) {
  $payload = @{
    companyName            = $CompanyName
    name                   = "Administrador Local"
    email                  = $Email
    password               = $Password
    createStarterStructure = $true
  } | ConvertTo-Json
  try {
    $created = Invoke-RestMethod -Uri "$Base/api/auth/setup" -Method Post -Body $payload -ContentType "application/json" -WebSession $session -TimeoutSec 30
    Check "instalacao inicial cria administrador" ($null -ne $created.user -and $created.user.roleCode -eq "admin") "resposta: $created"
  } catch {
    Check "instalacao inicial cria administrador" $false $_.Exception.Message
  }
} else {
  Write-Output "[info] instalacao ja concluida; seguindo com login"
}

$login = @{ email = $Email; password = $Password } | ConvertTo-Json
try {
  $logged = Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -Body $login -ContentType "application/json" -WebSession $session -TimeoutSec 30
  Check "login do administrador" ($logged.user.permissions.Count -eq 46) "permissoes recebidas: $($logged.user.permissions.Count)"
} catch {
  Check "login do administrador" $false $_.Exception.Message
}

try {
  $me = Invoke-RestMethod -Uri "$Base/api/auth/me" -WebSession $session -TimeoutSec 10
  Check "sessao valida em /api/auth/me" ($me.user.email -eq $Email) "usuario: $($me.user.email)"
} catch {
  Check "sessao valida em /api/auth/me" $false $_.Exception.Message
}

# --- 5. Requisicao sem sessao deve ser negada -------------------------------
try {
  Invoke-RestMethod -Uri "$Base/api/auth/me" -TimeoutSec 10 | Out-Null
  Check "sem cookie -> 401" $false "acesso indevido permitido"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check "sem cookie -> 401" ($code -eq 401) "status $code"
}

# --- 6. Senha incorreta nao autentica ---------------------------------------
$badSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$badLogin = @{ email = $Email; password = "senha-errada-12345" } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "$Base/api/auth/login" -Method Post -Body $badLogin -ContentType "application/json" -WebSession $badSession -TimeoutSec 30 | Out-Null
  Check "senha incorreta -> 401" $false "login aceito indevidamente"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check "senha incorreta -> 401" ($code -eq 401) "status $code"
}

# --- 7. Logout invalida a sessao --------------------------------------------
try {
  Invoke-RestMethod -Uri "$Base/api/auth/logout" -Method Post -WebSession $session -TimeoutSec 10 | Out-Null
  Check "logout responde ok" $true ""
} catch {
  Check "logout responde ok" $false $_.Exception.Message
}
try {
  Invoke-RestMethod -Uri "$Base/api/auth/me" -WebSession $session -TimeoutSec 10 | Out-Null
  Check "sessao encerrada -> 401" $false "sessao ainda ativa apos logout"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  Check "sessao encerrada -> 401" ($code -eq 401) "status $code"
}

Write-Output ""
if ($failures -eq 0) {
  Write-Output "SMOKE: todos os testes passaram"
  exit 0
} else {
  Write-Output "SMOKE: $failures falha(s)"
  exit 1
}
