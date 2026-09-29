---
target: settings UI
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/mnt/extra-ssd/dev/projects2/scrnsvr/src/settings/index.ts"
target_fingerprint: "sha256:e2933db4410d8e93a2735e29925e393959d498d70bec625af7c59f119ec17fd1"
target_path: /mnt/extra-ssd/dev/projects2/scrnsvr/src/settings/index.ts
timestamp: 2026-09-29T16-46-56Z
slug: src-settings-index-ts
---
Method: dual-agent (A: /root/design_review; B: /root/ui_evidence).

Preserve the charcoal shell, coral selection, real shader imagery, and gallery/preview/inspector arrangement. The identity is appropriate and product-specific. Improve confidence during experimentation and speed of visual discovery.

Evidence: current source and historical desktop/wide captures. No live Electron interaction; screenshots predate Looks & Shuffle and parameter locks. Scores are provisional.

| Heuristic | Score / 4 |
|---|---:|
| System status | 3 |
| Real-world match | 3 |
| Control and freedom | 2 |
| Consistency | 3 |
| Error prevention | 3 |
| Recognition | 3 |
| Efficiency | 2 |
| Minimalist design | 3 |
| Error recovery | 2 |
| Help/documentation | 2 |
| Total | 26 / 40 |

Priority issues:
1. P1: Make reset and applying looks undoable. Reset currently deletes edits and clears randomization undo; autosave makes this consequential. Restore keyboard focus after saved-look/shuffle list rerenders. Sources: src/settings/index.ts:262, 432, 577, 610, 653.
2. P1: Match preview to monitor aspect ratio and offer fullscreen preview. Current primary ratio is 657/523 and Looks uses 4/5. Add pause controls; reduced-motion handling currently covers scroll/CSS rather than shader animation. Sources: src/settings/settings.css:263,404; src/settings/index.ts:146,297.
3. P2: Add compact visual search and Favorites or Recent to avoid long gallery scrolling. Current categories are useful and should remain.
4. P2: Simplify inspector repetition: keep changed-value reset discoverable, consider locks within a randomization mode, and prevent focus-triggered hints from moving neighboring controls. Sources: src/settings/shader-controls.ts:65; src/settings/settings.css:320.
5. P2: Provide persistent unsaved state and Retry after autosave errors. Announce preview failures in HTML, not only canvas pixels. Sources: src/settings/index.ts:385,675.

Cognitive load: four tabs are manageable. The interaction of inheritance, locks, randomization, current edits, saved looks, and shuffle membership needs progressive disclosure. Many visual options are appropriate for a gallery; improve retrieval rather than hiding imagery.

Journey/personas: live changes reward exploration; irreversible reset and inaccurate display composition undermine confidence. Keyboard users need focus retained. Motion-sensitive users need preview pause. Experienced users benefit from search/favorites.

Detector: 58 findings in settings.css: 1 overused-font warning (line 2), 19 design-system-color advisories, 38 design-system-font-size advisories. Inter Tight is intentional; many 11–13px sizes match prose guidance. Treat these primarily as token-documentation drift, not demonstrated usability defects. No automatic drift repair.

Suggested first pass: undo/focus recovery, monitor-shaped preview, and search. Follow with inspector simplification and error recovery. Decide between this focused pass and all five areas; choose whether browsing or tuning should lead.
