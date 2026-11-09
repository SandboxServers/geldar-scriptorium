# A Windows job object holds a child and everything it spawns, so one call ends the whole tree
# (killing a parent first lets it spawn more children; a job closes that race).
$script:GP_JOB_READY = $false

function Initialize-JobType {
  if ($script:GP_JOB_READY) { return }
  if (-not ('GeldarJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GeldarJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct Ext { public Basic B; public Io I; public UIntPtr p1, p2, p3, p4; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int cls, ref Ext info, int len);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
  public static IntPtr Create() {
    IntPtr j = CreateJobObjectW(IntPtr.Zero, null);
    Ext e = new Ext();
    e.B.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    SetInformationJobObject(j, 9, ref e, Marshal.SizeOf(typeof(Ext)));
    return j;
  }
  public static bool Assign(IntPtr job, IntPtr proc) { return AssignProcessToJobObject(job, proc); }
  public static void Kill(IntPtr job) { TerminateJobObject(job, 124); }
}
'@
  }
  $script:GP_JOB_READY = $true
}
