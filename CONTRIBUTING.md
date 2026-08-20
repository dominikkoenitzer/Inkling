# Contributing

Thanks for taking an interest in **Inkling**. This guide covers local setup, the conventions the codebase follows, and how to get a change merged.

## Local setup

Requires [bun](https://bun.sh) and a toolchain that can build native modules — `better-sqlite3` is rebuilt for Electron by the `postinstall` step.

```bash
bun install
bun run dev        # electron-vite dev, with HMR in the renderer
bun run dist       # packaged Windows installer
```

`bun run icons` regenerates the app icons from the source mark; run it only when the mark changes and commit the result.

## Before you open a pull request

Run the same gate that CI runs — all four must pass:

```bash
bun run lint
bun run typecheck
bun run test
bun run build
```

Tests are Vitest over the pure logic — the FSRS scheduler, the quick-add parser, the repositories. Anything scheduling-related needs a test: the spaced-repetition engine is the part of this app a user cannot check by eye.

## Code style

- **Three processes, three tsconfigs.** `src/main` and `src/preload` are Node; `src/renderer` is the browser. `bun run typecheck` checks the web and node projects separately, and code must not drift across the boundary.
- **The preload bridge is the only door.** New capability means a new IPC channel in `src/main/ipc.ts` plus an explicit method on the `window.inkling` API in `src/preload/index.ts`. Never widen the bridge to pass a raw module through, and never turn `contextIsolation` off.
- **Data access goes through `src/main/repos/`,** one module per domain, with parameterised statements. Components do not touch the database.
- **A module exports either components or values, not both.** Fast Refresh is lost for every consumer otherwise — that is why `lib/icons.ts` holds the registry and `components/NotebookGlyph.tsx` holds the component.
- **Windows is case-insensitive.** `QuickAdd.tsx` and `quickadd.tsx` are the same file; pick names that differ by more than case.

## Commits and pull requests

- Keep commits focused, with a short imperative subject.
- Describe what you changed and how you verified it. For UI work, `INKLING_SCREENSHOT=<path>` launches the app, captures the window and quits — useful evidence in a PR.

## Reporting bugs and requesting features

Use the issue forms under **New issue**. For anything security-sensitive, do **not** open a public issue — follow [SECURITY.md](SECURITY.md) instead.
