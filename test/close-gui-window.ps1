param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GuiTestClose {
    public delegate bool Callback(IntPtr window, IntPtr param);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr param);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr a, IntPtr b);
    public static void Close(uint target) {
        EnumWindows((window, param) => {
            uint owner; GetWindowThreadProcessId(window, out owner);
            if(owner == target) PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
    }
}
'@
[GuiTestClose]::Close([uint32]$TargetProcessId)
