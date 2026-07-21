#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Replaces %NVM_HOME%, %NVM_SYMLINK%, and %JAVA_HOME%\bin in the Machine PATH
    with their literal values so they resolve correctly in all subprocesses,
    regardless of whether the env vars are inherited by the spawning process.

.USAGE
    Right-click PowerShell → "Run as Administrator"
    cd D:\Projects\gsd-tau\scripts
    .\fix-machine-path.ps1
#>

$ErrorActionPreference = 'Stop'

# Read current Machine PATH from registry (not $env:PATH which may be stale)
$machinePath = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
$entries     = $machinePath -split ';' | Where-Object { $_ }

Write-Host "Current Machine PATH entries:"
$entries | ForEach-Object { "  $_" }

# Literal replacements for %VAR% entries
$nvmHome  = [System.Environment]::GetEnvironmentVariable('NVM_HOME',  'Machine')
$nvmSym   = [System.Environment]::GetEnvironmentVariable('NVM_SYMLINK','Machine')
$javaHome = [System.Environment]::GetEnvironmentVariable('JAVA_HOME',  'Machine')

$replacements = @{
    '%NVM_HOME%'      = $nvmHome
    '%NVM_SYMLINK%'   = $nvmSym
    '%JAVA_HOME%\bin' = if ($javaHome) { "$javaHome\bin" } else { $null }
}

foreach ($k in @($replacements.Keys)) {
    if (-not $replacements[$k]) {
        Write-Warning "Cannot expand $k — source variable is not set. Skipping."
        $replacements.Remove($k)
    }
}

$newEntries = $entries | ForEach-Object {
    $entry = $_
    foreach ($k in $replacements.Keys) {
        if ($entry -ieq $k) {
            Write-Host "  Replacing '$entry' -> '$($replacements[$k])'"
            $entry = $replacements[$k]
        }
    }
    $entry
}

# Deduplicate (case-insensitive), preserve order
$seen    = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$deduped = $newEntries | Where-Object { $seen.Add($_) }

$newPath = $deduped -join ';'
[System.Environment]::SetEnvironmentVariable('PATH', $newPath, 'Machine')

Write-Host ""
Write-Host "New Machine PATH entries:"
$deduped | ForEach-Object { "  $_" }
Write-Host ""
Write-Host "Done. New terminals/processes will pick up the literal PATH immediately."
Write-Host "Running processes (including this GSD session) need a restart."
