---
name: inkling
description: How the Inkling desktop app handles notes, to-dos and flashcards, and how to write text in the formats it reads. Use when the user asks for help with Inkling notes, to-dos, the Today or Flashcards pages, flashcard reviews, backups or where the data is stored, updating or removing Inkling, or wants text turned into Inkling flashcards or to-dos, or wants to connect an assistant to Inkling through its MCP server.
---

# Inkling

Inkling is a desktop app for Windows, macOS and Linux. It keeps notes, to-dos and flashcards in one local SQLite database. It has no account, no sync and no import. It has an MCP server built in, see [MCP server](#mcp-server). The only thing it fetches from the internet is its own updates.

## What you can and cannot do

- If Inkling's MCP server is connected, use its tools to read and write the user's data. See [MCP server](#mcp-server).
- Without it, you cannot see or change the user's Inkling data. Help by writing text the user pastes into a note, and by telling them where to click and which keys to press.
- If you have file access on the user's computer, you may read a copy of the database. Never write to it. See [references/data.md](references/data.md).
- Do not invent features. Inkling has no folders, tags, due dates on to-dos, reminders, reverse cards, import of any kind, or export of all notes at once.

## Notes

- The sidebar shows New note, Today and Flashcards, then every note in one list, newest edit first, with Shortcuts and Settings at its foot. There are no folders. The arrow keys walk the note list.
- A note has a title and a body. The title is optional. The note saves while the user types.
- Typed at the start of a line in the body, `# `, `## ` or `### ` makes a heading, `- ` a bullet list, `1. ` a numbered list, `[] ` a to-do and `> ` a quote.
- The toolbar above the body has Bold, Italic, Heading 1, Heading 2, Bullet list, Numbered list, Task list, Flashcards and Export as Markdown.
- Pasted plain text becomes one paragraph per line. Markdown markers in pasted text, such as `# ` or `- [ ] `, are not turned into headings or to-dos.
- A note is deleted with the trash icon in the note's toolbar. There is no confirmation. Undo shows for about six seconds; there is no trash to browse later.

## To-dos

- A to-do is a checkbox line in a note. Typing `[] ` at the start of a line makes one (`[x] ` a ticked one), and so does selecting lines and clicking Task list.
- Every open checkbox from every note shows up on Today. Ticking it there ticks it in the note, and the other way round.
- To-dos have no due dates, priorities or reminders. A to-do is its line of text.
- When you plan to-dos, write one short action per line with no `- [ ]` prefix. Tell the user to paste the lines into a note, select them and click Task list.

## Flashcards

A note becomes a deck when the user clicks Flashcards in its toolbar. This does not happen on its own: after changing card lines, the user clicks Flashcards again to update the deck.

Card lines:

- `Term :: Definition` makes one card. The line splits at the first `::`. Spaces around it do not matter. Both sides must have text.
- `{{c1::Bern}} is the capital of {{c2::Switzerland}}` is a cloze line and makes one card per number. Spans with the same number are hidden together. A hint goes after a second `::` inside the braces: `{{c1::Bern::city}}`. Extra text for the back goes after the line's own `::`: `{{c1::Bern}} is the capital :: since 1848`.
- For a longer answer, put each further answer line right below the card line and start it with a space. A card line may also end with `::` and take its whole answer from those lines. The first line that does not start with a space ends the answer.
- Card lines are read from plain paragraphs, bullet items, to-do items and quotes. Headings and code blocks are never read.
- There are no reverse cards and no other separator than `::`.

Decks:

- Each note has one deck, named after the note title when it is first made. Renaming the note later does not rename the deck.
- Clicking Flashcards again updates changed lines in place and keeps their review history, adds new lines and removes cards whose lines are gone.
- On the Flashcards page, cards made from a note's lines show as plain text and cannot be edited or deleted there. The deck page says they are edited in the note and has an Open the note link. Change the note, then click Flashcards.
- The Flashcards page also has New deck, for a deck without a note. Every deck page has Front and Back fields to add a card by hand. Such cards can be edited there, and clicking Flashcards leaves them alone, also in a note's deck.

To turn text into card lines, follow [references/cards.md](references/cards.md).

## Today and Flashcards

- Today is the page Inkling opens on. It has a To-do section with every open checkbox, and a Flashcards section with each deck that has cards due and a Review button.
- The Flashcards page lists every deck with its card count, and a Review button when cards are due. A review takes every card that is due now. There is no daily limit for new cards.
- In a review, Space (or a click on the card) shows the answer. Then 1, 2, 3 or 4 rates it Again, Hard, Good or Easy. Esc ends the review.
- Scheduling is FSRS-6 with a fixed recall target of 90%. A new card is due at once. Again brings the card back in 10 minutes and once more at the end of the review. Hard, Good and Easy schedule it at least a day out. Each button shows the interval it would give.

## Keyboard

| Keys | What it does |
|---|---|
| Ctrl+K | Search, also from inside a note; it also jumps to Today, Flashcards and Settings |
| Ctrl+N | New note |
| Ctrl+1, Ctrl+2 | Today, Flashcards |
| F1 | All shortcuts |
| Ctrl+, | Settings: the theme (Light or Dark) and Connect an AI assistant |
| Ctrl+B, Ctrl+I | Bold, italic |
| Ctrl+Shift+9 | Turn the selected lines into to-dos, or back |
| Space, then 1 to 4 | In a review: show the answer, then Again, Hard, Good or Easy |
| Esc | End a review |

On macOS, press Cmd where the table says Ctrl. Ctrl+K, Ctrl+N, Ctrl+1, Ctrl+2 and Ctrl+, work with either key there.

Search matches note titles and text, to-do text and deck names. It does not search card text.

## Data, backups and export

- One SQLite file, `inkling.db`, in `%APPDATA%\Inkling` on Windows, `~/Library/Application Support/Inkling` on macOS and `~/.config/Inkling` on Linux.
- Every start copies it into `backups/` in the same folder and keeps the newest five. There is no restore button. To restore by hand, follow [references/data.md](references/data.md).
- Export as Markdown, in the toolbar above a note, saves that one note as a `.md` file. Checkboxes come out as `- [ ]` and `- [x]`. The title becomes the file name, not a line in the file.

## Updates and removal

- Inkling checks for a new version at each start. On Windows and Linux it downloads it in the background and installs it when Inkling closes. On macOS, run `curl -fsSL https://inkling.punds.ch/install | sh` in Terminal again.
- To remove it on Windows, uninstall Inkling under Settings, Apps, Installed apps. The notes stay. To delete them too, close Inkling and delete `%APPDATA%\Inkling` (notes and backups), `%LOCALAPPDATA%\inkling-updater` (downloaded updates) and `%TEMP%\inkling-mcp` (only there if the MCP server ran).
- On macOS, move Inkling from Applications to the Trash, then delete `~/Library/Application Support/Inkling` and `~/Library/Caches/inkling-updater`. On Linux, delete the AppImage, `~/.config/Inkling` and `~/.cache/inkling-updater`.

## MCP server

Inkling runs as an MCP server when started with `--mcp`. The client talks to it over standard input and output; nothing goes over the network.

To connect it, the user opens Settings (Ctrl+,) in Inkling. Under Connect an AI assistant, Connect adds Inkling to the assistant apps it finds on the computer; the assistant needs a restart afterwards. Copy setup puts the JSON for any other MCP client on the clipboard, with the real install path. By hand, the command is the full path to Inkling and the arguments are `["--mcp"]`:

- Windows: `C:\Users\<you>\AppData\Local\Programs\Inkling\Inkling.exe` (doubled backslashes in JSON; most clients do not expand `%LOCALAPPDATA%`)
- macOS: `/Applications/Inkling.app/Contents/MacOS/Inkling`
- Linux: the full path to `Inkling.AppImage`

Tools for notes:

- `search` finds notes, to-dos and decks by words in them. `list_notes` lists notes, newest edit first; `changedSince` gives what changed lately, `offset` pages on while `more` is true, `inTrash` lists deleted notes.
- `read_note` returns a note as Markdown, or with `heading` only the section under that heading.
- `create_note` makes a note from a title and Markdown. `append_to_note` adds Markdown to the end of a note, or with `heading` to the end of that section.
- `replace_section` replaces what stands under a heading, up to the next heading of the same or a higher level, and returns what was there. `edit_note` swaps `oldText` for `newText`; `oldText` must match the Markdown from `read_note` exactly and only once, or set `replaceAll`.
- `undo_edit` takes back the last edit to a note made in this session, one per call. It refuses if the note changed since.
- `rename_note` sets a new title. `delete_note` moves a note to the trash for 30 days, its to-dos and deck hidden with it; `restore_note` brings it back.

Tools for to-dos and flashcards:

- `today` returns what the Today page shows: the open to-dos and the decks with cards due. `list_open_todos` lists every open to-do with its note. `complete_todo` and `reopen_todo` tick and untick one, in the note too.
- `list_decks` lists decks with their card and due counts. `list_due_flashcards` gives the due cards as question and answer; a cloze card asks one gap, shown as `[…]`. `grade_flashcard` records `again`, `hard`, `good` or `easy` and schedules the card, as a review does.
- `make_flashcards_from_note` does what the Flashcards button does: the note's card lines become its deck. `add_flashcards` adds `{front, back}` cards to a deck by id, or by name, making the deck if there is none.

Each note is also the resource `inkling://note/{id}`, and Today is `inkling://today`. The prompts `plan_my_day`, `quiz_me` and `flashcards_from_note` start those tasks.

Rules:

- Search and read before you write, so you add to the right note instead of making a second one. Prefer `append_to_note`, `replace_section` and `edit_note` over making a new note, and tell the user what you changed and where.
- Markdown that comes through: headings, paragraphs, bold, italic, strike, `==highlight==`, inline code, links, bullet and numbered lists, quotes, code blocks and rules. Each line becomes its own paragraph. A `- [ ]` or `- [x]` line becomes a real to-do on Today.
- An edit rebuilds only the lines it touches. A to-do line that keeps its text keeps its to-do, and a reworded line keeps it too when edited with `edit_note`.
- To make cards that stay with a note, write card lines into it, then call `make_flashcards_from_note`. It refuses when it would remove cards whose lines are gone; say so, and leave that to the user's Flashcards click.
- Quizzing: show the question, wait for the user's answer, then show the answer and grade it by what they said. When unsure, ask them how it went.
- Nothing can be deleted for good. Ask before `delete_note`. The server cannot change settings.
- Before the first change in a session, the server copies the data into `backups/` as `assistant-` plus the date and keeps the last three.
- If a tool says Inkling needs to be opened first, ask the user to open Inkling once and try again. This happens before the first start and after an update. If it says the data is newer than this copy of Inkling, the command in the client's config starts an older Inkling than the one that last opened the data; ask the user to press Fix under Connect an AI assistant, or update the path.
- Inkling can stay open while you work. The window shows your changes within a couple of seconds.

## How to help

- Drafting a note: give plain lines the user can paste, and say which lines to turn into headings, lists or to-dos with the toolbar.
- Making flashcards from pasted text: return only card lines in one plain code block, so the copy button copies plain text. Tell the user to paste them into a note and click Flashcards. With the MCP server connected, write them into the note with `append_to_note` and call `make_flashcards_from_note`.
- Explaining when a card comes back: use the scheduling rules above. Do not promise exact intervals; the app computes them per card from its review history.
