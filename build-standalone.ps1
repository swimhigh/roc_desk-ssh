param(
  [ValidateSet('debug','release')]
  [string]$Configuration = 'release'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# 前端产物之前是直接提交进 git 的 `standalone/dist/`（2026-09 发现这个反模式并
# 改成 gitignore 之后，这一步之前缺失，导致这个脚本和 CI 都会因为 `dist/` 不存在
# 而在 `tauri::generate_context!()` 报错）——vite outDir 配置成直接写到
# `standalone/dist`（见 src-web/vite.config.ts），这里显式跑一遍前端构建，不依赖
# 任何提前存在于工作区的产物。
$srcWeb = Join-Path $root 'src-web'
Push-Location $srcWeb
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

$profile = if ($Configuration -eq 'release') { '--release' } else { '' }
if ($profile) { cargo build --workspace --release } else { cargo build --workspace }
$suffix = if ($Configuration -eq 'release') { 'release' } else { 'debug' }
$source = Join-Path $root ("target/{0}/roc_desk_ssh_standalone.exe" -f $suffix)
if (-not (Test-Path $source)) { throw "Build did not produce $source" }
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force $bin | Out-Null
$destination = Join-Path $bin 'roc_desk-ssh.exe'
Copy-Item $source $destination -Force

# RDP 功能内嵌用的 wfreerdp.exe——不是 Cargo 依赖，是随 exe 一起分发的外部进程
# （见 vendor/README.md）。standalone 单独跑起来也需要它，否则 RDP 连接会因为
# 找不到这个可执行文件而失败。
$vendorExe = Join-Path $root 'vendor\wfreerdp.exe'
if (-not (Test-Path -LiteralPath $vendorExe -PathType Leaf)) {
    throw "vendor\wfreerdp.exe not found — RDP embedding depends on it"
}
Copy-Item -LiteralPath $vendorExe -Destination (Join-Path $bin 'wfreerdp.exe') -Force
$vendorLicense = Join-Path $root 'vendor\wfreerdp.LICENSE.txt'
if (Test-Path -LiteralPath $vendorLicense -PathType Leaf) {
    Copy-Item -LiteralPath $vendorLicense -Destination (Join-Path $bin 'wfreerdp.LICENSE.txt') -Force
}

Write-Output "Built $destination"
