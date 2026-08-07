<#
.SYNOPSIS
    Désinstalle SentinelAI.

.DESCRIPTION
    Retire l'application et le raccourci. Le dossier de données
    (%ProgramData%\SentinelAI) est conservé par défaut car il contient le
    journal et le coffre de quarantaine : supprimer ce coffre rendrait
    impossible la restauration des fichiers qu'il contient.

.PARAMETER SupprimerDonnees
    Supprime aussi le dossier de données, journaux et quarantaine compris.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Uninstall-SentinelAI.ps1
#>

[CmdletBinding()]
param(
    [string] $Destination = (Join-Path $env:ProgramFiles 'SentinelAI'),
    [switch] $SupprimerDonnees
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$identite = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identite)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être exécuté en tant qu'administrateur."
}

Get-Process -Name 'SentinelAI' -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "Arrêt de SentinelAI (PID $($_.Id))…"
    $_.CloseMainWindow() | Out-Null
    Start-Sleep -Seconds 2
    if (-not $_.HasExited) { $_ | Stop-Process -Force }
}

$raccourci = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\SentinelAI.lnk'
if (Test-Path $raccourci) {
    Remove-Item $raccourci -Force
    Write-Host 'Raccourci supprimé.'
}

if (Test-Path $Destination) {
    Remove-Item $Destination -Recurse -Force
    Write-Host "Application supprimée : $Destination"
}

$donnees = Join-Path $env:ProgramData 'SentinelAI'
if ($SupprimerDonnees) {
    $quarantaine = Join-Path $donnees 'quarantaine'
    if ((Test-Path $quarantaine) -and (Get-ChildItem $quarantaine -File).Count -gt 0) {
        Write-Warning "Le coffre de quarantaine n'est pas vide. Les fichiers qu'il contient seront définitivement perdus."
        $reponse = Read-Host 'Continuer malgré tout ? (oui/non)'
        if ($reponse -notin @('oui', 'o', 'yes', 'y')) {
            Write-Host 'Dossier de données conservé.'
            return
        }
    }

    Remove-Item $donnees -Recurse -Force
    Write-Host "Dossier de données supprimé : $donnees"
} elseif (Test-Path $donnees) {
    Write-Host "Dossier de données conservé : $donnees"
    Write-Host 'Utilisez -SupprimerDonnees pour le retirer également.'
}

Write-Host 'Désinstallation terminée.' -ForegroundColor Green
