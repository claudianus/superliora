param(
  [string]$RepoUrl,
  [string]$Ref,
  [string]$InstallDir,
  [string]$BinDir,
  [string]$CommandName,
  [string]$NodeMin,
  [switch]$Force,
  [switch]$NoBuild,
  [switch]$NoBrowserUse,
  [switch]$NoComputerUse,
  [switch]$NoPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$DefaultRepoUrl = 'https://github.com/claudianus/superliora.git'
$DefaultRef = 'main'
$DefaultInstallDir = Join-Path $HOME '.superliora/source'
$DefaultBinDir = Join-Path $env:LOCALAPPDATA 'SuperLiora/bin'
$DefaultCommandName = 'liora'
$DefaultNodeMin = '24.15.0'
$WrapperMarker = 'Managed by superliora install.ps1'

function Get-ValueOrDefault {
  param([string]$Value, [string]$EnvName, [string]$Default)
  if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $envValue = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
  return $Default
}

function Write-Step {
  param([string]$Message)
  Write-Host $Message
}

function Fail {
  param([string]$Message)
  throw $Message
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "$Name is required"
  }
}

function Test-NodeVersion {
  param([string]$Minimum)
  $actual = (& node -p "process.versions.node").Trim()
  $actualVersion = [Version]$actual
  $minimumVersion = [Version]$Minimum
  if ($actualVersion -lt $minimumVersion) {
    Fail "Node.js >= $Minimum is required (found $actual)"
  }
}

function Ensure-Pnpm {
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  try {
    & corepack pnpm --version *> $null
    return
  } catch {
    try {
      & corepack enable pnpm *> $null
    } catch {
      # The retry below prints the actionable failure.
    }
  }

  try {
    & corepack pnpm --version *> $null
  } catch {
    Fail 'pnpm is required; enable Corepack or install pnpm'
  }
}

function Assert-SafeRemove {
  param([string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  $homeFull = [IO.Path]::GetFullPath($HOME)
  if ($full -eq $homeFull -or $full -eq [IO.Path]::GetPathRoot($full)) {
    Fail "refusing to remove unsafe path: $full"
  }
}

function Sync-Source {
  param([string]$Repository, [string]$GitRef, [string]$TargetDir, [bool]$Replace)

  $gitDir = Join-Path $TargetDir '.git'
  if ((Test-Path $TargetDir) -and -not (Test-Path $gitDir)) {
    if (-not $Replace) {
      Fail "$TargetDir exists but is not a git checkout; pass -Force to replace it"
    }
    Write-Step "Removing non-git install directory: $TargetDir"
    Assert-SafeRemove $TargetDir
    Remove-Item -LiteralPath $TargetDir -Recurse -Force
  }

  if (Test-Path $gitDir) {
    Write-Step "Updating SuperLiora source in $TargetDir"
    & git -C $TargetDir remote set-url origin $Repository
    & git -C $TargetDir fetch --depth 1 origin $GitRef
    & git -C $TargetDir checkout --force FETCH_HEAD
    & git -C $TargetDir reset --hard FETCH_HEAD
  } else {
    Write-Step "Cloning SuperLiora source into $TargetDir"
    $parent = Split-Path -Parent $TargetDir
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    & git clone --depth 1 $Repository $TargetDir
    & git -C $TargetDir fetch --depth 1 origin $GitRef
    & git -C $TargetDir checkout --force FETCH_HEAD
  }
}

function Build-Source {
  param([string]$TargetDir)
  Write-Step 'Installing dependencies and building CLI'
  Push-Location $TargetDir
  try {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    & corepack pnpm install --frozen-lockfile
    & corepack pnpm run build:packages
    & corepack pnpm -C apps/liora run build
  } finally {
    Pop-Location
  }
}

function Install-CloakBrowser {
  param([string]$TargetDir)
  Write-Step 'Pre-installing Lightpanda browser-use runtime (primary)'
  $lightpandaCache = if ($env:LIGHTPANDA_CACHE_DIR) { $env:LIGHTPANDA_CACHE_DIR } else { Join-Path $env:USERPROFILE '.cache\superliora-lightpanda' }
  $asset = switch ("$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)") {
    'Arm64' { if ($IsMacOS) { 'lightpanda-aarch64-macos' } elseif ($IsLinux) { 'lightpanda-aarch64-linux' } }
    'X64' { if ($IsMacOS) { 'lightpanda-x86_64-macos' } elseif ($IsLinux) { 'lightpanda-x86_64-linux' } }
  }
  if ($asset) {
    try {
      New-Item -ItemType Directory -Force -Path $lightpandaCache | Out-Null
      $target = Join-Path $lightpandaCache 'lightpanda'
      Invoke-WebRequest -Uri "https://github.com/lightpanda-io/browser/releases/download/nightly/$asset" -OutFile $target
    } catch {
      Write-Warning "Lightpanda pre-install failed; retry with '$CommandName browser-use install'"
    }
  } else {
    Write-Warning 'Lightpanda auto-install is not supported on this platform; CloakBrowser fallback only'
  }
  Write-Step 'Pre-installing CloakBrowser fallback cache'
  Push-Location $TargetDir
  try {
    $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
    & corepack pnpm --filter '@superliora/gui-use' exec cloakbrowser install
  } catch {
    Write-Warning "CloakBrowser fallback pre-install failed; retry with '$CommandName browser-use install'"
  } finally {
    Pop-Location
  }
}

function Install-CuaDriver {
  Write-Step 'Installing cua-driver computer-use runtime'
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -Command `
      "irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex"
    if ($LASTEXITCODE -ne 0) {
      throw "cua-driver installer exited with code $LASTEXITCODE"
    }
  } catch {
    Write-Warning "cua-driver install failed; retry with '$CommandName computer-use install'"
  }
}

function Test-ManagedFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $true }
  $content = Get-Content -LiteralPath $Path -Raw -ErrorAction Stop
  return $content.Contains($WrapperMarker)
}

function Write-Wrappers {
  param([string]$TargetDir, [string]$OutDir, [string]$Name, [bool]$Replace)
  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $mainFile = Join-Path $TargetDir 'apps/liora/dist/main.mjs'
  $cmdPath = Join-Path $OutDir "$Name.cmd"
  $psPath = Join-Path $OutDir "$Name.ps1"

  foreach ($path in @($cmdPath, $psPath)) {
    if ((Test-Path $path) -and -not (Test-ManagedFile $path) -and -not $Replace) {
      Fail "$path already exists and is not managed by this installer. Re-run with -Force to replace it."
    }
  }

  $cmd = @"
@echo off
rem $WrapperMarker
setlocal
if "%SUPERLIORA_NO_AUTO_UPDATE%"=="" set "SUPERLIORA_NO_AUTO_UPDATE=1"
node "$mainFile" %*
"@
  Set-Content -LiteralPath $cmdPath -Value $cmd -Encoding ASCII

  $escapedMain = $mainFile.Replace("'", "''")
  $ps = @"
# $WrapperMarker
if ([string]::IsNullOrWhiteSpace(`$env:SUPERLIORA_NO_AUTO_UPDATE)) {
  `$env:SUPERLIORA_NO_AUTO_UPDATE = '1'
}
& node '$escapedMain' @args
exit `$LASTEXITCODE
"@
  Set-Content -LiteralPath $psPath -Value $ps -Encoding UTF8
  return $cmdPath
}

function Add-UserPath {
  param([string]$PathToAdd)
  $full = [IO.Path]::GetFullPath($PathToAdd)
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @()
  if (-not [string]::IsNullOrWhiteSpace($userPath)) {
    $parts = $userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  }

  $alreadyPresent = $false
  foreach ($part in $parts) {
    if ([string]::Equals($part.TrimEnd('\'), $full.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
      $alreadyPresent = $true
      break
    }
  }

  if (-not $alreadyPresent) {
    $next = if ([string]::IsNullOrWhiteSpace($userPath)) { $full } else { "$full;$userPath" }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  }

  $processParts = $env:Path -split ';'
  if (-not ($processParts | Where-Object { [string]::Equals($_.TrimEnd('\'), $full.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) })) {
    $env:Path = "$full;$env:Path"
  }
}

$RepoUrl = Get-ValueOrDefault $RepoUrl 'SUPERLIORA_REPO_URL' $DefaultRepoUrl
$Ref = Get-ValueOrDefault $Ref 'SUPERLIORA_REF' $DefaultRef
$InstallDir = Get-ValueOrDefault $InstallDir 'SUPERLIORA_INSTALL_DIR' $DefaultInstallDir
$BinDir = Get-ValueOrDefault $BinDir 'SUPERLIORA_BIN_DIR' $DefaultBinDir
$CommandName = Get-ValueOrDefault $CommandName 'SUPERLIORA_COMMAND' $DefaultCommandName
$NodeMin = Get-ValueOrDefault $NodeMin 'SUPERLIORA_NODE_MIN' $DefaultNodeMin

if ($CommandName -notmatch '^[A-Za-z0-9._-]+$') {
  Fail '-CommandName must be a simple command name'
}

Require-Command git
Require-Command node
Require-Command corepack
Test-NodeVersion $NodeMin
Ensure-Pnpm

Sync-Source $RepoUrl $Ref $InstallDir ([bool]$Force)
if (-not $NoBuild) {
  Build-Source $InstallDir
  if ((-not $NoBrowserUse) -and $env:SUPERLIORA_SKIP_BROWSER_USE -ne '1') {
    Install-CloakBrowser $InstallDir
  }
  if ((-not $NoComputerUse) -and $env:SUPERLIORA_SKIP_COMPUTER_USE -ne '1') {
    Install-CuaDriver
  }
}

$commandPath = Write-Wrappers $InstallDir $BinDir $CommandName ([bool]$Force)
if (-not $NoPath) {
  Add-UserPath $BinDir
}

try {
  & $commandPath --version *> $null
} catch {
  # Keep install successful; the command may require terminal-only setup.
}

Write-Host ''
Write-Host 'SuperLiora is installed from GitHub source.'
Write-Host "Command: $CommandName"
Write-Host "Source:  $InstallDir"
Write-Host "Bin dir: $BinDir"
Write-Host 'Open a new terminal, then run:'
Write-Host "  $CommandName --version"
