param(
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [ValidateSet('select','cancel')][string]$Mode = 'select',
    [string]$Folder = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NativeDialogControl {
    [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr parent, int id);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr handle, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr handle);
}
'@
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
if ($null -eq $window) { throw 'The owned native folder dialog was not found in the automation tree.' }
# The title can be exposed by a child provider; walk to its native window owner.
while ($window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
    $parent = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($window)
    if ($null -eq $parent -or $parent.Current.ProcessId -ne $OwnerPid) { break }
    $window = $parent
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
$elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$records = @()
$button = $null
foreach ($item in $elements) {
    $type = $item.Current.ControlType
    $records += @{name=$item.Current.Name; type=$type.ProgrammaticName; id=$item.Current.AutomationId; class=$item.Current.ClassName; handle=$item.Current.NativeWindowHandle}
    if (($item.Current.Name -replace '&','') -eq 'Select Folder' -and ($type -eq [System.Windows.Automation.ControlType]::Button -or $type -eq [System.Windows.Automation.ControlType]::SplitButton)) { $button = $item }
}
[Console]::Error.WriteLine((@{dialog=$window.Current.Name; type=$window.Current.ControlType.ProgrammaticName; controls=$records} | ConvertTo-Json -Depth 4 -Compress))
if ($null -ne $button) {
    $invoke = $null
    if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) { $invoke.Invoke() }
    else { $button.SetFocus(); [System.Windows.Forms.SendKeys]::SendWait(' ') }
    Write-Output 'Native dialog selected the synthetic fixture via its confirmation control.'
    exit 0
}
# Win32 IDOK is the dialog's real default confirmation command. Restrict this
# fallback to the previously verified owned native dialog; no result is mocked.
$handle = [IntPtr]$window.Current.NativeWindowHandle
$confirm = [NativeDialogControl]::GetDlgItem($handle, 1)
if ($confirm -eq [IntPtr]::Zero -or -not [NativeDialogControl]::IsWindowEnabled($confirm)) { throw 'The owned native dialog has no enabled confirmation control.' }
[NativeDialogControl]::SendMessage($confirm, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Write-Output 'Native dialog selected the synthetic fixture via its Win32 confirmation command.'
