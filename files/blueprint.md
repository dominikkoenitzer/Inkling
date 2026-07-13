# NoteFlow — Full Product Blueprint (v2)
*An all-in-one, Discord-shelled, OneNote-powered productivity hub for students & everyone else (Electron)*

---

## 1. Vision & Design Philosophy

**One-liner:** A warm, friendly, all-in-one desktop app where you can dump a quick thought, write a full essay, track your assignments, see your week at a glance, and study for a test — all without leaving one app, navigated through a UI that feels as fluid and familiar as Discord.

**Core principles:**
- **Zero friction to capture.** New note = one keystroke. No forced titles, no save button.
- **One app, four pillars.** Notes, Tasks, Calendar/Schedule, and Study Tools — unified, cross-linked, not bolted-on separate apps.
- **Friendly, not corporate.** Warm color options, encouraging micro-copy, gentle empty-states ("Nothing due today — nice!"), subtle celebratory moments (completing a task, finishing a study session) — never childish or gamified to the point of being distracting.
- **Forgiving formatting.** Toolbar or markdown shortcuts, your choice, always.
- **Local-first.** Everything works fully offline; your data lives on your machine.
- **Built for real student/work life.** Assignments have due dates. Classes repeat weekly. Studying benefits from spaced repetition. The app should just *get* that.

---

## 2. Tech Stack (final)

| Layer | Choice | Reasoning |
|---|---|---|
| Shell | **Electron** (electron-vite) | Native window, tray, global hotkeys, OS notifications |
| UI Framework | **React 18 + TypeScript** | Component reuse across modules |
| Styling | **Tailwind CSS** + CSS variables | Fast theming, warm palette support |
| Rich Text Editor | **TipTap** (ProseMirror) | Toolbar + live markdown shortcuts together |
| State Management | **Zustand** | Lightweight, per-module stores |
| Local Database | **better-sqlite3** + Drizzle ORM | Fast, relational, handles notes/tasks/events cleanly |
| Drag & Drop | **dnd-kit** | Sticky board + kanban task board + calendar drag-to-reschedule |
| Search | **SQLite FTS5** | Instant full-text search across notes and tasks |
| Calendar rendering | **date-fns** + custom grid components | Lightweight, no heavy calendar lib bloat |
| Spaced repetition (flashcards) | Custom SM-2 algorithm implementation | Simple, proven, no external dependency needed |
| Icons | **lucide-react** | Clean, friendly, modern |
| Packaging | **electron-builder** | Cross-platform installers |

---

## 3. The Four Pillars

### Pillar 1 — Notes (as designed previously)
- **Pages** (linear, OneNote-style) and **Stickies** (freeform board), TipTap editor, full formatting spec, auto-save, daily journal.

### Pillar 2 — Tasks
- Simple to-do lists *and* a kanban board view (toggle per notebook/list)
- Due dates, priority flags, subtasks, checkboxes
- Tasks can live standalone OR be embedded inside a note (a checkbox typed in a note becomes a real trackable task automatically)
- "Today" and "This Week" smart views aggregate tasks across all notebooks

### Pillar 3 — Calendar / Schedule
- Week and month views
- **Class schedule mode**: recurring weekly blocks (e.g. "Biology 101, Mon/Wed/Fri 9–10am") — set once, repeats automatically all semester
- Assignment due dates and task due dates automatically appear on the calendar
- Drag-to-reschedule any task or event directly on the calendar grid
- Color-coded by notebook/subject

### Pillar 4 — Study Tools
- **Flashcards**: create decks (manually, or auto-generate cards from a note's checklist/Q&A-formatted lines), spaced-repetition review mode (SM-2 algorithm — cards you know well show up less often, ones you struggle with come back sooner)
- **Focus/Pomodoro timer**: linked to a specific task or study deck, tracks focused minutes per subject
- **Study streak**: gentle, non-punishing streak counter for consistency (skipping a day doesn't shame you, it just resets quietly)

**Cross-linking is the key design idea:** a note about "Chapter 4 notes" can have a linked task ("Finish reading Ch. 4 by Friday"), which shows up on the calendar, and its bolded key terms can become flashcards — all from the same piece of content, no duplicate entry.

---

## 4. Friendly & Approachable UI Principles

- **Warm default palette option**: alongside the sleek dark Discord-like theme, offer a softer "Cozy" theme — warm off-white background, muted pastel accent colors (sage, terracotta, dusty blue) for notebooks/subjects, rounded corners, slightly larger comfortable typography
- **Encouraging micro-copy**: empty states say things like "Nothing due today — enjoy it" or "First flashcard deck? Let's make it" instead of blank "No data" messages
- **Gentle onboarding**: 3-step first-launch flow — "What should we call your first notebook?" → "Are you using this for school, work, or personal stuff?" (adjusts default templates) → "Want a daily journal note? (optional)"
- **Sensible templates on first run**: if "school" is chosen — pre-built notebook structure (e.g. "Assignments", "Class Notes", "Study Decks") the person can rename or delete freely
- **No dark patterns**: no streak-shaming, no forced notifications, no nagging — reminders are helpful, never guilt-driven
- **Accessible by default**: adjustable font size, high-contrast mode option, full keyboard navigation

---

## 5. UI Layout Blueprint

```
┌───┬─────────────────┬──────────────────────────────┬───────────┐
│   │  NOTEBOOK NAME   │                                │  Right    │
│ I │ [Notes][Tasks]   │                                │  Panel    │
│ c │ [Calendar]       │        MAIN PANE               │(collapsible)│
│ o │  ─────────────── │   (Notes editor / Task board /  │           │
│ n │  🔍 Search        │    Calendar grid / Flashcards)  │ context-  │
│   │  + New            │                                │ dependent │
│ R │  ─────────────── │                                │ metadata  │
│ a │  📌 Today          │                                │           │
│ i │  Item preview...   │                                │           │
│ l │  ...                │                                │           │
├───┤                     │                                │           │
│ ⚙ │                     │                                │           │
│ 👤│  (streak: 4 days)   │                                │           │
└───┴─────────────────┴──────────────────────────────┴───────────┘
```

- **Icon Rail**: notebooks (subjects/workspaces), settings, streak/status indicator at bottom
- **Sidebar**: top tab switcher between **Notes / Tasks / Calendar** for the active notebook, search, quick-add
- **Main Pane**: swaps between the Notes editor, Task board (list or kanban), Calendar grid, or Flashcard review mode, depending on the active tab
- **Right Panel**: contextual — shows linked tasks for a note, or linked notes for a task, or upcoming due items for the calendar

---

## 6. Data Model (SQL schema, expanded)

```sql
CREATE TABLE notebooks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT,
  kind TEXT CHECK(kind IN ('general','school_subject')) DEFAULT 'general',
  sort_order INTEGER DEFAULT 0,
  is_journal BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  type TEXT CHECK(type IN ('page','sticky')) NOT NULL,
  title TEXT,
  content TEXT NOT NULL,        -- TipTap JSON
  color TEXT,
  pos_x REAL, pos_y REAL,
  width REAL, height REAL,
  pinned BOOLEAN DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,  -- optional link back to source note
  title TEXT NOT NULL,
  status TEXT CHECK(status IN ('todo','in_progress','done')) DEFAULT 'todo',
  priority TEXT CHECK(priority IN ('low','medium','high')) DEFAULT 'medium',
  due_date DATETIME,
  parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, -- subtasks
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME,
  recurrence_rule TEXT,           -- e.g. "WEEKLY;BYDAY=MO,WE,FR" (simplified RRULE)
  linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  color TEXT
);

CREATE TABLE flashcard_decks (
  id INTEGER PRIMARY KEY,
  notebook_id INTEGER REFERENCES notebooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE flashcards (
  id INTEGER PRIMARY KEY,
  deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease_factor REAL DEFAULT 2.5,     -- SM-2 algorithm state
  interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_date DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE focus_sessions (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  deck_id INTEGER REFERENCES flashcard_decks(id) ON DELETE SET NULL,
  duration_minutes INTEGER,
  started_at DATETIME,
  completed BOOLEAN DEFAULT 0
);

CREATE VIRTUAL TABLE search_index USING fts5(
  title, content_text, source_type, source_id
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

---

## 7. Interaction Details

**Auto-save:** debounced 400ms writes across all modules (notes, tasks, events); flushed on blur/close.

**Command Palette (Cmd/Ctrl+K):** fuzzy search across notes, tasks, and flashcard decks; quick actions like "New Task", "Start Focus Session", "Jump to Calendar".

**Quick-Add (global hotkey):** a small popup lets you add a note, task, or event without opening the full app — auto-detects intent (typing a date-like phrase suggests "Add as event/task").

**Note → Task auto-linking:** typing `[]` in a note creates a checklist item that also appears in the Tasks view for that notebook, fully bidirectional.

**Flashcard auto-suggestion:** lines formatted as `Term :: Definition` inside a note can be one-click converted into a flashcard deck.

**Streak & focus tracking:** shown quietly at the bottom of the icon rail — never a popup, never punishing, just a small number.

---

## 8. Component Tree (React)

```
<App>
 ├── <IconRail>              // notebooks, settings, streak indicator
 ├── <Sidebar>
 │    ├── <ModuleTabs>        // Notes / Tasks / Calendar
 │    ├── <SearchBar>         // opens <CommandPalette>
 │    └── <ItemList>          // notes, tasks, or agenda depending on tab
 ├── <MainPane>
 │    ├── <PageEditor>         // TipTap, linear notes
 │    ├── <StickyBoard>        // freeform notes canvas
 │    ├── <TaskBoard>          // list/kanban toggle
 │    ├── <CalendarGrid>       // week/month view
 │    └── <FlashcardReview>    // SM-2 review session UI
 ├── <RightPanel>              // contextual links/metadata
 └── <CommandPalette>          // global overlay
```

---

## 9. Non-Functional Requirements

- **Local-first & offline-capable**: fully functional with no network, SQLite file on disk
- **Performance target**: cold start < 1.5s, view switch < 100ms, search < 150ms at 10k+ items
- **Data safety**: WAL mode SQLite, rolling local backups (last 5), crash-safe writes
- **Security**: Electron `contextIsolation: true`, `nodeIntegration: false`, DB access only via preload IPC bridge

---

## 10. Roadmap

**Phase 1 — Shell & Navigation**
Electron + Vite boilerplate, icon rail, sidebar, theming (Dark + Cozy), onboarding flow.

**Phase 2 — Notes (core writing)**
TipTap integration, full formatting spec, Pages + Sticky Board, auto-save.

**Phase 3 — Tasks**
Task CRUD, list + kanban views, note-to-task checkbox linking, Today/This Week smart views.

**Phase 4 — Calendar**
Week/month grid, recurring class schedule support, drag-to-reschedule, task/assignment due dates surfaced automatically.

**Phase 5 — Search & Command Palette**
FTS5 across notes/tasks/decks, Cmd/Ctrl+K palette, global quick-add hotkey.

**Phase 6 — Study Tools**
Flashcard decks, SM-2 spaced repetition engine, note-to-flashcard conversion, Pomodoro/focus timer, streak tracking.

**Phase 7 — Branding & mascot**
Finalize logo/app icon across sizes, implement Inky as a reusable component (SVG poses + CSS idle/hover/click animations per §11), wire it into onboarding, empty states, and the streak indicator.

**Phase 8 — Polish**
Right panel metadata, accessible/high-contrast mode, backups, settings screen, empty-state copywriting pass.

**Phase 9 (v2+, later):** optional cloud sync, export (Markdown/PDF), mobile companion, grade tracker, collaborative notebooks, Rive-based mascot upgrade.

---

## 11. Branding & Visual Identity

**Name:** Inkling
**Tagline:** notes, tasks, schedule and study — together

### Logo mark
A rounded ink-droplet inside a rounded square (matches macOS/Windows app icon conventions). Teal-forward as the primary brand color, with the "cozy" palette used for notebook/subject color-coding throughout the app.

![Inkling logo mark](assets/logo.svg)

### Color palette

| Name | Hex (mid tone) | Use |
|---|---|---|
| Teal | `#1D9E75` | Primary brand color, default notebook, active-state ring |
| Coral | `#D85A30` | Notebook accent / warm alert state |
| Amber | `#BA7517` | Notebook accent / idle & study-mode accent |
| Pink | `#D4537E` | Notebook accent |
| Gray | `#888780` | Neutral/structural notebook, disabled states |

Dark mode: each color has a full 7-stop ramp (50→900); UI always pulls the 50/100 stop for backgrounds and 600+ for text/borders so contrast holds in both themes (see §4 UI principles — high-contrast mode included).

### Mascot — "Inky"
An original character (not derived from any existing IP) built from the same droplet shape as the logo, given a face. Inky is the app's emotional layer — it shows up in onboarding, empty states, and the streak indicator, and its color shifts to match the active notebook's color.

![Inky mascot reference sheet](assets/mascot-inky.svg)

**Poses defined for v1:**
- **Neutral** (teal) — default state, sits quietly in empty states and the icon rail
- **Waving hello** (coral) — first launch, onboarding, "welcome back" after time away
- **Sleepy/idle** (amber) — nothing due today, long inactivity, "Inky's taking a nap"

**Where Inky appears:**
- Onboarding flow (waving pose, walks the person through the 3-step setup from §4)
- Empty states across Notes/Tasks/Calendar/Flashcards ("Nothing here yet — want to add something?")
- Streak indicator at the bottom of the icon rail (tiny animated face instead of a bare number)
- Focus/Pomodoro session complete ("nice focus session!")
- Flashcard deck "all caught up" state

### Motion & interactivity spec (making it feel alive)

Static art isn't enough for a mascot — Inky needs a small, consistent motion vocabulary so it reads as "present" rather than decorative. Keep every animation short, subtle, and interruptible; nothing should block the person from working.

**Idle loop (always running, very subtle):**
- Gentle vertical bob, ~2px amplitude, 3s ease-in-out cycle (like breathing)
- Occasional blink every 4–7s (randomized interval so multiple instances on screen don't sync up and look robotic)

**Reactive micro-interactions:**
- **Hover** — Inky's eyes track the cursor slightly (±3px pupil shift toward pointer) — cheap to do, very high perceived-life payoff
- **Click/tap** — quick squash-and-stretch bounce (120ms squash, 180ms settle back), same principle as iOS icon bounces
- **Task completed** — brief happy pose swap (neutral → small bounce + closed-eye smile) for ~600ms, then returns to neutral
- **Streak milestone** (e.g. 7-day) — slightly bigger celebratory bounce, but still no confetti/sound spam — stays understated per the "no dark patterns" principle in §4

**State-driven appearance changes:**
- Body color = active notebook's color (re-skins in real time when switching notebooks)
- Pose = derived from context (sleepy when nothing's due, waving on first launch of the day, neutral otherwise) rather than random, so it always feels meaningful rather than gimmicky

**Implementation approach:**
- v1 (lean): SVG + CSS animations / SMIL, driven by React state — the poses above are just swapped path/attribute values, no external animation library needed. Idle bob and blink are pure CSS keyframes.
- v2 (polish): consider **Rive** (rive.app) for the mascot specifically — exports a small runtime file, supports state-machine-driven animation (feed it "streak count," "active notebook color," "last action" as inputs and Rive handles blending between poses/movements smoothly). This is the standard approach for this exact kind of reactive mascot and would replace the hand-rolled CSS version once the shape language is finalized.
- Keep Inky's animation layer decoupled from app logic — it should only ever *read* state (streak count, active notebook, idle time), never gate or block any action.

---

## 12. Packaging & Distribution

- `electron-builder` targets: `nsis` (Windows) first, `dmg`/`AppImage` later
- Auto-update via `electron-updater` against GitHub Releases (v2)
