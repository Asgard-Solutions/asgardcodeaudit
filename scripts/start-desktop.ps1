[CmdletBinding()]
param([switch]$Validate)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}
$major = & node.exe -p 'process.versions.node.split(".")[0]'
if ($LASTEXITCODE -ne 0 -or $major -ne '24') { throw 'Install Node.js 24 before running this script.' }
Get-Command uv -ErrorAction Stop | Out-Null
$keys = @('VITE_ASGARD_MODE', 'ASGARD_PYTHON', 'ASGARD_BACKEND_DIR', 'ASGARD_RENDERER_DIST')
$saved = @{}
foreach ($key in $keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    Push-Location (Join-Path $root 'backend')
    try {
        Invoke-Checked uv @('sync', '--frozen', '--group', 'test', '--python', '3.13')
        if ($Validate) { Invoke-Checked uv @('run', '--frozen', '--group', 'test', 'python', '-m', 'pytest', 'tests/', '--ignore=tests/test_external_preview.py') }
    } finally { Pop-Location }
    Push-Location (Join-Path $root 'frontend')
    try {
        Invoke-Checked npm.cmd @('ci')
        if ($Validate) {
            Invoke-Checked npm.cmd @('test')
            Invoke-Checked node.exe @('--test', 'tests/preview-transport.node.cjs')
        }
        $env:VITE_ASGARD_MODE = 'desktop'
        Invoke-Checked npm.cmd @('run', 'build')
    } finally { Pop-Location }
    Push-Location (Join-Path $root 'desktop')
    try {
        Invoke-Checked npm.cmd @('ci')
        if ($Validate) { Invoke-Checked npm.cmd @('test') }
        Invoke-Checked npm.cmd @('run', 'build')
        $env:ASGARD_PYTHON = (Resolve-Path (Join-Path $root 'backend/.venv/Scripts/python.exe')).Path
        $env:ASGARD_BACKEND_DIR = (Resolve-Path (Join-Path $root 'backend')).Path
        $env:ASGARD_RENDERER_DIST = (Resolve-Path (Join-Path $root 'frontend/dist')).Path
        if ($Validate) { Invoke-Checked node.exe @('tests/run-native-smoke.cjs') }
        else { Invoke-Checked npm.cmd @('start') }
    } finally { Pop-Location }
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
