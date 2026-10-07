param([switch]$Close)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$count = 0
foreach ($window in $shell.Windows()) {
    try {
        if ([string]::Equals($window.Document.Folder.Self.Path.TrimEnd('\'), $env:ANIMATE_TEST_FOLDER.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
            $count++
            if ($Close) { $window.Quit() }
        }
    } catch { }
}
[Console]::Write($count)
