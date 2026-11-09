# 把扩展真正加载进无头 Edge，访问本地 HTTP 页面，验证 content script 在真实扩展环境里的行为。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File test/run-ext.ps1
param(
  [string]$Edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  [string]$Url = "http://127.0.0.1:8765/test/ext.html"
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ext = Join-Path (Split-Path -Parent $here) 'extension'
$taskRoot = Split-Path -Parent $here
$wsRoot = Split-Path -Parent (Split-Path -Parent $taskRoot)
$tmp = Join-Path $wsRoot '.dsh\tmp\sts-test'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$profile = Join-Path $tmp ("ext-" + [guid]::NewGuid().ToString('N'))

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
  '--virtual-time-budget=9000',
  ('--load-extension="' + $ext + '"'),
  ('--disable-extensions-except="' + $ext + '"'),
  ('--user-data-dir="' + $profile + '"'),
  '--dump-dom',
  $Url
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
$proc.WaitForExit(60000) | Out-Null

$hostLine = [regex]::Match($stdout, 'HOST\s+(YES|NO)')
$allLine = [regex]::Match($stdout, 'ALL\s+(-?\d+)')
$activeLine = [regex]::Match($stdout, 'ACTIVE\s+(YES|NO)')

"HOST: " + $(if ($hostLine.Success) { $hostLine.Groups[1].Value } else { 'unknown' })
"ALL: " + $(if ($allLine.Success) { $allLine.Groups[1].Value } else { 'unknown' })
"ACTIVE: " + $(if ($activeLine.Success) { $activeLine.Groups[1].Value } else { 'unknown' })

if ($hostLine.Success -and $hostLine.Groups[1].Value -eq 'YES' -and
    $allLine.Success -and $allLine.Groups[1].Value -eq '3') {
  Write-Output 'RESULT: OK'
  exit 0
}

Write-Output ('RESULT: FAILED (exit=' + $proc.ExitCode + ', stdout=' + $stdout.Length + ')')
if ($stderr) {
  Write-Output '--- stderr tail ---'
  Write-Output ($stderr -split "`r?`n" | Select-Object -Last 15)
}
exit 1
