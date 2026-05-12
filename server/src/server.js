'use strict';

const {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  CodeActionKind,
} = require('vscode-languageserver/node');
const { TextDocument } = require('vscode-languageserver-textdocument');

const { resolveConfig, DEFAULT_CONFIG } = require('./config');
const { buildCodeActions, resolveAction } = require('./codeActions');
const { publishDiagnostics } = require('./diagnostics');
const { Logger } = require('./logger');

// We use `refactor.rewrite.*` rather than `source.*` so the actions appear
// in Zed's normal code-actions menu (cmd+.) rather than being filtered out
// as save-time-only source actions.
const ACTION_KIND_PREFIX = `${CodeActionKind.RefactorRewrite}.sortJson`;
const COMMAND_PREFIX = 'jsonSort.';

function start() {
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);
  const logger = new Logger(connection, 'warn');

  let config = DEFAULT_CONFIG;

  connection.onInitialize((params) => {
    config = resolveConfig(params.initializationOptions, logger);
    logger.setLevel(config.logLevel);
    logger.info(`json-sort-server initialized (logLevel=${config.logLevel})`);

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        codeActionProvider: {
          codeActionKinds: [
            ACTION_KIND_PREFIX,
            `${ACTION_KIND_PREFIX}.default`,
            `${ACTION_KIND_PREFIX}.descending`,
            `${ACTION_KIND_PREFIX}.caseInsensitive`,
            `${ACTION_KIND_PREFIX}.natural`,
            `${ACTION_KIND_PREFIX}.schema`,
            `${ACTION_KIND_PREFIX}.format`,
            `${ACTION_KIND_PREFIX}.minify`,
            `${ACTION_KIND_PREFIX}.selection`,
          ],
          resolveProvider: true,
        },
        executeCommandProvider: {
          commands: [
            `${COMMAND_PREFIX}sort`,
            `${COMMAND_PREFIX}sortDescending`,
            `${COMMAND_PREFIX}sortCaseInsensitive`,
            `${COMMAND_PREFIX}sortNatural`,
            `${COMMAND_PREFIX}sortSchema`,
            `${COMMAND_PREFIX}format`,
            `${COMMAND_PREFIX}minify`,
          ],
        },
      },
      serverInfo: { name: 'json-sort-server', version: '0.1.0' },
    };
  });

  connection.onDidChangeConfiguration((params) => {
    if (params && params.settings) {
      config = resolveConfig(params.settings.jsonSort || params.settings, logger);
      logger.setLevel(config.logLevel);
      logger.info('config reloaded');
      if (config.diagnostics) {
        for (const doc of documents.all()) publishDiagnostics(connection, doc, config, logger);
      } else {
        for (const doc of documents.all()) {
          connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
        }
      }
    }
  });

  documents.onDidChangeContent((change) => {
    if (config.diagnostics) {
      publishDiagnostics(connection, change.document, config, logger);
    }
  });

  documents.onDidClose((event) => {
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
  });

  connection.onCodeAction((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    try {
      return buildCodeActions(doc, params.range, config, ACTION_KIND_PREFIX, COMMAND_PREFIX, logger);
    } catch (err) {
      logger.error(`onCodeAction failed: ${err && err.message}`);
      return [];
    }
  });

  connection.onCodeActionResolve((action) => {
    try {
      return resolveAction(action, documents, config, logger) || action;
    } catch (err) {
      logger.error(`onCodeActionResolve failed: ${err && err.message}`);
      return action;
    }
  });

  connection.onExecuteCommand(async (params) => {
    const [uri, range] = params.arguments || [];
    if (!uri) return null;
    const doc = documents.get(uri);
    if (!doc) return null;

    const mode = params.command.replace(COMMAND_PREFIX, '');
    const actions = buildCodeActions(doc, range, config, ACTION_KIND_PREFIX, COMMAND_PREFIX, logger, {
      modeFilter: mode,
      forceResolve: true,
    });
    if (actions.length === 0) return null;
    const edit = actions[0].edit;
    if (edit) {
      await connection.workspace.applyEdit({ label: actions[0].title, edit });
    }
    return null;
  });

  connection.onShutdown(() => {
    logger.info('shutdown requested');
  });

  documents.listen(connection);
  connection.listen();
}

module.exports = { start };
