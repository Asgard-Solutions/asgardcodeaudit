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
$nameCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $title)
$processCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $OwnerPid)
$condition = [System.Windows.Automation.AndCondition]::new($nameCondition, $processCondition)
$deadline = [DateTime]::UtcNow.AddSeconds(12)
$window = $null
while ([DateTime]::UtcNow -lt $deadline) {
    $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $window) { break }
    Start-Sleep -Milliseconds 100
}
if ($null -eq $window) {
    $top = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $records = @()
    foreach ($item in $top) {
        $records += @{name=$item.Current.Name; process=$item.Current.ProcessId; class=$item.Current.ClassName; handle=$item.Current.NativeWindowHandle}
    }
    $owned = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $processCondition)
    $ownedNames = @()
    foreach ($item in $owned) { $ownedNames += @{name=$item.Current.Name; type=$item.Current.ControlType.ProgrammaticName; class=$item.Current.ClassName} }
    [Console]::Error.WriteLine((@{owner=$OwnerPid; windows=$records; owned=$ownedNames} | ConvertTo-Json -Depth 5 -Compress))
    throw 'The owned native folder dialog was not found in the automation tree.'
}
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($OwnerPid)) { throw 'Could not focus the owner of the native folder dialog.' }
Start-Sleep -Milliseconds 200
if ($Mode -eq 'cancel') {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Write-Output 'Native dialog cancelled.'
    exit 0
}
if (-not (Test-Path -LiteralPath $Folder -PathType Container)) { throw 'Synthetic fixture folder does not exist.' }
if ($Folder -match '[+^%~(){}\[\]]') { throw 'Unsupported metacharacter in the synthetic dialog fixture.' }
[System.Windows.Forms.SendKeys]::SendWait('^l')
[System.Windows.Forms.SendKeys]::SendWait($Folder)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 800
$buttonCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Select Folder')
$button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
if ($null -eq $button) { throw 'The Select Folder button was not found.' }
$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Write-Output 'Native dialog selected the synthetic fixture.'
