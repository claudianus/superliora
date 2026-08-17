# SuperLiora bootstrap -- ensure Node, then run scripts/install-superliora.mjs
# ASCII-only so Windows PowerShell 5.1 parses this on any system code page.
# Works as:  irm .../install.ps1 | iex
#        or: powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ... | iex"
#        or: .\install.ps1 --bin-dir ... --no-path
#        or: install.cmd (cmd.exe)
#
# Do not put param() at file scope. Windows PowerShell 5.1 treats `param` as a
# command when the file is Invoke-Expression'd (`irm | iex`).
# Do not use param() on the installer scriptblock either: GNU flags such as
# --bin-dir would then be bound as unknown named parameters.

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
}

& {
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$ProgressPreference = 'SilentlyContinue'
$installState = @{ Failed = $false }

$DefaultRepoUrl = 'https://github.com/claudianus/superliora.git'
$DefaultRef = 'main'
$homeDir = $HOME
if ([string]::IsNullOrWhiteSpace($homeDir)) { $homeDir = $env:USERPROFILE }
$localApp = $env:LOCALAPPDATA
if ([string]::IsNullOrWhiteSpace($localApp)) { $localApp = Join-Path $homeDir 'AppData\Local' }
$DefaultInstallDir = Join-Path $homeDir '.superliora\source'
$DefaultBinDir = Join-Path $localApp 'SuperLiora\bin'
$DefaultCommandName = 'liora'
$DefaultNodeMin = '24.15.0'
$DefaultManifestUrl = 'https://github.com/claudianus/superliora/releases/latest/download/manifest.json'
$DefaultRawBase = 'https://raw.githubusercontent.com/claudianus/superliora/main'
$StagePrefix = '__LIORA_UPGRADE_STAGE__='
$InstallModules = @(
  'platform.mjs',
  'ensure-node.mjs',
  'ensure-git.mjs',
  'ensure-pnpm.mjs',
  'theatre.mjs',
  'download.mjs',
  'prebuilt.mjs',
  'source.mjs',
  'sidecars.mjs',
  'path.mjs',
  'spawn.mjs',
  'wrappers.mjs',
  'ensure-terminal.mjs',
  'ensure-winget.mjs',
  'ensure-nerd-font.mjs',
  'ensure-oh-my-posh.mjs',
  'ensure-shell-vibe.mjs',
  'host-setup.mjs',
  'host-path.mjs'
)

$opt = @{
  RepoUrl = ''
  Ref = ''
  InstallDir = ''
  BinDir = ''
  CommandName = ''
  NodeMin = ''
  ManifestUrl = ''
  Version = ''
  RawBase = ''
  Force = $false
  NoBuild = $false
  NoBrowserUse = $false
  NoComputerUse = $false
  NoRetrieval = $false
  NoGit = $false
  NoTerminal = $false
  NoHostSetup = $false
  NoPath = $false
  NoShellRc = $false
  PreferSource = $false
  Main = $false
  ForcePrebuilt = $false
  Help = $false
}

function Get-ValueOrDefault {
  param([string]$Value, [string]$EnvName, [string]$Default)
  if (-not [string]::IsNullOrWhiteSpace($Value)) { return $Value }
  $envValue = [Environment]::GetEnvironmentVariable($EnvName, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($envValue)) { return $envValue }
  return $Default
}

function Fail {
  param([string]$Message)
  $installState.Failed = $true
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
  Write-Host 'After irm | iex, this PowerShell window can run liora (session PATH is updated).'
  Write-Host 'Flags after | iex are ignored; set SUPERLIORA_* or use install.cmd / .\install.ps1.'
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
  Write-Host '  -NoTerminal / --no-terminal'
  Write-Host '  -NoHostSetup / --no-host-setup'
  Write-Host '  -NoPath / -NoShellRc / --no-shell-rc'
  Write-Host '  -PreferSource / --prefer-source'
  Write-Host '  -Main / --main'
  Write-Host '  -ForcePrebuilt / --force-prebuilt'
  Write-Host '  -Help / --help'
}

function Get-FlagKey {
  param([string]$Flag)
  return $Flag.TrimStart('-').ToLowerInvariant().Replace('-', '')
}

function Apply-Flags {
  param([object]$Options, [string[]]$Flags)
  if ($null -eq $Flags -or $Flags.Count -eq 0) { return }
  $i = 0
  while ($i -lt $Flags.Count) {
    $flag = [string]$Flags[$i]
    $value = $null
    if ($flag.StartsWith('-') -and $flag.Contains('=')) {
      $eq = $flag.IndexOf('=')
      $value = $flag.Substring($eq + 1)
      $flag = $flag.Substring(0, $eq)
    }
    $key = Get-FlagKey $flag
    $needsValue = @(
      'repo', 'repourl', 'ref', 'installdir', 'bindir', 'command', 'commandname',
      'nodemin', 'manifest', 'manifesturl', 'version', 'rawbase'
    ) -contains $key
    if ($needsValue -and $null -eq $value) {
      if (($i + 1) -ge $Flags.Count) { Fail ($flag + ' requires a value') }
      $value = [string]$Flags[$i + 1]
      $i += 2
    } else {
      $i += 1
    }
    switch ($key) {
      { $_ -eq 'repo' -or $_ -eq 'repourl' } { $Options.RepoUrl = $value }
      'ref' { $Options.Ref = $value }
      'installdir' { $Options.InstallDir = $value }
      'bindir' { $Options.BinDir = $value }
      { $_ -eq 'command' -or $_ -eq 'commandname' } { $Options.CommandName = $value }
      'nodemin' { $Options.NodeMin = $value }
      { $_ -eq 'manifest' -or $_ -eq 'manifesturl' } { $Options.ManifestUrl = $value }
      'version' { $Options.Version = $value }
      'rawbase' { $Options.RawBase = $value }
      'force' { $Options.Force = $true }
      'nobuild' { $Options.NoBuild = $true }
      'nobrowseruse' { $Options.NoBrowserUse = $true }
      'nocomputeruse' { $Options.NoComputerUse = $true }
      'noretrieval' { $Options.NoRetrieval = $true }
      'nogit' { $Options.NoGit = $true }
      'noterminal' { $Options.NoTerminal = $true }
      'nohostsetup' { $Options.NoHostSetup = $true }
      { $_ -eq 'noshellrc' -or $_ -eq 'nopath' } { $Options.NoPath = $true; $Options.NoShellRc = $true }
      'prefersource' { $Options.PreferSource = $true }
      'main' { $Options.Main = $true }
      'forceprebuilt' { $Options.ForcePrebuilt = $true }
      { $_ -eq 'help' -or $_ -eq 'h' } { $Options.Help = $true }
      default { Fail ('unknown option: ' + $flag) }
    }
  }
}

function Get-RemoteFile {
  param([string]$Uri, [string]$OutFile)
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $OutFile
}

function Add-SessionPath {
  param([string]$Dir)
  if ([string]::IsNullOrWhiteSpace($Dir)) { return }
  $full = [IO.Path]::GetFullPath($Dir).TrimEnd('\')
  $parts = @()
  if (-not [string]::IsNullOrWhiteSpace($env:Path)) {
    $parts = @($env:Path -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  }
  foreach ($part in $parts) {
    try {
      $norm = [IO.Path]::GetFullPath($part).TrimEnd('\')
    } catch {
      $norm = $part.TrimEnd('\')
    }
    if ([string]::Equals($norm, $full, [StringComparison]::OrdinalIgnoreCase)) { return }
  }
  $env:Path = $full + ';' + $env:Path
}

function Add-SessionGitRuntime {
  param([string]$HomeDir)
  $gitRoot = Join-Path $HomeDir '.superliora\runtime\git'
  $bash = Join-Path $gitRoot 'bin\bash.exe'
  if (-not (Test-Path -LiteralPath $bash)) { return }
  if ([string]::IsNullOrWhiteSpace($env:LIORA_SHELL_PATH)) {
    $env:LIORA_SHELL_PATH = $bash
  }
  Add-SessionPath (Join-Path $gitRoot 'cmd')
  Add-SessionPath (Join-Path $gitRoot 'bin')
}

function Add-SessionPnpmRuntime {
  param([string]$HomeDir)
  $pnpmDir = Join-Path $HomeDir '.superliora\runtime\pnpm'
  $exe = Join-Path $pnpmDir 'pnpm.exe'
  if (-not (Test-Path -LiteralPath $exe)) { return }
  Add-SessionPath $pnpmDir
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
  param([string]$Minimum, [string]$HomeDir)
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
  $runtimeRoot = Join-Path $HomeDir '.superliora\runtime\node'
  if (Test-Path -LiteralPath $runtimeRoot) {
    $dirs = @(Get-ChildItem -LiteralPath $runtimeRoot -Directory -ErrorAction SilentlyContinue)
    foreach ($dir in $dirs) {
      $exe = Join-Path $dir.FullName 'node.exe'
      if ((Test-Path -LiteralPath $exe) -and (Test-NodeVersionOk $exe $Minimum)) {
        return $exe
      }
    }
  }
  return $null
}

# Do not read RuntimeInformation.OSArchitecture with :: or dot access.
# Set-StrictMode 2.0 throws PropertyNotFoundStrict when that property is
# missing: older .NET, or a shadowed netstandard RuntimeInformation type
# that never had OSArchitecture. Env vars work on every Windows host.
function Convert-WindowsArchToken {
  param([string]$Raw)
  if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
  switch -Regex ($Raw.Trim()) {
    '^(Arm64|ARM64|aarch64)$' { return 'arm64' }
    '^(X64|AMD64|amd64|x86_64|x64)$' { return 'x64' }
    default { return $null }
  }
}

function Get-RuntimeOsArchToken {
  try {
    $riType = [System.Runtime.InteropServices.RuntimeInformation]
    $prop = $riType.GetProperty('OSArchitecture')
    if ($null -eq $prop) { return $null }
    $value = $prop.GetValue($null, $null)
    if ($null -eq $value) { return $null }
    return [string]$value
  } catch {
    return $null
  }
}

function Get-WindowsNodeArch {
  $wow = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432', 'Process')
  $proc = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE', 'Process')
  foreach ($item in @((Get-RuntimeOsArchToken), $wow, $proc)) {
    $mapped = Convert-WindowsArchToken $item
    if ($mapped) { return $mapped }
  }
  if ([Environment]::Is64BitOperatingSystem) { return 'x64' }
  Fail ('unsupported arch for Node bootstrap (PROCESSOR_ARCHITECTURE=' + $proc + ' PROCESSOR_ARCHITEW6432=' + $wow + ')')
}

function Install-LocalNode {
  param([string]$Version, [string]$HomeDir)
  $nodeArch = Get-WindowsNodeArch
  $slug = 'node-v' + $Version + '-win-' + $nodeArch
  $url = 'https://nodejs.org/dist/v' + $Version + '/' + $slug + '.zip'
  $runtime = Join-Path $HomeDir '.superliora\runtime\node'
  $archive = Join-Path $runtime ($slug + '.zip')
  $dest = Join-Path $runtime $slug
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $nodeExe = Join-Path $dest 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Write-Host ('Downloading Node.js ' + $Version + ' ...')
    Get-RemoteFile -Uri $url -OutFile $archive
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
  }
  if (-not (Test-Path -LiteralPath $nodeExe)) { Fail ('Node bootstrap failed: missing ' + $nodeExe) }
  Add-SessionPath $dest
  return $nodeExe
}

function Convert-Flag01 {
  param([bool]$Value)
  if ($Value) { return '1' }
  return '0'
}

function Expand-HomePath {
  param([string]$Value, [string]$HomeDir)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Value }
  if ($Value -eq '~') { return $HomeDir }
  if ($Value.StartsWith('~\') -or $Value.StartsWith('~/')) {
    return (Join-Path $HomeDir $Value.Substring(2))
  }
  return $Value
}

function Write-Dump {
  param([object]$Options)
  Write-Host ('DUMP binDir=' + $Options.BinDir)
  Write-Host ('DUMP preferSource=' + (Convert-Flag01 $Options.PreferSource))
  Write-Host ('DUMP noPath=' + (Convert-Flag01 $Options.NoPath))
  Write-Host ('DUMP noShellRc=' + (Convert-Flag01 $Options.NoShellRc))
  Write-Host ('DUMP main=' + (Convert-Flag01 $Options.Main))
  Write-Host ('DUMP noBrowserUse=' + (Convert-Flag01 $Options.NoBrowserUse))
  Write-Host ('DUMP noGit=' + (Convert-Flag01 $Options.NoGit))
  Write-Host ('DUMP noTerminal=' + (Convert-Flag01 $Options.NoTerminal))
  Write-Host ('DUMP noHostSetup=' + (Convert-Flag01 $Options.NoHostSetup))
  Write-Host ('DUMP nodeArch=' + (Get-WindowsNodeArch))
  Write-Host 'DUMP ok'
}

Apply-Flags $opt $args

try {

$helpEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_INSTALL_HELP', 'Process')
if ($opt.Help -or $helpEnv -eq '1') {
  Show-Usage
  return
}

$opt.RepoUrl = Get-ValueOrDefault $opt.RepoUrl 'SUPERLIORA_REPO_URL' $DefaultRepoUrl
$opt.Ref = Get-ValueOrDefault $opt.Ref 'SUPERLIORA_REF' $DefaultRef
$opt.InstallDir = Get-ValueOrDefault $opt.InstallDir 'SUPERLIORA_INSTALL_DIR' $DefaultInstallDir
$opt.BinDir = Get-ValueOrDefault $opt.BinDir 'SUPERLIORA_BIN_DIR' $DefaultBinDir
$opt.CommandName = Get-ValueOrDefault $opt.CommandName 'SUPERLIORA_COMMAND' $DefaultCommandName
$opt.NodeMin = Get-ValueOrDefault $opt.NodeMin 'SUPERLIORA_NODE_MIN' $DefaultNodeMin
$opt.ManifestUrl = Get-ValueOrDefault $opt.ManifestUrl 'SUPERLIORA_MANIFEST_URL' $DefaultManifestUrl
$opt.Version = Get-ValueOrDefault $opt.Version 'SUPERLIORA_VERSION' ''
$opt.RawBase = Get-ValueOrDefault $opt.RawBase 'SUPERLIORA_RAW_BASE' $DefaultRawBase
$opt.InstallDir = Expand-HomePath $opt.InstallDir $homeDir
$opt.BinDir = Expand-HomePath $opt.BinDir $homeDir

$skipBrowser = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_BROWSER_USE', 'Process')
$skipComputer = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_COMPUTER_USE', 'Process')
$skipRetrieval = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_RETRIEVAL', 'Process')
$preferSourceEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_PREFER_SOURCE', 'Process')
$forcePrebuiltEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_FORCE_PREBUILT', 'Process')
$skipGit = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_GIT', 'Process')
$skipTerminal = [Environment]::GetEnvironmentVariable('SUPERLIORA_SKIP_TERMINAL', 'Process')
$noTerminalEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_NO_TERMINAL', 'Process')
$noHostSetupEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_NO_HOST_SETUP', 'Process')
$noShellEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_NO_SHELL_RC', 'Process')
$fromMainEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_FROM_MAIN', 'Process')
if ($skipBrowser -eq '1') { $opt.NoBrowserUse = $true }
if ($skipComputer -eq '1') { $opt.NoComputerUse = $true }
if ($skipRetrieval -eq '1') { $opt.NoRetrieval = $true }
if ($preferSourceEnv -eq '1') { $opt.PreferSource = $true }
if ($forcePrebuiltEnv -eq '1') { $opt.ForcePrebuilt = $true }
if ($skipGit -eq '1') { $opt.NoGit = $true }
if ($skipTerminal -eq '1' -or $noTerminalEnv -eq '1') { $opt.NoTerminal = $true }
if ($noHostSetupEnv -eq '1') { $opt.NoHostSetup = $true }
if ($noShellEnv -eq '1') { $opt.NoPath = $true; $opt.NoShellRc = $true }
if ($fromMainEnv -eq '1') { $opt.Main = $true }

if ($opt.CommandName -notmatch '^[A-Za-z0-9._-]+$') {
  Fail '-CommandName must be a simple command name'
}
if (-not [string]::IsNullOrWhiteSpace($opt.Version) -and $opt.Main) {
  Fail '-Version cannot be combined with -Main'
}

$dumpEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_INSTALL_DUMP', 'Process')
if ($dumpEnv -eq '1') {
  Add-SessionPath $opt.BinDir
  Add-SessionGitRuntime $homeDir
  Add-SessionPnpmRuntime $homeDir
  Write-Dump $opt
  return
}

Write-Host ($StagePrefix + 'bootstrapping')

$nodeBin = Find-Node $opt.NodeMin $homeDir
if (-not $nodeBin) {
  $nodeBin = Install-LocalNode $opt.NodeMin $homeDir
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
  $base = $opt.RawBase.TrimEnd('/')
  foreach ($rel in $relFiles) {
    $dest = Join-Path $bundleDir ($rel -replace '/', '\')
    $destDir = Split-Path -Parent $dest
    if (-not (Test-Path -LiteralPath $destDir)) {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    }
    $uri = $base + '/' + $rel
    Get-RemoteFile -Uri $uri -OutFile $dest
  }
  $orch = Join-Path $bundleDir 'scripts\install-superliora.mjs'
}

$orchArgs = @(
  $orch,
  '--repo', $opt.RepoUrl,
  '--ref', $opt.Ref,
  '--install-dir', $opt.InstallDir,
  '--bin-dir', $opt.BinDir,
  '--command', $opt.CommandName,
  '--node-min', $opt.NodeMin,
  '--manifest', $opt.ManifestUrl
)
if (-not [string]::IsNullOrWhiteSpace($opt.Version)) {
  $orchArgs += @('--version', $opt.Version)
}
if ($opt.Force) { $orchArgs += '--force' }
if ($opt.NoBuild) { $orchArgs += '--no-build' }
if ($opt.NoPath -or $opt.NoShellRc) { $orchArgs += '--no-shell-rc' }
if ($opt.NoBrowserUse) { $orchArgs += '--no-browser-use' }
if ($opt.NoComputerUse) { $orchArgs += '--no-computer-use' }
if ($opt.NoRetrieval) { $orchArgs += '--no-retrieval' }
if ($opt.NoGit) { $orchArgs += '--no-git' }
if ($opt.NoTerminal) { $orchArgs += '--no-terminal' }
if ($opt.NoHostSetup) { $orchArgs += '--no-host-setup' }
if ($opt.PreferSource) { $orchArgs += '--prefer-source' }
if ($opt.Main) { $orchArgs += '--main' }
if ($opt.ForcePrebuilt) { $orchArgs += '--force-prebuilt' }

try {
  & $nodeBin @orchArgs
  $code = $LASTEXITCODE
  if ($null -ne $code -and $code -ne 0) {
    Fail ('installer exited with code ' + $code)
  }
  Add-SessionPath $opt.BinDir
  Add-SessionGitRuntime $homeDir
  Add-SessionPnpmRuntime $homeDir
  Write-Host ('This session: ' + $opt.CommandName + ' --version')
} finally {
  if ($bundleDir -and (Test-Path -LiteralPath $bundleDir)) {
    Remove-Item -LiteralPath $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

} catch {
  if (-not $installState.Failed) {
    Write-Host ($StagePrefix + 'failed')
  }
  $errMsg = $_.Exception.Message
  if ([string]::IsNullOrWhiteSpace($errMsg)) { $errMsg = [string]$_ }
  Write-Host ('error: ' + $errMsg)
  throw
}
} @args
