// gewu-tools：格物审视面插件（无视觉主脑 -> 视觉子代理完成视觉检验）
//
// 独立项目：本目录（单一事实源）；安装位与社区通道为 Junction 指向本项目。改名/改版只动本目录。
//
// 定位：让 DSH 中无视觉能力的模型（主脑）通过视觉子代理完成需要视觉检验的项目。封装三步
// 流水线（截图 -> 简报审阅 -> 真值核验），本插件提供其中 1+3 步：
//   1. gewu_prep        准备层：HTML 按锚点分区逐页截图（宿主进程直起 headless Chrome，
//                      绕开受限沙箱对子进程命名管道的限制）+ 自动生成简报契约全文（纪律
//                      声明/伪影声明/页码归属规则/输出要求）。主代理把返回的 briefing 全文
//                      作为 prompt 调视觉子代理（如 subagent_vision）即可。
//   2. gewu_locate      真值核验层：文本片段 -> HTML 源码定位（所在页码 section id + 行号 +
//                      脱标签摘录）。核验视觉审阅发现的 OCR 误读与页码归属偏移（实测多种
//                      视觉模型均有此类错误）。
//   （第 2 步的子代理派发本身用 DSH 原生子代理工具，本插件不重复注册。）
//
// 命名：格物（《大学》格物致知，考察事物而后知）。工具前缀 gewu_，描述开头「格物审视面：」。
//
// 实测依据（docs/TESTING.md）：24 页售前方案三路对比 + 全量源码真值核验；冷启动三坑与
// 页码偏移均已固化进简报契约与核验步骤。
//
// 接口形状：cordis 插件 + defineTool 标准形态（dsh 0.1.0-rc.6 源码级核实）。
// 子进程：直接 node:child_process（宿主进程级 spawn，不经沙箱化 subprocess 服务，Chrome 的
// mojo 命名管道在受限沙箱下会 FATAL，宿主直起无此问题）。

import { defineTool } from "@deepseek-ai/dsh-tools";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import communityPreset from "./presets/community.js";

const name = "gewu-tools";
const inject = ["tools"];

// 工作区根：宿主注入优先，回退当前工作目录
const PROJECT_DIR = process.env.DSH_PROJECT_DIR
  ?? process.env.PRESALES_PROJECT_DIR
  ?? process.cwd();
const DEFAULT_OUT_ROOT = path.join(PROJECT_DIR, "_tmp_vision_test");

const BRIEFING_VERSION = 1;
const DEFAULT_FOCUS =
  "版式构图（对齐/留白/拥挤/遮挡）；视觉规范一致性（主色/角色色/层级）；信息密度（过高读不动/过低显空）；图表可读性（连线/标签/图例与图内色码同源）；每页核心论断是否一眼可见；跨页一致性（编号体系/图例/色编码）。";

// ---------- 通用 ----------

function clamp(n, lo, hi) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function fileUrlOf(p) {
  return encodeURI("file:///" + String(p).replace(/\\/g, "/"));
}

function findBrowser() {
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const candidates = [
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

function shotOne(browser, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(browser, args, { stdio: "ignore", windowsHide: true });
    } catch (e) {
      resolve({ code: -2, error: String(e) });
      return;
    }
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: -1, timeout: true });
    }, timeoutMs);
    child.on("error", (e) => finish({ code: -2, error: String(e) }));
    child.on("close", (code) => finish({ code }));
  });
}

// ---------- 截图层 ----------

function extractSections(html) {
  const out = [];
  const rx = /<section\b[^>]*>/g;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const tag = m[0];
    const idM = /\bid="([^"]+)"/.exec(tag);
    if (!idM) continue;
    const clsM = /\bclass="([^"]*)"/.exec(tag);
    out.push({ id: idM[1], cls: clsM ? clsM[1] : "", index: m.index });
  }
  return out;
}

function anchorIds(html) {
  const all = extractSections(html).filter((s) => s.id);
  const v2 = all.filter((s) => /(^|\s)v2-page(\s|$)/.test(s.cls));
  return (v2.length ? v2 : all).map((s) => s.id);
}

async function runShots(opts) {
  const { htmlPath, outDir, width, height, navOffset } = opts;
  let html;
  try {
    html = fs.readFileSync(htmlPath, "utf8");
  } catch (e) {
    return { ok: false, pages: [], failed: [], error: "读取 HTML 失败：" + String(e && e.message) };
  }
  const browser = findBrowser();
  if (!browser) return { ok: false, pages: [], failed: [], error: "未找到本机 Chrome/Edge" };
  fs.mkdirSync(outDir, { recursive: true });
  const profile = path.join(outDir, "_profile");
  const baseArgs = [
    "--headless=new",
    "--disable-gpu",
    "--allow-file-access-from-files",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
  ];
  let wrapperPath = null;
  try {
    const ids = anchorIds(html);
    if (!ids.length) {
      const out = path.join(outDir, "full.png");
      const r = await shotOne(
        browser,
        [...baseArgs, `--window-size=${width},6000`, "--virtual-time-budget=8000", `--screenshot=${out}`, fileUrlOf(htmlPath)],
        60000,
      );
      const ok = r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 5000;
      if (!ok) return { ok: false, pages: [], failed: [], error: "整页截图失败：" + JSON.stringify(r) };
      return { ok: true, mode: "fullpage", pages: [{ id: "full", file: out, bytes: fs.statSync(out).size }], failed: [] };
    }
    wrapperPath = path.join(path.dirname(htmlPath), "_shot_wrapper.html");
    const wrapper = [
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>shot wrapper</title><style>',
      `  html, body { margin:0; padding:0; height:${height}px; overflow:hidden; background:#fff; }`,
      `  iframe { position:absolute; top:-${navOffset}px; left:0; width:${width}px; height:${height + navOffset}px; border:0; }`,
      "</style></head><body><iframe id=\"f\"></iframe><script>",
      `  var p = new URLSearchParams(location.search).get('page') || '${ids[0]}';`,
      `  document.getElementById('f').src = '${fileUrlOf(htmlPath)}#' + p;`,
      "</script></body></html>",
    ].join("\n");
    fs.writeFileSync(wrapperPath, wrapper, "utf8");
    const wrapperUrl = fileUrlOf(wrapperPath);
    const pages = [];
    const failed = [];
    for (const id of ids) {
      const out = path.join(outDir, id + ".png");
      const r = await shotOne(
        browser,
        [
          ...baseArgs,
          `--window-size=${width},${height}`,
          "--virtual-time-budget=8000",
          `--screenshot=${out}`,
          `${wrapperUrl}?page=${encodeURIComponent(id)}`,
        ],
        45000,
      );
      const ok = r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 5000;
      if (ok) pages.push({ id, file: out, bytes: fs.statSync(out).size });
      else failed.push(id);
    }
    return { ok: failed.length === 0, mode: "anchors", pages, failed };
  } finally {
    if (wrapperPath) {
      try { fs.rmSync(wrapperPath, { force: true }); } catch {}
    }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

// ---------- preset 加载层 ----------

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function normalizePreset(raw, extra = {}) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {
    name: src.name ?? "community",
    version: src.version ?? "1",
    defaultFocus: src.defaultFocus ?? null,
    sections: Array.isArray(src.sections) ? src.sections : [],
    dispatchHints: src.dispatchHints ?? null,
    requires:
      src.requires && typeof src.requires === "object" && !Array.isArray(src.requires)
        ? src.requires
        : {},
    degraded: Boolean(extra.degraded),
  };
  if (extra.error !== undefined) out.error = extra.error;
  return out;
}

function validatePreset(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "preset 必须导出纯数据对象" };
  }
  if (!isNonEmptyString(raw.name)) {
    return { ok: false, error: "preset.name 必须为非空字符串" };
  }
  if (!isNonEmptyString(raw.version)) {
    return { ok: false, error: "preset.version 必须为非空字符串" };
  }
  if (raw.defaultFocus !== null && typeof raw.defaultFocus !== "string") {
    return { ok: false, error: "preset.defaultFocus 必须为 string|null" };
  }
  if (!Array.isArray(raw.sections)) {
    return { ok: false, error: "preset.sections 必须为字符串数组" };
  }
  for (const s of raw.sections) {
    if (typeof s !== "string") {
      return { ok: false, error: "preset.sections 必须全为字符串" };
    }
    if (s.length > 2000) {
      return { ok: false, error: "preset.sections 单段超过 2000 字" };
    }
  }
  const totalLength = raw.sections.reduce((sum, s) => sum + s.length, 0);
  if (totalLength > 8000) {
    return { ok: false, error: "preset.sections 总长超过 8000 字" };
  }
  if (raw.dispatchHints !== null && typeof raw.dispatchHints !== "string") {
    return { ok: false, error: "preset.dispatchHints 必须为 string|null" };
  }
  if (!raw.requires || typeof raw.requires !== "object" || Array.isArray(raw.requires)) {
    return { ok: false, error: "preset.requires 必须为对象" };
  }
  return { ok: true };
}

const DEFAULT_PRESET = normalizePreset(communityPreset);

async function resolvePreset(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const explicitPath =
    cfg.presetPath !== undefined && cfg.presetPath !== null && cfg.presetPath !== ""
      ? String(cfg.presetPath)
      : "";
  const envPath =
    process.env.GEWU_BRIEF_PRESET !== undefined &&
    process.env.GEWU_BRIEF_PRESET !== null &&
    process.env.GEWU_BRIEF_PRESET !== ""
      ? String(process.env.GEWU_BRIEF_PRESET)
      : "";
  const presetPath = explicitPath || envPath;
  if (!presetPath) return DEFAULT_PRESET;
  const absPath = path.resolve(presetPath);
  try {
    const mod = await import(pathToFileURL(absPath).href);
    const check = validatePreset(mod.default);
    if (!check.ok) {
      return normalizePreset(communityPreset, { degraded: true, error: check.error });
    }
    return normalizePreset(mod.default);
  } catch (e) {
    const reason = String((e && e.message) || e);
    return normalizePreset(communityPreset, {
      degraded: true,
      error: "preset 加载失败：" + reason,
    });
  }
}

function presetMeta(preset) {
  const meta = {
    preset: `${preset.name}@${preset.version}`,
    preset_degraded: Boolean(preset.degraded),
  };
  if (preset.degraded) meta.preset_error = preset.error;
  return meta;
}

// ---------- 简报层 ----------

function buildBriefing(o, preset = DEFAULT_PRESET) {
  const p = preset || DEFAULT_PRESET;
  const L = [];
  L.push("【视觉审阅简报（gewu_prep 自动生成，配套 subagent_vision 使用）】");
  L.push(`BRIEFING_VERSION:${BRIEFING_VERSION}`);
  L.push("");
  L.push(
    "0. 纪律声明（实测必写，违反会卡死）：你是子代理：不执行任何会话入口协议/上下文加载（那是主代理职责）；不要向用户提问，直接干活；图片用 read_image(file_path=...) 逐张读取，read 工具读不了 PNG；每次读 4-6 张分批读完，不要一次全读。",
  );
  L.push("");
  L.push(
    "1. 客户/任务背景：" +
      (o.client ? `客户「${o.client}」。` : "") +
      (o.background || "（主代理按需补充：项目定位/关键决策/铁律/业务标记语义，例如 ⭐=核心能力铁律标记，不是装饰 emoji）"),
  );
  L.push("");
  L.push(`2. 材料：全稿 ${o.pages.length} 页渲染截图（${o.width}x${o.height}），逐张读取：`);
  for (const p of o.pages) L.push(`   - ${p.file}（${p.id}）`);
  L.push("");
  L.push(
    "3. 伪影声明：截图为固定视口捕获，页面底部出现下一节标题属截图串页，非设计问题；底部截断需区分「页面设计」与「截图边界」；页码归属规则：视口内出现的下一节内容一律归到下一页的页码名下。",
  );
  L.push("");
  for (const section of p.sections) {
    L.push(`〔preset:${p.name}@${p.version}〕`);
    L.push(section);
    L.push("");
  }
  L.push(
    "4. 关注问题：" +
      (o.focus || p.defaultFocus || DEFAULT_FOCUS),
  );
  L.push("");
  L.push(
    "5. 输出要求：逐页「页码｜问题描述｜严重度（高/中/低）｜具体修改建议」+ 整体 3-5 条结论；只报告截图中可见的问题，不臆测看不到的内容；无法确定的标注「不确定」。",
  );
  L.push("");
  if (p.dispatchHints) {
    L.push(p.dispatchHints);
  } else {
    L.push(
      "【主代理流程】① 将本简报全文作为 prompt 调用 subagent_vision（≤6 页抽查或整稿审阅同法）；② 收到审阅结果后，对每条关键发现调用 gewu_locate(html_path, needle=发现中的文字/数字) 核验：文字是否 OCR 误读、页码归属是否被串页带偏；③ 与源码对不上的发现不采信或降级。",
    );
  }
  return L.join("\n");
}

// ---------- 真值核验层 ----------

function locate(htmlPath, needle, maxMatches) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const sections = extractSections(html);
  const matches = [];
  let idx = html.indexOf(needle);
  while (idx !== -1 && matches.length < maxMatches) {
    const line = html.slice(0, idx).split("\n").length;
    let pageId = "(页首/未包裹)";
    for (const s of sections) {
      if (s.index <= idx) pageId = s.id;
      else break;
    }
    const win = html.slice(Math.max(0, idx - 150), idx + needle.length + 150);
    const snippet = win.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    matches.push({ page_id: pageId, line, snippet });
    idx = html.indexOf(needle, idx + needle.length);
  }
  return { needle, count: matches.length, matches };
}

// ---------- 插件装配 ----------

function apply(ctx, config) {
  const presetPromise = resolvePreset(config);
  ctx.tools.register(
    defineTool({
      name: "gewu_prep",
      description:
        "格物审视面：视觉审阅准备器（三步流水线第 1+2 步）。把长页 HTML 按锚点分区逐页渲染成 PNG（宿主进程直起 headless Chrome，不受 pwsh 沙箱限制），并自动生成完整的 subagent_vision 简报契约（含纪律声明/伪影声明/页码归属规则/输出要求）。用法：传入 HTML 路径 + 可选客户背景与关注问题，拿到 briefing 后将其全文作为 prompt 调 subagent_vision；返回结果再配合 gewu_locate 做真值核验。适用：方案 HTML 成品的逐页/整稿视觉审阅（看看方案好不好看/丑不丑/挤不挤）。PPTX 请先用 pptx_screenshot 渲染再走简报；无锚点 HTML 自动降级整页长截图。",
      parameters: {
        html_path: { type: "string", required: true, description: "方案 HTML 文件路径（工作区内）" },
        out_dir: { type: "string", description: "截图输出目录（默认 _tmp_vision_test/<文件名>_shots；不要放 output/ 交付区）" },
        width: { type: "number", description: "视口宽（默认 1280）" },
        height: { type: "number", description: "视口高（默认 900）" },
        nav_offset: { type: "number", description: "sticky 顶导航高度偏移（默认 64；页面无 sticky 导航可设 0）" },
        client: { type: "string", description: "客户名（写入简报背景）" },
        background: { type: "string", description: "任务背景补充：项目定位/关键决策/铁律/业务标记语义（强烈建议提供，上下文决定视觉审阅质量下限）" },
        focus: { type: "string", description: "关注问题清单（默认通用六项：版式/规范一致性/密度/图表可读性/核心论断/跨页一致性）" },
      },
      output: {
        schema: { type: "json" },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const preset = await presetPromise;
        try {
          const htmlPath = path.resolve(String(args.html_path || ""));
          if (!fs.existsSync(htmlPath)) {
            return { ok: false, error: "HTML 不存在: " + htmlPath, ...presetMeta(preset) };
          }
          const width = clamp(args.width !== undefined ? args.width : 1280, 640, 2560);
          const height = clamp(args.height !== undefined ? args.height : 900, 480, 2160);
          const navOffset = clamp(args.nav_offset !== undefined ? args.nav_offset : 64, 0, 200);
          const base = path.basename(htmlPath).replace(/\.html?$/i, "");
          const outDir = path.resolve(args.out_dir || path.join(DEFAULT_OUT_ROOT, base + "_shots"));
          const r = await runShots({ htmlPath, outDir, width, height, navOffset });
          if (!r.pages || r.pages.length === 0) {
            return {
              ok: false,
              error: r.error || "截图失败",
              failed: r.failed || [],
              ...presetMeta(preset),
            };
          }
          const briefing = buildBriefing(
            {
              client: args.client,
              background: args.background,
              focus: args.focus,
              pages: r.pages,
              width,
              height,
            },
            preset,
          );
          return {
            ok: r.ok,
            mode: r.mode,
            out_dir: outDir,
            page_count: r.pages.length,
            failed: r.failed || [],
            pages: r.pages,
            briefing,
            note: r.ok ? undefined : "部分页面截图失败（见 failed），简报仅含成功页",
            ...presetMeta(preset),
          };
        } catch (e) {
          return {
            ok: false,
            error: String((e && e.message) || e),
            ...presetMeta(preset),
          };
        }
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "gewu_locate",
      description:
        "格物审视面：真值核验器（三步流水线第 3 步）。把一段文字/数字定位到 HTML 源码（返回所在页码 section id + 行号 + 脱标签摘录）。用途：核验视觉子代理审阅发现的 ①文字/数字是否被 OCR 误读（如 三层->二宝、项->页、报价->报销）②页码归属是否被截图串页带偏（如 p11 内容记成 p10）。对不上源码的发现不采信或降级。",
      parameters: {
        html_path: { type: "string", required: true, description: "被审阅的 HTML 文件路径" },
        needle: { type: "string", required: true, description: "待核验的文字/数字片段（取审阅发现中的原文）" },
        max_matches: { type: "number", description: "最多返回匹配数（默认 8，上限 20）" },
      },
      output: {
        schema: { type: "json" },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        try {
          const htmlPath = path.resolve(String(args.html_path || ""));
          if (!fs.existsSync(htmlPath)) return { ok: false, error: "HTML 不存在: " + htmlPath };
          const needle = String(args.needle || "").trim();
          if (!needle) return { ok: false, error: "needle 为空" };
          const r = locate(htmlPath, needle, clamp(args.max_matches || 8, 1, 20));
          return Object.assign({ ok: true, html_path: htmlPath, hint: r.count === 0 ? "源码中无此文字：大概率是视觉模型 OCR 误读，该发现不采信" : undefined }, r);
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) };
        }
      },
    }),
  );
}

// ---------- standalone 冒烟（node index.js <html> [outdir]，不经 DSH 直接测核心逻辑） ----------

const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const USAGE = [
    "用法:",
    "  node index.js --prep <html_path> [--client <s>] [--background <s>] [--focus <s>] [--out-dir <s>] [--width <n>] [--height <n>] [--nav-offset <n>]",
    "  node index.js --locate <html_path> --needle <s> [--max-matches <n>]",
    "  node index.js <html_path> [outDir]   # 冒烟别名",
  ].join("\n");

  function usageError(msg) {
    process.stderr.write(`用法错误：${msg}\n\n${USAGE}\n`);
    process.exit(2);
  }

  async function runPrep(argv) {
    const args = {
      client: undefined,
      background: undefined,
      focus: undefined,
      outDir: undefined,
      width: 1280,
      height: 900,
      navOffset: 64,
    };
    let htmlArg = null;
    let i = 0;
    while (i < argv.length) {
      const a = argv[i];
      if (a === "--prep") {
        i++;
        continue;
      }
      if (a === "--client" || a === "--background" || a === "--focus" || a === "--out-dir") {
        if (i + 1 >= argv.length) usageError(`${a} 缺少值`);
        const v = argv[i + 1];
        if (a === "--client") args.client = v;
        else if (a === "--background") args.background = v;
        else if (a === "--focus") args.focus = v;
        else args.outDir = v;
        i += 2;
        continue;
      }
      if (a === "--width" || a === "--height" || a === "--nav-offset") {
        if (i + 1 >= argv.length) usageError(`${a} 缺少值`);
        const v = Number(argv[i + 1]);
        if (a === "--width") args.width = v;
        else if (a === "--height") args.height = v;
        else args.navOffset = v;
        i += 2;
        continue;
      }
      if (a.startsWith("-")) usageError(`未知参数：${a}`);
      if (htmlArg !== null) usageError(`多余的位置参数：${a}`);
      htmlArg = a;
      i++;
    }
    if (!htmlArg) usageError("--prep 缺少 <html_path>");

    const htmlPath = path.resolve(htmlArg);
    if (!fs.existsSync(htmlPath)) {
      process.stderr.write(`运行失败：HTML 不存在 ${htmlPath}\n`);
      process.exitCode = 1;
      return;
    }

    const width = clamp(args.width, 640, 2560);
    const height = clamp(args.height, 480, 2160);
    const navOffset = clamp(args.navOffset, 0, 200);
    const base = path.basename(htmlPath).replace(/\.html?$/i, "");
    const outDir = path.resolve(args.outDir || path.join(DEFAULT_OUT_ROOT, base + "_shots"));

    const preset = await resolvePreset(null);
    const r = await runShots({ htmlPath, outDir, width, height, navOffset });

    if (!r.pages || r.pages.length === 0) {
      const result = {
        ok: false,
        error: r.error || "截图失败",
        failed: r.failed || [],
        ...presetMeta(preset),
      };
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "prep_result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
      process.stderr.write(`运行失败：${result.error}\n`);
      process.exitCode = 1;
      return;
    }

    const briefing = buildBriefing(
      {
        client: args.client,
        background: args.background,
        focus: args.focus,
        pages: r.pages,
        width,
        height,
      },
      preset,
    );
    const result = {
      ok: r.ok,
      mode: r.mode,
      out_dir: outDir,
      page_count: r.pages.length,
      failed: r.failed || [],
      pages: r.pages,
      briefing,
      ...presetMeta(preset),
    };
    if (!r.ok) result.note = "部分页面截图失败（见 failed），简报仅含成功页";

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "prep_result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(outDir, "briefing.txt"), briefing + "\n", "utf8");

    console.log(`ok=${result.ok} mode=${result.mode} page_count=${result.page_count} failed=${(result.failed || []).join(",") || "-"}`);
    console.log(`preset=${result.preset} preset_degraded=${result.preset_degraded}`);
    console.log(`prep_result=${path.join(outDir, "prep_result.json")}`);
    console.log(`briefing=${path.join(outDir, "briefing.txt")}`);
    process.exitCode = result.ok ? 0 : 1;
  }

  async function runLocate(argv) {
    let htmlArg = null;
    let needle = null;
    let maxMatches = 8;
    let i = 0;
    while (i < argv.length) {
      const a = argv[i];
      if (a === "--locate") {
        i++;
        continue;
      }
      if (a === "--needle") {
        if (i + 1 >= argv.length) usageError("--needle 缺少值");
        needle = argv[i + 1];
        i += 2;
        continue;
      }
      if (a === "--max-matches") {
        if (i + 1 >= argv.length) usageError("--max-matches 缺少值");
        maxMatches = Number(argv[i + 1]);
        i += 2;
        continue;
      }
      if (a.startsWith("-")) usageError(`未知参数：${a}`);
      if (htmlArg !== null) usageError(`多余的位置参数：${a}`);
      htmlArg = a;
      i++;
    }
    if (!htmlArg) usageError("--locate 缺少 <html_path>");
    if (!needle) usageError("--locate 缺少 --needle <s>");

    const htmlPath = path.resolve(htmlArg);
    if (!fs.existsSync(htmlPath)) {
      const result = { ok: false, error: "HTML 不存在: " + htmlPath };
      process.stderr.write(`运行失败：${result.error}\n`);
      process.exitCode = 1;
      return;
    }

    const needleValue = String(needle).trim();
    if (!needleValue) {
      process.stderr.write("运行失败：needle 为空\n");
      process.exitCode = 1;
      return;
    }

    const r = locate(htmlPath, needleValue, clamp(maxMatches || 8, 1, 20));
    const result = Object.assign(
      {
        ok: true,
        html_path: htmlPath,
        hint: r.count === 0 ? "源码中无此文字：大概率是视觉模型 OCR 误读，该发现不采信" : undefined,
      },
      r,
    );

    const base = path.basename(htmlPath).replace(/\.html?$/i, "");
    const outDir = path.join(DEFAULT_OUT_ROOT, base + "_locate");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "locate_result.json");
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + "\n", "utf8");

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 0;
  }

  async function runSmoke(argv) {
    const target = argv[0];
    if (!target) usageError("缺少 <html_path>");
    const htmlPath = path.resolve(target);
    const base = path.basename(htmlPath).replace(/\.html?$/i, "");
    const outDir = path.resolve(argv[1] || path.join(DEFAULT_OUT_ROOT, base + "_smoke"));
    const t0 = Date.now();
    const r = await runShots({ htmlPath, outDir, width: 1280, height: 900, navOffset: 64 });
    if (!r.pages || r.pages.length === 0) {
      process.stderr.write(`运行失败：${r.error || "截图失败"}\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`mode=${r.mode} ok=${r.ok} pages=${r.pages.length} failed=${(r.failed || []).join(",") || "-"} ${Date.now() - t0}ms`);
    const briefing = buildBriefing({ client: "冒烟测试", pages: r.pages, width: 1280, height: 900 });
    console.log("---- briefing 前 12 行 ----");
    console.log(briefing.split("\n").slice(0, 12).join("\n"));
    const loc = locate(htmlPath, "104", 5);
    console.log("---- locate('104') ----");
    console.log(JSON.stringify(loc, null, 1).slice(0, 900));
    process.exitCode = 0;
  }

  const argv = process.argv.slice(2);
  if (argv.length === 0) usageError("缺少命令");

  const first = argv[0];
  if (first.startsWith("-")) {
    if (first !== "--prep" && first !== "--locate") usageError(`未知参数：${first}`);
  }

  (async () => {
    try {
      if (first === "--prep") {
        if (argv.includes("--locate")) usageError("--prep 与 --locate 不能混用");
        await runPrep(argv);
      } else if (first === "--locate") {
        if (argv.includes("--prep")) usageError("--prep 与 --locate 不能混用");
        await runLocate(argv);
      } else {
        await runSmoke(argv);
      }
    } catch (e) {
      process.stderr.write(`运行失败：${(e && e.message) || e}\n`);
      process.exitCode = 1;
    }
  })();
}

export { apply, inject, name, buildBriefing, resolvePreset };
