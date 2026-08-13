@echo off
setlocal EnableExtensions
rem SuperLiora Windows bootstrap for cmd.exe (and double-click).
rem Checkout:  install.cmd [--help]
rem Remote:    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

set "PS_OPTS=-NoProfile -ExecutionPolicy Bypass"
set "PS1=%~dp0install.ps1"

if exist "%PS1%" (
  powershell %PS_OPTS% -File "%PS1%" %*
  exit /b %ERRORLEVEL%
)

if not defined SUPERLIORA_RAW_BASE set "SUPERLIORA_RAW_BASE=https://raw.githubusercontent.com/claudianus/superliora/main"
set "TMPPS=%TEMP%\superliora-install-%RANDOM%%RANDOM%.ps1"

powershell %PS_OPTS% -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri (($env:SUPERLIORA_RAW_BASE).TrimEnd('/') + '/install.ps1') -OutFile $env:TMPPS"
if errorlevel 1 (
  echo Failed to download install.ps1 from %SUPERLIORA_RAW_BASE%
  exit /b 1
)

powershell %PS_OPTS% -File "%TMPPS%" %*
set "ERR=%ERRORLEVEL%"
del /f /q "%TMPPS%" >nul 2>&1
exit /b %ERR%
