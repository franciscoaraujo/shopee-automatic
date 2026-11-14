# Instala (ou remove) a inicializacao automatica do AutoAchados no Windows.
# Copia autoachados-start.ps1 para %LOCALAPPDATA%\AutoAchados e cria um atalho
# na pasta "Inicializar" do usuario, que roda o script oculto a cada login.
#
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -ProjectDir C:\caminho\do\projeto [-Port 3000] [-OpenBrowser]
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove

param(
    [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [int]$Port = 3000,
    [switch]$OpenBrowser,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$appDir = Join-Path $env:LOCALAPPDATA 'AutoAchados'
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'AutoAchados.lnk'
$installed = Join-Path $appDir 'autoachados-start.ps1'

if ($Remove) {
    Remove-Item $shortcut -ErrorAction SilentlyContinue
    Remove-Item $installed -ErrorAction SilentlyContinue
    Write-Host "Inicializacao automatica removida."
    exit 0
}

$ProjectDir = (Resolve-Path $ProjectDir).Path
if (-not (Test-Path (Join-Path $ProjectDir 'docker-compose.yml'))) {
    throw "docker-compose.yml nao encontrado em $ProjectDir"
}

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'autoachados-start.ps1') $installed -Force

$lnkArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installed`" -ProjectDir `"$ProjectDir`" -Port $Port"
if ($OpenBrowser) { $lnkArgs += ' -OpenBrowser' }

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($shortcut)
$lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$lnk.Arguments = $lnkArgs
$lnk.WorkingDirectory = $ProjectDir
$lnk.WindowStyle = 7  # minimizado
$lnk.Description = 'Sobe o AutoAchados (docker compose) ao iniciar o Windows'
$lnk.Save()

Write-Host "Instalado: $shortcut"
Write-Host "  projeto: $ProjectDir"
Write-Host "  porta:   $Port"
Write-Host "  log:     $(Join-Path $appDir 'startup.log')"
