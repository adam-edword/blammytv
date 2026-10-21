# One-command signed release build (see RELEASING.md for the publish steps).
#
#   .\scripts\release.ps1
#
# Prompts for the signing-key password and the Azure client secret (never
# echoed, never in history), builds the NSIS installer code-signed by Azure
# Artifact Signing (SIGNING.md), and puts the update .sig on the clipboard -
# ready to paste into the session that writes latest.json. Everything runs
# in THIS shell, in ONE build, so the exe and its signature can never come
# from different builds (the mismatch that broke the first 0.2.x update).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$keyPath = Join-Path $HOME ".tauri\blammytv.key"
if (-not (Test-Path $keyPath)) {
    Write-Error "Signing key not found at $keyPath - see RELEASING.md one-time setup."
}

# Code signing. artifact-signing-cli logs in with the Azure CLI, then signs
# with the Windows SDK's signtool, which the .NET runtime's signing client
# plugs into. All of it is checked here, before any password is asked for,
# so a missing piece costs seconds and not a build.
if (-not (Get-Command artifact-signing-cli -ErrorAction SilentlyContinue)) {
    Write-Error "artifact-signing-cli not found - run: cargo install artifact-signing-cli"
}
if (-not $env:AZURE_CLI_PATH) { $env:AZURE_CLI_PATH = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd" }
if (-not (Test-Path $env:AZURE_CLI_PATH)) {
    Write-Error "Azure CLI not found at $env:AZURE_CLI_PATH - run: winget install -e --id Microsoft.AzureCLI"
}
$runtimes = if (Get-Command dotnet -ErrorAction SilentlyContinue) { & dotnet --list-runtimes } else { @() }
if (-not ($runtimes -match "^Microsoft\.NETCore\.App ([89]|[1-9]\d)\.")) {
    Write-Error ".NET 8 or later not found - run: winget install -e --id Microsoft.DotNet.Runtime.8"
}
if (-not $env:SIGNTOOL_PATH) {
    $env:SIGNTOOL_PATH = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object { $_.Directory.Parent.Name -as [version] } -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $env:SIGNTOOL_PATH -or -not (Test-Path $env:SIGNTOOL_PATH)) {
    Write-Error "signtool.exe not found - install the Windows SDK (its signing tools), or set SIGNTOOL_PATH."
}
# The bundler runs signtool too, to see what's already signed.
$env:TAURI_WINDOWS_SIGNTOOL_PATH = $env:SIGNTOOL_PATH

# The app registration's ids aren't secret but they are this account's, so
# they live beside the update key, outside the repo. Asked for once.
$azIdsPath = Join-Path $HOME ".tauri\azure-signing.json"
if (-not (Test-Path $azIdsPath)) {
    @{
        clientId = (Read-Host "Azure application (client) ID")
        tenantId = (Read-Host "Azure directory (tenant) ID")
    } | ConvertTo-Json | Set-Content $azIdsPath
}
$azIds = Get-Content $azIdsPath -Raw | ConvertFrom-Json

$secure = Read-Host "Signing key password" -AsSecureString
$azSecret = Read-Host "Azure client secret" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyPath -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
    [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure))
$env:AZURE_CLIENT_ID = $azIds.clientId
$env:AZURE_TENANT_ID = $azIds.tenantId
$env:AZURE_CLIENT_SECRET = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
    [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($azSecret))

$version = (Get-Content (Join-Path $root "apps\app\src-tauri\tauri.conf.json") | ConvertFrom-Json).version
Write-Host "Building BlammyTV v$version (signed, NSIS)..." -ForegroundColor Cyan

Push-Location (Join-Path $root "apps\app")
try {
    # The signing config is merged in here and not kept in tauri.windows.conf.json,
    # so a plain `pnpm tauri build` without the Azure setup still builds.
    pnpm tauri build --bundles nsis --config src-tauri/tauri.signing.json
    if ($LASTEXITCODE -ne 0) { throw "build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
    # Wipe the secrets from the environment the moment the build is done.
    $env:TAURI_SIGNING_PRIVATE_KEY = ""
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
    $env:AZURE_CLIENT_SECRET = ""
    # artifact-signing-cli signed the app registration in to the Azure CLI; don't leave it there.
    try { & $env:AZURE_CLI_PATH logout --username $env:AZURE_CLIENT_ID 2>$null | Out-Null } catch {}
}

$bundle = Join-Path $root "apps\app\src-tauri\target\release\bundle\nsis"
$exe = Join-Path $bundle "BlammyTV_${version}_x64-setup.exe"
$sig = "$exe.sig"
if (-not (Test-Path $sig)) {
    Write-Error "No .sig next to the exe - the build was NOT signed. Wrong password?"
}

# A signCommand that never ran still builds an installer, unsigned, with a
# valid .sig beside it (SIGNING.md). So the installer itself is checked.
$auth = Get-AuthenticodeSignature $exe
if ($auth.Status -ne "Valid") {
    Write-Error "The installer is NOT code-signed ($($auth.Status)). Look above for 'Signing ... with a custom signing command' lines."
}
if (-not $auth.TimeStamperCertificate) {
    Write-Error "The installer is signed but NOT timestamped, so it would stop validating within days. Don't publish it."
}

Get-Content $sig -Raw | Set-Clipboard
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Installer: $exe"
Write-Host "  Code-signed by: $($auth.SignerCertificate.Subject)"
Write-Host "  Signature: copied to clipboard - paste it to the session."
Write-Host "  Next: draft release v$version (NEW tag, tick 'Set as the latest release'),"
Write-Host "        upload the exe, paste the sig, attach the latest.json you get back."
