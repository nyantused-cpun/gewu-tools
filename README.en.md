# gewu-tools (格物)

[![npm](https://img.shields.io/npm/v/gewu-tools.svg)](https://www.npmjs.com/package/gewu-tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The Gewu Inspection Surface**: let text-only models in DSH complete visual-inspection tasks through vision subagents.

> 格物 (Gewu): from the *Great Learning* — "investigate things to attain knowledge." Look carefully first, then conclude.
> 中文: [README.md](README.md)

## Quick install (npm)

```powershell
npm i gewu-tools
pwsh node_modules\gewu-tools\scripts\install-gewu-plugins.ps1 -Install   # idempotent mount into DSH
# Or install directly through the DSH plugin manager (requires the dsh.bundle manifest)
dsh plugin add gewu-tools
# Restart the DSH session; gewu_prep / gewu_locate appear in the tool catalog. -Verify = 4 greens.
# Optional: inject a custom preset (defaults to community, zero injection; GEWU_BRIEF_PRESET also works)
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install -Preset <preset-file-path>
```

## Problem

The DSH session brain is usually a **text-only model** — it cannot see rendered pages, so it cannot answer "does this proposal page look good / crowded / misaligned?" Vision subagents (e.g. `subagent_vision`, mimo-v2.5, qwen3.7-plus) can see, but have two weaknesses:

1. **No session context**: they don't know client ground rules or business-marker semantics (e.g. ⭐ = "core capability", not decoration), so intentional design gets reported as defects;
2. **They misread**: OCR-level character errors, and page attribution drifted by screenshot viewport boundaries.

gewu-tools packages a three-step pipeline (validated on a 24-page proposal, 2026-08-16) into two tools:

```
① gewu_prep    screenshot + briefing: renders an HTML document page-by-page and generates a
               complete vision-subagent briefing contract (discipline / artifact / attribution rules)
② vision subagent    dispatch: the main agent calls DSH's native vision subagent with the briefing
③ gewu_locate  truth verification: locates a text/number from the review back into the HTML source
               (page section id + line number); count=0 means OCR misread — do not trust it
```

## Model-agnostic statement

Validated on vision subagents **mimo-v2.5 (conservative)** and **qwen3.7-plus (more insightful, slightly more false positives)**. Finding: **model tier does not determine the trustworthiness of review results** —

- The **briefing contract (context)** eliminates context-free false positives: e.g. reporting business markers like ⭐ (core capability) as decorative emoji — observed systematically in the no-briefing plugin mode during testing;
- The **truth-verification loop (`gewu_locate`)** blocks OCR misreads and page-attribution drift before acceptance: in testing, 2.5 of qwen3.7-plus's 3 core new claims failed source-code verification — all were caught by the verification step.

Tier differences only show up in **review style** (higher-tier = sharper insight, steadier = more conservative conclusions), not in correctness. With any vision model, the pipeline output stays trustworthy and auditable — which is exactly why verification is hard-wired as the third step.

## Install

Prereqs: Windows + Chrome/Edge + Node 24+ (for the verify script only).

```powershell
# Direct install through the DSH plugin manager (requires the dsh.bundle manifest)
dsh plugin add gewu-tools
# Or use the bundled installer for local junction mounting and custom presets
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install    # idempotent
pwsh gewu\scripts\install-gewu-plugins.ps1 -Verify     # verify only
pwsh gewu\scripts\install-gewu-plugins.ps1 -Uninstall  # remove
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install -Preset <preset-file-path>  # optional custom preset
```

`-Preset` injects a custom briefing preset. If omitted, the installer uses `community` (zero injection); you can also set the `GEWU_BRIEF_PRESET` environment variable instead.

The script appends a `gewu-tools` mount row to the DSH agent preset (default `pre-sales`, override with env `GEWU_PRESET`), pointing at `<workspace>\.dsh\gewu-tools` (a Junction to this project).

**Restart the DSH session after install** (host plugins have no HMR). Verification: `install-gewu-plugins.ps1 -Verify` expects 4 greens (preset mount row / junction chain / import load / preset loading).

## Usage (main-agent view)

```text
1. gewu_prep(html_path="...", client="<client>", background="<ground rules / marker semantics>")
   → { pages: [...], briefing: "..." }
2. Call a vision subagent with the briefing as its prompt → per-page issue list + conclusions
3. gewu_locate(html_path=..., needle=<text/number from the findings>) for every key finding
```

## Custom preset injection

A preset is gewu-tools' extension point: put your own design standards or acceptance criteria into a preset file, and `gewu_prep` injects them into the briefing so the vision subagent reviews against the same yardstick. The default `community` preset injects nothing and keeps the 1.0.0 community baseline.

| Field | Type | Description |
|---|---|---|
| `name` | string | Non-empty preset name. |
| `version` | string | Non-empty preset version. |
| `defaultFocus` | string \| null | Overrides the default focus list; pass `null` to keep the built-in default. |
| `sections` | string[] | Sections injected into the briefing (design standard / acceptance criteria); each section ≤ 2,000 characters, total ≤ 8,000 characters. |
| `dispatchHints` | string \| null | Dispatch hints (e.g. how many pages to review per pass); nullable. |
| `requires` | object | Reserved extension dependency declaration; an invalid object causes degradation. |

Minimal example `brief-preset.js`:

```js
export default {
  name: "my-design-standard",
  version: "1.0.0",
  defaultFocus: "layout consistency, information density, chart readability",
  sections: [
    "Visual standard: primary color #123456, left-aligned titles, 24px card spacing.",
    "Acceptance criteria: each page must have one core claim; key data must match business-marker semantics."
  ],
  dispatchHints: null,
  requires: {}
};
```

If a preset file is invalid (not an object, missing `name`/`version`, wrong field types, `sections` too long, etc.), gewu-tools falls back to `community` and returns `preset_degraded: true` with `preset_error` explaining why.

## CLI usage (cross-host)

`index.js` works without DSH. Non-DSH hosts (Trae/Codex/Kimi, etc.) can use this CLI to get the same screenshot + briefing + verification artifacts as the plugin.

```powershell
# Screenshot + briefing (same source as gewu_prep)
node gewu\index.js --prep <html> [--client <client>] [--background "..."] [--focus "..."] [--out-dir <dir>] [--width <n>] [--height <n>] [--nav-offset <n>]

# Truth verification (same source as gewu_locate)
node gewu\index.js --locate <html> --needle "<text/number>" [--max-matches <n>]

# Smoke alias (old positional form)
node gewu\index.js <html> [outDir]
```

Artifacts: `--prep` writes `prep_result.json` + `briefing.txt` to `--out-dir` (default `_tmp_vision_test/<file>_shots`); `--locate` writes `locate_result.json` to `_tmp_vision_test/<file>_locate/`.

Exit codes: `0` success; `1` runtime/business failure (HTML missing, screenshot failure, etc.); `2` usage error.

## How it works

- **Screenshots**: reads `<section>` anchors (prefers `v2-page` class), captures each page via headless Chrome viewport; sticky nav pushed out by iframe offset; falls back to a full-page shot when no anchors exist. Chrome is spawned from the host process, bypassing the restricted sandbox's named-pipe limitation.
- **Briefing contract** (baked into `briefing`):
  - discipline: subagent skips entry protocols, never asks the user, reads images via `read_image` (prevents deadlocks);
  - artifact notice: fixed-viewport screenshots concatenate page boundaries — a next-section header at the bottom is an artifact, not a design flaw; attribution rule: content from the next section belongs to the next page;
  - output spec: per-page "page｜issue｜severity｜fix", visible issues only.
- **Truth verification**: locates each `needle` occurrence in source, returning page section id + line number + tag-stripped snippet.

## Test

```powershell
node gewu\index.js <any HTML with section anchors> [outDir]   # standalone smoke, no DSH needed
```

## Directory structure

```
gewu/
├── index.js                # plugin body (cordis + defineTool, standalone CLI entry)
├── package.json            # gewu-tools (dsh.bundle manifest)
├── cordis.patch.yml        # dsh plugin add mount patch
├── presets/                # built-in community preset and preset contract
├── README.md / README.en.md
├── CHANGELOG.md
├── LICENSE                 # MIT
├── docs/TESTING.md         # testing methodology and results
└── scripts/install-gewu-plugins.ps1   # install script (Install/Verify/Uninstall/DryRun)
```

## Compatibility

- DSH 0.1.0-rc.6 (cordis plugin + defineTool surface)
- Peer dependency: `@deepseek-ai/dsh-tools` only (resolved via the workspace AiBridge junction)
- Browser: auto-detects Chrome/Edge, no config

## Related links

The following projects complement the gewu ecosystem.

- [Lanting Folio](https://github.com/nyantused-cpun/folio): deep-context review engine
- [dsh-vision-toolkit](https://github.com/Anionex/dsh-vision-toolkit): general-purpose vision toolbox; complementary to this project — it lets models see, gewu makes reviews trustworthy
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

## License

MIT — see [LICENSE](LICENSE). Version 1.1.0 (2026-08-17).