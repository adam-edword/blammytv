# One-command signed release build (see RELEASING.md for the publish steps).
#
#   .\scripts\release.ps1
#
# Prompts for the signing-key password (never echoed, never in history),
# builds the signed NSIS installer, and puts the .sig on the clipboard —
# ready to paste into the session that writes latest.json. Everything runs
# in THIS shell, in ONE build, so the exe and its signature can never come
# from different builds (the mismatch that broke the first 0.2.x update).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$keyPath = Join-Path $HOME ".tauri\blammytv.key"
if (-not (Test-Path $keyPath)) {
    Write-Error "Signing key not found at $keyPath — see RELEASING.md one-time setup."
}

$secure = Read-Host "Signing key password" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyPath -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
    [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure))

$version = (Get-Content (Join-Path $root "apps\app\src-tauri\tauri.conf.json") | ConvertFrom-Json).version
Write-Host "Building BlammyTV v$version (signed, NSIS)..." -ForegroundColor Cyan

Push-Location (Join-Path $root "apps\app")
try {
    pnpm tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw "build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
    # Wipe the secrets from the environment the moment the build is done.
    $env:TAURI_SIGNING_PRIVATE_KEY = ""
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
}

$bundle = Join-Path $root "apps\app\src-tauri\target\release\bundle\nsis"
$exe = Join-Path $bundle "BlammyTV_${version}_x64-setup.exe"
$sig = "$exe.sig"
if (-not (Test-Path $sig)) {
    Write-Error "No .sig next to the exe — the build was NOT signed. Wrong password?"
}

Get-Content $sig -Raw | Set-Clipboard
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Installer: $exe"
Write-Host "  Signature: copied to clipboard — paste it to the session."
Write-Host "  Next: draft release v$version (NEW tag, tick 'Set as the latest release'),"
Write-Host "        upload the exe, paste the sig, attach the latest.json you get back."
