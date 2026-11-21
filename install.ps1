#requires -Version 5.1
<#
.SYNOPSIS
    Mem0 for DeepSeek Harness —— 一键部署后端。

.DESCRIPTION
    检查 Python、创建虚拟环境、安装依赖、生成目录与密钥文件，最后可选自检。
    不安装 DSH 插件本身；装完脚本后到 DSH 的插件页添加 bundle 目录即可。

.PARAMETER Home
    Mem0 部署根目录。默认 E:\mem0。

.PARAMETER SkipVerify
    跳过最后一步自检（自检会调用一次 embedding API）。

.EXAMPLE
    .\install.ps1
    .\install.ps1 -Home 'D:\mem0'
#>
[CmdletBinding()]
param(
    [string]$Home = 'E:\mem0',
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$appSrc = Join-Path $scriptRoot 'app'
$bundleSrc = Join-Path $scriptRoot 'bundle'

function Write-Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Write-Ok([string]$text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Write-Warn2([string]$text) { Write-Host "    !   $text" -ForegroundColor Yellow }

if (-not (Test-Path $appSrc)) { throw "找不到 app 目录：$appSrc（请在仓库根目录运行本脚本）" }

# ---------------------------------------------------------------- 1. Python
Write-Step "检查 Python"
$python = $null
foreach ($candidate in @('py -3', 'python')) {
    try {
        $parts = $candidate -split ' '
        $exe = $parts[0]
        $pre = if ($parts.Length -gt 1) { @($parts[1]) } else { @() }
        $v = & $exe @pre -c "import sys;print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($LASTEXITCODE -eq 0 -and [version]$v -ge [version]'3.10') {
            $python = @{ Exe = $exe; Pre = $pre; Version = $v }
            break
        }
    } catch { }
}
if (-not $python) {
    throw "需要 Python 3.10 或更高版本。请从 https://www.python.org/downloads/ 安装，安装时勾选 'Add python.exe to PATH'。"
}
Write-Ok "Python $($python.Version)（$($python.Exe)）"

# ---------------------------------------------------------------- 2. 目录
Write-Step "创建目录 $Home"
foreach ($d in @('app', 'data', 'export', 'snapshots')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Home $d) | Out-Null
}
Write-Ok "$Home\{app,data,export,snapshots}"

# ---------------------------------------------------------------- 3. venv
Write-Step "准备虚拟环境"
$venvPy = Join-Path $Home '.venv\Scripts\python.exe'
if (Test-Path $venvPy) {
    Write-Ok "已存在，复用"
} else {
    & $python.Exe @($python.Pre) -m venv (Join-Path $Home '.venv')
    if ($LASTEXITCODE -ne 0) { throw "创建虚拟环境失败" }
    Write-Ok "已创建 $(Join-Path $Home '.venv')"
}

Write-Step "安装依赖（首次约 1–3 分钟）"
& $venvPy -m pip install --upgrade pip --quiet
& $venvPy -m pip install -r (Join-Path $scriptRoot 'requirements.txt') --quiet
if ($LASTEXITCODE -ne 0) { throw "pip 安装失败。若卡在下载，可先设置代理或换用国内镜像：`n  & '$venvPy' -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple" }
Write-Ok "mem0ai + mcp 就绪"

# ---------------------------------------------------------------- 4. 应用代码
Write-Step "复制应用代码"
Copy-Item (Join-Path $appSrc '*') (Join-Path $Home 'app') -Recurse -Force
Write-Ok "$Home\app"

# ---------------------------------------------------------------- 5. 插件包
Write-Step "复制 DSH 插件包"
$bundleDst = Join-Path $Home 'dsh-bundle'
New-Item -ItemType Directory -Force -Path $bundleDst | Out-Null
Copy-Item (Join-Path $bundleSrc '*') $bundleDst -Recurse -Force
Write-Ok $bundleDst

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpm) {
    Push-Location $bundleDst
    try {
        & pnpm add '@deepseek-ai/schemastery@~3.19.0' --silent 2>$null
        if (Test-Path (Join-Path $bundleDst 'node_modules\@deepseek-ai\schemastery')) {
            Write-Ok "插件依赖 schemastery 已安装"
        } else {
            Write-Warn2 "schemastery 安装可能失败，安装插件后若报 ERR_MODULE_NOT_FOUND，请在此目录重跑：pnpm add @deepseek-ai/schemastery@~3.19.0"
        }
    } finally { Pop-Location }
} else {
    Write-Warn2 "未找到 pnpm。安装 DSH 插件后若报 ERR_MODULE_NOT_FOUND，请先安装 pnpm（npm i -g pnpm），再在本目录运行 pnpm add @deepseek-ai/schemastery@~3.19.0"
}

# ---------------------------------------------------------------- 6. 密钥
Write-Step "配置 API 密钥"
$secretsPath = Join-Path $Home 'secrets.json'
if (Test-Path $secretsPath) {
    Write-Ok "secrets.json 已存在，保留现有配置"
} else {
    Write-Host @"
    需要两个密钥，原因见 README「为什么需要两个 Key」：
      1. DeepSeek      —— 用来把对话抽取成事实（写入时调用）
      2. Embedding 服务 —— 用来把文字变成向量（DeepSeek 没有 embedding 接口）
"@ -ForegroundColor DarkGray
    $ds = Read-Host '    DeepSeek API Key (sk-...，留空跳过)'
    $sf = Read-Host '    Embedding 服务 API Key (sk-...，留空跳过)'
    $obj = [ordered]@{ deepseek_api_key = $ds; siliconflow_api_key = $sf }
    [IO.File]::WriteAllText($secretsPath, ($obj | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
    Write-Ok "已写入 $secretsPath"
    if (-not $ds -or -not $sf) {
        Write-Warn2 "有密钥为空。可以稍后编辑该文件补上，或改用环境变量。"
    }
}

# ---------------------------------------------------------------- 7. 自检
if ($SkipVerify) {
    Write-Step "跳过自检（-SkipVerify）"
} else {
    Write-Step "自检"
    & $venvPy (Join-Path $Home 'app\verify.py')
    if ($LASTEXITCODE -ne 0) {
        Write-Warn2 "自检未全部通过。常见原因：密钥未填、embedding 服务额度不足。"
    }
}

# ---------------------------------------------------------------- 完成
Write-Host @"

部署完成。

下一步：装 DSH 插件
  1. 打开 DSH → 插件页 → Add plugin
  2. 选择目录：$bundleDst
  3. 插件激活后，在插件配置页填写路径与密钥（也可继续用 secrets.json）

常用命令：
  $venvPy "$Home\app\mem0_cli.py" doctor
  $venvPy "$Home\app\mem0_cli.py" search "我记得什么"
  $venvPy "$Home\app\mem0_cli.py" export
"@ -ForegroundColor Gray
