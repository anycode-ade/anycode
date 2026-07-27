param(
    [string]$Version = $env:ANYCODE_VERSION,
    [string]$InstallDir = $env:ANYCODE_INSTALL_DIR,
    [string]$Repo = $(if ($env:ANYCODE_REPO) { $env:ANYCODE_REPO } else { "anycode-ade/anycode" }),
    [string]$ArchivePath = $env:ANYCODE_ARCHIVE_PATH
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = "latest"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $HOME "AppData\Local\anycode\bin"
}

function Get-WindowsArchitecture {
    $runtimeType = [System.Type]::GetType("System.Runtime.InteropServices.RuntimeInformation")
    if ($null -ne $runtimeType) {
        $osArchProperty = $runtimeType.GetProperty("OSArchitecture")
        if ($null -ne $osArchProperty) {
            return $osArchProperty.GetValue($null).ToString()
        }
    }

    $processArch = $env:PROCESSOR_ARCHITEW6432
    if ([string]::IsNullOrWhiteSpace($processArch)) {
        $processArch = $env:PROCESSOR_ARCHITECTURE
    }

    switch ($processArch.ToUpperInvariant()) {
        "AMD64" { return "X64" }
        "X86" { return "X86" }
        "ARM64" { return "Arm64" }
        default { return $processArch }
    }
}

$arch = Get-WindowsArchitecture
switch ($arch) {
    "X64" { $asset = "anycode-windows-x86_64.zip" }
    "Arm64" { throw "Windows ARM64 releases are not published yet. Build from source instead." }
    default {
        throw "Unsupported Windows architecture: $arch"
    }
}

if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
    if ($Version -eq "latest") {
        $downloadUrl = "https://github.com/$Repo/releases/latest/download/$asset"
    } else {
        $downloadUrl = "https://github.com/$Repo/releases/download/$Version/$asset"
    }
} else {
    $ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
    if (-not (Test-Path $ArchivePath)) {
        throw "Archive not found: $ArchivePath"
    }
}

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("anycode-install-" + [System.Guid]::NewGuid().ToString("N"))
$tempArchivePath = Join-Path $tmpRoot $asset
$extractDir = Join-Path $tmpRoot "extract"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

try {
    if ([string]::IsNullOrWhiteSpace($ArchivePath)) {
        Write-Host "Downloading $asset from $downloadUrl"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempArchivePath
    } else {
        Write-Host "Using local archive $ArchivePath"
        Copy-Item -Path $ArchivePath -Destination $tempArchivePath -Force
    }

    Expand-Archive -Path $tempArchivePath -DestinationPath $extractDir -Force

    $sourceExe = Join-Path $extractDir "anycode.exe"
    if (-not (Test-Path $sourceExe)) {
        throw "Archive did not contain expected binary: anycode.exe"
    }

    $installExe = Join-Path $InstallDir "anycode.exe"
    Copy-Item -Path $sourceExe -Destination $installExe -Force

    Write-Host "Installed anycode to $installExe"

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathEntries = @()
    if (-not [string]::IsNullOrWhiteSpace($userPath)) {
        $pathEntries = $userPath.Split(';', [System.StringSplitOptions]::RemoveEmptyEntries)
    }

    $pathContainsInstallDir = $pathEntries | Where-Object { $_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\') }
    if (-not $pathContainsInstallDir) {
        $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) {
            $InstallDir
        } else {
            "$userPath;$InstallDir"
        }

        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
        $env:Path = "$env:Path;$InstallDir"

        Write-Host "Added $InstallDir to the user PATH."
        Write-Host "Open a new terminal to use 'anycode'."
    } else {
        Write-Host "$InstallDir is already in PATH."
    }
} finally {
    if (Test-Path $tmpRoot) {
        Remove-Item -LiteralPath $tmpRoot -Recurse -Force
    }
}
