# Changelog

All notable changes to Inkling are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-08-16

**Progress.** Through v0.3.x Inkling could tell you what to do today but never what you'd
achieved: a flashcard stored only where SM-2 had left it, and every answer overwrote the
last. This release gives the app a memory — a permanent review log — then builds on it: a
modern scheduler, a Progress page, and a streak that's derived from what you actually did.
It also brings the desktop shell up to date, adds wiki-links, tags, import, and an undo for
deletion.

### Added
- **Progress view** — a new tab: an activity heatmap over the last six months, **true
  retention**, reviews and focused hours, current and longest streak, a 14-day forecast of
  what's coming due, an Again/Hard/Good/Easy breakdown, your memory-state mix, and a
  per-subject table. Built on a new `review_log` table that records one immutable row per
  answered card.
- **FSRS-4.5 scheduling**, replacing SM-2. Instead of one "ease factor" per card, FSRS
  models **stability** (how long until recall drops to 90%) and **difficulty**, so it can
  schedule for an explicit *recall target* rather than an arbitrary multiplier. Each review
  button now shows the interval it would buy (`10m · 1d · 3d · 15d`). Existing cards are
  converted from their SM-2 state, not reset.
- **Recall target** setting — 85% / 90% / 95%. Higher means shorter intervals and more
  reviews; FSRS solves each interval for the number you pick.
- **`[[Wiki-links]]`** — type `[[Chapter 4]]` in any note to link another page. Unknown
  titles create the page, so you can link as you write. The context panel gains a **Linked
  from** section showing every note pointing at the current one.
- **`#hashtags`** — tags are read out of your note text (like `[]` becomes a task and
  `Term :: Definition` becomes a flashcard). The Notes sidebar lists every tag in the
  notebook with counts; clicking one filters the page list.
- **Import** — bring in **Markdown** files as pages (headings, lists, task lists, quotes,
  code, inline marks, and `[[links]]`), or a **CSV/TSV** of cards as a deck. The delimiter
  is detected rather than asked for, so Quizlet and Anki exports work as-is.
- **Trash and undo** — deleting a page or sticky now moves it to a trash it can be restored
  from, with an **Undo** offered immediately. Trashed notes are cleared 30 days later.

### Changed
- **Streaks are derived from your history**, not from two counters in `settings`. The user
  bar, the Today greeting, and Progress can no longer disagree, and a session that ended
  without the app noticing still counts. An existing streak carries over on upgrade.
- **Electron 33 → 43.** Electron only patches its three newest majors, so every previous
  installer shipped an end-of-life Chromium. Also updated: better-sqlite3 11 → 13, React
  18 → 19, TipTap 2 → 3, Tailwind CSS 3 → 4, Vite 6 → 8, electron-vite 3 → 5,
  electron-builder 25 → 26, lucide 0.474 → 1.x.
- The version in Settings is now injected from `package.json` at build time — it had
  already drifted a release behind.
- A fresh database no longer creates the `events` table left over from the calendar module
  removed in v0.3.0. Existing databases keep their rows, as promised at the time.

### Fixed
- Deleting a note was an immediate, unconfirmed, unrecoverable `DELETE`.

### Notes
- Database migrations v4–v7 run automatically on first launch and are all additive; a
  backup is taken before any of them, as on every launch.
- 146 tests (was 53), including a full unit suite for the FSRS implementation and a
  Markdown export → import → export round-trip.

## [0.3.4] — 2026-07-19

Fixes from an adversarial review of the v0.3.0–v0.3.3 changes (all six verified), plus refreshed docs.

### Fixed
- **Grades keep their meaning when you switch systems.** Each assessment now records the grading system it was entered under, so changing the header toggle no longer silently reinterprets old grades. Previously a points entry that happened to be out of 6 could be misread as a failing Swiss grade, and a Swiss pass could land near the bottom of the US letter scale. (DB migration v3, additive; existing grades are backfilled from your current system.)
- **Switching the grading system mid-entry can't submit a wrong grade.** Changing the toggle while adding an assessment now clears the half-typed draft instead of reinterpreting a Swiss grade as a raw percentage.
- **The Today focus card won't discard a running session.** When a focus block is already in progress the card offers **Resume** instead of a second **Start**, and starting a new session banks any minutes already elapsed rather than orphaning them.
- **Segmented toggles stay visible in high-contrast mode.** The grading, theme, font-size and List/Board controls now carry a border, so they no longer vanish when high-contrast collapses the surface tones to a single colour.
- **The Tasks "All clear" banner tells the truth.** It now accounts for unchecked subtasks nested under a completed parent, so it won't claim you're done while an open task is on screen.
- **Deck "add card" fields read as fields.** The Front/Back inputs now sit on a distinct surface from their container instead of blending into one block.

### Changed
- README screenshots and hero banner regenerated for the current design (vertical navigation, four-tone surface ladder); tests badge now reflects 53 passing.

## [0.3.3] — 2026-07-18

Round two of the design review: tone separation, empty states, and width discipline.

### Changed
- **Wider surface ladder**: the content area is now visibly lighter than the sidebar and the rail visibly darker than both, in both themes.
- **Context panel auto-collapses**: it opens only when a note or task is selected (real context); otherwise it stays a slim strip. A manual toggle always wins.
- **Width discipline**: the tasks add-row is capped to the same 720px column as the list; the grades add-row collapsed into a "+ Add assessment" button that expands on demand.
- **Empty states**: a completed-only task list shows an explicit empty "To do" group; percentages round to one decimal everywhere (header and sidebar can no longer disagree).
- **Today**: the cleared banner is a slim one-liner so "Jump back in" moves up; the duplicated focus-minutes line is gone.
- **Notes sidebar**: Page and Sticky board are equal-width siblings; the journal shortcut has its own labeled section.
- **Focus timer**: tightened vertical rhythm and a visible progress track; segmented controls sit on a darker pill track everywhere.

## [0.3.2] — 2026-07-18

A design-review pass applying an 8-point critique against Discord's visual system.

### Changed
- **Strict 4-tone surface ladder** (rail → sidebar → content → cards/inputs), using Discord's exact dark values; nothing in between.
- **Sidebar nav is now vertical rows**: icon left, label right, 32px height, neutral pill highlight on the active tab instead of a green square.
- **Accent discipline**: green is reserved for interactive and active states; streak text is default foreground with only the flame colored.
- **One corner radius (8px) everywhere**; separation comes from background tone, not strokes.
- **Flat context panel**: tiny uppercase labels and plain rows instead of boxed cards; empty sections hide instead of repeating "nothing due" three times.
- **Today view density**: 28px greeting on a tighter type scale, compact 36px quick actions, and a "Jump back in" list of recent pages so the canvas is useful, not empty.
- Titlebar shows just "Inkling"; the notebook name lives in the sidebar header only.

## [0.3.1] — 2026-07-18

The clean pass, from a direct side-by-side against Discord.

### Changed
- **Surfaces separate by elevation, not borders.** The rail, sidebar, and content each sit on their own background shade (rail darkest); hairline borders between panes are now nearly invisible in the normal themes. High-contrast mode restores strong borders.
- **Cards are raised again.** Plan cards, deck cards, the focus timer, flashcards, and form panels use the raised surface, so they float above the content instead of reading as cut-outs.
- **The titlebar blends in.** Window chrome now matches the app background in both themes; the black seam at the top is gone.
- **Context panel sections are cards**, like Discord's Active Now panel.
- **Rail initials are word initials** ("My Notebook" → MN), uppercase, so notebooks without a glyph still look deliberate.
- **A cleared Today plan centers itself** and offers three quick actions (new page, build a deck, add a task) instead of leaving the pane empty.

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
