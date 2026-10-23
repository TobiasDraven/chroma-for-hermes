# Rebuild the installed Chroma plugin from this checkout's skins-v2 catalogue.
# Run from PowerShell: .\chroma\install\regenerate-windows.ps1
$ErrorActionPreference = 'Stop'

$bundle = Split-Path -Parent $MyInvocation.MyCommand.Path
# This file lives in <checkout>/chroma/install/. The checkout root - which
# holds skins-v2/ and scripts/ - is two directories above install/.
$checkout = Split-Path -Parent (Split-Path -Parent $bundle)
$hermesHome = if ($env:HERMES_HOME) {
  $env:HERMES_HOME
} else {
  Join-Path $env:LOCALAPPDATA 'hermes'
}
# The catalogue is skins-v2: one file per skin, both palettes. The retired v1
# pair table (skins/) is not valid input and the generator refuses it.
$bundledSkins = Join-Path $checkout 'skins-v2'
$pluginPath = Join-Path $hermesHome 'desktop-plugins\chroma\plugin.js'
$regenerator = Join-Path $checkout 'scripts\regenerate.py'
$stagingSkins = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-chroma-skins-$PID"

# An installed copy is sparse-cloned from chroma/ and has no skins-v2/ or
# scripts/; regeneration is a checkout-only operation.
if (-not (Test-Path -LiteralPath $bundledSkins -PathType Container)) {
  throw "This script rebuilds from a source checkout and cannot run from an installed copy. Missing: $bundledSkins"
}
if (-not (Test-Path -LiteralPath $regenerator -PathType Leaf)) {
  throw "This script rebuilds from a source checkout and cannot run from an installed copy. Missing: $regenerator"
}

if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
  throw 'Python launcher (py) was not found. Install Python 3, then run this script again.'
}

& py -c 'import yaml'
if ($LASTEXITCODE -ne 0) {
  throw 'PyYAML is required. Install it for this Python with: py -m pip install --user PyYAML'
}

try {
  New-Item -ItemType Directory -Force -Path $stagingSkins | Out-Null
  Copy-Item -Path (Join-Path $bundledSkins '*.yaml') -Destination $stagingSkins -Force

  # Gateway skins are mode-locked transports, not catalogue skins: they are not
  # merged here. The build needs skins-v2 input only.

  & py $regenerator $stagingSkins $pluginPath
  if ($LASTEXITCODE -ne 0) {
    throw 'Chroma regeneration failed; the existing plugin was left unchanged.'
  }
} finally {
  Remove-Item -Path $stagingSkins -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Rebuilt: $pluginPath" -ForegroundColor Green
Write-Host 'In Hermes Desktop, press Ctrl+K and run: Reload desktop plugins (or restart the app).'
