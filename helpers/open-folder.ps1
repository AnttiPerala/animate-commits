$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $folder = $env:ANIMATE_OPEN_FOLDER
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { throw "Folder is unavailable: $folder" }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FolderWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
}
'@
    $shell = New-Object -ComObject Shell.Application
    function Find-FolderWindow {
        foreach ($window in $shell.Windows()) {
            try {
                $location = $window.Document.Folder.Self.Path
                if ([string]::Equals($location.TrimEnd('\'), $folder.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { return $window }
            } catch { }
        }
    }
    $window = Find-FolderWindow
    if (-not $window) { $shell.Open($folder) }
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        if (-not $window) { $window = Find-FolderWindow }
        if ($window) {
            $handle = [IntPtr]$window.HWND
            [FolderWindow]::ShowWindowAsync($handle, 9) | Out-Null
            [FolderWindow]::SetForegroundWindow($handle) | Out-Null
            if ([FolderWindow]::IsWindowVisible($handle)) { exit 0 }
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Windows did not show the output folder. Open it manually: $folder"
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
