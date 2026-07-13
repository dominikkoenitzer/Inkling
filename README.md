<div align="center">

<img src="docs/banner.png" alt="Inkling — notes, tasks, schedule and study, together" width="820" />

<br />

[![CI](https://github.com/dominikkoenitzer/Inkling/actions/workflows/ci.yml/badge.svg)](https://github.com/dominikkoenitzer/Inkling/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-24%20passing-1D9E75)](test)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![better-sqlite3](https://img.shields.io/badge/better--sqlite3-FTS5-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![License: MIT](https://img.shields.io/badge/License-MIT-1D9E75.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/dominikkoenitzer/Inkling?color=1D9E75)](https://github.com/dominikkoenitzer/Inkling/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-1D9E75)](https://github.com/dominikkoenitzer/Inkling/releases/latest)

**A warm, local-first desktop hub where you can dump a quick thought, write a full essay, track assignments, see your week at a glance, and study for a test — all without leaving one app.**

[Download](https://github.com/dominikkoenitzer/Inkling/releases/latest) · [Features](#the-four-pillars) · [Getting started](#getting-started) · [Architecture](#project-layout)

</div>

<p align="center">
  <img src="docs/notes.png" width="880" alt="Inkling — notes view with the Inky mascot and context panel" />
</p>

---

## Why Inkling

Four things students and busy people juggle — **notes, tasks, a schedule, and studying** — usually live in four different apps that don't talk to each other. Inkling unifies them and *cross-links* them, so one piece of content flows everywhere:

> A page of *Chapter 4 notes* can hold a checkbox (`[] Finish reading by Friday`) that becomes a **real task**, which shows up on the **calendar**, while its `Term :: Definition` lines turn into **flashcards** — all from the same text, no duplicate entry.

- 🪶 **Zero friction to capture** — new note is one keystroke, no forced title, no save button
- 🧩 **One app, four pillars** — unified and cross-linked, not bolted-on separate tools
- 🔒 **Local-first** — everything works fully offline; your data is a single SQLite file on your machine
- ☕ **Friendly, not corporate** — warm *Cozy* theme, gentle empty states, an original mascot (Inky), zero dark patterns

---

## The four pillars

### 📝 Notes
TipTap rich-text **pages** (toolbar *and* live markdown shortcuts: `#`, `-`, `1.`, `>`, `**bold**`, `[]`) plus a freeform **sticky board** you can drag, resize, and recolor. Auto-saves as you type (debounced, flushed on blur).

### ✅ Tasks
<img src="docs/tasks.png" width="880" alt="Inkling — tasks view with smart views and priority flags" />

List **and** kanban board, due dates, priorities, subtasks, and **Today / This Week** smart views that aggregate across every notebook. Typing `[]` in a note creates a real, bidirectionally-linked task.

### 📅 Calendar
<img src="docs/calendar.png" width="880" alt="Inkling — calendar week view with a recurring class and task due-dates" />

Week and month grids with **recurring class blocks** (`WEEKLY;BYDAY=MO,WE,FR` — set once, repeats all semester). Task due-dates surface automatically, and you can **drag any event or task chip to reschedule** it.

### 📚 Study
<img src="docs/study.png" width="880" alt="Inkling — study view with a flashcard deck and Pomodoro timer" />

**SM-2 spaced-repetition flashcards** (Again / Hard / Good / Easy, keys 1–4), one-click deck creation from `Term :: Definition` lines in a note, a **Pomodoro focus timer** linked to a task or deck, and a gentle, non-punishing **study streak**.

---

## Everything else

| | |
|---|---|
| 🔍 **Command palette** | `Ctrl+K` fuzzy search across notes, tasks, and decks (SQLite **FTS5**) + quick actions |
| ⚡ **Global quick-add** | `Ctrl+Alt+N` popup with natural-date detection — *“essay draft friday at 5pm”* |
| 🎨 **Themes** | Sleek **Dark** + warm **Cozy**, high-contrast mode, adjustable font size |
| 👋 **Onboarding** | 3-step first-launch flow with Inky; sensible starter notebooks for school/work/personal |
| 🐙 **Inky the mascot** | Original SVG character — idle bob, blink, cursor-tracking eyes, celebratory bounces |
| 💾 **Data safety** | WAL-mode SQLite with rolling local backups (last 5), crash-safe writes |
| 📤 **Markdown export** | One click turns any note into a portable `.md` file — headings, lists, task lists, quotes, code, and links |
| 🛡️ **Secure by default** | `contextIsolation: true`, `nodeIntegration: false`, DB access only via the preload IPC bridge |

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` + `K` | Command palette / search |
| `Ctrl` + `Alt` + `N` | Global quick-add popup |
| `Ctrl` + `,` | Settings |
| `#`, `-`, `1.`, `>`, `[]` | Markdown block shortcuts (in the editor) |
| `Ctrl` + `B` / `I` / `U` | Bold / italic / underline |
| `Space` then `1`–`4` | Reveal card, then grade (Again / Hard / Good / Easy) |

---

## Themes

Pick the sleek **Dark** theme or the warm **Cozy** one — with a high-contrast mode and adjustable font size on top.

| Dark | Cozy |
|:---:|:---:|
| <img src="docs/theme-dark.png" alt="Inkling Dark theme" /> | <img src="docs/theme-cozy.png" alt="Inkling Cozy theme" /> |

---

## Tech stack

| Layer | Choice |
|---|---|
| Shell | **Electron** (electron-vite) |
| UI | **React 18 + TypeScript** |
| Styling | **Tailwind CSS** + CSS variables |
| Editor | **TipTap** (ProseMirror) |
| State | **Zustand** (per-module stores) |
| Database | **better-sqlite3** + typed repositories, **FTS5** search |
| Drag & drop | **dnd-kit** (kanban) + hand-rolled pointer drags (calendar, sticky board) |
| Dates | **date-fns** |
| Spaced repetition | Custom **SM-2** implementation |
| Icons | **lucide-react** |
| Tests | **Vitest** (recurrence, parsing, color-system logic) |
| CI / Packaging | **GitHub Actions** · **electron-builder** (NSIS) |

---

## Getting started

Uses **[Bun](https://bun.sh)** as the package manager / script runner (npm works too). Electron runs the app on its own embedded Node — Bun just installs and orchestrates.

```bash
bun install     # also rebuilds better-sqlite3 for Electron (postinstall)
bun run dev     # dev mode with hot reload
```

Everyday scripts:

```bash
bun run typecheck   # tsc across renderer + main/preload
bun run test        # vitest unit suite
bun run build       # production bundle
bun run dist        # Windows installer (NSIS) → release/
```

Prefer a prebuilt binary? Grab the latest installer for **Windows (`.exe`)**, **macOS (`.dmg`)**, or **Linux (`.AppImage`)** from the [**Releases**](https://github.com/dominikkoenitzer/Inkling/releases/latest) page — each platform is built and attached automatically by the [release workflow](.github/workflows/release.yml).

> **Note:** `trustedDependencies` in `package.json` lets Bun run the postinstall scripts of `electron` (binary download) and `better-sqlite3` — don't remove it.

---

## Project layout

```
src/main       Electron main — db.ts (schema/backups), repos.ts (all queries, SM-2, FTS), ipc.ts, index.ts
src/preload    contextBridge → window.inkling (typed via src/shared/api.ts)
src/renderer   React app — stores/ (zustand), components/{shell,notes,tasks,calendar,study}, lib/
src/shared     types + API contract shared across processes
test           Vitest suites for the pure logic (recur, parse, colors)
```

Data lives in a single WAL-mode SQLite file in `%APPDATA%/Inkling`, with a `backups/` folder beside it. Fully offline — nothing leaves your machine.

### Dev / test hooks

The main process reads a few env vars for isolated, reproducible runs:

| Variable | Effect |
|---|---|
| `INKLING_USERDATA=<dir>` | Run against an isolated profile |
| `INKLING_SEED=1` | Seed demo content on a fresh profile |
| `INKLING_SCREENSHOT=<file.png>` | Capture the window and exit |
| `INKLING_EVAL=<js>` | Run JS in the renderer before capture (`window.__app` exposes the store) |

---

## Roadmap

- [x] Four pillars, command palette, quick-add, themes, onboarding, mascot
- [x] SM-2 flashcards, Pomodoro, streak
- [x] CI + Windows, macOS & Linux installers (built automatically on release)
- [x] Markdown export
- [ ] PDF export
- [ ] Grade tracker
- [ ] Optional end-to-end-encrypted cloud sync
- [ ] Auto-update (electron-updater)

---

## Contributing

Issues and PRs welcome. Before opening a PR, please run:

```bash
bun run typecheck && bun run test && bun run build
```

See [`CHANGELOG.md`](CHANGELOG.md) for release history.

## License

[MIT](LICENSE) © 2026 Dominik Könitzer
