$ErrorActionPreference = "Stop"

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDir = Join-Path $workspace "release"
$targetDir = Join-Path $releaseDir "MeiDou-local"
$targetExe = Join-Path $targetDir "MeiDou.exe"
$targetAsar = Join-Path $targetDir "resources\app.asar"
$asarBin = Join-Path $workspace "node_modules\@electron\asar\bin\asar.js"
$stamp = Get-Date -Format "yyyyMMddHHmmss"
$stagingApp = Join-Path $workspace (".meidou-local-staging\app-" + $stamp)
$newAsar = Join-Path $releaseDir ("app.local-" + $stamp + ".asar")

function Get-ShellSourceDir {
  $existingLocalExe = Join-Path $targetDir "MeiDou.exe"
  if (Test-Path -LiteralPath $existingLocalExe) {
    return $targetDir
  }

  $latestDir = Get-ChildItem -LiteralPath $releaseDir -Directory -Filter "MeiDou-latest-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($latestDir -and (Test-Path -LiteralPath (Join-Path $latestDir.FullName "MeiDou.exe"))) {
    return $latestDir.FullName
  }

  $installedDir = Join-Path $env:ProgramFiles "MeiDou"
  if (Test-Path -LiteralPath (Join-Path $installedDir "MeiDou.exe")) {
    return $installedDir
  }

  throw "No MeiDou Electron shell found. Install once or keep a release\MeiDou-latest-* directory."
}

if (-not (Test-Path -LiteralPath $asarBin)) {
  throw "Missing asar tool. Run npm install first."
}

Push-Location $workspace
try {
  npm run build

  if (-not (Test-Path -LiteralPath $targetExe)) {
    $sourceDir = Get-ShellSourceDir
    if ($sourceDir -ne $targetDir) {
      Copy-Item -LiteralPath $sourceDir -Destination $targetDir -Recurse -Force
    }
  }

  New-Item -ItemType Directory -Path $stagingApp -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $workspace "out") -Destination (Join-Path $stagingApp "out") -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $workspace "package.json") -Destination (Join-Path $stagingApp "package.json") -Force
  node $asarBin pack $stagingApp $newAsar

  $running = Get-Process -Name "MeiDou" -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -and $_.Path.StartsWith($targetDir, [System.StringComparison]::OrdinalIgnoreCase) }
  if ($running) {
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
  }

  if (Test-Path -LiteralPath $targetAsar) {
    $backupName = "app.asar.backup-local-" + $stamp
    Rename-Item -LiteralPath $targetAsar -NewName $backupName
  }
  Copy-Item -LiteralPath $newAsar -Destination $targetAsar -Force

  $desktop = [Environment]::GetFolderPath("Desktop")
  $linkPath = Join-Path $desktop "MeiDou.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($linkPath)
  $shortcut.TargetPath = $targetExe
  $shortcut.WorkingDirectory = $targetDir
  $shortcut.IconLocation = $targetExe
  $shortcut.Save()

  Start-Process -FilePath $targetExe

  Write-Host "Updated local MeiDou:"
  Write-Host $targetExe
  Write-Host "Shortcut:"
  Write-Host $linkPath
} finally {
  Pop-Location
}
