#requires -Version 5.1
<#
.SYNOPSIS
    生成用于 Windows Authenticode 自签代码签名的证书，并导出 .pfx / .cer / base64。

.DESCRIPTION
    产出的文件默认放在仓库之外的私有目录（含私钥，切勿入版本库）：
        <OutDir>\BUGJI-codesign.pfx             私钥 + 证书（PKCS#12，密码保护）
        <OutDir>\BUGJI-codesign.cer             公钥证书（给最终用户导入信任）
        <OutDir>\BUGJI-codesign.pfx.base64.txt  pfx 的 base64（粘贴到 CI secret 用）
        <OutDir>\signing.json                   签名配置（含密码），供 build-win-signed.ps1 读取
        <OutDir>\README.md                      信任安装与安全说明

.PARAMETER OutDir
    输出目录。默认取 $env:BDG_SIGNING_DIR，否则用本机私有目录。

.PARAMETER CommonName
    证书主题 CN，同时是 electron-updater 校验用的 publisherName。默认 BUGJI。

.PARAMETER Years
    有效期年数，默认 3。自签过期后旧安装包仍可装，但签新包会失败。

.PARAMETER Force
    目标文件已存在时覆盖。默认拒绝，避免误删仍在使用的私钥。

.EXAMPLE
    pwsh -File scripts\new-signing-cert.ps1
#>
[CmdletBinding()]
param(
    [string]$OutDir = $(if ($env:BDG_SIGNING_DIR) { $env:BDG_SIGNING_DIR } else { 'D:\Users\BUGJI\Documents\VSCode\_impotant\beat_data_generator\signing' }),
    [string]$CommonName = 'BUGJI',
    [int]$Years = 3,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$pfxPath = Join-Path $OutDir "$CommonName-codesign.pfx"
$cerPath = Join-Path $OutDir "$CommonName-codesign.cer"
$b64Path = Join-Path $OutDir "$CommonName-codesign.pfx.base64.txt"
$jsonPath = Join-Path $OutDir 'signing.json'

if ((Test-Path $pfxPath) -and -not $Force) {
    throw "已存在 $pfxPath。确认要更换证书时加 -Force（旧证书签出的版本将不再被新证书续签）。"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# 随机私钥口令：32 位字母数字，只落在 signing.json 里，不进版本库
$alphabet = (48..57) + (65..90) + (97..122)
$password = -join ($alphabet | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force

# -Type CodeSigningCert 会同时写入 KeyUsage=DigitalSignature 和代码签名 EKU，
# 因此不要再叠加 -KeyUsage，否则参数冲突。
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=$CommonName" `
    -KeyAlgorithm RSA `
    -KeyLength 4096 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears($Years)

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null

$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfxPath))
Set-Content -LiteralPath $b64Path -Value $base64 -Encoding ascii -NoNewline

# 自签证书的 issuer 就是自己；signtool 需要证书带私钥且 EKU 正确
$info = [ordered]@{
    commonName = $CommonName
    thumbprint = $cert.Thumbprint
    subject    = $cert.Subject
    issuer     = $cert.Issuer
    notBefore  = $cert.NotBefore.ToString('o')
    notAfter   = $cert.NotAfter.ToString('o')
    pfx        = $pfxPath
    password   = $password
    cer        = $cerPath
    base64     = $b64Path
    keyLength  = 4096
    hash       = 'SHA256'
    generatedAt = (Get-Date).ToString('o')
}
$info | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $jsonPath -Encoding utf8

# 私钥目录只在当前用户可读（去掉继承，只保留本用户与 SYSTEM）
try {
    icacls $OutDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
} catch {
    Write-Warning "收紧目录权限失败（不影响签名）：$($_.Exception.Message)"
}

@"
# 代码签名材料（私有，勿提交到仓库）

由 ``scripts/new-signing-cert.ps1`` 生成，$($cert.NotAfter.ToString('yyyy-MM-dd')) 过期。

| 文件 | 用途 |
| --- | --- |
| ``$CommonName-codesign.pfx`` | 含私钥，签名用；口令见 ``signing.json`` |
| ``$CommonName-codesign.cer`` | 公钥，分发给用户导入信任 |
| ``$CommonName-codesign.pfx.base64.txt`` | pfx 的 base64，用于填 GitHub secret ``CSC_LINK`` |
| ``signing.json`` | 脚本读取的签名配置（含口令） |

## 本地签名打包

``````
npm run dist:win:signed
``````

## 让 Windows 信任这个自签证书（可选，装过才不会出现“未知发布者”）

需要管理员 PowerShell，且两个存储都要导入：

``````
certutil -addstore -f Root "$cerPath"
certutil -addstore -f TrustedPublisher "$cerPath"
``````

导入后 ``Get-AuthenticodeSignature`` 的状态才会是 ``Valid``；否则是 ``NotTrusted``。
electron-updater 的严格校验依赖这个状态，因此本仓库把 ``win.verifyUpdateCodeSignature`` 设为 ``false``。

## 安全提醒

- 私钥泄露等于任何人都能冒充你发布“正版”安装包，务必只留在本机。
- 别把 ``.pfx`` / ``signing.json`` 放进仓库或网盘同步目录。
- 换证书会让 ``publisherName`` 变化，老用户的自动更新校验（若开启）会失败。
"@ | Set-Content -LiteralPath (Join-Path $OutDir 'README.md') -Encoding utf8

[ordered]@{
    ok         = $true
    outDir     = $OutDir
    subject    = $cert.Subject
    thumbprint = $cert.Thumbprint
    notAfter   = $cert.NotAfter.ToString('o')
    hasPrivateKey = $cert.HasPrivateKey
    eku        = ($cert.EnhancedKeyUsageList | ForEach-Object { "$($_.FriendlyName) ($($_.ObjectId))" }) -join '; '
} | ConvertTo-Json -Depth 4
