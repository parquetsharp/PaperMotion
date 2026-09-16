[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [string]$NodePath,
    [switch]$Install,
    [switch]$Rebuild,
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
try {
    if (-not $NodePath) {
        $NodePath = (Get-Command node -ErrorAction Stop).Source
    }
    $NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($NpmCommand) {
        $NpmCli = Join-Path (Split-Path $NpmCommand.Source) 'node_modules/npm/bin/npm-cli.js'
        if (Test-Path $NpmCli) { $env:PAPERMOTION_NPM_CLI = $NpmCli }
    }
    $Arguments = @((Join-Path $PSScriptRoot 'scripts/start-companion.mjs'), '--port', [string]$Port)
    if ($Install) { $Arguments += '--install' }
    if ($Rebuild) { $Arguments += '--rebuild' }
    if ($Check) { $Arguments += '--check' }
    & $NodePath @Arguments
    exit $LASTEXITCODE
} catch {
    Write-Error $_
    exit 1
}