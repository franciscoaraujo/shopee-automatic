# Sobe o AutoAchados (docker compose) quando o Windows inicia.
# Espera o Docker Desktop ficar pronto, roda "docker compose up -d" no projeto
# e aguarda o site responder. Log: %LOCALAPPDATA%\AutoAchados\startup.log
#
#   powershell -ExecutionPolicy Bypass -File autoachados-start.ps1 -ProjectDir C:\caminho\do\projeto [-OpenBrowser]

param(
    [Parameter(Mandatory = $true)][string]$ProjectDir,
    [int]$Port = 3000,
    [switch]$OpenBrowser,
    [int]$DockerTimeoutSec = 600,
    [int]$WebTimeoutSec = 300
)

$ErrorActionPreference = 'Continue'
$logDir = Join-Path $env:LOCALAPPDATA 'AutoAchados'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'startup.log'

function Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path $log -Value $line
    Write-Host $line
}

function Test-Docker {
    docker info --format '{{.ServerVersion}}' *> $null
    return $LASTEXITCODE -eq 0
}

Log "Iniciando AutoAchados em $ProjectDir (porta $Port)"

if (-not (Test-Path (Join-Path $ProjectDir 'docker-compose.yml'))) {
    Log "ERRO: docker-compose.yml nao encontrado em $ProjectDir"
    exit 1
}

# 1. Docker Desktop
if (-not (Test-Docker)) {
    $dockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue) -and (Test-Path $dockerExe)) {
        Log "Abrindo Docker Desktop"
        Start-Process $dockerExe
    }
    Log "Aguardando o Docker ficar pronto..."
    $deadline = (Get-Date).AddSeconds($DockerTimeoutSec)
    while (-not (Test-Docker)) {
        if ((Get-Date) -gt $deadline) {
            Log "ERRO: Docker nao respondeu em $DockerTimeoutSec s"
            exit 1
        }
        Start-Sleep -Seconds 5
    }
}
Log "Docker pronto"

# 2. Containers (sem --build: usa a imagem ja construida)
Push-Location $ProjectDir
try {
    $out = docker compose up -d 2>&1 | Out-String
    $code = $LASTEXITCODE
    Add-Content -Path $log -Value $out
    if ($code -ne 0) {
        Log "ERRO: docker compose up falhou (codigo $code)"
        exit 1
    }
} finally {
    Pop-Location
}
Log "Containers no ar"

# 3. Aguarda o site responder
$url = "http://localhost:$Port"
$deadline = (Get-Date).AddSeconds($WebTimeoutSec)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0 -ErrorAction Stop | Out-Null
        $ok = $true; break
    } catch {
        # 3xx/4xx tambem significam que o servidor esta respondendo
        if ($_.Exception.Response) { $ok = $true; break }
        Start-Sleep -Seconds 3
    }
}

if ($ok) {
    Log "Site respondendo em $url"
    if ($OpenBrowser) { Start-Process $url }
} else {
    Log "AVISO: $url nao respondeu em $WebTimeoutSec s (veja: docker compose logs web)"
    exit 1
}
