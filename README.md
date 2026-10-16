# Inkling

[![CI](https://github.com/dominikkoenitzer/Inkling/actions/workflows/ci.yml/badge.svg)](https://github.com/dominikkoenitzer/Inkling/actions/workflows/ci.yml)

Inkling is a desktop app for studying from your own notes: the to-dos and flashcards you write in a note come together on one Today page, and everything stays on your computer.

<p align="center">
  <img src="docs/notes.png" width="880" alt="A note in Inkling with a checklist and flashcard lines" />
</p>

## Download

**[Download Inkling for Windows](https://get-inkling.vercel.app)**, then double-click it. It installs and opens on its own, and there is no account to make.

Windows may say "Windows protected your PC"; click More info, then Run anyway.

For macOS and Linux, see [Other ways to install](#other-ways-to-install).

## What it does

- Type anywhere in a note and it saves as you go. `#` makes a heading, `-` a list, `[]` a to-do.
- Every open to-do from every note shows up on Today, next to the flashcard decks with cards due. Tick a to-do there or in the note; it is the same box.
- Write `Term :: Definition` in a note and press Flashcards, and the note becomes a deck. Cloze lines such as `{{c1::Bern}} is the capital of Switzerland` work too. Under Study you can also make a deck by hand.
- Each card comes back right before you would forget it. The scheduler is FSRS-6.
- `Ctrl+K` finds any note, to-do or deck.
- Light and dark themes.

<p align="center">
  <img src="docs/today.png" width="880" alt="Today in Inkling: open to-dos from every note and decks with cards due" />
</p>

<p align="center">
  <img src="docs/study.png" width="880" alt="Study in Inkling: flashcard decks with cards due" />
</p>

## Keyboard

| Keys | What it does |
|---|---|
| `Ctrl+K` | Search |
| `Ctrl+N` | New note |
| `Ctrl+,` | Settings |
| `Space`, then `1` to `4` | In a review: show the answer, then Again, Hard, Good or Easy |

## Other ways to install

- macOS, Intel and Apple Silicon: [Inkling-mac.dmg](https://get-inkling.vercel.app). Open it and drag Inkling into Applications.
- Linux: [Inkling.AppImage](https://get-inkling.vercel.app). Make it executable with `chmod +x Inkling.AppImage`, then run it.
- Every version is on the [releases page](https://github.com/dominikkoenitzer/Inkling/releases).

## Use it with an AI assistant

Inkling has an MCP server built in. Started as `Inkling.exe --mcp`, it lets an AI assistant on your computer look through your notes, write new ones and keep your to-dos and flashcards going.

Add Inkling to your MCP client's list of servers, with the path where Inkling is installed. On Windows:

```json
{
  "mcpServers": {
    "inkling": {
      "command": "C:\\Users\\<you>\\AppData\\Local\\Programs\\Inkling\\Inkling.exe",
      "args": ["--mcp"]
    }
  }
}
```

On macOS the command is `/Applications/Inkling.app/Contents/MacOS/Inkling`, on Linux the full path to your `Inkling.AppImage`. Write the path out in full; most clients do not expand `%LOCALAPPDATA%` or `~`.

What the assistant can do:

- search notes, to-dos and decks, list your notes and read any of them as Markdown
- make a new note, or add to the end of one, in Markdown. Headings, lists, bold, italic, links, code and quotes all come through, and a `- [ ]` line becomes a real to-do on Today
- list your open to-dos, tick them off or open them again
- list your decks with the cards due, and add flashcards, cloze cards too

What it cannot do: delete anything, rewrite or remove what a note already says, review cards or touch your settings. Those stay with you.

Open Inkling once before you connect it, so it can set up your data. After an update, open it once more before the assistant carries on. Inkling can stay open while the assistant works; switch back to it and the changes are there.

Inkling sends nothing over the network here. The assistant app starts Inkling itself and they talk over standard input and output. What the assistant reads becomes part of your conversation with it.

## Your data, updates and removal

Your notes, to-dos and cards live in one SQLite file, `inkling.db`, in `%APPDATA%\Inkling` on Windows, `~/Library/Application Support/Inkling` on macOS and `~/.config/Inkling` on Linux. Each time Inkling starts, a copy goes into `backups` next to it, and the last five are kept. The export button above a note saves it as Markdown.

The installed app goes online for one thing: when it starts, it checks for a new version. On Windows and Linux it downloads the update in the background and installs it when you close Inkling. On macOS, get a new version from the [releases page](https://github.com/dominikkoenitzer/Inkling/releases).

To remove Inkling on Windows, uninstall it under Settings > Apps > Installed apps. Your notes stay. To delete them too, close Inkling and delete these folders:

- `%APPDATA%\Inkling`: your notes and the backups
- `%LOCALAPPDATA%\inkling-updater`: downloaded updates
- `%TEMP%\inkling-mcp`: only there if you used the AI assistant connection

On macOS, move Inkling from Applications to the Trash, then delete `~/Library/Application Support/Inkling` and `~/Library/Caches/inkling-updater`. On Linux, delete the AppImage, `~/.config/Inkling` and `~/.cache/inkling-updater`.

## Build from source

You need [Git](https://git-scm.com), [Bun](https://bun.sh) 1.4.2 (the version CI uses) and [Node.js](https://nodejs.org) 22 or newer. On Windows:

```powershell
winget install --id Git.Git -e
winget install --id Oven-sh.Bun -e --version 1.4.2
winget install --id OpenJS.NodeJS.LTS -e
```

Then, in a new terminal:

```bash
git clone https://github.com/dominikkoenitzer/Inkling.git
cd Inkling
bun install
node node_modules/electron/install.js   # fetches the Electron app if bun skipped it
bun run dev                             # opens Inkling with live reload
```

On Windows, `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1` checks that Git, Bun and Node.js 22 or newer are there, installs the packages, fetches Electron and runs the tests.

Other scripts:

```bash
bun run test        # unit tests
bun run typecheck   # TypeScript
bun run lint        # ESLint
bun run build       # production bundle into out/
bun run smoke       # starts the built app off screen and checks notes, to-dos, search and reviews
bun run mcp         # runs the MCP server from the built app, on stdin and stdout
bun run mcp:smoke   # talks to the built app's MCP server over stdio and checks every tool
bun run dist        # Windows installer into release/
```

## How it is built

Electron with React 19, TypeScript, Tailwind CSS 4 and TipTap for the editor. Data goes through typed repositories over better-sqlite3 with FTS5 search. Spaced repetition is an FSRS-6 scheduler in `src/shared/fsrs.ts`.

```
src/main       main process: database, migrations and backups, IPC, the data repositories, the MCP server
src/preload    the bridge the app talks through (window.inkling, typed in src/shared/api.ts)
src/renderer   the React app: shell, today, notes, study
src/shared     types and the pure logic both sides use: FSRS, cloze, Markdown export
test           Vitest suites
```

For screenshots and the smoke test, development builds read `INKLING_USERDATA` (separate profile), `INKLING_SEED` (demo notes), `INKLING_SCREENSHOT` and `INKLING_EVAL`. Release builds ignore all but the first.

## More

- [CHANGELOG.md](CHANGELOG.md): what changed in each version
- [CONTRIBUTING.md](CONTRIBUTING.md): local setup, code style and the checks a change has to pass
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately

## License

[MIT](LICENSE)

Made by [@dominikkoenitzer](https://github.com/dominikkoenitzer).
