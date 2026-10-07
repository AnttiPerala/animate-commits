param([Parameter(Mandatory=$true)][string]$OptionsFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $captureOptions = Get-Content -LiteralPath $OptionsFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

public static class NativeFrame {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
    public struct ProcessEntry {
        public uint Size, Usage, Pid; public UIntPtr Heap; public uint Module, Threads, Parent;
        public int Priority; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Exe;
    }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    public static string Title(IntPtr hwnd) { var text = new StringBuilder(2048); GetWindowText(hwnd, text, text.Capacity); return text.ToString(); }
    public static uint Owner(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid; }
    public static void DpiAware() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    public static HashSet<uint> Descendants(uint root) {
        var children = new Dictionary<uint,uint>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) throw new Exception("Cannot enumerate application processes");
        try {
            var entry = new ProcessEntry(); entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            if (Process32First(snapshot, ref entry)) do { children[entry.Pid] = entry.Parent; } while (Process32Next(snapshot, ref entry));
        } finally { CloseHandle(snapshot); }
        var result = new HashSet<uint>(); result.Add(root);
        bool changed;
        do { changed = false; foreach(var item in children) if(result.Contains(item.Value) && result.Add(item.Key)) changed = true; } while(changed);
        return result;
    }
    public static IntPtr Find(uint root, string titlePattern) {
        var processes = Descendants(root);
        Regex pattern = String.IsNullOrEmpty(titlePattern) ? null : new Regex(titlePattern, RegexOptions.None, TimeSpan.FromSeconds(1));
        IntPtr chosen = IntPtr.Zero; long largest = 0;
        EnumWindows((hwnd, param) => {
            if(!IsWindowVisible(hwnd) || !processes.Contains(Owner(hwnd))) return true;
            string title = Title(hwnd);
            if(String.IsNullOrEmpty(title) || (pattern != null && !pattern.IsMatch(title))) return true;
            Rect rect; GetClientRect(hwnd, out rect); long area = (long)(rect.Right-rect.Left)*(rect.Bottom-rect.Top);
            if(area > largest) { largest = area; chosen = hwnd; }
            return true;
        }, IntPtr.Zero);
        return chosen;
    }
    public static void Save(IntPtr hwnd, uint root, int width, int height, int settle, string path) {
        if(!IsWindow(hwnd) || !Descendants(root).Contains(Owner(hwnd))) throw new Exception("Selected application window closed before capture");
        if(IsIconic(hwnd)) ShowWindow(hwnd, 9);
        for(int attempt=0; attempt<3; attempt++) {
            Rect client, window; GetClientRect(hwnd, out client); GetWindowRect(hwnd, out window);
            int extraWidth = window.Right-window.Left-(client.Right-client.Left);
            int extraHeight = window.Bottom-window.Top-(client.Bottom-client.Top);
            if(!SetWindowPos(hwnd, IntPtr.Zero, 0, 0, width+extraWidth, height+extraHeight, 0x0016)) throw new Exception("Cannot resize application window");
            Thread.Sleep(150);
            GetClientRect(hwnd, out client);
            if(client.Right-client.Left == width && client.Bottom-client.Top == height) break;
        }
        Thread.Sleep(settle);
        Rect final; GetClientRect(hwnd, out final);
        if(final.Right-final.Left != width || final.Bottom-final.Top != height) throw new Exception("Application refused the requested client size; choose a supported width and height");
        using(var bitmap = new Bitmap(width, height, PixelFormat.Format32bppRgb)) {
            using(var graphics = Graphics.FromImage(bitmap)) {
                IntPtr hdc = graphics.GetHdc();
                try { if(!PrintWindow(hwnd, hdc, 3)) throw new Exception("PrintWindow failed; this application's renderer may not support native capture"); }
                finally { graphics.ReleaseHdc(hdc); }
            }
            bitmap.Save(path, ImageFormat.Png);
        }
    }
}
'@
    [NativeFrame]::DpiAware()
    $captureTimer = [Diagnostics.Stopwatch]::StartNew()
    $selectedWindow = [IntPtr]::Zero
    while ($captureTimer.ElapsedMilliseconds -lt $captureOptions.timeout) {
        $selectedWindow = [NativeFrame]::Find([uint32]$captureOptions.rootPid, [string]$captureOptions.title)
        $ready = !$captureOptions.readyFile -or (Test-Path -LiteralPath $captureOptions.readyFile)
        if ($selectedWindow -ne [IntPtr]::Zero -and $ready) { break }
        Start-Sleep -Milliseconds 150
    }
    if ($selectedWindow -eq [IntPtr]::Zero -or !$ready) { throw 'Timed out waiting for a matching native window or readiness file' }
    [NativeFrame]::Save($selectedWindow, [uint32]$captureOptions.rootPid, $captureOptions.width, $captureOptions.height, $captureOptions.delay, $captureOptions.output)
    @{ title = [NativeFrame]::Title($selectedWindow); processId = [NativeFrame]::Owner($selectedWindow); width = $captureOptions.width; height = $captureOptions.height; method = 'PrintWindow'; platform = 'win32' } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
