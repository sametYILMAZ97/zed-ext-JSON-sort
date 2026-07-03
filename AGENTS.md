<!-- BEGIN commit-guide (auto-added) -->
## Commit message convention

Use Conventional Commits: `type(scope): subject` + optional body (plain-language what & why) + optional footer.

- Types: `feat`, `fix`, `refactor`, `style`, `chore`, `docs`, `test`, `perf`, `build`.
- Scope: the area you touched (lowercase, kebab-case), optional.
- Subject: imperative mood, ≤72 chars, describe the outcome (not the file), no trailing period.
- One logical change per commit.
- Add a short body explaining what changed and why when it isn't trivial.
- Reference an issue in a footer when relevant: `Refs: #<id>` / `Closes: #<id>`.

Example:
```
feat(parser): support trailing commas in JSON input

Lenient mode now tolerates trailing commas so pasted configs parse.
```
<!-- END commit-guide -->
