param(
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [ValidateSet('select','cancel')][string]$Mode = 'select',
    [string]$Folder = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
$title = 'Choose a source folder to register'
$condition = New-Object System.Windows.Automation.AndCondition(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $title)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $OwnerPid))
)
$deadline = [DateTime]::UtcNow.AddSeconds(15)
$window = $null
while ([DateTime]::UtcNow -lt $deadline) {
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
    if ($null -ne $window) { break }
    Start-Sleep -Milliseconds 100
}
if ($null -eq $window) { throw 'The owned native folder dialog did not appear.' }
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($title)) { throw 'Could not focus the native folder dialog.' }
Start-Sleep -Milliseconds 200
if ($Mode -eq 'cancel') {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Write-Output 'Native dialog cancelled.'
    exit 0
}
if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { throw 'Synthetic fixture folder does not exist.' }
# SendKeys metacharacters are intentionally disallowed in this test-only fixture.
if ($Folder -match '[+^%~(){}\[\]]') { throw 'Unsupported metacharacter in the synthetic dialog fixture.' }
[System.Windows.Forms.SendKeys]::SendWait('^l')
[System.Windows.Forms.SendKeys]::SendWait($Folder)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 800
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Select Folder')
$button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
if ($null -eq $button) { throw 'The Select Folder button was not found.' }
$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Write-Output 'Native dialog selected the synthetic fixture.'
