'use strict';

const { DiagnosticSeverity } = require('vscode-languageserver/node');
const jsoncParser = require('jsonc-parser');
const { detectDialectFromUri, parse, stripBOM } = require('./dialect');
const { buildKeyOrderer } = require('./sort');
const { priorityKeysForUri } = require('./schemaPriority');

function publishDiagnostics(connection, doc, config, logger) {
  if (!config.diagnostics) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }

  const fullText = doc.getText();
  if (fullText.trim().length === 0) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }
  if (config.maxFileSizeBytes && Buffer.byteLength(fullText, 'utf8') > config.maxFileSizeBytes) {
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
    return;
  }

  const dialect = detectDialectFromUri(doc.uri, doc.languageId);
  const stripped = stripBOM(fullText).text;

  const diagnostics = [];

  // Surface parse errors first.
  const parsed = parse(stripped, dialect, { bigIntSafe: config.bigIntSafe });
  if (parsed.errors && parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: e.line, character: e.column },
          end: { line: e.line, character: e.column + (e.length || 1) },
        },
        message: 'JSON parse: ' + e.message,
        source: 'json-sort',
      });
    }
    connection.sendDiagnostics({ uri: doc.uri, diagnostics: diagnostics });
    return;
  }

  // Walk the AST and flag any object whose keys aren't in sorted order.
  const priorityKeys = priorityKeysForUri(doc.uri, config.keyPriority);
  const orderer = buildKeyOrderer(config, priorityKeys);

  const tree = jsoncParser.parseTree(stripped, [], {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (tree) walkForUnsorted(tree, doc, stripped, orderer, diagnostics);

  connection.sendDiagnostics({ uri: doc.uri, diagnostics: diagnostics });
}

function walkForUnsorted(node, doc, source, orderer, diagnostics) {
  if (!node) return;
  if (node.type === 'object' && node.children && node.children.length > 0) {
    const keys = node.children.map(function getK(p) { return p.children[0].value; });
    const expected = orderer(keys);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== expected[i]) {
        const propNode = node.children[i];
        const keyNode = propNode.children[0];
        const start = doc.positionAt(keyNode.offset);
        const end = doc.positionAt(keyNode.offset + keyNode.length);
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: { start: start, end: end },
          message: 'Key "' + keys[i] + '" is not in sorted order (expected "' + expected[i] + '" here)',
          source: 'json-sort',
          code: 'unsorted-key',
        });
        break; // one per object — avoid spam
      }
    }
  }
  if (node.children) {
    for (const c of node.children) walkForUnsorted(c, doc, source, orderer, diagnostics);
  }
}

module.exports = { publishDiagnostics: publishDiagnostics };
