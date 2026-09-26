# Electrobun → Electron: benefits, drawbacks, and migration cost

**Date:** 2026 (research snapshot)
**Question:** Should an Electrobun-based desktop app be migrated to Electron?
**Basis:** primary sources (Electrobun docs/changelog/repo/issues, Electron docs) + measurements taken on this machine from the workspace's own builds. Confidence noted per section; every non-obvious claim has a link.

> **Assumed context.** The candidate apps in this workspace are `werk-3/apps/desktop` (Electrobun, `bundleCEF: true` on Linux) and `web/leitfaden` (Electrobun, native WebKitGTK). `scrnsvr` is already Electron 44 + electron-builder and serves as an in-house reference implementation of the target stack. If you meant a different repo, the framework-level analysis still holds; the measured numbers are from these three.

---

## 0. Bottom line

**Migration is defensible primarily as an operational risk decision, not a technical-performance one.**

- Electron wins decisively on **packaging/updating/signing/distribution, security defaults, tooling and long-term maintenance confidence**. Two independent teams publicly migrated away from Electrobun for exactly these reasons and reported the migration being cheap because the runtime was already abstracted.
- Electron loses on **download size** (real and user-visible) and **cold-start/RAM floor**. It does *not* lose on **installed size on Linux** — see §1, where the numbers invert the marketing.
- Electrobun's **current security posture is the strongest single argument for moving**: no update signature verification, no `contextIsolation` equivalent, no sandbox by default, RPC encryption key readable from page JS, and open unfixed transport issues ([#518](https://github.com/blackboardsh/electrobun/issues/518)).
- Electrobun's **framework risk is elevated but not disqualifying**: bus factor of one, no changelog, no migration guides, version numbers with no stability contract, and a mid-flight main-process runtime change in the 2.0 line (Bun → Cottontail).
- The decisive counter-argument: **on Linux with CEF you already ship Chromium**. You pay the Chromium cost and still lose the ecosystem. That is the weakest possible position (§1.3).

**Recommendation:** migrate for anything user-facing or agent-facing with real OS integration; a runtime-seam-first migration is ~1–5 focused days per app given the abstraction patterns already present in `werk-3` and `leitfaden` (both already isolate a thin runtime shell). Do it before shipping an auto-updater, not after.

---

## 1. What you gain

### 1.1 Packaging, distribution, OS integration — the dominant benefit
*Confidence: **high** (multiple independent primary accounts + Electron's own docs).*

Electron's ecosystem has already solved the long tail of desktop operational work. One `electron-builder.yml` produces `.dmg`, `.zip`, NSIS, `.deb`, `.rpm`, `.AppImage`, `.pacman`, `.snap`, `.flatpak`.

Electrobun's Linux distribution target is **a self-extracting archive only** — no `.deb`, `.rpm`, `.AppImage`, Flatpak or Snap target, meaning no package-manager integration. See the measured artifacts in §1.3: `Werk-Setup.tar.gz` and a `Werk.tar.zst` payload extracted by a `launcher` binary. Install root is `~/.local/share/` on Linux.

Firsthand migration accounts (both unaffiliated with Electron):

- "I wasn't building features anymore. I wasn't building infrastructure around the runtime… Electrobun produced an `Uninstall.reg` but never applied it." — [Rick van Lieshout](https://www.rickvanlieshout.com/posts/2026/wanted-electrobun-shipping-chose-electron/). He maintained custom launchers, bundled `bin/bun`, zstd payloads, manual patch generation and custom extraction logic; switching back took "about a single evening" because his `src/main/` never imported the runtime. His verdict: *"Runtime minimalism is a false economy if you end up rebuilding the ecosystem yourself."*
- `beautyfree/skiller` [#2](https://github.com/beautyfree/skiller/issues/2) tracked a phased Electrobun→Electron move (electron-vite + electron-builder + electron-updater), estimated **~4 focused days end-to-end**, motivated by three upstream Electrobun bugs: macOS App Translocation crash ([#359](https://github.com/blackboardsh/electrobun/issues/359)), Windows per-monitor HiDPI blur ([#324](https://github.com/blackboardsh/electrobun/issues/324)), and no Windows caption-button API. Their stated bonus was **deleting ~250 LOC** of FFI vibrancy workaround in favour of `vibrancy: 'sidebar'`.

### 1.2 Security defaults
*Confidence: **high** for Electron, **high** for Electrobun (code-level claims in a third-party audit, consistent with its own open issues).*

| Property | Electron | Electrobun |
|---|---|---|
| Renderer sandbox | **On by default** since Electron 20 ([docs](https://github.com/electron/electron/blob/main/docs/tutorial/sandbox.md)) | Opt-in; a sandboxed webview explicitly has "No RPC, NO encryption, NO webview tags" |
| Context isolation | **On by default** since Electron 12 ([docs](https://github.com/electron/electron/blob/main/docs/tutorial/context-isolation.md)) | **No equivalent.** `window.__electrobun` and `window.__electrobun_encrypt` are page-reachable and overwritable, so the RPC encryption key is readable by page JS |
| Security documentation | Extensive `tutorial/security.md` | **None for the framework at all** |
| Update integrity | Squirrel.Mac refuses unsigned updates; electron-updater verifies published checksums | **Verifies nothing** (see §3.1) |
| CSP | Documented recommendation | No default, no guidance |

The practical consequence of sandbox-or-RPC being mutually exclusive: an XSS in an Electrobun webview reaches the full RPC surface, which in a typical app carries filesystem and OS access. In Electron the same bug is contained by context isolation plus a deliberately narrow `contextBridge`.

### 1.3 Download size — the one place where the numbers are genuinely mixed
*Confidence: **high** (measured on this machine).*

| App / stack | Linux install (unpacked) | Shipped download |
|---|---|---|
| `scrnsvr` — **Electron 44**, electron-builder | **306 MB** | AppImage **136 MB**, deb **111 MB** |
| `werk-3` desktop — Electrobun, `bundleCEF: true` | dev bundle `bin/` alone **680 MB** (`libcef.so` **409 MB**, `bun` **81 MB**, `resources.pak` 14.7 MB, `icudtl.dat` 10.8 MB) → ~690 MB installed | `Werk.tar.zst` **36.7 MB**, `Werk-Setup.tar.gz` **38.2 MB** |
| `leitfaden` — Electrobun, native WebKitGTK | dev build **169 MB** (`bun` ~80 MB dominates) | `Leitfaden.tar.zst` **55.8 MB**, `Setup.tar.gz` **57.3 MB** |

Read this carefully, because it inverts the usual pitch:

- **Download:** Electrobun wins 3.7× (36.7 MB vs 136 MB). zstd over a self-extracting tar compresses a Chromium-heavy payload far better than a squashfs AppImage. This is real and users notice it.
- **Installed size, native webview:** Electrobun still wins (~170 MB vs 306 MB).
- **Installed size, CEF (i.e. what you must ship on Linux):** **Electrobun loses badly** — ~690 MB vs 306 MB, roughly 2.3× *larger* than Electron.

The third row is the killer. Electrobun's own documentation recommends CEF over WebKitGTK on Linux, citing WebKitGTK's severe limitations — and the `werk-3` config in this repo documents the concrete reason on the actual dev hardware:

> "WebKitGTK has no accelerated compositing path on NVIDIA + Hyprland: its DMA-BUF renderer violates Hyprland's acquire-point rule and its GBM/EGL path fails to import buffers, so the only WebKit fallback is a slow software compositor." — `werk-3/apps/desktop/electrobun.config.ts`

`leitfaden` instead ships an env-var guard (`scripts/desktop/leitfaden-launcher.sh`) exporting `WEBKIT_DISABLE_DMABUF_RENDERER=1` / `WEBKIT_DISABLE_COMPOSITING_MODE=1` on NVIDIA+Wayland, installed into bundles by a `postPackage` hook that rewrites the `.desktop` entry to point at the wrapper. **The "no Chromium tax" benefit is already gone on Linux, and you are maintaining launcher shims to keep it gone.**

The marketing figure is ~14 MB for a minimal system-webview app; independent measurement of a React app landed at **64.5 MB on disk**. Measure your own build, not the headline.

Note the second-order effect: with `bundleCEF: true`, **you own your own Chromium patch cadence**. System webviews are patched by the OS vendor; bundled CEF is only as current as your last release. You get Chromium's security surface *and* its maintenance burden — which is the worst of both worlds relative to Electron, where Chromium bumps arrive via a dependency update with a well-trodden migration path.

### 1.4 Rendering determinism and graphics consistency
*Confidence: **medium-high** for the principle; **high** that it matters in this workspace.*

Electron ships one Chromium everywhere: same WebGL/WebGPU behaviour, same JS/CSS feature set, same DevTools. Electrobun ships three different engines (WebKitGTK / WKWebView / WebView2) unless you pay for CEF — so you debug rendering bugs three times, or you bundle Chromium and lose the size argument (§1.3).

For a WebGL/shader-heavy app this is not theoretical. `werk-3` had to *undo Electrobun's own defaults* to get GPU acceleration at all:

```ts
// Electrobun passes --disable-gpu and --disable-gpu-compositing to CEF by default.
// Suppressing them lets Chromium use the GPU; without this, CEF falls back to
// software rasterization and stays slow.
chromiumFlags: { "disable-gpu": false, "disable-gpu-compositing": false }
```

Electron's GPU acceleration for WebGL is on by default and its Linux/Wayland story is a first-class, widely-exercised path. `scrnsvr` — the Electron app in this workspace — already runs 44 GLSL shaders, multi-monitor fullscreen, kiosk mode and headless capture under it. **The team already has a working, shader-heavy Electron reference implementation.** That substantially de-risks the migration and is worth more than any benchmark.

### 1.5 Tooling, ecosystem, debugging, hiring
*Confidence: **high**.*

DevTools on every platform (Electrobun automation via CDP is currently macOS-only and traces to CEF limitations — [#466](https://github.com/blackboardsh/electrobun/issues/466)). Native module support via N-API (Electrobun requires ESM; `better-sqlite3` etc. need care). Abundant CI examples, Stack Overflow answers, and third-party libraries that assume Electron. Long-term maintenance confidence for a project you intend to keep.

### 1.6 Process primitives you may be missing
*Confidence: **high**.*

Electrobun has **no documented sidecar mechanism and no `extraResources` equivalent** — the working pattern is a community-assembled three-step (`build.copy` + `Bun.spawn` + `RESOURCES_FOLDER`). Windows assumes Evergreen WebView2 is already installed and **bundles no bootstrapper**; on a machine without it the app does not run. If any of the Electrobun apps spawn helper processes or shell out to system tools, Electron's `extraResources`, `utilityProcess`, `child_process` and `app.getPath` machinery is a step change.

---

## 2. What you lose / what it costs

*Confidence: **high** unless noted.*

| Cost | Magnitude | Notes |
|---|---|---|
| **Download size** | 36.7 MB → ~136 MB AppImage (measured) | Real, user-visible regression. The one unambiguous Electrobun win. |
| **Installed size (native webview case)** | ~170 MB → 306 MB (measured) | For the CEF case this reverses; see §1.3. |
| **RAM floor** | Higher, but smaller than folklore | Each Electron app ships its own Chromium; shared-memory dedup between two Electron apps is partial. The Evellen/single-maintainer blog claims are inflated. **Confidence: medium** — you should measure your own app. |
| **Cold start** | Slower | Bundled Chromium init + Node bootstrap vs a single native launcher. **Confidence: medium** — measure. |
| **Security-patch treadmill** | Continuous | Electron majors every 8 weeks, latest 3 supported ([Electron timelines](https://electronjs.org/docs/latest/tutorial/electron-timelines)). You *do* get security fixes fast — but you also must keep up, and Electron majors do carry breaking changes. Mitigated by `electron-updater` being able to ship out-of-band. |
| **Build tooling complexity** | Moderate | Need esbuild/vite for main+preload+renderer plus electron-builder config, effectively a build system where Electrobun's CLI was one command. `electron-vite` closes most of the gap. Note `scrnsvr` already uses exactly this shape (esbuild + electron-builder), so the pattern exists in-repo. |
| **Loss of built-in typed RPC** | Moderate rewrite | Electrobun's `defineRPC` with compile-time-typed channels is genuinely nicer than `ipcMain.handle` + `contextBridge`. Electrobun's own docs grade this as "cleaner than Electron's IPC". Replacing it usually means either raw `ipcMain.handle` + a preload API, or `tRPC`/custom typed wrapper. Runtime validation must be re-added either way — the type contract is compile-time only in both frameworks. |
| **Loss of single-binary distribution** | Cosmetic/ops | No more "one self-extracting file + 4 KB bsdiff patch". **But** Electron's differential story is not as bad as Electrobun advocates claim: electron-builder embeds a **blockmap into the AppImage itself** and `electron-updater` downloads only changed blocks ([electron-builder AppImage docs](https://www.electron.build/docs/appimage/)). The often-quoted "a one-character change re-downloads 250 MB" claim ([Claude Code #26648](https://github.com/anthropics/claude-code/issues/26648)) is **contested** — treat as low confidence and test it rather than believing either side. |
| **Bun-specific APIs must be rewritten** | Low in this workspace | Measured: `werk-3` uses only `Bun.spawn` (2 sites) and `Bun.sleep` (2 sites). `leitfaden` is heavier (Bun-based server + `bun:sqlite` likely). Each `bun:*` import is a rewrite (`bun:sqlite` → `better-sqlite3`, `Bun.serve` → `@trpc/server` standalone or `node:http`). |
| **App Translocation / bunch of "was fine on my machine" bugs** | Low | Actually an Electron *benefit*: Electron never self-modifies on first launch, so the macOS App Translocation class of bug disappears. |
| **One subtle new bug class** | Low | Runtime-specific bugs exist in both directions. Example: Electron prefixes IPC errors with `Error invoking remote method 'rpc:call':`, which broke a sentinel-based error rehydration in the `mastermindzh` migration. Fixed with a `startsWith` → `indexOf() >= 0` change, but only caught because he tested the **packaged** app. Budget for packaged-app integration tests. |

---

## 3. Risk register: staying on Electrobun

*Confidence: **medium-high**. The audit below is a third-party document ([jlevy/tbd, Electrobun App Development Patterns](https://cdn.jsdelivr.net/npm/get-tbd@0.8.1/dist/docs/guidelines/electrobun-app-development-patterns.md), last updated 2026-08-16); its code-level claims are checkable against the repo and are consistent with Electrobun's own open issues. Recheck before relying on it, as it itself instructs.*

### 3.1 The updater verifies nothing — high severity if you ship one
Electrobun's bsdiff delta updater performs **no signature verification**. The audit's evidence: grepping `Updater.ts` and `extractor/main.zig` for `ed25519`, `rsa`, `publickey`, `verifySignature`, `minisign`, `signify`, `gpg`, `pgp` returns nothing; the only `createHash("sha256")` in `Updater.ts` builds a Task Scheduler task name; every SHA-256 in `extractor/main.zig` is for naming, locking or `.desktop` checks. The `hash` field in `update.json` is a change sentinel compared against the local hash to decide whether an update *exists*.

Consequence: anyone who can serve or tamper with the update endpoint executes arbitrary code on every user's machine. Its own recommendation: **disable the updater** unless signature verification has landed. For contrast, Squirrel.Mac refuses unsigned updates and Tauri's updater requires a key you hold.

Note this is in scope for this workspace: `werk-3/apps/desktop/artifacts/stable-linux-x64-update.json` shows the updater manifest being generated and published, i.e. the delta-update channel is in use.

### 3.2 Code signing gaps
| Platform | State |
|---|---|
| macOS | Configurable via `mac.codesign` / `mac.entitlements`, but the implementation lives inside the **Hutch CLI binary, not the open repo** — you cannot audit how or whether it signs. [#515](https://github.com/blackboardsh/electrobun/issues/515) reports the signing setup exposing a personal Apple ID credential. |
| Windows | **No code signing at all.** No Authenticode, no SignTool. Unsigned binaries → SmartScreen warnings, no trust chain. |
| Linux | No GPG signing, no repository integration. |

Also: the macOS bundle layout is non-standard (`Resources/` nested inside `Contents/MacOS/`), so Apple-canonical tooling expectations do not transfer.

### 3.3 Framework maturity and bus factor
*Confidence: **medium-high**.*

- **Bus factor of one.** Every sampled period shows a single author writing the overwhelming majority of commits. No external funding identified; the backing company is the maintainer's own. `CONTRIBUTING.md` warns that high-review-effort PRs "will be ruthlessly closed without explanation," with no response timelines.
- **~86 open issues against roughly a dozen visibly closed**, including security ([#515](https://github.com/blackboardsh/electrobun/issues/515), [#518](https://github.com/blackboardsh/electrobun/issues/518)) and an architectural FFI problem ([#520](https://github.com/blackboardsh/electrobun/issues/520)).
- **No CHANGELOG and no migration guides.** Release notes are auto-generated commit ranges; evaluating an upgrade means reading diffs. The maintainer describes the project as "10% of the vision."
- **Version numbers carry no contract.** 0.13.0 → 1.0.0 in two days; numbers skipped freely; majors mark feature milestones, not API stability. Pin an exact version; semver gives you no protection.
- **Documentation trails source**, including on the config schema (published docs describe a schema the templates on `main` no longer use — treat the repo as authoritative).
- **Runtime migration in flight.** The 2.0 line decouples from Bun in response to Bun's Zig-to-Rust core rewrite, introducing Cottontail (JavaScriptCore + Zig) as the default and offering `bun | cottontail | zig | rust | go | odin` as main-process runtimes. Whatever the merits, *a framework changing its main-process runtime mid-flight is a moving target.* Two `dist-tags` (`latest` and `beta`) diverge substantially in config schema.
- **Ecosystem size is honest but small.** ~200 repos in the dependents graph, most single-star experiments; the honest count of maintained non-trivial OSS apps is roughly a dozen, dominated by developer tools and macOS-first projects. No widely recognised consumer product is publicly built on it.

### 3.4 Open transport hardening issues
[#518](https://github.com/blackboardsh/electrobun/issues/518) (OPEN, filed 2026-08-09) documents, still present on `main`:

1. The RPC WebSocket upgrade is authenticated only by the presence of a small sequentially-assigned integer `webviewId`. Any local process can attach as the transport for a webview, **displacing the legitimate socket**. (v1.18.1 also bound the server to all interfaces — reachable from the LAN; only the loopback bind is fixed on `main`.)
2. `websocket_payload_limit` is **500 MB**, so a peer that can reach the port can stream large frames to exhaust memory/CPU.

Impact is local/adjacent DoS and transport hijack, not RPC forgery (AES-256-GCM contents hold). Bug reports are filed **in the open** because private vulnerability reporting is disabled on the repository — itself a signal about security process maturity.

---

## 4. Migration cost

*Confidence: **medium** (informed by two published migrations plus local code inspection; your own LOC will move the estimate).*

The good news: both Electrobun apps here already have the runtime seam that made the two published migrations cheap. `werk-3` isolates the runtime in `src/bun/window.ts`, `src/bun/rpc/router.ts` and `src/bun/dialogs.ts` — three small files — with domain logic elsewhere.

### API mapping (from Electrobun's own vocabulary + the `skiller` migration)

| Electrobun | Electron |
|---|---|
| `BrowserWindow` (`electrobun/main`) | `BrowserWindow` (`electron`) — near 1:1 |
| `BrowserView` | `WebContentsView` / `<webview>` |
| `BrowserView.defineRPC<T>()` | `ipcMain.handle` + `contextBridge`, or tRPC |
| `Electroview.defineRPC` (renderer) | `ipcRenderer.invoke` behind a `contextBridge` surface |
| `Utils.quit()` | `app.quit()` |
| `Utils.openFileDialog()` | `dialog.showOpenDialog()` |
| `Utils.openExternal(url)` | `shell.openExternal(url)` |
| `Utils.showItemInFolder(path)` | `shell.showItemInFolder(path)` |
| `Electrobun.events.on('reopen')` | `app.on('activate')` |
| `Tray` API | `Tray` + `setContextMenu(Menu.buildFromTemplate(...))` |
| `BrowserView.setNavigationRules` | `webRequest` filtering / `will-navigate` |
| `views://` scheme | `file://` or a custom protocol |
| `Updater` | `electron-updater` / `autoUpdater` |
| `buttonStyles`/`titleBarStyle: 'hiddenInset'` | `titleBarStyle` + **`titleBarOverlay`** (Windows/Linux caption buttons — this is the fix for Electrobun #324) |
| `RESOURCES_FOLDER` / `build.copy` | `extraResources` / `process.resourcesPath` |
| `mainProcess: bun` + `Bun.serve`/`bun:sqlite` | Node main + `better-sqlite3` (+ `asarUnpack`) / `@trpc/server` standalone |
| macOS FFI vibrancy dylib | `vibrancy: 'sidebar'`, `visualEffectState`, `nativeTheme` |

### Phasing (adapted from the `skiller` plan, ~4 focused days)

```
Phase 0  Tag electrobun-final-vX.Y.Z as rollback point; snapshot last Electrobun artifact
         for updater-bridge testing. Branch migration/electron.
Phase 1  Minimal Electron shell: electron + electron-vite + electron-builder +
         @electron-toolkit/{preload,utils}. Main + preload stub + config.
         CHECKPOINT: `dev` opens the existing renderer unchanged.
Phase 2  Main-process logic: RPC layer, utils renames, paths, native modules,
         drop all bun:* imports. CHECKPOINT: feature parity on Linux.
Phase 3  Platform polish: titleBarOverlay, vibrancy, DPI, -webkit-app-region.
         CHECKPOINT: no HiDPI blur; caption buttons present.
Phase 4  Packaging: electron-builder.yml, targets, notarize hook, CI matrix.
         CHECKPOINT: notarized+stapled artifact passes `spctl` / `stapler validate`.
Phase 5  Updater: electron-updater + publish config. Ship one final Electrobun
         release with an in-app banner — the Electrobun updater CANNOT bridge to
         electron-updater transport, so users must re-download once.
Phase 6  Docs, READMEs, env-var renames, delete electrobun.config.ts.
```

**Highest-risk items, in order:** the updater bridge (irreversible-ish user action required), the RPC layer rewrite, and packaged-app-only bugs (§2, last row) — which is why Phase 2 and Phase 4 checkpoints are worded as *packaged* parity, not dev parity.

---

## 5. Decision framework

**Migrate if any of these are true:**
- You ship to non-technical users on Windows (unsigned binaries + no Authenticode are a hard blocker).
- You want a real auto-updater (Electrobun's verifies nothing; disabling it forfeits the feature).
- You need OS integration beyond dialogs and reveal-in-folder.
- You ship on Linux to a mixed-hardware audience (WebKitGTK breaks; CEF then costs you 2.3× Electron's installed size).
- You need WebGL/WebGPU consistency across platforms.
- You are resource-constrained on maintenance: one maintainer's roadmap is your roadmap.

**Stay on Electrobun if all of these are true:**
- Developer-tool audience, macOS-first or Linux-on-known-hardware only.
- Download size is a genuine acquisition constraint.
- You don't ship an auto-updater, or you distribute via a channel with its own integrity guarantees (e.g. Homebrew, distro repos, an app store).
- You are willing to pin an exact version, read diffs to upgrade, and accept single-maintainer risk.

**Hybrid worth considering:** keep the runtime-agnostic core, and maintain two thin shells behind an interface (`openFileDialog` / `revealPath` / `update` / `ipc` / `window`). This is precisely the architecture that made the two published migrations take an evening. If you already have it, the *option* to migrate is cheap and you can defer the decision. If you don't have it, building it is the highest-ROI change regardless of which framework you pick.

---

## 6. Spikes to run before committing (verify, don't trust)

*Confidence: these are explicitly unverified items; treat the report as a hypothesis until each is closed.*

1. **Measure your own sizes.** Build a debug and packaged Electron variant of your actual app; record installer size, installed size, cold start, idle RAM, and steady-state GPU RAM under your real workload. §1.3 numbers are from `scrnsvr`/`werk-3`/`leitfaden` at specific dates — they are indicative, not yours.
2. **Test differential updates end-to-end.** Publish two builds one commit apart; measure actual bytes downloaded by `electron-updater` on Linux and Windows. This settles the contested blockmap-diff claim.
3. **Confirm Electrobun's updater status.** Recheck whether signature verification has landed in a version newer than the audit. This single question governs whether the security argument stands at full strength.
4. **Re-verify the platform matrix and dist-tags.** `latest` vs `beta` diverge in config schema; architecture support is narrower than the marketing surface.
5. **Test the WebKitGTK/CEF decision on target Linux hardware.** On NVIDIA + Wayland the native path is already known broken here (see the `werk-3` and `leitfaden` configs) — confirm CEF is the only viable Linux renderer, and then price it (§1.3).
6. **Estimate RPC rewrite cost precisely.** Count typed RPC channels in the app and decide `ipcMain.handle`+`contextBridge` vs tRPC. `werk-3` looks like a few hours; `leitfaden` (Bun server + likely `bun:sqlite`) looks like days.
7. **Packaged-app integration tests.** Whatever the framework, the IPC-error-prefix class of bug only appears in the packaged runtime. Budget for it.

---

## 7. Sources

**Primary — Electrobun**
- Docs: https://framework.blackboard.sh/electrobun/ · Changelog v2.x: https://framework.blackboard.sh/electrobun/guides/changelog/v2-x/ · v1.18.0: https://framework.blackboard.sh/electrobun/guides/changelog/v1-18-0/
- Repo/releases: https://github.com/blackboardsh/electrobun · v2.0.1: https://github.com/blackboardsh/electrobun/releases/tag/v2.0.1 · diff v1.18.1…v2.0.1: https://github.com/blackboardsh/electrobun/compare/v1.18.1...v2.0.1
- 2.0 rationale / Cottontail: https://blackboard.sh/blog/electrobun-2-0/ · v1 retrospective: https://blackboard.sh/blog/electrobun-v1/
- Open issues relied upon: [#518](https://github.com/blackboardsh/electrobun/issues/518) (RPC transport), [#515](https://github.com/blackboardsh/electrobun/issues/515) (signing credentials), [#466](https://github.com/blackboardsh/electrobun/issues/466) (CDP automation gaps), [#439](https://github.com/blackboardsh/electrobun/issues/439) (Bun Zig→Rust impact), [#213](https://github.com/blackboardsh/electrobun/issues/213) (view-agnostic architecture), [#2](https://github.com/blackboardsh/electrobun/issues/2) (roadmap), [#359](https://github.com/blackboardsh/electrobun/issues/359) (App Translocation), [#324](https://github.com/blackboardsh/electrobun/issues/324) (Windows DPI)
- Ecosystem/risk audit: https://cdn.jsdelivr.net/npm/get-tbd@0.8.1/dist/docs/guidelines/electrobun-app-development-patterns.md (third-party, jlevy, 2026-08-16)

**Primary — Electron**
- Security: https://electronjs.org/docs/latest/tutorial/security · Context isolation: https://electronjs.org/docs/latest/tutorial/context-isolation · Sandbox: https://github.com/electron/electron/blob/main/docs/tutorial/sandbox.md · Timelines/cadence: https://electronjs.org/docs/latest/tutorial/electron-timelines · 8-week cadence: https://electronjs.org/blog/8-week-cadence · Release schedule: https://releases.electronjs.org/schedule
- AppImage blockmap/differential updates: https://www.electron.build/docs/appimage/ · builder: https://www.electron.build/

**Migration case studies**
- `beautyfree/skiller` #2 — Electrobun → electron-vite, phased plan, ~4 days, 3 upstream bugs: https://github.com/beautyfree/skiller/issues/2
- Rick van Lieshout — "shipping reality chose Electron": https://www.rickvanlieshout.com/posts/2026/wanted-electrobun-shipping-chose-electron/
- Reverse-direction tooling exists (Electron → Electrobun skill), useful as an API-mapping reference: https://github.com/recrsn/claude-plugins/blob/main/skills/electron-to-electrobun/SKILL.md
- Motivating argument against Electron (size/delta updates, **contested**): https://github.com/anthropics/claude-code/issues/26648

**Local workspace evidence (measured in this repo/workspace)**
- `scrnsvr/release/linux-unpacked` (306 MB), `release/Scrnsvr-0.5.0.AppImage` (136 MB), `scrnsvr_0.5.0_amd64.deb` (111 MB)
- `werk-3/apps/desktop/build/electrobun/dev-linux-x64/Werk-dev/bin` (680 MB, `cef/libcef.so` 409 MB, `bun` 81 MB); `artifacts/stable-linux-x64-Werk.tar.zst` (36.7 MB); `artifacts/stable-linux-x64-update.json`
- `werk-3/apps/desktop/electrobun.config.ts` (bundleCEF + chromiumFlags GPU comment)
- `web/leitfaden/artifacts/electrobun/stable-linux-x64-Leitfaden.tar.zst` (55.8 MB); `scripts/desktop/leitfaden-launcher.sh` + `scripts/electrobun/post-package.ts` (WebKit NVIDIA/Wayland guard)
- `werk-3/apps/desktop/src/bun/{window,rpc/router,dialogs}.ts` (runtime seam surface area)

---

## 8. Confidence summary

| Section | Confidence | Main caveat |
|---|---|---|
| 1.1 Packaging/integration | High | Two independent migrations + Electron docs agree |
| 1.2 Security defaults | High | Electrobun half rests on a third-party audit; code-level and consistent with open issues |
| 1.3 Size numbers | High (measured) | Specific to these three apps on this machine at these dates |
| 1.4 Rendering determinism | Medium-high | Principle is solid; magnitude for your app unmeasured |
| 2. Costs | Medium | RAM/cold-start/delta-update claims need local measurement |
| 3.1 Updater | Medium-high | Recheck whether verification has since landed |
| 3.3 Maturity/bus factor | Medium-high | Snapshot in time; 2.0 line is actively moving |
| 4. Migration cost | Medium | Only two published data points; your LOC dominates |
