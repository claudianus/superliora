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
  [switch]$NoPath,
  [switch]$PreferSource,
  [switch]$Main,
  [switch]$ForcePrebuilt
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$DefaultRepoUrl = 'https://github.com/claudianus/superliora.git'
$DefaultRef = 'main'
$DefaultInstallDir = Join-Path $HOME '.superliora/source'
$DefaultBinDir = Join-Path $env:LOCALAPPDATA 'SuperLiora/bin'
$DefaultCommandName = 'liora'
$DefaultNodeMin = '24.15.0'
$DefaultManifestUrl = 'https://github.com/claudianus/superliora/releases/latest/download/manifest.json'
$DefaultRawBase = 'https://raw.githubusercontent.com/claudianus/superliora/main'
$StagePrefix = '__LIORA_UPGRADE_STAGE__='

function Get-ValueOrDefault {
  param([string]$Value, [string]$EnvName, [string]$Default)
  if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $envValue = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
  return $Default
}

function Fail {
  param([string]$Message)
  Write-Host "${StagePrefix}failed"
  throw $Message
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
  if ($cmd -and (Test-NodeVersionOk $cmd.Source $Minimum)) {
    return $cmd.Source
  }
  return $null
}

function Install-LocalNode {
  param([string]$Version)
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  $nodeArch = switch ($arch) {
    'Arm64' { 'arm64' }
    'X64' { 'x64' }
    default { Fail "unsupported arch for Node bootstrap: $arch" }
  }
  $slug = "node-v$Version-win-$nodeArch"
  $url = "https://nodejs.org/dist/v$Version/$slug.zip"
  $runtime = Join-Path $HOME '.superliora/runtime/node'
  $archive = Join-Path $runtime "$slug.zip"
  $dest = Join-Path $runtime $slug
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  if (-not (Test-Path (Join-Path $dest 'node.exe'))) {
    Write-Host "Downloading Node.js $Version …"
    Invoke-WebRequest -Uri $url -OutFile $archive
    if (Test-Path $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  }
  $nodeExe = Join-Path $dest 'node.exe'
  if (-not (Test-Path $nodeExe)) { Fail "Node bootstrap failed: missing $nodeExe" }
  $env:Path = "$dest;$env:Path"
  return $nodeExe
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
if (-not [string]::IsNullOrWhiteSpace($Version) -and ($Main -or $env:SUPERLIORA_FROM_MAIN -eq '1')) {
  Fail '-Version cannot be combined with -Main'
}

Write-Host "${StagePrefix}bootstrapping"

$nodeBin = Find-Node $NodeMin
if (-not $nodeBin) {
  $nodeBin = Install-LocalNode $NodeMin
}

# Prefer local checkout if this script lives in a clone; else download orchestrator bundle.
$scriptPath = $MyInvocation.MyCommand.Path
$orch = $null
$bundleDir = $null
if ($scriptPath -and (Test-Path $scriptPath)) {
  $root = Split-Path -Parent $scriptPath
  $candidate = Join-Path $root 'scripts/install-superliora.mjs'
  if (Test-Path $candidate) { $orch = $candidate }
}

if (-not $orch) {
  $bundleDir = Join-Path ([IO.Path]::GetTempPath()) ("superliora-install-" + [guid]::NewGuid().ToString('N'))
  $installMod = Join-Path $bundleDir 'scripts/install'
  New-Item -ItemType Directory -Force -Path $installMod | Out-Null
  $files = @(
    @{ Rel = 'scripts/install-superliora.mjs'; Dest = (Join-Path $bundleDir 'scripts/install-superliora.mjs') },
    @{ Rel = 'scripts/install-liora.mjs'; Dest = (Join-Path $bundleDir 'scripts/install-liora.mjs') }
  )
  foreach ($name in @('platform.mjs','ensure-node.mjs','theatre.mjs','download.mjs','prebuilt.mjs','source.mjs','sidecars.mjs','path.mjs')) {
    $files += @{ Rel = "scripts/install/$name"; Dest = (Join-Path $installMod $name) }
  }
  foreach ($f in $files) {
    Invoke-WebRequest -Uri "$RawBase/$($f.Rel)" -OutFile $f.Dest
  }
  $orch = Join-Path $bundleDir 'scripts/install-superliora.mjs'
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
if ($NoPath) { $orchArgs += '--no-shell-rc' }
if ($NoBrowserUse -or $env:SUPERLIORA_SKIP_BROWSER_USE -eq '1') { $orchArgs += '--no-browser-use' }
if ($NoComputerUse -or $env:SUPERLIORA_SKIP_COMPUTER_USE -eq '1') { $orchArgs += '--no-computer-use' }
if ($NoRetrieval -or $env:SUPERLIORA_SKIP_RETRIEVAL -eq '1') { $orchArgs += '--no-retrieval' }
if ($PreferSource -or $env:SUPERLIORA_PREFER_SOURCE -eq '1') { $orchArgs += '--prefer-source' }
if ($Main -or $env:SUPERLIORA_FROM_MAIN -eq '1') { $orchArgs += '--main' }
if ($ForcePrebuilt -or $env:SUPERLIORA_FORCE_PREBUILT -eq '1') { $orchArgs += '--force-prebuilt' }

try {
  & $nodeBin @orchArgs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if ($bundleDir -and (Test-Path $bundleDir)) {
    Remove-Item -LiteralPath $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
