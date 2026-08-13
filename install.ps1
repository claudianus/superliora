# SuperLiora bootstrap -- ensure Node, then run scripts/install-superliora.mjs
# ASCII-only so Windows PowerShell 5.1 parses this on any system code page.
# Works as:  irm .../install.ps1 | iex
#        or: powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ... | iex"
#        or: .\install.ps1 --bin-dir ... --no-path
#        or: install.cmd (cmd.exe)
#
# Do not put param() at file scope. Windows PowerShell 5.1 treats `param` as a
# command when the file is Invoke-Expression'd (`irm | iex`).

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
}

& {
param(
  [string]$RepoUrl,
  [string]$Ref,
  [string]$InstallDir,
  [string]$BinDir,
  [string]$CommandName,
  [string]$NodeMin,
  [string]$ManifestUrl,
  [string]$Version,
  [string]$RawBase,
  [switch]$Force,
  [switch]$NoBuild,
  [switch]$NoBrowserUse,
  [switch]$NoComputerUse,
  [switch]$NoRetrieval,
  [switch]$NoGit,
  [switch]$NoPath,
  [switch]$NoShellRc,
  [switch]$PreferSource,
  [switch]$Main,
  [switch]$ForcePrebuilt,
  [switch]$Help,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Remaining
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$DefaultRepoUrl = 'https://github.com/claudianus/superliora.git'
$DefaultRef = 'main'
$DefaultInstallDir = Join-Path $HOME '.superliora\source'
$DefaultBinDir = Join-Path $env:LOCALAPPDATA 'SuperLiora\bin'
$DefaultCommandName = 'liora'
$DefaultNodeMin = '24.15.0'
$DefaultManifestUrl = 'https://github.com/claudianus/superliora/releases/latest/download/manifest.json'
$DefaultRawBase = 'https://raw.githubusercontent.com/claudianus/superliora/main'
$StagePrefix = '__LIORA_UPGRADE_STAGE__='
$InstallModules = @(
  'platform.mjs',
  'ensure-node.mjs',
  'ensure-git.mjs',
  'theatre.mjs',
  'download.mjs',
  'prebuilt.mjs',
  'source.mjs',
  'sidecars.mjs',
  'path.mjs',
  'spawn.mjs',
  'wrappers.mjs'
)

function Get-ValueOrDefault {
  param([string]$Value, [string]$EnvName, [string]$Default)
  if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $envValue = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
  return $Default
}

function Fail {
  param([string]$Message)
  Write-Host ($StagePrefix + 'failed')
  throw $Message
}

function Show-Usage {
  Write-Host 'Usage: install.ps1 [options]'
  Write-Host ''
  Write-Host 'Installs SuperLiora from the latest published GitHub Release (prebuilt SEA)'
  Write-Host 'and creates the liora command. Pass -Main to build tip of origin/main instead.'
  Write-Host ''
  Write-Host 'From cmd.exe use install.cmd, or:'
  Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm <url> | iex"'
  Write-Host ''
  Write-Host 'Options (PowerShell or GNU-style):'
  Write-Host '  -RepoUrl / --repo <url>'
  Write-Host '  -Ref / --ref <ref>'
  Write-Host '  -InstallDir / --install-dir <path>'
  Write-Host '  -BinDir / --bin-dir <path>'
  Write-Host '  -CommandName / --command <name>'
  Write-Host '  -NodeMin / --node-min <version>'
  Write-Host '  -ManifestUrl / --manifest <url>'
  Write-Host '  -Version / --version <semver>'
  Write-Host '  -Force / --force'
  Write-Host '  -NoBuild / --no-build'
  Write-Host '  -NoBrowserUse / --no-browser-use'
  Write-Host '  -NoComputerUse / --no-computer-use'
  Write-Host '  -NoRetrieval / --no-retrieval'
  Write-Host '  -NoGit / --no-git'
  Write-Host '  -NoPath / -NoShellRc / --no-shell-rc'
  Write-Host '  -PreferSource / --prefer-source'
  Write-Host '  -Main / --main'
  Write-Host '  -ForcePrebuilt / --force-prebuilt'
  Write-Host '  -Help / --help'
}

function Apply-GnuFlags {
  param([string[]]$Flags)
  if ($null -eq $Flags -or $Flags.Count -eq 0) { return }
  $i = 0
  while ($i -lt $Flags.Count) {
    $flag = $Flags[$i]
    $needsValue = @(
      '--repo', '--ref', '--install-dir', '--bin-dir', '--command',
      '--node-min', '--manifest', '--version'
    ) -contains $flag
    $value = $null
    if ($needsValue) {
      if (($i + 1) -ge $Flags.Count) { Fail ($flag + ' requires a value') }
      $value = $Flags[$i + 1]
      $i += 2
    } else {
      $i += 1
    }
    switch ($flag) {
      '--repo' { Set-Variable -Name RepoUrl -Value $value -Scope 1 }
      '--ref' { Set-Variable -Name Ref -Value $value -Scope 1 }
      '--install-dir' { Set-Variable -Name InstallDir -Value $value -Scope 1 }
      '--bin-dir' { Set-Variable -Name BinDir -Value $value -Scope 1 }
      '--command' { Set-Variable -Name CommandName -Value $value -Scope 1 }
      '--node-min' { Set-Variable -Name NodeMin -Value $value -Scope 1 }
      '--manifest' { Set-Variable -Name ManifestUrl -Value $value -Scope 1 }
      '--version' { Set-Variable -Name Version -Value $value -Scope 1 }
      '--force' { Set-Variable -Name Force -Value $true -Scope 1 }
      '--no-build' { Set-Variable -Name NoBuild -Value $true -Scope 1 }
      '--no-browser-use' { Set-Variable -Name NoBrowserUse -Value $true -Scope 1 }
      '--no-computer-use' { Set-Variable -Name NoComputerUse -Value $true -Scope 1 }
      '--no-retrieval' { Set-Variable -Name NoRetrieval -Value $true -Scope 1 }
      '--no-git' { Set-Variable -Name NoGit -Value $true -Scope 1 }
      '--no-shell-rc' { Set-Variable -Name NoPath -Value $true -Scope 1 }
      '--no-path' { Set-Variable -Name NoPath -Value $true -Scope 1 }
      '--prefer-source' { Set-Variable -Name PreferSource -Value $true -Scope 1 }
      '--main' { Set-Variable -Name Main -Value $true -Scope 1 }
      '--force-prebuilt' { Set-Variable -Name ForcePrebuilt -Value $true -Scope 1 }
      '--help' { Set-Variable -Name Help -Value $true -Scope 1 }
      '-h' { Set-Variable -Name Help -Value $true -Scope 1 }
      default { Fail ('unknown option: ' + $flag) }
    }
  }
}

function Test-NodeVersionOk {
  param([string]$NodePath, [string]$Minimum)
  try {
    $actual = (& $NodePath -p 'process.versions.node').Trim()
    return ([Version]$actual -ge [Version]$Minimum)
  } catch {
    return $false
  }
}

function Find-Node {
  param([string]$Minimum)
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $cmd) {
    $source = $null
    if ($cmd.PSObject.Properties['Source'] -and $cmd.Source) {
      $source = $cmd.Source
    } elseif ($cmd.PSObject.Properties['Path'] -and $cmd.Path) {
      $source = $cmd.Path
    }
    if ($source -and (Test-NodeVersionOk $source $Minimum)) {
      return $source
    }
  }
  return $null
}

function Install-LocalNode {
  param([string]$Version)
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $nodeArch = switch ($arch) {
    'Arm64' { 'arm64' }
    'X64' { 'x64' }
    default { Fail ('unsupported arch for Node bootstrap: ' + $arch) }
  }
  $slug = 'node-v' + $Version + '-win-' + $nodeArch
  $url = 'https://nodejs.org/dist/v' + $Version + '/' + $slug + '.zip'
  $runtime = Join-Path $HOME '.superliora\runtime\node'
  $archive = Join-Path $runtime ($slug + '.zip')
  $dest = Join-Path $runtime $slug
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $nodeExe = Join-Path $dest 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Write-Host ('Downloading Node.js ' + $Version + ' ...')
    Invoke-WebRequest -Uri $url -OutFile $archive
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) { Fail ('Node bootstrap failed: missing ' + $nodeExe) }
  $env:Path = $dest + ';' + $env:Path
  return $nodeExe
}

Apply-GnuFlags $Remaining

$helpEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_INSTALL_HELP', 'Process')
if ($Help -or $helpEnv -eq '1') {
  Show-Usage
  return
}

$RepoUrl = Get-ValueOrDefault $RepoUrl 'SUPERLIORA_REPO_URL' $DefaultRepoUrl
$Ref = Get-ValueOrDefault $Ref 'SUPERLIORA_REF' $DefaultRef
$InstallDir = Get-ValueOrDefault $InstallDir 'SUPERLIORA_INSTALL_DIR' $DefaultInstallDir
$BinDir = Get-ValueOrDefault $BinDir 'SUPERLIORA_BIN_DIR' $DefaultBinDir
$CommandName = Get-ValueOrDefault $CommandName 'SUPERLIORA_COMMAND' $DefaultCommandName
$NodeMin = Get-ValueOrDefault $NodeMin 'SUPERLIORA_NODE_MIN' $DefaultNodeMin
$ManifestUrl = Get-ValueOrDefault $ManifestUrl 'SUPERLIORA_MANIFEST_URL' $DefaultManifestUrl
$Version = Get-ValueOrDefault $Version 'SUPERLIORA_VERSION' ''
$RawBase = Get-ValueOrDefault $RawBase 'SUPERLIORA_RAW_BASE' $DefaultRawBase

if ($CommandName -notmatch '^[A-Za-z0-9._-]+$') {
  Fail '-CommandName must be a simple command name'
}
$fromMainEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_FROM_MAIN', 'Process')
if (-not [string]::IsNullOrWhiteSpace($Version) -and ($Main -or $fromMainEnv -eq '1')) {
  Fail '-Version cannot be combined with -Main'
}

Write-Host ($StagePrefix + 'bootstrapping')

$nodeBin = Find-Node $NodeMin
if (-not $nodeBin) {
  $nodeBin = Install-LocalNode $NodeMin
}

# Prefer local checkout when this file lives in a clone. Use PSScriptRoot /
# PSCommandPath (empty under irm|iex) -- not MyCommand.Path, which points at
# the parent script when this file is Invoke-Expression'd.
$orch = $null
$bundleDir = $null
$scriptRoot = $PSScriptRoot
if (-not $scriptRoot -and $PSCommandPath) {
  $scriptRoot = Split-Path -Parent $PSCommandPath
}
if ($scriptRoot) {
  $candidate = Join-Path $scriptRoot 'scripts\install-superliora.mjs'
  if (Test-Path -LiteralPath $candidate) { $orch = $candidate }
}

if (-not $orch) {
  $bundleDir = Join-Path ([IO.Path]::GetTempPath()) ('superliora-install-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path (Join-Path $bundleDir 'scripts\install') | Out-Null
  $relFiles = @(
    'scripts/install-superliora.mjs',
    'scripts/install-liora.mjs'
  )
  foreach ($name in $InstallModules) {
    $relFiles += ('scripts/install/' + $name)
  }
  $base = $RawBase.TrimEnd('/')
  foreach ($rel in $relFiles) {
    $dest = Join-Path $bundleDir ($rel -replace '/', '\')
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }
    $uri = $base + '/' + $rel
    Invoke-WebRequest -Uri $uri -OutFile $dest
  }
  $orch = Join-Path $bundleDir 'scripts\install-superliora.mjs'
}

$orchArgs = @(
  $orch,
  '--repo', $RepoUrl,
  '--ref', $Ref,
  '--install-dir', $InstallDir,
  '--bin-dir', $BinDir,
  '--command', $CommandName,
  '--node-min', $NodeMin,
  '--manifest', $ManifestUrl
)
if (-not [string]::IsNullOrWhiteSpace($Version)) {
  $orchArgs += @('--version', $Version)
}
if ($Force) { $orchArgs += '--force' }
if ($NoBuild) { $orchArgs += '--no-build' }
if ($NoPath -or $NoShellRc) { $orchArgs += '--no-shell-rc' }
$skipBrowser = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_BROWSER_USE', 'Process')
$skipComputer = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_COMPUTER_USE', 'Process')
$skipRetrieval = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_RETRIEVAL', 'Process')
$preferSourceEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_PREFER_SOURCE', 'Process')
$forcePrebuiltEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_FORCE_PREBUILT', 'Process')
if ($NoBrowserUse -or $skipBrowser -eq '1') { $orchArgs += '--no-browser-use' }
if ($NoComputerUse -or $skipComputer -eq '1') { $orchArgs += '--no-computer-use' }
if ($NoRetrieval -or $skipRetrieval -eq '1') { $orchArgs += '--no-retrieval' }
$skipGit = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_GIT', 'Process')
if ($NoGit -or $skipGit -eq '1') { $orchArgs += '--no-git' }
if ($PreferSource -or $preferSourceEnv -eq '1') { $orchArgs += '--prefer-source' }
if ($Main -or $fromMainEnv -eq '1') { $orchArgs += '--main' }
if ($ForcePrebuilt -or $forcePrebuiltEnv -eq '1') { $orchArgs += '--force-prebuilt' }

try {
  & $nodeBin @orchArgs
  $code = $LASTEXITCODE
  if ($null -ne $code -and $code -ne 0) {
    Fail ('installer exited with code ' + $code)
  }
} finally {
  if ($bundleDir -and (Test-Path -LiteralPath $bundleDir)) {
    Remove-Item -LiteralPath $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
} @args
