use std::{env, fs};
use zed_extension_api::{self as zed, LanguageServerId, Result};

/// The bundled Node.js LSP server. Built from `server/` via
/// `npm --prefix server run build`, which esbuild-packs the server plus all
/// of its dependencies into one self-contained CommonJS file. Embedded into
/// the WASM at compile time so the extension is fully self-contained — no
/// runtime npm install, no GitHub download.
const SERVER_BUNDLE: &str = include_str!("../dist/server.bundle.js");

/// Filename of the materialized bundle inside the extension's working dir.
const SERVER_SCRIPT_NAME: &str = "server.bundle.js";

struct JsonSortExtension;

impl JsonSortExtension {
    /// Writes the embedded bundle to the extension's working directory and
    /// returns its absolute host path. The write is idempotent — if the
    /// existing file already matches the embedded content, we skip rewriting
    /// to avoid unnecessary IO on every server restart.
    fn ensure_server_script(&self) -> Result<String> {
        let cwd = env::current_dir()
            .map_err(|e| format!("failed to read extension working dir: {e}"))?;
        let dest = cwd.join(SERVER_SCRIPT_NAME);

        let needs_write = match fs::read_to_string(&dest) {
            Ok(existing) => existing != SERVER_BUNDLE,
            Err(_) => true,
        };

        if needs_write {
            fs::write(&dest, SERVER_BUNDLE)
                .map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
        }

        Ok(dest.to_string_lossy().into_owned())
    }
}

impl zed::Extension for JsonSortExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _server_id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.ensure_server_script()?;
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![server_path, "--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(JsonSortExtension);
