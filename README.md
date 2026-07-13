# Inkling

*notes, tasks, schedule and study — together*

A local-first, Discord-shelled productivity hub for students & everyone else, built from `files/blueprint.md`. Electron + React 18 + TypeScript + Tailwind + TipTap + Zustand + better-sqlite3 (FTS5).

## Run it

Uses **Bun** as the package manager / script runner (npm works too). Electron still executes the app with its embedded Node — Bun just installs and orchestrates.

```powershell
bun install     # also rebuilds better-sqlite3 for Electron (postinstall)
bun run dev     # dev mode with HMR
```

Production build & launch:

```powershell
bun run build
bunx electron .
```

Windows installer: `bun run dist` (NSIS, lands in `release/`).

Note: `trustedDependencies` in package.json lets Bun run the postinstall scripts of `electron` (binary download) and `better-sqlite3` — don't remove it.

## The four pillars

- **Notes** — TipTap pages (toolbar + markdown shortcuts: `#`, `-`, `1.`, `>`, `**bold**`, `[]`) and a freeform **sticky board** (drag, resize, recolor). Auto-save, debounced 400 ms, flushed on blur.
- **Tasks** — list + kanban board, due dates, priorities, subtasks, Today / This Week smart views. Typing `[] ` in a note creates a *real linked task*, bidirectional (check it in either place).
- **Calendar** — week/month views, weekly-recurring class blocks (`WEEKLY;BYDAY=…`), task due dates surface automatically, drag events/task-chips to reschedule.
- **Study** — flashcard decks with SM-2 spaced repetition (Again/Hard/Good/Easy, keys 1–4), one-click deck creation from `Term :: Definition` lines in a note (✨ toolbar button), Pomodoro focus timer linked to a task or deck, gentle streak.

Plus: **Ctrl+K** command palette with FTS5 full-text search across notes/tasks/decks, **Ctrl+Alt+N** global quick-add popup with date detection ("essay draft friday at 5pm"), Dark + Cozy themes, high-contrast mode, adjustable font size, 3-step onboarding with Inky, rolling local DB backups (last 5), daily journal.

## Where's my data?

A single SQLite file (WAL mode) in `%APPDATA%/Inkling`, with `backups/` beside it. Fully offline.

## Dev/test hooks

- `INKLING_USERDATA=<dir>` — run against an isolated profile
- `INKLING_SEED=1` — seed demo content on a fresh profile
- `INKLING_SCREENSHOT=<file.png>` — capture the window and exit (optionally `INKLING_EVAL=<js>` first)

## Layout

```
src/main       Electron main: db.ts (schema/backups), repos.ts (all queries, SM-2, FTS), ipc.ts, index.ts
src/preload    contextBridge → window.inkling (typed via src/shared/api.ts)
src/renderer   React app: stores/ (zustand), components/{shell,notes,tasks,calendar,study}, lib/
src/shared     types + API contract shared across processes
```

Security per blueprint §9: `contextIsolation: true`, `nodeIntegration: false`, DB access only via the preload IPC bridge.
