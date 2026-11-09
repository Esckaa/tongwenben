# Build offline zip: extension/ -> dist/tongwenben-<version>.zip
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$OutDir = Join-Path $root 'dist'

$manifestPath = Join-Path $root 'extension\manifest.json'
if (-not (Test-Path $manifestPath)) { throw "manifest not found: $manifestPath" }

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$zip = Join-Path $OutDir ("tongwenben-$version.zip")

if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }

Compress-Archive -Path (Join-Path $root 'extension\*') -DestinationPath $zip -CompressionLevel Optimal

$size = (Get-Item $zip).Length
Write-Output ("ZIP " + $zip + " (" + [math]::Round($size / 1MB, 2) + " MB)")
