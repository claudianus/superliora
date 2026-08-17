/**
 * Windows Job Object supervisor — process-tree kill on close.
 * Not a filesystem jail. Soft-fail: assignment errors are ignored.
 */

import { spawn, type ChildProcess } from 'node:child_process';

const SUPERVISOR_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LioraJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetInformationJobObject(IntPtr h, int infoClass, IntPtr info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
  public static bool EnableKillOnClose(IntPtr job) {
    var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    int size = Marshal.SizeOf(info);
    IntPtr ptr = Marshal.AllocHGlobal(size);
    try {
      Marshal.StructureToPtr(info, ptr, false);
      return SetInformationJobObject(job, 9, ptr, (uint)size);
    } finally {
      Marshal.FreeHGlobal(ptr);
    }
  }
}
"@
$job = [LioraJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { exit 1 }
if (-not [LioraJob]::EnableKillOnClose($job)) { exit 1 }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $pidText = $line.Trim()
  if ($pidText.Length -eq 0) { continue }
  $procId = 0
  if (-not [int]::TryParse($pidText, [ref]$procId)) { continue }
  if ($procId -le 0) { continue }
  $handle = [LioraJob]::OpenProcess(0x1F0FFF, $false, $procId)
  if ($handle -eq [IntPtr]::Zero) { continue }
  [void][LioraJob]::AssignProcessToJobObject($job, $handle)
  [void][LioraJob]::CloseHandle($handle)
}
`;

let supervisor: ChildProcess | undefined;
let supervisorFailed = false;

function ensureSupervisor(): ChildProcess | undefined {
  if (process.platform !== 'win32' || supervisorFailed) return undefined;
  if (supervisor !== undefined && supervisor.exitCode === null && !supervisor.killed) {
    return supervisor;
  }
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SUPERVISOR_SCRIPT],
      { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true },
    );
    child.once('error', () => {
      supervisorFailed = true;
      supervisor = undefined;
    });
    child.once('exit', () => {
      supervisor = undefined;
    });
    supervisor = child;
    return child;
  } catch {
    supervisorFailed = true;
    return undefined;
  }
}

export function assignPidToWindowsJob(pid: number): void {
  if (process.platform !== 'win32' || pid <= 0) return;
  const child = ensureSupervisor();
  const stdin = child?.stdin;
  if (stdin == null) return;
  try {
    stdin.write(`${String(pid)}\n`);
  } catch {
    /* supervisor gone — lexical/host exec still runs */
  }
}
