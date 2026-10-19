# Rebuild the installed Chroma plugin from this checkout's skins-v2 catalogue.
# Run from PowerShell: .\install\regenerate-windows.ps1
$ErrorActionPreference = 'Stop'

$bundle = Split-Path -Parent $MyInvocation.MyCommand.Path
$hermesHome = if ($env:HERMES_HOME) {
  $env:HERMES_HOME
} else {
  Join-Path $env:LOCALAPPDATA 'hermes'
}
# The catalogue is skins-v2: one file per skin, both palettes. The retired v1
# pair table (skins/) is not valid input and the generator refuses it.
$bundledSkins = Join-Path $bundle '..\skins-v2'
$pluginPath = Join-Path $hermesHome 'desktop-plugins\chroma\plugin.js'
$regenerator = Join-Path $bundle '..\scripts\regenerate.py'
$stagingSkins = Join-Path ([System.IO.Path]::GetTempPath()) "hermes-chroma-skins-$PID"

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
    throw 'Theme Picker regeneration failed; the existing plugin was left unchanged.'
  }
} finally {
  Remove-Item -Path $stagingSkins -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "Rebuilt: $pluginPath" -ForegroundColor Green
Write-Host 'In Hermes Desktop, press Ctrl+K and run: Reload desktop plugins (or restart the app).'
