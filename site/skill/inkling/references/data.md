# Inkling data on disk

Read this only when you have file access on the user's computer, or when the user asks where their data is or how to restore a backup.

## Where it is

| System | Folder |
|---|---|
| Windows | `%APPDATA%\Inkling` |
| macOS | `~/Library/Application Support/Inkling` |
| Linux | `~/.config/Inkling` |

If the environment variable `INKLING_USERDATA` is set when Inkling starts, the folder is that path instead.

In the folder:

- `inkling.db` is the whole library: notes, to-dos, decks, cards, review history and the theme.
- `inkling.db-wal` and `inkling.db-shm` sit next to it while Inkling runs. Recent changes can be in the `-wal` file and not yet in `inkling.db`.
- `backups/inkling-YYYY-MM-DDTHH-MM-SS.db` is a full copy made at every start, before anything else touches the file. The time is UTC. The newest five are kept.

Only one copy of Inkling runs at a time; a second launch brings the open window to the front. Inkling started with `--mcp` is the exception: it opens no window, runs beside the app and keeps its scratch files in `inkling-mcp` in the system temp folder, not in the data folder.

## Format

SQLite in WAL mode. `PRAGMA user_version` holds the schema version (13 at the time of writing). A database from an older version is upgraded at the next start, after the backup.

| Table | What it holds |
|---|---|
| `notes` | `title` as plain text, `content` as the editor's JSON document in a text column (not Markdown, not HTML), `updated_at`, and `deleted_at` for a deleted note |
| `tasks` | one row per checkbox line: `note_id`, `title`, `status` (`todo` or `done`). The checkbox in the note's JSON points at its row through `attrs.taskId` |
| `flashcard_decks` | `name`, and `note_id` for a deck made from a note |
| `flashcards` | `deck_id`, `front`, `back`, `cloze` (the cloze number, 0 for a plain card), `source_line`, `state`, `stability`, `difficulty`, `last_review`, and `next_review_date`, the moment the card is due |
| `review_log` | one row per answered card: `rating` 1 to 4 for Again, Hard, Good, Easy, and `reviewed_at` |
| `settings` | key and value pairs, for example `theme` |
| `search_index` | the full text search index, kept up to date only by Inkling itself |
| `notebooks` | a storage detail; Inkling shows every note in one list |

Some tables and columns are left from removed features, such as `focus_sessions`, `grades` and `tasks.due_date`. Inkling does not show them.

A deleted note stays in `notes` with `deleted_at` set and is removed for good at the first start after 30 days.

## Reading it

- Read the newest file in `backups/`, or a copy of `inkling.db` made after the user quit Inkling. Do not open the live file while Inkling runs.
- To list a note's text, read `notes.content` as JSON and collect the text of its nodes. To get Markdown, the user can click Export as Markdown on that note instead.

## Never write to it

Do not change `inkling.db`, its `-wal` or `-shm` files, or a backup, whether Inkling is open or not.

- Inkling does not watch the file. It reloads the open note only when its window gets focus, and an edit still waiting to be saved there is written over an outside change.
- To-do rows, card links and the search index only follow the notes when Inkling itself makes the change, so a hand edit leaves them out of step.

If the user wants something changed, tell them how to do it in Inkling.

## Restoring a backup

Inkling has no restore button. To go back to a backup by hand:

1. Quit Inkling.
2. Move `inkling.db`, and `inkling.db-wal` and `inkling.db-shm` if they are there, into another folder. Keep them until the restore works.
3. Copy the chosen file from `backups/` into the data folder and rename the copy to `inkling.db`.
4. Start Inkling.
