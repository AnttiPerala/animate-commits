param([ValidateSet('folder','load','save','error')][string]$Kind = 'folder')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
if ($Kind -eq 'error') {
    [System.Windows.Forms.MessageBox]::Show($env:ANIMATE_GUI_MESSAGE, 'Animate Commits', 'OK', 'Error') | Out-Null
    exit
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
try {
    if ($Kind -eq 'folder') {
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
        $dialog.Description = 'Choose a folder for Animate Commits'
        $dialog.ShowNewFolderButton = $true
    } elseif ($Kind -eq 'load') {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Filter = 'Capture configuration (*.json)|*.json'
    } else {
        $dialog = New-Object System.Windows.Forms.SaveFileDialog
        $dialog.Filter = 'Capture configuration (*.json)|*.json'
        $dialog.FileName = 'animate-commits.json'
    }
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        if ($Kind -eq 'folder') { [Console]::Write($dialog.SelectedPath) }
        else { [Console]::Write($dialog.FileName) }
    }
} finally {
    if ($dialog) { $dialog.Dispose() }
    $owner.Dispose()
}
