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

# Raw stage markers are for piped observers (Upgrade Studio, CI logs). On an
# interactive console they are visual noise, so gate them on redirection.
$FancyOutput = $false
try {
  if (-not [Console]::IsOutputRedirected) {
    $noColorEnv = [Environment]::GetEnvironmentVariable('NO_COLOR', 'Process')
    if ([string]::IsNullOrWhiteSpace($noColorEnv) -or $noColorEnv -eq '0') { $FancyOutput = $true }
  }
} catch {
}

function Write-StageMarker {
  param([string]$Stage)
  if (-not $FancyOutput) { Write-Host ($StagePrefix + $Stage) }
}

function Write-FancyInfo {
  param([string]$Message)
  if ($FancyOutput) {
    Write-Host '  * ' -ForegroundColor Cyan -NoNewline
    Write-Host $Message
  } else {
    Write-Host $Message
  }
}

$InstallModules = @(
  'platform.mjs',
  'home.mjs',
  'ensure-node.mjs',
  'ensure-git.mjs',
  'ensure-pnpm.mjs',
  'theatre.mjs',
  'download.mjs',
  'prebuilt.mjs',
  'source.mjs',
  'checkout-health.mjs',
  'sidecars.mjs',
  'path.mjs',
  'spawn.mjs',
  'wrappers.mjs',
  'ensure-terminal.mjs',
  'ensure-desktop-launcher.mjs',
  'brand-icon.mjs',
  'locale.mjs',
  'strings.mjs',
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
  Home = ''
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
  AllowExecutionPolicy = $false
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
  Write-StageMarker 'failed'
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
  Write-Host '  -Home / --home <path>   Data home (sessions, cache, worktrees). Default: auto, ~100 GB'
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
  Write-Host '  SUPERLIORA_LOCALE=en|ko'
  Write-Host '  -NoPath / -NoShellRc / --no-shell-rc'
  Write-Host '  -PreferSource / --prefer-source'
  Write-Host '  -Main / --main'
  Write-Host '  -ForcePrebuilt / --force-prebuilt'
  Write-Host '  -AllowExecutionPolicy / --allow-execution-policy  (legacy alias; auto-fix is now default)'
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
      'repo', 'repourl', 'ref', 'installdir', 'home', 'bindir', 'command', 'commandname',
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
      'home' { $Options.Home = $value }
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
      'allowexecutionpolicy' { $Options.AllowExecutionPolicy = $true }
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
  $gitRoot = Join-Path $HomeDir 'runtime\git'
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
  $pnpmDir = Join-Path $HomeDir 'runtime\pnpm'
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
  $runtimeRoot = Join-Path $HomeDir 'runtime\node'
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
  $runtime = Join-Path $HomeDir 'runtime\node'
  $archive = Join-Path $runtime ($slug + '.zip')
  $dest = Join-Path $runtime $slug
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $nodeExe = Join-Path $dest 'node.exe'
  if (-not (Test-Path -LiteralPath $nodeExe)) {
    Write-FancyInfo ('Downloading Node.js ' + $Version + ' ...')
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

function Get-LioraPathRoot {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
  try {
    return [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path))
  } catch {
    return ''
  }
}

function Test-LioraHomePopulated {
  param([string]$Dir)
  if ([string]::IsNullOrWhiteSpace($Dir)) { return $false }
  if (Test-Path -LiteralPath (Join-Path $Dir 'config.toml')) { return $true }
  if (Test-Path -LiteralPath (Join-Path $Dir 'tui.toml')) { return $true }
  if (Test-Path -LiteralPath (Join-Path $Dir 'credentials')) { return $true }
  $memory = Join-Path $Dir 'memory\liora-memory.sqlite'
  if (Test-Path -LiteralPath $memory) { return $true }
  $sessions = Join-Path $Dir 'sessions'
  if (Test-Path -LiteralPath $sessions) {
    $kids = @(Get-ChildItem -LiteralPath $sessions -ErrorAction SilentlyContinue)
    if ($kids.Count -gt 0) { return $true }
  }
  return $false
}

function Get-LioraLocalVolumes {
  $out = @()
  try {
    $disks = @(Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction Stop)
    foreach ($disk in $disks) {
      $id = [string]$disk.DeviceID
      if ([string]::IsNullOrWhiteSpace($id)) { continue }
      $root = $id.TrimEnd('\') + '\'
      $free = 0
      $total = 0
      try { $free = [int64]$disk.FreeSpace } catch { continue }
      try { $total = [int64]$disk.Size } catch { continue }
      if ($total -lt 1GB) { continue }
      $out += [pscustomobject]@{ Root = $root; Free = $free; Total = $total }
    }
  } catch {
    foreach ($d in @(Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
      if ($d.Name -notmatch '^[A-Za-z]$') { continue }
      if ($null -eq $d.Free) { continue }
      $total = 0
      try { $total = [int64]$d.Free + [int64]$d.Used } catch { continue }
      if ($total -lt 1GB) { continue }
      $out += [pscustomobject]@{ Root = ($d.Name.ToUpperInvariant() + ':\'); Free = [int64]$d.Free; Total = $total }
    }
  }
  return $out
}

function Resolve-SuperLioraDataHome {
  param(
    [string]$OsHome,
    [string]$Explicit,
    [string]$Cwd
  )
  $comfort = [int64]100 * [int64]1024 * [int64]1024 * [int64]1024
  $extra = [int64]20 * [int64]1024 * [int64]1024 * [int64]1024
  $pointer = Join-Path $OsHome '.superliora'
  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    return (Expand-HomePath $Explicit $OsHome)
  }
  $existing = [Environment]::GetEnvironmentVariable('SUPERLIORA_HOME', 'User')
  if (-not [string]::IsNullOrWhiteSpace($existing)) {
    return $existing
  }
  $redirect = Join-Path $pointer 'home.redirect'
  if (Test-Path -LiteralPath $redirect) {
    $lines = @(Get-Content -LiteralPath $redirect -ErrorAction SilentlyContinue)
    foreach ($line in $lines) {
      $trim = ([string]$line).Trim()
      if ($trim.Length -eq 0 -or $trim.StartsWith('#')) { continue }
      return $trim
    }
  }
  if (Test-LioraHomePopulated $pointer) { return $pointer }

  $volumes = @(Get-LioraLocalVolumes)
  $pointerRoot = Get-LioraPathRoot $pointer
  $defaultVol = $null
  foreach ($v in $volumes) {
    if ([string]::Equals($v.Root, $pointerRoot, [StringComparison]::OrdinalIgnoreCase)) {
      $defaultVol = $v
      break
    }
  }
  $defaultFree = [int64]0
  if ($null -ne $defaultVol) { $defaultFree = [int64]$defaultVol.Free }
  if ($defaultFree -ge $comfort) { return $pointer }

  $cwdRoot = Get-LioraPathRoot $Cwd
  $best = $null
  foreach ($v in $volumes) {
    if ([int64]$v.Free -lt $comfort) { continue }
    if ([string]::Equals($v.Root, $pointerRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($null -eq $best -or [int64]$v.Free -gt [int64]$best.Free) { $best = $v }
  }
  if ($cwdRoot -and -not [string]::Equals($cwdRoot, $pointerRoot, [StringComparison]::OrdinalIgnoreCase)) {
    foreach ($v in $volumes) {
      if ([string]::Equals($v.Root, $cwdRoot, [StringComparison]::OrdinalIgnoreCase) -and [int64]$v.Free -ge $comfort) {
        $best = $v
        break
      }
    }
  }
  if ($null -eq $best) {
    foreach ($v in $volumes) {
      if ([string]::Equals($v.Root, $pointerRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
      if ([int64]$v.Free -ge ($defaultFree + $extra)) {
        if ($null -eq $best -or [int64]$v.Free -gt [int64]$best.Free) { $best = $v }
      }
    }
  }
  if ($null -eq $best) { return $pointer }
  return (Join-Path $best.Root.TrimEnd('\') 'SuperLiora')
}

function Write-LioraHomeRedirect {
  param([string]$OsHome, [string]$DataHome)
  $pointer = Join-Path $OsHome '.superliora'
  if ([string]::Equals(
      [IO.Path]::GetFullPath($pointer).TrimEnd('\'),
      [IO.Path]::GetFullPath($DataHome).TrimEnd('\'),
      [StringComparison]::OrdinalIgnoreCase
    )) {
    return
  }
  New-Item -ItemType Directory -Force -Path $pointer | Out-Null
  $file = Join-Path $pointer 'home.redirect'
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $body = '# SuperLiora data home.' + [char]10 + $DataHome + [char]10
  [IO.File]::WriteAllText($file, $body, $utf8)
}

function Save-LioraHomeEnv {
  param([string]$OsHome, [string]$DataHome)
  $env:SUPERLIORA_HOME = $DataHome
  $pointer = Join-Path $OsHome '.superliora'
  $same = $false
  try {
    $same = [string]::Equals(
      [IO.Path]::GetFullPath($pointer).TrimEnd('\'),
      [IO.Path]::GetFullPath($DataHome).TrimEnd('\'),
      [StringComparison]::OrdinalIgnoreCase
    )
  } catch {
    $same = $false
  }
  if ($same) { return }
  try {
    [Environment]::SetEnvironmentVariable('SUPERLIORA_HOME', $DataHome, 'User')
  } catch {
  }
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
$opt.Home = Get-ValueOrDefault $opt.Home 'SUPERLIORA_HOME' ''
$opt.BinDir = Get-ValueOrDefault $opt.BinDir 'SUPERLIORA_BIN_DIR' $DefaultBinDir
$opt.CommandName = Get-ValueOrDefault $opt.CommandName 'SUPERLIORA_COMMAND' $DefaultCommandName
$opt.NodeMin = Get-ValueOrDefault $opt.NodeMin 'SUPERLIORA_NODE_MIN' $DefaultNodeMin
$opt.ManifestUrl = Get-ValueOrDefault $opt.ManifestUrl 'SUPERLIORA_MANIFEST_URL' $DefaultManifestUrl
$opt.Version = Get-ValueOrDefault $opt.Version 'SUPERLIORA_VERSION' ''
$rawBasePinnedByCaller =
  (-not [string]::IsNullOrWhiteSpace($opt.RawBase)) -or
  (-not [string]::IsNullOrWhiteSpace($env:SUPERLIORA_RAW_BASE))
$opt.RawBase = Get-ValueOrDefault $opt.RawBase 'SUPERLIORA_RAW_BASE' $DefaultRawBase
$opt.InstallDir = Expand-HomePath $opt.InstallDir $homeDir
$opt.Home = Expand-HomePath $opt.Home $homeDir
$opt.BinDir = Expand-HomePath $opt.BinDir $homeDir

$dumpEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_INSTALL_DUMP', 'Process')
if ($dumpEnv -eq '1') {
  Add-SessionPath $opt.BinDir
  Write-Dump $opt
  return
}

$dataHome = Resolve-SuperLioraDataHome -OsHome $homeDir -Explicit $opt.Home -Cwd (Get-Location).Path
Save-LioraHomeEnv -OsHome $homeDir -DataHome $dataHome
Write-LioraHomeRedirect -OsHome $homeDir -DataHome $dataHome
$legacySource = Join-Path $homeDir '.superliora\source'
if ([string]::IsNullOrWhiteSpace($opt.InstallDir) -or [string]::Equals(
    [IO.Path]::GetFullPath($opt.InstallDir).TrimEnd('\'),
    [IO.Path]::GetFullPath($legacySource).TrimEnd('\'),
    [StringComparison]::OrdinalIgnoreCase
  )) {
  $opt.InstallDir = Join-Path $dataHome 'source'
}
$opt.Home = $dataHome

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
$allowExecEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_ALLOW_EXECUTION_POLICY', 'Process')
$noExecEnv = [Environment]::GetEnvironmentVariable('SUPERLIORA_NO_EXECUTION_POLICY', 'Process')
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
if ($allowExecEnv -eq '1') { $opt.AllowExecutionPolicy = $true }

function Resolve-InstallLocale {
  $explicit = [Environment]::GetEnvironmentVariable('SUPERLIORA_LOCALE', 'Process')
  if (-not [string]::IsNullOrWhiteSpace($explicit)) { return $explicit.Trim().ToLowerInvariant() }
  try {
    $name = [System.Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName
    if ($name -eq 'ko') { return 'ko' }
  } catch {
  }
  return 'en'
}
if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('SUPERLIORA_LOCALE', 'Process'))) {
  $env:SUPERLIORA_LOCALE = Resolve-InstallLocale
}

if ($opt.CommandName -notmatch '^[A-Za-z0-9._-]+$') {
  Fail '-CommandName must be a simple command name'
}
if (-not [string]::IsNullOrWhiteSpace($opt.Version) -and $opt.Main) {
  Fail '-Version cannot be combined with -Main'
}

Write-StageMarker 'bootstrapping'
if ($FancyOutput) {
  Write-Host ''
  Write-Host '  * ' -ForegroundColor Cyan -NoNewline
  Write-Host 'SuperLiora installer' -ForegroundColor White
  Write-Host '    Preparing Node.js runtime ...' -ForegroundColor DarkGray
}

$nodeBin = Find-Node $opt.NodeMin $dataHome
if (-not $nodeBin) {
  $nodeBin = Install-LocalNode $opt.NodeMin $dataHome
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

# Resolve the published release tag and return a raw base pinned to it.
# Returns $null when the tag cannot be resolved or verified. The probe also
# guards against a stale `latest` pointer on main advertising a tag that was
# never cut. The installer module bundle should come from the same immutable
# tag the release was published from, not from the mutable tip of main.
function Resolve-PinnedRawBase {
  param([string]$Base, [string]$Version)
  $repoRoot = $Base.TrimEnd('/')
  if ($repoRoot.EndsWith('/main')) { $repoRoot = $repoRoot.Substring(0, $repoRoot.Length - 5) }
  try {
    if ([string]::IsNullOrWhiteSpace($Version)) {
      $latest = Invoke-RestMethod -Uri ($Base.TrimEnd('/') + '/latest.json') -TimeoutSec 15
      $Version = [string]$latest.version
    }
    if ([string]::IsNullOrWhiteSpace($Version)) { return $null }
    $tag = 'v' + ($Version -replace '^v', '')
    $check = Invoke-RestMethod -Uri ($repoRoot + '/' + $tag + '/latest.json') -TimeoutSec 15
  } catch { return $null }
  if ([string]$check.version -ne $Version) { return $null }
  return ($repoRoot + '/' + $tag)
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
  # Consent-free but safe default: pin the executed installer modules to the
  # release tag. Skipped when the caller pinned SUPERLIORA_RAW_BASE or asked
  # for --main; falls back to main with a note when pinning cannot resolve.
  if (-not $opt.Main -and -not $rawBasePinnedByCaller) {
    $pinned = Resolve-PinnedRawBase -Base $DefaultRawBase -Version $opt.Version
    if ($pinned) {
      Write-Host ("installer modules pinned to release " + ($pinned -replace '^.*/', ''))
      $base = $pinned.TrimEnd('/')
    } else {
      Write-Host 'could not pin installer modules to a release tag; falling back to main'
    }
  }
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
  '--home', $opt.Home,
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
if ($opt.AllowExecutionPolicy) { $orchArgs += '--allow-execution-policy' }

try {
  & $nodeBin @orchArgs
  $code = $LASTEXITCODE
  if ($null -ne $code -and $code -ne 0) {
    Fail ('installer exited with code ' + $code)
  }
  Add-SessionPath $opt.BinDir
  Add-SessionGitRuntime $dataHome
  Add-SessionPnpmRuntime $dataHome
  if ($FancyOutput) {
    Write-Host ('  Try it now: ' + $opt.CommandName + ' --version') -ForegroundColor DarkGray
    if (-not $opt.NoHostSetup -and -not $opt.NoTerminal) {
      Write-Host '  Or double-click SuperLiora on the Desktop.' -ForegroundColor DarkGray
    }
  } else {
    Write-Host ('This session: ' + $opt.CommandName + ' --version')
  }
} finally {
  if ($bundleDir -and (Test-Path -LiteralPath $bundleDir)) {
    Remove-Item -LiteralPath $bundleDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

} catch {
  if (-not $installState.Failed) {
    Write-StageMarker 'failed'
  }
  $errMsg = $_.Exception.Message
  if ([string]::IsNullOrWhiteSpace($errMsg)) { $errMsg = [string]$_ }
  if ($FancyOutput) {
    Write-Host ('  x error: ' + $errMsg) -ForegroundColor Red
  } else {
    Write-Host ('error: ' + $errMsg)
  }
  throw
}
} @args
