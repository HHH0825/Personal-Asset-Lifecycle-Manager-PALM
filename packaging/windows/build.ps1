param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$')]
    [string]$Version,
    [string]$Python = 'python',
    [string]$Iscc,
    [switch]$BundleOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$packageDir = $PSScriptRoot
$outputRoot = Join-Path $packageDir 'out'
$bundleRoot = Join-Path $outputRoot 'bundle'
$workRoot = Join-Path $outputRoot 'build'
$releaseRoot = Join-Path $outputRoot 'release'
$iconFile = Join-Path $outputRoot 'palm.ico'
$appVersion = $Version.Substring(1)

& $Python (Join-Path $packageDir 'create_icon.py') $iconFile
if ($LASTEXITCODE -ne 0) { throw '图标生成失败' }
& $Python -m PyInstaller --noconfirm --clean --distpath $bundleRoot --workpath $workRoot (Join-Path $packageDir 'PALM.spec')
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller 打包失败' }
$bundle = Join-Path $bundleRoot 'PALM'
if (-not (Test-Path (Join-Path $bundle 'PALM.exe'))) { throw '缺少 PALM.exe' }

if ($BundleOnly) {
    Write-Host "已构建目录版：$bundle"
    exit 0
}

if (-not $iscc) {
    $iscc = Get-Command 'ISCC.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
}
if (-not $iscc) {
    $candidate = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6\ISCC.exe'
    if (Test-Path $candidate) { $iscc = $candidate }
}
if (-not $iscc) { throw '未找到 Inno Setup 6 的 ISCC.exe' }
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
& $iscc '/Qp' "/DAppVersion=$appVersion" "/DBundleDir=$bundle" "/DOutputDir=$releaseRoot" "/DIconFile=$iconFile" (Join-Path $packageDir 'installer.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 安装包编译失败' }
$installer = Join-Path $releaseRoot "PALM-Setup-$Version-windows-x64.exe"
if (-not (Test-Path $installer)) { throw '安装包输出文件不存在' }
$digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
$checksumFile = "$installer.sha256"
Set-Content -LiteralPath $checksumFile -Value "$digest  $(Split-Path $installer -Leaf)" -Encoding ascii
Write-Host "安装包：$installer"
Write-Host "SHA-256：$checksumFile"
