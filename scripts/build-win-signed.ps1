#requires -Version 5.1
<#
.SYNOPSIS
    用本地自签证书签名打包 Windows 安装包。

.DESCRIPTION
    从 signing.json 读取 .pfx 路径和口令，注入 electron-builder 认的两个环境变量
    （CSC_LINK / CSC_KEY_PASSWORD），再执行 build + electron-builder --win。
    证书材料不在仓库内，默认位置见 $SigningConfig。

.PARAMETER SigningConfig
    signing.json 路径。默认取 $env:BDG_SIGNING_CONFIG，否则用本机私有目录。

.PARAMETER SkipBuild
    复用已有 out/ 产物，只重新打包（调试签名流程时更快）。

.PARAMETER Publish
    打包后发布到 GitHub Release。默认 never，避免本地误发。

.EXAMPLE
    npm run dist:win:signed
#>
[CmdletBinding()]
param(
    [string]$SigningConfig = $(if ($env:BDG_SIGNING_CONFIG) { $env:BDG_SIGNING_CONFIG } else { 'D:\Users\BUGJI\Documents\VSCode\_impotant\beat_data_generator\signing\signing.json' }),
    [switch]$SkipBuild,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (-not (Test-Path -LiteralPath $SigningConfig)) {
    throw @"
找不到签名配置：$SigningConfig
先生成证书：pwsh -File scripts\new-signing-cert.ps1
或用 -SigningConfig / `$env:BDG_SIGNING_CONFIG 指定 signing.json 的位置。
"@
}

$cfg = Get-Content -LiteralPath $SigningConfig -Raw | ConvertFrom-Json
foreach ($field in 'pfx', 'password') {
    if (-not $cfg.$field) { throw "signing.json 缺少字段 $field" }
}
if (-not (Test-Path -LiteralPath $cfg.pfx)) { throw "signing.json 指向的 pfx 不存在：$($cfg.pfx)" }

if ((Get-Date) -gt [datetime]$cfg.notAfter) {
    throw "证书已于 $($cfg.notAfter) 过期，请重新生成：pwsh -File scripts\new-signing-cert.ps1 -Force"
}

# electron-builder 26 默认会从 GitHub 下载 winCodeSign（内含 signtool / rcedit）。
# 国内网络下该下载经常超时，这里优先复用它已经缓存的副本或本机 Windows SDK，
# 通过 SIGNTOOL_PATH / ELECTRON_BUILDER_RCEDIT_PATH 跳过下载。
function Resolve-SignTool {
    if ($env:SIGNTOOL_PATH -and (Test-Path $env:SIGNTOOL_PATH)) { return $env:SIGNTOOL_PATH }

    $kits = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
    foreach ($kit in $kits) {
        $candidate = Join-Path $kit.FullName 'x64\signtool.exe'
        if (Test-Path $candidate) { return $candidate }
    }

    $cached = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign-2.6.0\windows-10\x64\signtool.exe'
    if (Test-Path $cached) { return $cached }
    return $null
}

function Resolve-RceditDir {
    if ($env:ELECTRON_BUILDER_RCEDIT_PATH -and (Test-Path $env:ELECTRON_BUILDER_RCEDIT_PATH)) {
        return $env:ELECTRON_BUILDER_RCEDIT_PATH
    }
    $cached = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign-2.6.0'
    if (Test-Path (Join-Path $cached 'rcedit-x64.exe')) { return $cached }
    return $null
}

$signTool = Resolve-SignTool
if ($signTool) {
    $env:SIGNTOOL_PATH = $signTool
    Write-Host "signtool：$signTool" -ForegroundColor Cyan
} else {
    Write-Warning '未找到本机 signtool，将回退到 electron-builder 自行下载 winCodeSign（需要能访问 GitHub）。'
}

$rceditDir = Resolve-RceditDir
if ($rceditDir) {
    $env:ELECTRON_BUILDER_RCEDIT_PATH = $rceditDir
    Write-Host "rcedit：$rceditDir" -ForegroundColor Cyan
}

$env:CSC_LINK = $cfg.pfx
$env:CSC_KEY_PASSWORD = $cfg.password

# electron-builder 的依赖收集器在 Windows 上直接 spawn `powershell.exe`
# （app-builder-lib/out/node-module-collector/nodeModulesCollector.js:324）。
# 本机 PATH 里的 powershell.exe 是 scoop shim，指向已不存在的 pwsh 7.6.6，
# 结果输出为空、报 “No JSON content found in output”。把系统自带 Windows PowerShell 提前。
$winPsDir = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0'
if (Test-Path (Join-Path $winPsDir 'powershell.exe')) {
    $env:PATH = "$winPsDir;$env:PATH"
}

Write-Host "签名证书：$($cfg.subject)（$($cfg.thumbprint)）" -ForegroundColor Cyan
Write-Host "到期时间：$([datetime]$cfg.notAfter)" -ForegroundColor Cyan

if (-not $SkipBuild) {
    Write-Host '==> npm run build' -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$publishMode = if ($Publish) { 'always' } else { 'never' }
Write-Host "==> electron-builder --win --publish $publishMode" -ForegroundColor Cyan
npx electron-builder --win --publish $publishMode
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 打包完立即回读签名，避免“构建成功但没签上”的假象
$setup = Get-ChildItem -LiteralPath (Join-Path $repoRoot 'release') -Filter '*-setup.exe' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($setup) {
    $sig = Get-AuthenticodeSignature -LiteralPath $setup.FullName
    Write-Host ("产物：{0}" -f $setup.Name) -ForegroundColor Cyan
    Write-Host ("状态：{0}" -f $sig.Status) -ForegroundColor Cyan
    Write-Host ("签名者：{0}" -f $sig.SignerCertificate.Subject) -ForegroundColor Cyan
    if ($sig.Status -ne 'Valid') {
        Write-Warning "签名状态不是 Valid。未在本机信任该自签证书时属正常（NotTrusted），可用 docs/code-signing.md 的 certutil 命令导入信任。"
    }
}
