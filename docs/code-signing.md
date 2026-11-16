# Windows 代码签名（自签证书）

本项目用**自签证书**给 Windows 安装包做 Authenticode 签名，全部在本地完成，不依赖证书颁发机构。目标是让安装包带可见的发布者信息、可校验是否被篡改；**不追求消除 SmartScreen 警告**（那需要 EV 证书或长期声誉积累）。

## 材料与位置

证书由 [`scripts/new-signing-cert.ps1`](../scripts/new-signing-cert.ps1) 生成，输出到仓库之外的私有目录（默认 `D:\Users\BUGJI\Documents\VSCode\_impotant\beat_data_generator\signing`，可用 `$env:BDG_SIGNING_DIR` 覆盖）：

| 文件 | 内容 | 是否可外传 |
| --- | --- | --- |
| `BUGJI-codesign.pfx` | 证书 + 私钥（PKCS#12） | **否**，泄露等于可冒充发布 |
| `BUGJI-codesign.cer` | 公钥证书 | 是，分发给用户导入信任 |
| `BUGJI-codesign.pfx.base64.txt` | pfx 的 base64 | 否，仅供填 CI secret |
| `signing.json` | 路径 + 口令 + 指纹 + 到期时间 | **否** |

私钥目录已用 `icacls` 收紧到当前用户与 SYSTEM，**不要**放进版本库、网盘同步目录或备份工具。

当前证书：`CN=BUGJI`、RSA 4096 / SHA-256、代码签名 EKU，有效期三年。到期后需重新生成；旧安装包仍可安装，但无法再用旧证书签新包。

## 打包

```bash
# 签名打包（build + electron-builder --win --publish never）
npm run dist:win:signed
```

脚本会读 `signing.json`，注入 electron-builder 认的 `CSC_LINK` / `CSC_KEY_PASSWORD`，打包后回读签名并打印状态。想复用已有 `out/` 产物、只重打包：

```powershell
powershell -NoProfile -File scripts\build-win-signed.ps1 -SkipBuild
```

也可以在任意打包命令前手动设环境变量：

```powershell
$env:CSC_LINK = 'D:\...\signing\BUGJI-codesign.pfx'
$env:CSC_KEY_PASSWORD = '<signing.json 里的 password>'
npm run dist:win
```

`npm run dist:win` 本身仍可用于未签名打包（例如临时验证），不带证书时 electron-builder 直接跳过签名。

### 工具链：不依赖 GitHub 下载

electron-builder 26 默认会从 GitHub Releases 拉取 `winCodeSign-2.6.0.7z`（内含 `signtool.exe` 与 `rcedit`）。国内网络下这个请求经常 `ETIMEDOUT`，导致打包在签名阶段失败。

`scripts/build-win-signed.ps1` 会自动探测并注入两个官方支持的覆盖变量，命中后完全不发起下载：

| 变量 | 指向 | 本机来源 |
| --- | --- | --- |
| `SIGNTOOL_PATH` | `signtool.exe` 文件 | Windows SDK `C:\Program Files (x86)\Windows Kits\10\bin\<ver>\x64\signtool.exe`，退而使用 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign-2.6.0\windows-10\x64\signtool.exe` |
| `ELECTRON_BUILDER_RCEDIT_PATH` | 含 `rcedit-x64.exe` 的目录 | `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign-2.6.0` |

若两处都没有，脚本会回退到 electron-builder 自身下载（需要能访问 GitHub）。CI（GitHub runner）网络正常，不需要这两个变量。

### 排障：`No JSON content found in output`

打包在 `searching for node modules` 阶段失败、报这一句，通常不是签名问题，而是 electron-builder 的依赖收集器 spawn 的 `powershell.exe` 不可用（`app-builder-lib/out/node-module-collector/nodeModulesCollector.js:324` 直接调用它）。本机 `powershell.exe` 被 scoop shim 覆盖、指向已卸载的 pwsh 时就会这样：输出为空，JSON 解析失败。

脚本已把 `%SystemRoot%\System32\WindowsPowerShell\v1.0` 提到 `PATH` 最前面规避。若仍复现，先验证：

```powershell
powershell -NoProfile -Command 'Write-Output ok'
```

正常应输出 `ok`。若报 `Shim: Could not create process ...`，需要修 `C:\Users\<user>\scoop\shims\powershell.exe` 或调整 `PATH` 顺序。

## 验证签名

```powershell
# 打包脚本已自动做这一步
Get-AuthenticodeSignature 'release\Beat-Data-Generator-0.3.13-setup.exe' |
    Format-List Status, StatusMessage, SignerCertificate
```

未在本机信任该证书时，`Status` 是 `NotTrusted`（`StatusMessage: 证书链已处理，但终止于不受信任的根证书`），属正常现象。**是否信任与是否签名是两件事**：文件确实带签名，只是这台机器不认这个根。

## 让本机 / 用户信任（可选）

需要管理员权限，`Root` 与 `TrustedPublisher` 两个存储都要导入：

```powershell
certutil -addstore -f Root "$env:BDG_SIGNING_DIR\BUGJI-codesign.cer"
certutil -addstore -f TrustedPublisher "$env:BDG_SIGNING_DIR\BUGJI-codesign.cer"
```

导入后 `Get-AuthenticodeSignature` 会变成 `Valid`，安装时不再显示“未知发布者”，但首次运行时 SmartScreen 仍可能提示（它看的是声誉而非签名本身）。

## 为什么 `win.verifyUpdateCodeSignature` 设为 `false`

`electron-updater` 在 Windows 上默认校验更新包的签名：它把下载的安装包与 `app-update.yml` 里的 `publisherName` 比对。该字段只在 `win.verifyUpdateCodeSignature !== false` 时由 electron-builder 写入（见 `app-builder-lib/out/winPackager.js` 的 `isForceCodeSigningVerification`）。

校验要求 `Get-AuthenticodeSignature` 返回 `Valid`，也就是**客户端必须已信任我们的自签根证书**。若不导入就开启，用户会卡在“签名校验失败”而无法自动更新。因此：

- 默认 `false`：安装包有签名，但更新只依赖 HTTPS + `latest.yml` 里的 SHA-512 校验，不比对发布者。
- 如果你确认所有用户都导入了根证书（例如内网分发），可以删掉 `package.json` 里这一行，恢复严格发布者校验。

## CI 签名（已启用）

`.github/workflows/release.yml` 在 tag 推送时用 GitHub runner 打包并发布，Windows 产物同样签名，材料来自仓库 secrets：

| Secret | 内容 |
| --- | --- |
| `CSC_LINK` | `BUGJI-codesign.pfx.base64.txt` 的全部内容（PKCS#12 的 base64） |
| `CSC_KEY_PASSWORD` | `signing.json` 里的 `password` |

`Package` 步骤只给 `windows-latest` 注入这两个变量（Linux 不需要），写成：

```yaml
env:
  CSC_LINK: ${{ matrix.os == 'windows-latest' && secrets.CSC_LINK || '' }}
  CSC_KEY_PASSWORD: ${{ matrix.os == 'windows-latest' && secrets.CSC_KEY_PASSWORD || '' }}
```

`CSC_LINK` 为空时 electron-builder 直接跳过签名（`windowsSignToolManager.js`），所以 fork 或 secret 缺失都不会让构建失败，只是产物不带签名。

更换证书后要同步覆盖 secret：

```powershell
$dir = "$env:BDG_SIGNING_DIR"   # 或写死 signing 目录
gh secret set CSC_LINK --repo BUGJI/beat_data_generator --body (Get-Content "$dir\BUGJI-codesign.pfx.base64.txt" -Raw).Trim()
gh secret set CSC_KEY_PASSWORD --repo BUGJI/beat_data_generator --body ((Get-Content "$dir\signing.json" -Raw | ConvertFrom-Json).password)
```

**权衡**：私钥交给 GitHub（仓库 secret 可被有 `repo` 权限的协作者或 Actions 读取），换取 Release 产物也签名。若要收回，执行 `gh secret delete CSC_LINK`、`gh secret delete CSC_KEY_PASSWORD`，CI 即回到不签名状态。

本地与 CI 现在都签名，签名者一致（`CN=BUGJI`），换证时两边必须同步，否则混发的产物发布者不同。

## 已知限制

- 自签证书不能消除 SmartScreen“未知发布者”提示，也不能让企业环境免加点信任；只有 CA 签发（OV/EV）可以。
- 时间戳由 DigiCert 提供（`rfc3161TimeStampServer`），用于证明签名时刻；即便证书过期，已签名的旧包仍被视为有效签名。
- 换证书会改变 `publisherName`（CN），开启严格校验后老用户的自动更新会失败，换证前请先规划迁移。
