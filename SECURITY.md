# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue for anything security-sensitive.

- Preferred: open a [private security advisory](https://github.com/dominikkoenitzer/Inkling/security/advisories/new) on this repository.
- Alternatively: email **dominik.koenitzer@gmail.com** with the details.

Please include:

- a description of the issue and its impact,
- steps to reproduce and, where relevant, a minimal note or notebook that triggers it, and
- your OS version, the Inkling version, and any logs or proof of concept.

## What to expect

- An acknowledgement of your report, typically within a few days.
- An assessment and, where applicable, a fix in the next release.
- Credit for the report if you would like it, once the issue is resolved.

## Scope

Inkling is a **local-first desktop app**. Notes, tasks, flashcards and grades live in a SQLite file in the user's own app-data directory; the main process makes no network requests, and there is no account and no sync. The threat model is therefore about the desktop boundary, not a server.

Reports most relevant to this project:

- **Anything that escapes the renderer.** The renderer runs with `contextIsolation: true` and `nodeIntegration: false`, and reaches the main process only through the narrow `window.inkling` bridge in `src/preload/index.ts`. A path that reaches Node, the filesystem, or `shell` outside that bridge is the highest-severity bug here.
- **IPC that trusts its input.** Every channel in `src/main/ipc.ts` is callable by the renderer with arbitrary arguments; a handler that writes outside the app's data directory, or that takes a path from the caller without validating it, is in scope.
- **Navigation and window opening.** Links leave through `setWindowOpenHandler`, and a full navigation away from the renderer is blocked and handed to the browser. A way around either is in scope.
- **SQL injection** into the SQLite layer (`src/main/db.ts`, `src/main/repos/`).
- **Anything that gets note content off the machine** — an unexpected request, a leak into a log or a temporary file.
- **Dependency and Electron vulnerabilities** with a plausible path to the above.

Out of scope: reports that require an attacker to already have access to the user's account on the machine, since the database is readable by that user by design.
