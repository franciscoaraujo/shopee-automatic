@echo off
rem Sobe o AutoAchados manualmente (duplo clique). Abre o site no navegador ao final.
rem Uso: "Iniciar AutoAchados.cmd" [pasta do projeto] [porta]
setlocal
set "PROJ=%~1"
if "%PROJ%"=="" set "PROJ=%~dp0..\.."
set "PORT=%~2"
if "%PORT%"=="" set "PORT=3000"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autoachados-start.ps1" -ProjectDir "%PROJ%" -Port %PORT% -OpenBrowser
pause
