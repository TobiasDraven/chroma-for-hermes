# Installs Theme Picker (v2) into the active Windows Hermes home.
# Theme Picker is now a UNIFIED plugin: a desktop UI half AND a Python backend.
$ErrorActionPreference = 'Stop'

$bundle = Split-Path -Parent $MyInvocation.MyCommand.Path

# Support both layouts:
# - a source checkout: <repo>\plugin\plugin.js + <repo>\dashboard\*
# - a distributable bundle: <bundle>\theme-picker\{plugin.js, dashboard\*}
$checkoutPlugin = Join-Path (Split-Path -Parent $bundle) 'plugin\plugin.js'
$bundledPlugin = Join-Path $bundle 'theme-picker\plugin.js'
$checkoutDash = Join-Path (Split-Path -Parent $bundle) 'dashboard'
$bundledDash = Join-Path $bundle 'theme-picker\dashboard'
$sourcePlugin = if (Test-Path -LiteralPath $checkoutPlugin) { $checkoutPlugin } elseif (Test-Path -LiteralPath $bundledPlugin) { $bundledPlugin } else { throw "Theme Picker desktop file not found (expected '$checkoutPlugin' or '$bundledPlugin')." }
$sourceDash = if (Test-Path -LiteralPath $checkoutDash) { $checkoutDash } elseif (Test-Path -LiteralPath $bundledDash) { $bundledDash } else { throw "Theme Picker dashboard folder not found (expected '$checkoutDash' or '$bundledDash')." }

$desktopHome = Join-Path $env:LOCALAPPDATA 'hermes'
$cliHome = Join-Path $env:USERPROFILE '.hermes'
$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } elseif (Test-Path $desktopHome) { $desktopHome } else { $cliHome }

# Desktop UI (kept under desktop-plugins AND plugins/<id>/desktop so both runtime
# doors discover it — see runtime-loader.ts: the desktop half may live at either).
$pluginDir = Join-Path $hermesHome 'desktop-plugins\theme-picker'
$unifiedRoot = Join-Path $hermesHome 'plugins\theme-picker'
$desktopDir   = Join-Path $unifiedRoot 'desktop'
$dashboardDir = Join-Path $unifiedRoot 'dashboard'
New-Item -ItemType Directory -Force -Path $pluginDir, $desktopDir, $dashboardDir | Out-Null
Copy-Item -LiteralPath $sourcePlugin -Destination (Join-Path $pluginDir 'plugin.js') -Force
Copy-Item -LiteralPath $sourcePlugin -Destination (Join-Path $desktopDir 'plugin.js') -Force
Get-ChildItem -LiteralPath $sourceDash -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $dashboardDir -Force
}

Write-Host ''
Write-Host "Installed Theme Picker into: $unifiedRoot" -ForegroundColor Green
Write-Host '  Desktop UI : desktop\plugin.js (in desktop-plugins too, for the rescan path)'
Write-Host '  Backend    : dashboard\manifest.json + plugin_api.py'
Write-Host ''
Write-Host 'REMAINING STEPS (Python backend mounts only at startup):' -ForegroundColor Yellow
Write-Host " 1) Ensure config.yaml lists 'theme-picker' under plugins.enabled."
Write-Host ' 2) Fully quit and restart Hermes Desktop on the running machine.'
Write-Host ' 3) Ctrl+K -> Reload desktop plugins.'