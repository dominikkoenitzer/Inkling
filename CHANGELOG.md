# Changelog

All notable changes to Inkling are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-07-18

The "make studying fun" release: Inkling sharpens from a four-pillar organizer into a study companion that tells you what to do today.

### Added
- **Today view** — a new home tab (and the app's new default) that auto-assembles a daily study plan: flashcard decks with due cards, tasks due today (with inline check-off), your lowest-averaging subject, and a suggested 25-minute focus block — each with a one-click start. Clearing the plan earns a confetti celebration.
- **Grading systems** — choose **Swiss 1–6** (6 best, 4 = pass; grades entered directly and averaged by weight), **US letters + 4.0 GPA**, or plain **percentages**. Switchable from the Grades header or Settings; the sidebar, Today plan, and grade rows all follow.
- **User bar** — a Discord-style panel pinned to the bottom of the sidebar: Inky + streak status, a **live Pomodoro chip** (visible and pausable from any tab), and settings. The previously dead space at the bottom of the app now works for a living.
- **Notebook icon covers** — every notebook can pick a monochrome glyph (flask, calculator, globe, brain, …) from the app's own icon family, shown on its gradient squircle in the rail, the sidebar header, and Today plan cards. School starter notebooks come pre-iconed.

### Changed
- **Design-consistency pass** — icons normalized to a 4-step scale (18 nav / 16 standard / 14 meta / 12 floor; previously 11 ad-hoc sizes from 9–20 px), micro-text unified at 11 px, view headings unified, larger hit targets.
- **Micro-interactions everywhere** — staggered list entrances, plan cards that lift on hover, press-scale on every button, a flickering streak flame, checkbox pop on completion, all honoring `prefers-reduced-motion`.
- Notebook rail squircles now use a subtle color gradient; the sidebar's due-this-week and context-panel items are clickable.

### Removed
- **Calendar module** — Inkling is a study companion, not a scheduling app; students already have calendars. Task due dates (with natural-language quick-add) fully cover in-app scheduling. Existing `events` data stays untouched in the database; only the UI and APIs are gone.

## [0.2.1] — 2026-07-13

### Fixed
Findings from an adversarial review of the 0.2.0 additions (all verified):
- **Markdown export no longer drops content** — a list item's second paragraph, code block, or blockquote is now preserved (previously only the first paragraph + nested lists survived).
- **Markdown export escapes metacharacters** — literal text like `- not a list` or `*args` round-trips instead of being reinterpreted as formatting.
- **PDF export handles large notebooks** — renders via a temp file instead of a `data:` URL, so big exports no longer fail silently past Chromium's ~2 MB URL cap.
- **Export failures surface an error** instead of failing silently (and the PDF print window is always cleaned up).
- **Grade header is internally consistent** — the shown percentage, letter, and GPA are derived from one rounded value, so they can't disagree at a cutoff.

## [0.2.0] — 2026-07-13

### Added
- **Grade tracker** — a new per-subject module: log assessments (score / max / weight) and see a live **weighted average, letter grade, and 4.0 GPA**, with an overall GPA across subjects in the sidebar. (DB migration v2, additive.)
- **Export a whole notebook as PDF** — from Notebook settings, render every page into one print-styled document.
- **Auto-updates** — packaged builds check GitHub Releases for new versions via `electron-updater`.
- **Universal macOS build** — a single `.dmg`/`.zip` runs natively on both Intel and Apple Silicon.

### Changed
- The sidebar gained a fifth module tab, **Grades**.

## [0.1.3] — 2026-07-13

### Added
- **Export a note as PDF** — renders the note to a clean, print-styled document via Electron's `printToPDF`. The note toolbar's Export button now offers **Markdown** or **PDF**.

## [0.1.2] — 2026-07-13

### Added
- **Export a note as Markdown** — a toolbar button serializes the note (headings, lists, task lists, quotes, code, links, inline marks) and saves it via a native dialog. The pure converter is unit-tested.
- README **Themes** section showing the Dark and Cozy themes side by side.

## [0.1.1] — 2026-07-13

### Added
- **Cross-platform builds** — macOS (`.dmg` + `.zip`) and Linux (`.AppImage`) targets alongside the Windows NSIS installer.
- **Release automation** — a GitHub Actions matrix workflow builds installers for Windows, macOS, and Linux and attaches them to the release.

### Changed
- Redesigned the README hero banner into a product shot.

## [0.1.0] — 2026-07-13

First public release.

### Added
- **Notes** — TipTap pages (toolbar + live markdown shortcuts) and a freeform sticky board; debounced autosave flushed on blur/unmount.
- **Tasks** — list + kanban board, due dates, priorities, subtasks, and Today / This Week smart views across notebooks.
- **Calendar** — week/month grids, weekly-recurring class blocks (`WEEKLY;BYDAY=…`), task due-dates surfaced automatically, drag-to-reschedule.
- **Study** — SM-2 spaced-repetition flashcards, one-click decks from `Term :: Definition` lines, Pomodoro focus timer, gentle streak.
- **Cross-linking** — note checkboxes are real bidirectional tasks; task due-dates appear on the calendar; bolded terms become flashcards.
- `Ctrl+K` command palette over SQLite **FTS5** search; `Ctrl+Alt+N` global quick-add with natural-date detection.
- Dark + Cozy themes, high-contrast mode, adjustable font size, 3-step onboarding, and the **Inky** mascot.
- WAL-mode SQLite with rolling local backups (last 5); `contextIsolation`/`nodeIntegration`-safe Electron setup.
- Generated multi-size app icon and a **Windows NSIS installer**.
- **Vitest** unit suite (recurrence, parsing, color system) and **GitHub Actions CI** (typecheck · test · build).

### Fixed
Final QA pass — 15 defects found by an adversarially-verified review and fixed:
- Calendar drag no longer fires a spurious click that reopened a dialog or jumped to another tab.
- Today / This Week smart views now surface subtasks whose parent isn't in the result set.
- Month-grid **“+N more”** now counts hidden items correctly (and never hides items without an indicator).
- Flashcard grading is guarded against double-fire and against keypresses on the completion screen.
- Quick-add: fixed double-submit duplicates, the un-selectable “Note” kind, and auto-hide firing mid-typing.
- Deleting the active notebook no longer strands a phantom editor over a deleted note.
- Sticky notes flush their debounced autosave on unmount/blur (no lost edits); saves landing after delete are safe no-ops.
- Nested subtask text no longer folds into the parent task’s title.
- A quick-add of only a date (e.g. `friday`) gets a neutral title instead of the raw date word.

[0.1.0]: https://github.com/dominikkoenitzer/Inkling/releases/tag/v0.1.0
