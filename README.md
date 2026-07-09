# JSON Sort — Zed Extension

VS Code-like **Sort JSON** for [Zed](https://zed.dev). Sort keys recursively, sort homogeneous string arrays, format / minify, all from the command palette.

Supports **JSON**, **JSONC** (comments + trailing commas preserved on sort), and **JSON5**.

## How to use

1. Open any `.json`, `.jsonc`, or `.json5` file in Zed.
2. (Optional) Select a fragment to sort just that region. Skip to use whole file.
3. Trigger the code actions menu:
   - **Keyboard:** `Cmd+.` (macOS) / `Ctrl+.` (Linux) — runs `editor::ToggleCodeActions`.
   - **Mouse:** right-click in the editor → **Code Actions**.
4. Pick the action you want from the menu:
   - **Sort JSON** — keys alphabetically, recursive, string arrays sorted.
   - **Sort JSON (Descending)** — Z→A.
   - **Sort JSON (Case-Insensitive)** — `"Apple"` and `"apple"` collate together.
   - **Sort JSON (Natural Order)** — `item2` before `item10`.
   - **Sort JSON (Schema-Aware)** — `package.json` / `tsconfig.json` / `jsconfig.json` / `composer.json` get their conventional key order; everything else gets alphabetic.
   - **Format JSON** — pretty-print, no reordering.
   - **Minify JSON** — strip all whitespace.
5. The edit applies in place. `Cmd+Z` undoes it.

When you have a selection active, every action's title gains `(Selection)` and operates on just the selected range.

> **Heads up:** in Zed, LSP-provided actions live in the code actions menu — not in the command palette (`Cmd+Shift+P`). The command palette only shows Zed's built-in actions.

### Rebind to a dedicated shortcut (optional)

Sorting JSON is a two-step action by default (`Cmd+.` → pick). To bind it to a single keypress, edit `~/.config/zed/keymap.json`:

```json
[
  {
    "context": "Editor && (extension == json || extension == jsonc || extension == json5)",
    "bindings": {
      "cmd-shift-o": ["editor::ToggleCodeActions", { "deployed_from_indicator": null }]
    }
  }
]
```

Zed doesn't yet expose a way to bind directly to a specific LSP code action — the menu still pops up — but you can scope the shortcut to JSON files so it's a one-key opener.

## Features

Each appears in the command palette / code actions menu on JSON-family files:

| Action | Behavior |
|--------|----------|
| **Sort JSON** | Keys alphabetically, recursive. String arrays sorted. Default config wins. |
| **Sort JSON (Descending)** | Z→A. |
| **Sort JSON (Case-Insensitive)** | `"Apple" == "apple"` for ordering. |
| **Sort JSON (Natural Order)** | `item2` before `item10`. |
| **Sort JSON (Schema-Aware)** | Known conventions for `package.json`, `tsconfig.json`, `jsconfig.json`, `composer.json` — pinned keys first, rest alphabetic. |
| **Format JSON** | Pretty-print, no sort. |
| **Minify JSON** | One-line, no whitespace. |

Each action also applies to a **selection** if you have one — selecting an inner object and running "Sort JSON" sorts just that fragment.

## Why a separate extension?

Zed ships `vscode-json-language-server` for schema validation and completion, but no "Sort JSON" command. This extension runs as a *second* LSP server alongside the built-in one, dedicated to sort / format actions. They coexist without conflict.

## Architecture

```
extension.toml        Zed manifest
Cargo.toml + src/     Rust WASM shim (~25 lines) — tells Zed how to spawn the Node LSP server
server/               Node.js LSP server (sort logic)
  src/server.js         Connection setup, code-action / execute-command handlers
  src/codeActions.js    Orchestrator — picks dialect, runs sort, builds workspace edit
  src/sort.js           Sort algorithms (asc / desc / case / natural / arrays)
  src/jsoncSort.js      Comment-preserving JSONC sort (AST-based source-text rewrite)
  src/dialect.js        Detects JSON / JSONC / JSON5, BOM, CRLF, indent
  src/format.js         Stringify, minify, indent, BOM/CRLF/trailing-newline preservation
  src/schemaPriority.js Known-convention key orders for well-known filenames
  src/config.js         Resolves user initializationOptions
  src/diagnostics.js    Optional "key not in sorted order" warnings
  src/logger.js         Connection-aware logger
languages/json/       Language association (binds the LSP to JSON files)
```

## Configuration

All options live under `lsp.json-sort-server.initialization_options` in your Zed `settings.json`. Defaults shown:

```jsonc
{
  "lsp": {
    "json-sort-server": {
      "initialization_options": {
        "indent": 2,                    // 2 | 4 | "tab"
        "preserveIndent": false,        // detect indent from source instead
        "sortOrder": "asc",             // "asc" | "desc"
        "caseInsensitive": false,
        "naturalSort": false,
        "sortArrays": true,             // sort homogeneous string arrays
        "sortNumberArrays": false,
        "sortObjectArraysBy": null,     // e.g. "id"
        "recursive": true,
        "preserveBOM": true,
        "preserveTrailingNewline": true,
        "preserveLineEndings": true,
        "bigIntSafe": true,             // numbers > 2^53 stay lossless
        "diagnostics": false,           // hint when keys aren't sorted
        "maxFileSizeBytes": 104857600,  // 100 MB hard cap
        "warnFileSizeBytes": 10485760,  // 10 MB warning
        "logLevel": "warn",             // "off"|"error"|"warn"|"info"|"debug"
        "keyPriority": {
          "package.json": ["name", "version", "description", "..."],
          "tsconfig.json": ["extends", "compilerOptions", "include", "exclude"]
        }
      }
    }
  }
}
```

Override `keyPriority` to add your own pinned-first orderings for specific filenames.

## Edge cases handled

- **Parse errors** — code action silently absent (no popup). With `diagnostics: true`, emits LSP diagnostic at error line/col.
- **Empty files / whitespace** — no action.
- **BOM** — stripped on read, restored on write when `preserveBOM`.
- **CRLF** — preserved when `preserveLineEndings`.
- **Trailing newline** — preserved.
- **Numbers > `Number.MAX_SAFE_INTEGER`** — `lossless-json` keeps them lossless.
- **Comments in JSONC** — preserved (AST-based source rewrite).
- **Trailing commas in JSONC** — preserved.
- **JSON5 unquoted keys / single quotes** — preserved on re-emit.
- **Mixed-type arrays** — order kept, contents recursed.
- **Concurrent edits** — LSP version check rejects stale edits.
- **Read-only files** — Zed handles write rejection; we still offer the action.
- **Untitled buffers** — supported via in-memory LSP document state.
- **Files > 100 MB** — refused (configurable via `maxFileSizeBytes`).

## Development

### Build the WASM shim

You need the Rust toolchain (`rustup`) with the `wasm32-wasip1` target:

```sh
rustup target add wasm32-wasip1
cargo build --release --target wasm32-wasip1
```

Zed builds the WASM automatically when installing as a dev extension; the manual command above is for verification only.

### Rebuild the bundled server

Whenever you change anything under `server/`, regenerate the embedded bundle:

```sh
cd server
npm install
npm run build         # → ../dist/server.bundle.js (embedded into the WASM)
```

The Rust crate `include_str!`s `dist/server.bundle.js` at compile time, so the bundle must exist before `cargo build` runs.

### Run server tests

```sh
cd server
node --test 'test/**/*.test.js'
```

### Install as dev extension in Zed

1. `Zed → Extensions → Install Dev Extension…`
2. Pick this directory.
3. Open any JSON file → command palette → type "Sort JSON".

## Known limitations (v0.1)

- JSONC comment ↔ property/element attribution is heuristic. Block comments that span multiple properties or array elements attach to the one they textually precede.
- JSON5 sort re-emits via `json5` library — fancy formatting (e.g. multi-line strings) is normalized.
- Single-line JSONC objects/arrays that use padding spaces right after `{`/`[` or before `}`/`]` (e.g. `{ "a": 1 }`) may lose that padding once reordered — cosmetic only, output stays valid JSONC.

## Roadmap (deferred)

- Multi-file workspace sort with progress reporting
- CLI mode for CI
- Diff preview before apply
- YAML / TOML sort
- Inline directive comments (`// json-sort: skip`)

## License

MIT
