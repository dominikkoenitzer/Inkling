# Gets a fresh Windows PC ready to work on Inkling: checks the tools, installs the
# packages, fetches the Electron app and runs the tests. Installs no tools itself;
# for anything missing it prints the command to run.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$missing = @()
foreach ($tool in @(
    @{ Name = 'git'; Install = 'winget install --id Git.Git -e' },
    @{ Name = 'bun'; Install = 'winget install --id Oven-sh.Bun -e' },
    @{ Name = 'node'; Install = 'winget install --id OpenJS.NodeJS.LTS -e' }
  )) {
  if (Get-Command $tool.Name -ErrorAction SilentlyContinue) {
    Write-Host ("found   {0}" -f $tool.Name)
  } else {
    Write-Host ("missing {0}: {1}" -f $tool.Name, $tool.Install)
    $missing += $tool.Name
  }
}
if ($missing.Count -gt 0) {
  Write-Host "`nInstall the missing tools, open a new terminal and run this script again."
  exit 1
}

$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
  Write-Host "Node $nodeMajor is too old, 22 or newer is needed: winget upgrade --id OpenJS.NodeJS.LTS -e"
  exit 1
}

Write-Host "`nInstalling packages..."
bun install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path 'node_modules\electron\path.txt')) {
  Write-Host "Fetching the Electron app..."
  node node_modules\electron\install.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Running the tests..."
bun run test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "`nReady. Start Inkling with: bun run dev"
