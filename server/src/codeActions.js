'use strict';

const { CodeActionKind } = require('vscode-languageserver/node');
const {
  detectDialectFromUri,
  stripBOM,
  detectLineEndings,
  detectTrailingNewline,
  detectIndent,
} = require('./dialect');
const { sortValue, buildKeyOrderer } = require('./sort');
const { stringify, applyLineEndings, withBOM, withTrailingNewline } = require('./format');
const { sortJsoncText } = require('./jsoncSort');
const { priorityKeysForUri } = require('./schemaPriority');
const { withOverrides } = require('./config');

const MODES = [
  { id: 'sort',                   title: 'Sort JSON',                          overrides: {},                                              kindSuffix: 'default'         },
  { id: 'sortDescending',         title: 'Sort JSON (Descending)',             overrides: { sortOrder: 'desc' },                            kindSuffix: 'descending'      },
  { id: 'sortCaseInsensitive',    title: 'Sort JSON (Case-Insensitive)',       overrides: { caseInsensitive: true },                        kindSuffix: 'caseInsensitive' },
  { id: 'sortNatural',            title: 'Sort JSON (Natural Order)',          overrides: { naturalSort: true },                            kindSuffix: 'natural'         },
  { id: 'sortSchema',             title: 'Sort JSON (Schema-Aware)',           overrides: { schemaAware: true },                            kindSuffix: 'schema'          },
  { id: 'format',                 title: 'Format JSON',                        overrides: { skipSort: true },                               kindSuffix: 'format'          },
  { id: 'minify',                 title: 'Minify JSON',                        overrides: { skipSort: true, minify: true },                 kindSuffix: 'minify'          },
];

function isEmptyRange(range) {
  return range
    && range.start && range.end
    && range.start.line === range.end.line
    && range.start.character === range.end.character;
}

function fullDocumentRange(doc) {
  return {
    start: { line: 0, character: 0 },
    end: doc.positionAt(doc.getText().length),
  };
}

function rangeText(doc, range) {
  return doc.getText(range);
}

function buildCodeActions(doc, requestedRange, baseConfig, kindPrefix, commandPrefix, logger, extra) {
  const opts = extra || {};
  const modeFilter = opts.modeFilter || null;
  const forceResolve = !!opts.forceResolve;

  const range = (requestedRange && !isEmptyRange(requestedRange))
    ? requestedRange
    : fullDocumentRange(doc);
  const isSelection = !isEmptyRange(requestedRange || {});

  const fullText = doc.getText();
  if (baseConfig.maxFileSizeBytes && Buffer.byteLength(fullText, 'utf8') > baseConfig.maxFileSizeBytes) {
    if (logger) logger.warn('file exceeds maxFileSizeBytes — no actions offered');
    return [];
  }
  if (baseConfig.warnFileSizeBytes && Buffer.byteLength(fullText, 'utf8') > baseConfig.warnFileSizeBytes) {
    if (logger) logger.warn('file exceeds warnFileSizeBytes — sort may be slow');
  }

  const modes = MODES.filter(function f(m) {
    if (!modeFilter) return true;
    return m.id === modeFilter;
  });

  const actions = [];
  for (const mode of modes) {
    const action = {
      title: isSelection ? (mode.title + ' (Selection)') : mode.title,
      kind: kindPrefix + '.' + mode.kindSuffix,
      command: {
        title: mode.title,
        command: commandPrefix + mode.id,
        arguments: [doc.uri, requestedRange || null],
      },
      data: {
        modeId: mode.id,
        uri: doc.uri,
        range: range,
        isSelection: isSelection,
      },
    };
    if (forceResolve) {
      resolveActionInto(action, doc, baseConfig, range, isSelection, logger);
    }
    actions.push(action);
  }
  return actions;
}

function resolveAction(action, documents, baseConfig, logger) {
  if (!action || !action.data) return action;
  const doc = documents.get(action.data.uri);
  if (!doc) return action;
  resolveActionInto(action, doc, baseConfig, action.data.range, action.data.isSelection, logger);
  return action;
}

function resolveActionInto(action, doc, baseConfig, range, isSelection, logger) {
  const modeId = action.data && action.data.modeId;
  const mode = MODES.find(function f(m) { return m.id === modeId; });
  if (!mode) return;

  const cfg = withOverrides(baseConfig, mode.overrides);
  const dialect = detectDialectFromUri(doc.uri, doc.languageId);
  const priorityKeys = (cfg.schemaAware !== false)
    ? priorityKeysForUri(doc.uri, cfg.keyPriority)
    : null;
  cfg.keyOrderer = buildKeyOrderer(cfg, priorityKeys);

  let edit;
  try {
    edit = computeEdit(doc, range, isSelection, cfg, dialect, logger);
  } catch (err) {
    if (logger) logger.error('compute edit failed: ' + (err && err.message));
    return;
  }
  if (!edit) return;
  action.edit = {
    documentChanges: [
      {
        textDocument: { uri: doc.uri, version: doc.version },
        edits: [edit],
      },
    ],
  };
}

function computeEdit(doc, range, isSelection, cfg, dialect, logger) {
  const fullText = doc.getText();
  const targetRange = isSelection ? range : fullDocumentRange(doc);
  const targetText = isSelection ? rangeText(doc, targetRange) : fullText;

  if (targetText.trim().length === 0) return null;

  // Preserve file-level metadata when sorting the whole file.
  const wholeMeta = {
    bom: false,
    eol: '\n',
    trailing: '',
    detectedIndent: null,
  };
  if (!isSelection) {
    const stripped = stripBOM(targetText);
    wholeMeta.bom = stripped.hadBOM;
    wholeMeta.eol = detectLineEndings(stripped.text);
    wholeMeta.trailing = detectTrailingNewline(stripped.text);
    wholeMeta.detectedIndent = detectIndent(stripped.text);
  }

  const effectiveIndent = (cfg.preserveIndent && wholeMeta.detectedIndent != null)
    ? wholeMeta.detectedIndent
    : cfg.indent;

  const workingText = isSelection ? targetText : stripBOM(targetText).text;

  let newBody;
  if (dialect === 'jsonc' && !cfg.minify && !cfg.skipSort) {
    const result = sortJsoncText(workingText, cfg, ((cfg.schemaAware !== false) ? priorityKeysForUri(doc.uri, cfg.keyPriority) : null));
    if (!result || result.errors && hasFatalJsoncErrors(result.errors)) return null;
    newBody = result.text;
    if (!result.changed && (cfg.preserveIndent || effectiveIndent === wholeMeta.detectedIndent)) {
      // Nothing to do.
      return null;
    }
  } else {
    newBody = computeStructuralSort(workingText, cfg, dialect, effectiveIndent, logger);
    if (newBody == null) return null;
  }

  if (!isSelection) {
    if (cfg.preserveLineEndings) newBody = applyLineEndings(newBody, wholeMeta.eol);
    if (cfg.preserveTrailingNewline) newBody = withTrailingNewline(newBody, wholeMeta.trailing);
    if (cfg.preserveBOM) newBody = withBOM(newBody, wholeMeta.bom, true);
  }

  if (newBody === targetText) return null;

  return {
    range: targetRange,
    newText: newBody,
  };
}

function computeStructuralSort(text, cfg, dialect, effectiveIndent, logger) {
  const { parse } = require('./dialect');
  const parseRes = parse(text, dialect, { bigIntSafe: cfg.bigIntSafe });
  if (parseRes.errors && parseRes.errors.length > 0) {
    if (logger) logger.debug('parse errors: ' + parseRes.errors.length);
    return null;
  }
  const value = parseRes.value;
  const sorted = cfg.skipSort ? value : sortValue(value, cfg);
  return stringify(sorted, {
    dialect: dialect,
    indent: effectiveIndent,
    minify: !!cfg.minify,
    bigIntSafe: !!cfg.bigIntSafe,
  });
}

function hasFatalJsoncErrors(errors) {
  if (!errors || errors.length === 0) return false;
  // jsonc-parser sometimes reports recoverable issues; for v1 treat any
  // error as fatal except absent CommaExpected we explicitly allow.
  for (const e of errors) {
    if (e.error !== 6) return true;
  }
  return false;
}

module.exports = {
  buildCodeActions: buildCodeActions,
  resolveAction: resolveAction,
  MODES: MODES,
};
