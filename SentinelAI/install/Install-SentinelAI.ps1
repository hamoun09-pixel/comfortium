<#
.SYNOPSIS
    Installe SentinelAI V0.1 sur un poste Windows 11.

.DESCRIPTION
    Vérifie les prérequis, compile la solution, publie l'application dans
    C:\Program Files\SentinelAI, prépare le dossier de données sous
    %ProgramData%\SentinelAI avec des droits restreints, et crée les raccourcis.

    Le script ne touche jamais à la configuration de Microsoft Defender.
    SentinelAI est un second niveau de surveillance : Defender reste le
    produit antimalware principal du poste.

.PARAMETER Source
    Racine de la solution SentinelAI (dossier contenant SentinelAI.slnx).

.PARAMETER Destination
    Dossier d'installation. Par défaut : C:\Program Files\SentinelAI.

.PARAMETER SansRaccourci
    N'ajoute pas de raccourci au menu Démarrer.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\Install-SentinelAI.ps1

.NOTES
    Exécuter dans une console PowerShell ouverte en tant qu'administrateur.
#>

[CmdletBinding()]
param(
    [string] $Source = (Split-Path -Parent $PSScriptRoot),
    [string] $Destination = (Join-Path $env:ProgramFiles 'SentinelAI'),
    [switch] $SansRaccourci
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Etape { param([string] $Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok    { param([string] $Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Avert { param([string] $Message) Write-Host "    $Message" -ForegroundColor Yellow }

# --------------------------------------------------------------------------
# 1. Prérequis
# --------------------------------------------------------------------------
Write-Etape 'Vérification des prérequis'

$identite = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identite)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Ce script doit être exécuté dans une console PowerShell ouverte en tant qu'administrateur."
}
Write-Ok 'Privilèges administrateur confirmés.'

if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    throw 'SentinelAI est une application Windows.'
}

$version = [Environment]::OSVersion.Version
if ($version.Major -lt 10) {
    throw "Windows 10 ou 11 est requis (version détectée : $version)."
}
if ($version.Build -lt 22000) {
    Write-Avert "Windows 11 est recommandé (build 22000+). Build détecté : $($version.Build). L'installation continue."
} else {
    Write-Ok "Windows 11 détecté (build $($version.Build))."
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw "Le SDK .NET 10 est introuvable. Installez-le depuis https://dotnet.microsoft.com/download puis relancez ce script."
}

$sdks = & dotnet --list-sdks
if (-not ($sdks | Where-Object { $_ -match '^10\.' })) {
    throw "Le SDK .NET 10 est requis. SDK détectés :`n$($sdks -join "`n")"
}
Write-Ok 'SDK .NET 10 détecté.'

$solution = Join-Path $Source 'SentinelAI.slnx'
if (-not (Test-Path $solution)) {
    throw "Solution introuvable : $solution"
}

# --------------------------------------------------------------------------
# 2. État de Microsoft Defender (information seulement)
# --------------------------------------------------------------------------
Write-Etape 'État de Microsoft Defender'
try {
    $defender = Get-MpComputerStatus -ErrorAction Stop
    if ($defender.RealTimeProtectionEnabled) {
        Write-Ok 'Protection en temps réel active. SentinelAI viendra en complément.'
    } else {
        Write-Avert "La protection en temps réel de Defender est désactivée."
        Write-Avert "SentinelAI ne la remplace pas : réactivez-la dans Sécurité Windows."
    }
} catch {
    Write-Avert "Impossible de lire l'état de Defender ($($_.Exception.Message)). L'installation continue."
}

# --------------------------------------------------------------------------
# 3. Compilation et publication
# --------------------------------------------------------------------------
Write-Etape 'Compilation de SentinelAI'

$applications = Join-Path $Source 'src\SentinelAI.App\SentinelAI.App.csproj'
$cli          = Join-Path $Source 'src\SentinelAI.Cli\SentinelAI.Cli.csproj'

& dotnet publish $applications --configuration Release --runtime win-x64 --self-contained false `
    --output $Destination /p:PublishSingleFile=false
if ($LASTEXITCODE -ne 0) { throw "La compilation de l'interface a échoué (code $LASTEXITCODE)." }
Write-Ok "Interface publiée dans $Destination"

& dotnet publish $cli --configuration Release --runtime win-x64 --self-contained false `
    --output $Destination
if ($LASTEXITCODE -ne 0) { throw "La compilation de l'outil en ligne de commande a échoué (code $LASTEXITCODE)." }
Write-Ok 'Outil en ligne de commande publié (sentinelai.exe).'

# --------------------------------------------------------------------------
# 4. Dossier de données et droits
# --------------------------------------------------------------------------
Write-Etape 'Préparation du dossier de données'

$donnees = Join-Path $env:ProgramData 'SentinelAI'
foreach ($sous in @('', 'journaux', 'quarantaine', 'cles', 'regles')) {
    $chemin = if ($sous) { Join-Path $donnees $sous } else { $donnees }
    if (-not (Test-Path $chemin)) {
        New-Item -ItemType Directory -Path $chemin -Force | Out-Null
    }
}
Write-Ok "Dossier de données : $donnees"

# Le coffre de quarantaine et les clés ne doivent être lisibles que par
# les administrateurs et le compte SYSTEM : ils contiennent des fichiers
# potentiellement malveillants (chiffrés) et la clé qui les protège.
foreach ($sensible in @('quarantaine', 'cles')) {
    $chemin = Join-Path $donnees $sensible
    $acl = Get-Acl $chemin
    $acl.SetAccessRuleProtection($true, $false)
    $acl.Access | ForEach-Object { [void] $acl.RemoveAccessRule($_) }

    foreach ($compte in @('BUILTIN\Administrateurs', 'BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
        try {
            $regle = New-Object Security.AccessControl.FileSystemAccessRule(
                $compte, 'FullControl',
                'ContainerInherit,ObjectInherit', 'None', 'Allow')
            $acl.AddAccessRule($regle)
        } catch {
            # Le nom du groupe Administrateurs dépend de la langue de Windows :
            # on essaie les deux et on ignore celui qui n'existe pas.
        }
    }

    Set-Acl -Path $chemin -AclObject $acl
    Write-Ok "Droits restreints appliqués sur $sensible."
}

# Fichier d'empreintes vide, prêt à être complété par l'utilisateur.
$empreintes = Join-Path $donnees 'regles\empreintes-bloquees.txt'
if (-not (Test-Path $empreintes)) {
    @(
        '# Empreintes SHA-256 connues comme malveillantes, une par ligne.',
        '# Format : <empreinte sha256>;<nom de la menace>',
        '# Les lignes vides et celles commençant par # sont ignorées.'
    ) | Set-Content -Path $empreintes -Encoding UTF8
    Write-Ok 'Fichier d''empreintes locales créé.'
}

# --------------------------------------------------------------------------
# 5. Raccourcis
# --------------------------------------------------------------------------
if (-not $SansRaccourci) {
    Write-Etape 'Création du raccourci'
    $menu = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\SentinelAI.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $raccourci = $shell.CreateShortcut($menu)
    $raccourci.TargetPath = Join-Path $Destination 'SentinelAI.exe'
    $raccourci.WorkingDirectory = $Destination
    $raccourci.Description = 'SentinelAI — analyse locale de fichiers'
    $raccourci.Save()
    Write-Ok "Raccourci ajouté au menu Démarrer."
}

# --------------------------------------------------------------------------
# 6. Vérification finale
# --------------------------------------------------------------------------
Write-Etape 'Vérification'
$executable = Join-Path $Destination 'SentinelAI.exe'
if (-not (Test-Path $executable)) {
    throw "L'exécutable est absent après publication : $executable"
}

& (Join-Path $Destination 'sentinelai.exe') version
Write-Host ''
Write-Host 'Installation terminée.' -ForegroundColor Green
Write-Host "  Interface       : $executable"
Write-Host "  Ligne de commande : $(Join-Path $Destination 'sentinelai.exe')"
Write-Host "  Données         : $donnees"
Write-Host ''
Write-Host 'Microsoft Defender reste votre protection principale. SentinelAI ajoute un second niveau de vérification.' -ForegroundColor Cyan
