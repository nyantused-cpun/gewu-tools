# install-gewu-plugins：格物审视面插件（gewu-tools）一键安装/卸载/验证
# 独立发布项目（2026-08-16）：@gewu/dsh-tools + gewu_prep/gewu_locate。
# 安装位：<workspace>\.dsh\gewu-tools（Junction 指向本项目，由本脚本维护）。
#
# 用法：
#   pwsh gewu\scripts\install-gewu-plugins.ps1 -Install    # 安装（幂等）
#   pwsh gewu\scripts\install-gewu-plugins.ps1 -Verify     # 只验证不落盘
#   pwsh gewu\scripts\install-gewu-plugins.ps1 -Uninstall  # 卸载
#   pwsh gewu\scripts\install-gewu-plugins.ps1 -DryRun     # 报告计划不执行
#
# 说明：向 DSH agent preset（默认 pre-sales，环境变量 GEWU_PRESET 可覆盖）追加挂载行
# （绝对路径引用；Node ESM 不支持目录导入，name 必须指向 index.js 文件）。
# 安装后必须重启 DSH 会话才生效（host 插件无 HMR）。
# 退出码：0 = 成功或跳过；1 = 任何失败。

param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Verify,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$gewuRoot = Split-Path -Parent $scriptRoot                      # gewu\scripts\.. = 本项目根
$projRoot = Split-Path -Parent (Split-Path -Parent $scriptRoot) # 工作区根（脚本位置两级向上）
$dshHome = Join-Path $env:USERPROFILE ".dsh"
if ($env:GEWU_PRESET) { $presetFile = $env:GEWU_PRESET }
else { $presetFile = Join-Path $dshHome ".agent-presets\pre-sales\agent.cordis.yml" }
$presetBak = "$presetFile.bak-gewu"
$lockPath = Join-Path $dshHome ".gewu-plugins-install.lock"
# 安装位（Junction -> 本项目根）；preset 引用此路径，校验整条链
$mountDir = Join-Path $projRoot ".dsh\gewu-tools"
$mountName = ($projRoot -replace '\\', '/') + "/.dsh/gewu-tools/index.js"
# node 探测（Verify 的 import 加载验证用）：PATH 优先
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { Write-Host "未找到 node（Node 24+），import 加载验证将跳过。"; $nodeExe = "" }

# 挂载行（与 preset 内 gewu-tools 行一致；Install 追加在文件末尾）
$mountLines = @(
    "",
    "# ── 格物（Gewu）审视面插件（install-gewu-plugins.ps1 维护；2026-08-16 独立发布）───",
    "- id: gewu-tools",
    "  name: `"$mountName`"",
    "  config: {}"
)
$mountNeedle = '"' + $mountName + '"'

function Write-Step([string]$msg) { Write-Host "  $msg" }

function Test-MountPresent {
    if (-not (Test-Path $presetFile)) { return $false }
    return (Get-Content $presetFile -Raw -Encoding UTF8).Contains($mountNeedle)
}

function Test-MountChain {
    # 项目源存在 且 安装位 junction 指向项目根 且 index.js 可达
    if (-not (Test-Path (Join-Path $gewuRoot "index.js"))) { return $false }
    if (-not (Test-Path (Join-Path $mountDir "index.js"))) { return $false }
    $item = Get-Item $mountDir -Force
    if ($item.LinkType -ne "Junction") { return $false }
    return ($item.Target -eq $gewuRoot)
}

function Test-ModuleLoads {
    # 真加载验证：经安装位路径 import 插件模块（验证 junction 链 + import 解析 + 语法）
    if (-not $nodeExe) { Write-Host "  [load] 跳过（无 node）"; return $true }
    $fileUrl = "file:///" + ((Join-Path $mountDir "index.js") -replace '\\', '/')
    $code = "const m = await import('$fileUrl'); console.log('MODULE_OK:' + m.name + ':' + (typeof m.apply));"
    $out = & $nodeExe --input-type=module -e $code 2>&1
    if ($LASTEXITCODE -ne 0) { return $false }
    return ($out -match 'MODULE_OK:gewu-tools:function')
}

function Add-Mount {
    $content = Get-Content $presetFile -Raw -Encoding UTF8
    Copy-Item $presetFile $presetBak -Force
    $content = $content.TrimEnd() + "`r`n" + ($mountLines -join "`r`n") + "`r`n"
    Set-Content -Path $presetFile -Value $content -Encoding UTF8 -NoNewline
}

function Remove-Mount {
    # 移除 gewu-tools 行三元组 + 紧邻的格物注释行（含手工插入的注释块）
    $lines = Get-Content $presetFile -Encoding UTF8
    $keep = New-Object System.Collections.Generic.List[string]
    $skipComment = $false
    foreach ($line in $lines) {
        if ($line -match '^#.*(格物|Gewu|gewu)') { $skipComment = $true; continue }
        if ($line -match '^\s*$' -and $skipComment) { $skipComment = $false; continue }
        if ($line -match '^- id: gewu-tools$') {
            $skipComment = $true  # 吃掉后续 name/config 行
            continue
        }
        if ($line -match 'gewu-tools/index\.js' -or $line -match '^\s*config: \{\}\s*$') {
            if ($skipComment) { $skipComment = $false; continue }
        }
        $keep.Add($line)
    }
    $content = ($keep -join "`r`n").TrimEnd() + "`r`n"
    Set-Content -Path $presetFile -Value $content -Encoding UTF8 -NoNewline
}

try {
    if (Test-Path $lockPath) {
        $lockAge = (Get-Date) - (Get-Item $lockPath).LastWriteTime
        if ($lockAge.TotalMinutes -lt 10) { Write-Host "另一 setup 实例运行中（锁存在），本次跳过。"; exit 0 }
        Remove-Item $lockPath -Force
    }
    Set-Content -Path $lockPath -Value "locked" -Encoding UTF8

    if ($Verify) {
        Write-Host "== 格物审视面插件验证 =="
        $ok = $true
        $m = Test-MountPresent;  Write-Host ("  [preset] 挂载行        {0}" -f $(if ($m) { "OK" } else { "MISSING" })); if (-not $m) { $ok = $false }
        $c = Test-MountChain;    Write-Host ("  [chain] 项目源+junction {0}" -f $(if ($c) { "OK" } else { "FAIL" })); if (-not $c) { $ok = $false }
        $l = Test-ModuleLoads;   Write-Host ("  [load]  import 验证     {0}" -f $(if ($l) { "OK" } else { "FAIL" })); if (-not $l) { $ok = $false }
        Write-Host $(if ($ok) { "验证通过。" } else { "验证失败，见上方。" })
        exit $(if ($ok) { 0 } else { 1 })
    }

    if ($Uninstall) {
        if (-not (Test-MountPresent)) { Write-Host "未安装（无挂载行），跳过。"; exit 0 }
        if (Test-Path $presetBak) { Remove-Item $presetBak -Force }
        Remove-Mount
        Write-Host "已卸载（preset 挂载行已移除）。重启 dsh web 生效。"
        exit 0
    }

    # Install / DryRun
    if (Test-MountPresent -and (Test-MountChain)) {
        Write-Step "已安装且一致（幂等跳过）"
        if ($DryRun) { Write-Step "[DryRun] 不落盘" }
        exit 0
    }
    if (-not (Test-Path (Join-Path $gewuRoot "index.js"))) { Write-Host "项目源码缺失：$gewuRoot"; exit 1 }
    if (-not (Test-MountChain)) {
        Write-Host "安装位 junction 异常：$mountDir 应指向 $gewuRoot（安装位由项目自带脚本/发布流程建立，勿手工删除）" -ForegroundColor Yellow
        if (-not (Test-Path $mountDir)) {
            New-Item -ItemType Junction -Path $mountDir -Target $gewuRoot | Out-Null
            Write-Step "已重建安装位 Junction: $mountDir -> $gewuRoot"
        }
    }
    Write-Step "计划：pre-sales preset 追加 gewu-tools 挂载行（先备份 $presetBak）"
    if ($DryRun) { Write-Step "[DryRun] 不落盘"; exit 0 }

    if (Test-MountPresent) { Write-Step "挂载行已存在，跳过写入" }
    else { Add-Mount; Write-Step "已写入挂载行" }

    if (-not (Test-ModuleLoads)) { Write-Host "警告：模块加载验证未通过，请检查 index.js 语法/依赖链"; exit 1 }
    Write-Host "安装完成。请重启 dsh web 后生效，验证：pwsh gewu\scripts\install-gewu-plugins.ps1 -Verify"
    exit 0
} finally {
    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}
