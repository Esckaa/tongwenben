# 用无头 Edge 跑 test/harness.html，打印 PASS/FAIL 行。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File test/run-harness.ps1
param(
  [string]$Edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  [string]$Page = "harness.html"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Edge)) {
  Write-Output "EDGE NOT FOUND: $Edge"
  exit 2
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$page = Join-Path $here $Page
$uri = ([System.Uri]$page).AbsoluteUri
$taskRoot = Split-Path -Parent $here
$wsRoot = Split-Path -Parent (Split-Path -Parent $taskRoot)
$tmp = Join-Path $wsRoot '.dsh\tmp\sts-test'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$profile = Join-Path $tmp ("profile-" + [guid]::NewGuid().ToString('N'))

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Edge
$psi.Arguments = @(
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-crashpad',
  '--disable-breakpad',
  '--no-first-run',
  '--no-default-browser-check',
  '--virtual-time-budget=6000',
  ('--user-data-dir="' + $profile + '"'),
  '--dump-dom',
  ('"' + $uri + '"')
) -join ' '
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

$proc = [System.Diagnostics.Process]::Start($psi)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit(90000) | Out-Null

try {
  Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue
} catch { }

$matched = $stdout -split "`r?`n" | Where-Object { $_ -match '^(PASS|FAIL|ALL PASS|FAILURES)' }
foreach ($line in $matched) { Write-Output $line }

if ($stdout -match 'ALL PASS') {
  Write-Output 'RESULT: OK'
  exit 0
}

Write-Output ('RESULT: FAILED (exit=' + $proc.ExitCode + ', stdout=' + $stdout.Length + ' chars)')
if ($stderr) {
  Write-Output '--- stderr tail ---'
  Write-Output ($stderr -split "`r?`n" | Select-Object -Last 12)
}
exit 1
