[CmdletBinding()]
param([switch]$Validate)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
function Invoke-Checked {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}
$nodeVersion = & node.exe --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw 'Install Node.js 24 before running this script.' }
Get-Command uv -ErrorAction Stop | Out-Null
$keys = @('VITE_ASGARD_MODE', 'ASGARD_PYTHON', 'ASGARD_BACKEND_DIR', 'ASGARD_RENDERER_DIST')
$saved = @{}
foreach ($key in $keys) { $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    Push-Location (Join-Path $root 'backend')
    try {
        Invoke-Checked -Executable uv -Arguments @('sync', '--frozen', '--group', 'test', '--python', '3.13')
        if ($Validate) { Invoke-Checked -Executable uv -Arguments @('run', '--frozen', '--group', 'test', 'python', '-m', 'pytest', 'tests/', '--ignore=tests/test_external_preview.py') }
    } finally { Pop-Location }
    Push-Location (Join-Path $root 'frontend')
    try {
        Invoke-Checked -Executable npm.cmd -Arguments @('ci')
        if ($Validate) { Invoke-Checked -Executable npm.cmd -Arguments @('test') }
        $env:VITE_ASGARD_MODE = 'desktop'
        Invoke-Checked -Executable npm.cmd -Arguments @('run', 'build')
    } finally { Pop-Location }
    Push-Location (Join-Path $root 'desktop')
    try {
        Invoke-Checked -Executable npm.cmd -Arguments @('ci')
        if ($Validate) { Invoke-Checked -Executable npm.cmd -Arguments @('test') }
        Invoke-Checked -Executable npm.cmd -Arguments @('run', 'build')
        $env:ASGARD_PYTHON = (Resolve-Path (Join-Path $root 'backend/.venv/Scripts/python.exe')).Path
        $env:ASGARD_BACKEND_DIR = (Resolve-Path (Join-Path $root 'backend')).Path
        $env:ASGARD_RENDERER_DIST = (Resolve-Path (Join-Path $root 'frontend/dist')).Path
        if ($Validate) { Invoke-Checked -Executable node.exe -Arguments @('tests/run-native-smoke.cjs') }
        else { Invoke-Checked -Executable npm.cmd -Arguments @('start') }
    } finally { Pop-Location }
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
}
