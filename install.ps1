#!/usr/bin/env pwsh

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
  throw "This installer is for Windows only. Use install.sh on macOS or Linux."
}

[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$repo = if ($env:AGENTOS_REPO) { $env:AGENTOS_REPO } else { "SapienXai/AgentOS" }
$installRoot = if ($env:AGENTOS_INSTALL_ROOT) { [System.IO.Path]::GetFullPath($env:AGENTOS_INSTALL_ROOT) } else { [System.IO.Path]::Combine($HOME, ".agentos") }
$binDir = if ($env:AGENTOS_BIN_DIR) { [System.IO.Path]::GetFullPath($env:AGENTOS_BIN_DIR) } else { [System.IO.Path]::Combine($HOME, ".local", "bin") }
$requestedVersion = if ($env:AGENTOS_VERSION) { $env:AGENTOS_VERSION } else { "latest" }
$assetPlatform = "win32"
$assetArch = switch ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture) {
  ([System.Runtime.InteropServices.Architecture]::X64) { "x64" }
  default {
    throw "Windows installer currently supports x64 only. Detected $([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture)."
  }
}

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Assert-NodeVersion {
  Require-Command "node"

  & node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 9) ? 0 : 1);'

  if ($LASTEXITCODE -ne 0) {
    throw "AgentOS requires Node.js 20.9 or newer."
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$Target
  )

  Invoke-WebRequest -Uri $Url -OutFile $Target -ErrorAction Stop | Out-Null
}

function Verify-Checksum {
  param(
    [string]$ChecksumFile,
    [string]$ArtifactFile
  )

  $checksumLine = (Get-Content -LiteralPath $ChecksumFile -Raw).Trim()

  if (-not $checksumLine) {
    throw "Checksum file is empty: $ChecksumFile"
  }

  $checksumParts = $checksumLine -split "\s+"

  if ($checksumParts.Length -lt 2) {
    throw "Malformed checksum file: $ChecksumFile"
  }

  $expectedHash = $checksumParts[0]
  $expectedName = $checksumParts[$checksumParts.Length - 1]
  $actualName = [System.IO.Path]::GetFileName($ArtifactFile)

  if ($expectedName -ne $actualName) {
    throw "Checksum file does not match $actualName."
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArtifactFile).Hash

  if ($actualHash.ToLowerInvariant() -ne $expectedHash.ToLowerInvariant()) {
    throw "SHA-256 verification failed for $ArtifactFile."
  }
}

function Print-Completion {
  param([string]$LauncherPath)

  Write-Host "Installed AgentOS to $installRoot\package"
  Write-Host "Launcher: $LauncherPath"
  Write-Host "Try: agentos doctor"
  Write-Host "Then: agentos start --open"
  Write-Host "Stop later: agentos stop"
  Write-Host "Remove later: agentos uninstall"
  Write-Host "Add $binDir to your PATH if 'agentos' is not found."
  Write-Host "Example for this PowerShell session:"
  Write-Host ("  `$env:Path = " + '"' + $binDir + ';$env:Path' + '"')
}

Assert-NodeVersion

$artifactName = "agentos-$assetPlatform-$assetArch.tgz"

if ($requestedVersion -eq "latest") {
  $releasePath = "latest/download"
} else {
  $releasePath = "download/agentos-v$requestedVersion"
}

$baseUrl = "https://github.com/$repo/releases/$releasePath"
$artifactUrl = "$baseUrl/$artifactName"
$checksumUrl = "$artifactUrl.sha256"
$tempRoot = [System.IO.Path]::GetTempPath().TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$tempDir = Join-Path $tempRoot ("agentos-install.{0}" -f ([guid]::NewGuid().ToString("N")))

New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
  $artifactFile = Join-Path $tempDir $artifactName
  $checksumFile = Join-Path $tempDir "$artifactName.sha256"

  Write-Host "Downloading $artifactUrl"
  Download-File -Url $artifactUrl -Target $artifactFile

  $checksumDownloaded = $false

  try {
    Download-File -Url $checksumUrl -Target $checksumFile
    $checksumDownloaded = $true
  } catch {
    $checksumDownloaded = $false
  }

  if ($checksumDownloaded) {
    Verify-Checksum -ChecksumFile $checksumFile -ArtifactFile $artifactFile
  } else {
    Write-Host "No checksum file found; skipping SHA-256 verification."
  }

  Require-Command "tar"

  New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $binDir -Force | Out-Null

  $packageDir = Join-Path $installRoot "package"

  if (Test-Path -LiteralPath $packageDir) {
    Remove-Item -LiteralPath $packageDir -Recurse -Force
  }

  & tar -xzf "$artifactFile" -C "$installRoot"

  if ($LASTEXITCODE -ne 0) {
    throw "Failed to extract $artifactFile."
  }

  $launcherPath = Join-Path $binDir "agentos.cmd"
  $nodeScriptPath = [System.IO.Path]::Combine($installRoot, "package", "bin", "agentos.js")
  $launcherContent = @"
@echo off
setlocal
node "$nodeScriptPath" %*
"@

  Set-Content -LiteralPath $launcherPath -Value $launcherContent -Encoding Ascii
  Print-Completion -LauncherPath $launcherPath
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
