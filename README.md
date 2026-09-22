<div align="center">

<img src="docs/banner.png" alt="Inkling: notes, tasks, flashcards and grades. Studying, made fun." width="820" />

<br />

[![CI](https://github.com/dominikkoenitzer/Inkling/actions/workflows/ci.yml/badge.svg)](https://github.com/dominikkoenitzer/Inkling/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-101%20passing-10A37F)](test)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![better-sqlite3](https://img.shields.io/badge/better--sqlite3-FTS5-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![License: MIT](https://img.shields.io/badge/License-MIT-10A37F.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/dominikkoenitzer/Inkling?color=10A37F)](https://github.com/dominikkoenitzer/Inkling/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-10A37F)](https://github.com/dominikkoenitzer/Inkling/releases/latest)

A warm, local-first desktop app that makes studying fun: open it and it tells you exactly what to do today. Review these cards, finish that task, give your weakest subject some love.

[Download](https://github.com/dominikkoenitzer/Inkling/releases/latest) · [Features](#the-six-modules) · [Getting started](#getting-started) · [Architecture](#project-layout)

</div>

<p align="center">
  <img src="docs/notes.png" width="880" alt="Inkling: notes view with the Inky mascot and context panel" />
</p>

---

## Why Inkling

The hardest part of studying isn't the studying, it's knowing what to do right now. Inkling assembles a daily plan from things you already track (due flashcards, open tasks, your weakest subject), and one piece of content flows everywhere:

> A page of *Chapter 4 notes* can hold a checkbox (`[] Finish reading by Friday`) that becomes a real task in your Today plan, while its `Term :: Definition` lines turn into flashcards, all from the same text, no duplicate entry.

- **A plan, not a blank page**. Open the app and know exactly what to study today
- **Proof you're getting better**. Every review is logged, so Inkling can show your retention and your activity
- **Zero friction to capture**. New note is one keystroke, no forced title, no save button
- **Local-first**. Everything works fully offline; your data is a single SQLite file on your machine
- **Friendly, not corporate**. Warm *Cozy* theme, an original mascot (Inky), streaks and confetti, zero dark patterns

---

## The six modules

### Today
<img src="docs/today.png" width="880" alt="Inkling: Today view with an auto-generated daily study plan" />

An auto-generated daily study plan: due flashcard decks, tasks due today, your lowest-averaging subject, and a suggested focus block, each with a one-click start. Clear the plan, get confetti. That's the whole loop.

### Notes
TipTap rich-text pages (toolbar *and* live markdown shortcuts: `#`, `-`, `1.`, `>`, `**bold**`, `[]`). Auto-saves as you type (debounced, flushed on blur).

Deleting a page is undoable from the toast that follows it, and `Ctrl+K` searches every page, task and deck at once.

### Tasks
<img src="docs/tasks.png" width="880" alt="Inkling: tasks view grouped by due date" />

One list, grouped by when things are due: overdue, today, upcoming, someday, done. A due date and a checkbox, nothing else to fill in. Typing `[]` in a note creates a real, bidirectionally-linked task, and what is due this week sits in the sidebar of your Today plan.

### Study
<img src="docs/study.png" width="880" alt="Inkling: study view with a flashcard deck and Pomodoro timer" />

FSRS-4.5 spaced-repetition flashcards (Again / Hard / Good / Easy, keys 1–4), each button showing the interval it would buy. FSRS models two things per card, stability (how long until your recall chance falls to 90%) and difficulty, instead of SM-2's single "ease factor", so it schedules for a real 90% recall target rather than an arbitrary multiplier.

Also here: one-click deck creation from `Term :: Definition` lines in a note, a Pomodoro focus timer linked to a task or deck, and a gentle, non-punishing study streak. The timer stays visible in the Discord-style user bar at the bottom of the sidebar, wherever you are in the app.

### Grades
<img src="docs/grades.png" width="880" alt="Inkling grade tracker: Swiss 1–6 scale with weighted average and pass status" />

Log assessments per subject and pick your scale: Swiss 1–6 (6 is best, 4 is a pass) or plain percentages, recorded per row so switching the view never reinterprets an old grade. Weighted averages per subject, an overall figure across subjects, and a "give this subject some love" nudge in your Today plan.

### Progress

Every card you answer is written to a permanent review log. Progress reads it back: reviews, true retention (how often a card that was genuinely due came back to you), focused hours, your streak, and a six-month activity heatmap. All of it measured, none of it estimated.

---

## Everything else

| Feature | What it does |
|---|---|
| **Command palette** | `Ctrl+K` fuzzy search across notes, tasks, and decks (SQLite FTS5) + quick actions |
| **Undo** | Deleting a note is undoable from the toast, and the row is only cleared for good 30 days later |
| **Themes** | Sleek Dark + warm Cozy, adjustable font size |
| **First run** | No wizard: one notebook and a welcome page, ready to type in |
| **Inky the mascot** | Original SVG character: idle bob, blink, cursor-tracking eyes, celebratory bounces |
| **User bar** | Discord-style panel at the bottom of the sidebar: Inky, your streak, a live Pomodoro chip (pause/resume anywhere), settings |
| **Notebook covers** | Every notebook gets a color and its initials on a Discord-style squircle |
| **Data safety** | WAL-mode SQLite with rolling local backups (last 5), crash-safe writes |
| **Export** | Turn any note into portable Markdown (`.md`) |
| **Auto-update** | Packaged builds check GitHub Releases and update themselves (electron-updater) |
| **Secure by default** | `contextIsolation: true`, `nodeIntegration: false`, DB access only via the preload IPC bridge |

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` + `K` | Command palette / search |
| `Ctrl` + `,` | Settings |
| `#`, `-`, `1.`, `>`, `[]` | Markdown block shortcuts (in the editor) |
| `Ctrl` + `B` / `I` / `U` | Bold / italic / underline |
| `Space` then `1`–`4` | Reveal card, then grade (Again / Hard / Good / Easy) |

---

## Themes

Pick the sleek Dark theme or the warm Cozy one, with adjustable font size on top.

| Dark | Cozy |
|:---:|:---:|
| <img src="docs/theme-dark.png" alt="Inkling Dark theme" /> | <img src="docs/theme-cozy.png" alt="Inkling Cozy theme" /> |

---

## Tech stack

| Layer | Choice |
|---|---|
| Shell | Electron 44 (electron-vite) |
| UI | React 19 + TypeScript |
| Styling | Tailwind CSS 4 (CSS-first `@theme`) + CSS variables |
| Editor | TipTap 3 (ProseMirror) with task items that carry their task's id |
| State | Zustand (per-module stores) |
| Database | better-sqlite3 + typed repositories, FTS5 search |
| Dates | date-fns |
| Spaced repetition | Custom FSRS-4.5 implementation (`src/shared/fsrs.ts`) |
| Icons | lucide-react |
| Tests | Vitest, 101 tests (FSRS, grade math, streaks, parsing, Markdown export, colors) |
| CI / Packaging | GitHub Actions · electron-builder (NSIS) |

---

## Getting started

Uses [Bun](https://bun.sh) as the package manager / script runner (npm works too). Electron runs the app on its own embedded Node. Bun just installs and orchestrates.

```bash
bun install     # also rebuilds better-sqlite3 for Electron (postinstall)
bun run dev     # dev mode with hot reload
```

Everyday scripts:

```bash
bun run typecheck   # tsc across renderer + main/preload
bun run test        # vitest unit suite
bun run smoke       # end-to-end: drives the built app through IPC on a throwaway profile
bun run build       # production bundle
bun run dist        # Windows installer (NSIS) → release/
```

Prefer a prebuilt binary? Grab the latest installer for Windows (`.exe`), macOS (`.dmg`, universal, Intel + Apple Silicon), or Linux (`.AppImage`) from the [Releases](https://github.com/dominikkoenitzer/Inkling/releases/latest) page, each platform is built and attached automatically by the [release workflow](.github/workflows/release.yml).

> Note: `trustedDependencies` in `package.json` lets Bun run the postinstall scripts of `electron` (binary download) and `better-sqlite3`, don't remove it.

---

## Project layout

```
src/main       Electron main: db.ts (schema/migrations/backups), ipc.ts, index.ts
src/main/repos the data layer, one module per domain: notebooks, notes, tasks,
               flashcards, focus, streak, grades, stats, search, onboarding;
               index.ts re-exports them, so callers still just `import * as repos`
src/preload    contextBridge → window.inkling (typed via src/shared/api.ts)
src/renderer   React app: stores/ (zustand), components/{shell,today,notes,tasks,study,grades,stats}, lib/
src/shared     types + API contract + the pure logic both processes use:
               fsrs.ts (scheduler), grades.ts, streaks.ts, markdown.ts
test           Vitest suites for everything in src/shared
```

Data lives in a single WAL-mode SQLite file in `%APPDATA%/Inkling`, with a `backups/` folder beside it. Fully offline. Nothing leaves your machine.

The schema is versioned via `PRAGMA user_version` and migrated on open (currently v9); a backup is written before each launch's migration runs.

Anything that isn't I/O lives in `src/shared` and is unit-tested. The FSRS scheduler takes `now` as an argument and returns a plain object; the Markdown exporter and the deck importer are pure functions. That's what keeps the interesting logic testable without an Electron window.

### Dev / test hooks

The main process reads a few env vars for isolated, reproducible runs:

| Variable | Effect |
|---|---|
| `INKLING_USERDATA=<dir>` | Run against an isolated profile |
| `INKLING_SEED=1` | Seed demo content on a fresh profile |
| `INKLING_SCREENSHOT=<file.png>` | Capture the window and exit |
| `INKLING_EVAL=<js>` | Run JS in the renderer before capture (`window.__app` exposes the store) |

`bun run smoke` builds on those hooks: it launches the packaged main process against an
isolated profile and runs twelve checks through the real preload bridge, covering the note
to task bridge, search, undo, FSRS scheduling, grades, focus minutes, the streak and the
review log. Unit tests cover the pure logic; this covers the wiring between the processes.

---

## Roadmap

- [x] Four pillars, command palette, themes, mascot
- [x] SM-2 flashcards, Pomodoro, streak
- [x] CI + Windows, macOS & Linux installers (built automatically on release)
- [x] Markdown export
- [x] Grade tracker (weighted averages per subject)
- [x] Auto-update (electron-updater) + universal macOS build (Intel + Apple Silicon)
- [x] Today view (auto-generated daily study plan), Swiss 1–6 and percentage grading, user bar
- [x] Review history + Progress view (activity heatmap, true retention) and FSRS-4.5 scheduling
- [x] Undoable deletes
- [ ] Fit FSRS parameters to your own review log instead of the published defaults
- [ ] Optional end-to-end-encrypted cloud sync
- [ ] Mobile companion

---

## Contributing

Issues and PRs welcome. Before opening a PR, please run:

```bash
bun run typecheck && bun run test && bun run build
```

See [`CHANGELOG.md`](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © 2026 Inkling

## Author

Built and written by [@dominikkoenitzer](https://github.com/dominikkoenitzer).

