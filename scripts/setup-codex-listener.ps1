[CmdletBinding()]
param([switch]$Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$release = '0.154.0'
$installerCommit = '6b9826e3aa83b1a5947db50f4332cb9c65f1b340'
$installerHash = '391f247de2c70c7e99041979ec02dae7e76be27ac9cfc1dfe7c1eb21d48d8b97'
$installerUrl = "https://raw.githubusercontent.com/openai/codex/$installerCommit/scripts/install/install.ps1"

if ($env:OS -ne 'Windows_NT') { throw 'This setup supports Windows only.' }
$profilePath = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    Join-Path $env:USERPROFILE '.codex'
} else { $env:CODEX_HOME }
if (-not [IO.Path]::IsPathRooted($profilePath)) { throw 'CODEX_HOME must be an absolute local path.' }
$profilePath = [IO.Path]::GetFullPath($profilePath)
if ($profilePath.StartsWith('\\')) { throw 'Use a local CODEX_HOME, not a network share.' }

function Find-ManagedCodex {
    $current = Join-Path $profilePath 'packages\standalone\current'
    foreach ($candidate in @((Join-Path $current 'bin\codex.exe'), (Join-Path $current 'codex.exe'))) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

$managed = Find-ManagedCodex
$socket = Join-Path $profilePath 'app-server-control\app-server-control.sock'
$settingsPath = Join-Path $profilePath 'app-server-daemon\settings.json'
$remoteControl = $false
if (Test-Path -LiteralPath $settingsPath) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    if ($settings.remoteControlEnabled -isnot [bool]) { throw 'Invalid daemon remote-control setting; no changes made.' }
    $remoteControl = $settings.remoteControlEnabled
}
$plan = [ordered]@{
    mode = if ($Apply) { 'apply' } else { 'preview' }
    supportedCodexVersion = $release
    codexHome = $profilePath
    managedExecutable = $managed
    standaloneInstallationNeeded = ($null -eq $managed)
    installerUrl = $installerUrl
    installerSha256 = $installerHash
    userPathWillChangeOnInstallation = ($null -eq $managed)
    existingNpmInstallWillBeKept = $true
    remoteControlEnabled = $remoteControl
    localOnlyCompatible = (-not $remoteControl)
    socketPath = $socket
    automaticUpdaterRequested = $false
    windowsAutostartRequested = $false
    commands = @('codex app-server daemon start', 'codex app-server daemon version', 'codex app-server daemon stop')
    launchRequirement = 'A normal non-administrator PowerShell outside an agent tool shell; the host must allow detached processes.'
}
if (-not $Apply) {
    $plan | ConvertTo-Json -Depth 4
    return
}

# Refuse incompatible existing state before any download or profile/PATH change.
if ($remoteControl) { throw 'Remote control is already enabled. This local-only setup leaves that setting unchanged and will not start the daemon.' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this setup from a normal non-administrator PowerShell.'
}
if ([Text.Encoding]::UTF8.GetByteCount($socket) + 1 -gt 108) {
    throw 'The control socket path exceeds the Windows AF_UNIX limit. Use a shorter real CODEX_HOME; do not use a junction workaround.'
}

if ($null -eq $managed) {
    $temporaryParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $temporary = Join-Path $temporaryParent ('asm-listener-setup-' + [Guid]::NewGuid().ToString('N'))
    $temporary = [IO.Path]::GetFullPath($temporary)
    if (-not $temporary.StartsWith($temporaryParent.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary installer directory escaped the expected parent.'
    }
    $null = New-Item -ItemType Directory -Path $temporary
    $savedNonInteractive = [Environment]::GetEnvironmentVariable('CODEX_NON_INTERACTIVE', 'Process')
    try {
        $installer = Join-Path $temporary 'install.ps1'
        Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installer -TimeoutSec 60
        $actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $installerHash) { throw 'Pinned installer checksum mismatch; the installer was not executed.' }
        $env:CODEX_NON_INTERACTIVE = '1'
        $powerShell = Join-Path $PSHOME $(if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' })
        & $powerShell -NoProfile -File $installer -Release $release
        if ($LASTEXITCODE -ne 0) { throw "Standalone installer failed (exit $LASTEXITCODE)." }
    } finally {
        [Environment]::SetEnvironmentVariable('CODEX_NON_INTERACTIVE', $savedNonInteractive, 'Process')
        # This is the fresh, validated directory above; never delete install/profile directories.
        Remove-Item -LiteralPath $temporary -Recurse -Force
    }
    $managed = Find-ManagedCodex
    if ($null -eq $managed) { throw 'The installer did not create the expected managed executable.' }
}

$versionOutput = & $managed --version
if ($LASTEXITCODE -ne 0 -or ($versionOutput -join '').Trim() -ne "codex-cli $release") {
    throw "The managed version differs from the verified $release. It was not replaced or started."
}
# Upstream start is idempotent and does not run bootstrap, an updater, or Windows autostart.
$startOutput = & $managed app-server daemon start
if ($LASTEXITCODE -ne 0) {
    throw 'Daemon start failed. If Windows reports a Job Object restriction, rerun this command in an ordinary non-administrator PowerShell outside the app.'
}
$start = ($startOutput -join [Environment]::NewLine) | ConvertFrom-Json
$versionOutput = & $managed app-server daemon version
if ($LASTEXITCODE -ne 0) { throw 'Daemon start returned, but its version handshake failed.' }
$running = ($versionOutput -join [Environment]::NewLine) | ConvertFrom-Json
[ordered]@{
    status = $start.status
    managedExecutable = $managed
    socketPath = $start.socketPath
    appServerVersion = $running.appServerVersion
    backend = if ($running.PSObject.Properties['backend']) { $running.backend } else { $null }
    nextStep = 'Open a new Codex CLI normally. Existing embedded sessions must exit before codex resume. After a Windows restart, run daemon start again.'
} | ConvertTo-Json -Depth 4

