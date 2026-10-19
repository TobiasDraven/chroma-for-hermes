# Installs Theme Picker into the active Windows Hermes home.
#
# The repo root IS the plugin package now:
#     desktop/plugin.js        <- the desktop UI half
#     dashboard/manifest.json  <- the Python backend
#     dashboard/plugin_api.py
#
# The Desktop app COPIES a package's desktop half out of
# <hermes home>/plugins/<name>/desktop/ into <hermes home>/desktop-plugins/<name>/
# by itself, and — when the package folder is a symlink — re-syncs on every save.
# So installing is just placing this folder at <hermes home>/plugins/chroma.
#
# Modes:
#   -Link (default on Windows when run as admin) : junction to this checkout (dev)
#   -Copy                                        : copy the package (stable install)
param(
  [switch]$Copy
)

$ErrorActionPreference = 'Stop'

# This file lives in <repo>/install/, so the package root is one level up.
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$desktopHome = Join-Path $env:LOCALAPPDATA 'hermes'
$cliHome = Join-Path $env:USERPROFILE '.hermes'
$hermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } elseif (Test-Path $desktopHome) { $desktopHome } else { $cliHome }

$pluginsRoot = Join-Path $hermesHome 'plugins'
$target = Join-Path $pluginsRoot 'chroma'

New-Item -ItemType Directory -Force -Path $pluginsRoot | Out-Null

if (Test-Path -LiteralPath $target) {
  Write-Host "Removing existing '$target' first (kept nothing)." -ForegroundColor Yellow
  Remove-Item -LiteralPath $target -Recurse -Force
}

if ($Copy) {
  # The manifest is not optional: Hermes refuses a plugin directory without
  # plugin.yaml, and the licence and notices must travel with the copy.
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  foreach ($item in @('desktop', 'dashboard', 'plugin.yaml', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md')) {
    $from = Join-Path $repo $item
    if (-not (Test-Path -LiteralPath $from)) {
      Write-Host "WARNING: '$item' is missing from the package; the copy is incomplete." -ForegroundColor Yellow
      continue
    }
    if ((Get-Item -LiteralPath $from).PSIsContainer) {
      Copy-Item -LiteralPath $from -Destination $target -Recurse -Force
    } else {
      Copy-Item -LiteralPath $from -Destination $target -Force
    }
  }
  Write-Host "Copied the package to: $target" -ForegroundColor Green
} else {
  # A junction needs no admin rights and the app follows it (listDirs followLinks).
  $null = New-Item -ItemType Junction -Path $target -Target $repo
  Write-Host "Linked $target -> $repo" -ForegroundColor Green
  Write-Host 'Editing the checkout and saving now hot-reloads the pane.'
}

Write-Host ''
Write-Host 'REMAINING STEP:' -ForegroundColor Yellow
Write-Host ' Restart Hermes Desktop once so the Python backend mounts.'
Write-Host ' (Then Capabilities -> Plugins -> Rescan if the row does not appear.)'
Write-Host ''
Write-Host 'If you previously installed by hand, delete the stale folder:' -ForegroundColor Yellow
Write-Host "   $hermesHome\desktop-plugins\chroma"