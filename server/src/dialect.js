'use strict';

const path = require('path');
const losslessJSON = require('lossless-json');
const JSON5 = require('json5');
const jsoncParser = require('jsonc-parser');

const BOM = '﻿';

const JSONC_EXTS = new Set(['.jsonc']);
const JSON5_EXTS = new Set(['.json5']);
const JSONC_BASENAMES = new Set([
  'tsconfig.json',
  'jsconfig.json',
  'devcontainer.json',
  '.eslintrc.json',
  '.babelrc',
  '.babelrc.json',
  '.swcrc',
]);

function detectDialectFromUri(uri, languageId) {
  if (!uri) {
    if (languageId === 'jsonc') return 'jsonc';
    if (languageId === 'json5') return 'json5';
    return 'json';
  }
  const filename = path.basename(uriToPath(uri));
  const ext = path.extname(filename).toLowerCase();
  if (JSONC_EXTS.has(ext)) return 'jsonc';
  if (JSON5_EXTS.has(ext)) return 'json5';
  if (JSONC_BASENAMES.has(filename) || filename.startsWith('tsconfig.')) return 'jsonc';
  if (languageId === 'jsonc') return 'jsonc';
  if (languageId === 'json5') return 'json5';
  return 'json';
}

function uriToPath(uri) {
  try {
    const u = new URL(uri);
    return decodeURIComponent(u.pathname);
  } catch (_e) {
    return uri;
  }
}

function stripBOM(text) {
  if (text.charCodeAt(0) === 0xFEFF) {
    return { text: text.slice(1), hadBOM: true };
  }
  return { text, hadBOM: false };
}

function detectLineEndings(text) {
  return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
}

function detectTrailingNewline(text) {
  if (text.length === 0) return '';
  if (text.endsWith('\r\n')) return '\r\n';
  if (text.endsWith('\n')) return '\n';
  return '';
}

function detectIndent(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0) continue;
    const m = line.match(/^([ \t]+)\S/);
    if (m) {
      if (m[1].includes('\t')) return 'tab';
      return Math.max(1, Math.min(16, m[1].length));
    }
  }
  return null;
}

function parse(text, dialect, opts) {
  const o = opts || {};
  const bigIntSafe = o.bigIntSafe !== false;
  switch (dialect) {
    case 'jsonc':
      return parseJsonc(text);
    case 'json5':
      return parseJson5(text);
    case 'json':
    default:
      return parseJson(text, bigIntSafe);
  }
}

function parseJson(text, bigIntSafe) {
  if (bigIntSafe) {
    try {
      const value = losslessJSON.parse(text);
      return { value, errors: [], dialect: 'json', bigIntSafe: true };
    } catch (e) {
      return { value: undefined, errors: [parserErrorFromException(e, text)], dialect: 'json' };
    }
  }
  try {
    const value = JSON.parse(text);
    return { value, errors: [], dialect: 'json', bigIntSafe: false };
  } catch (e) {
    return { value: undefined, errors: [parserErrorFromException(e, text)], dialect: 'json' };
  }
}

function parseJsonc(text) {
  const errors = [];
  const options = {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: true,
  };
  const value = jsoncParser.parse(text, errors, options);
  const mapped = errors.map(function mapErr(e) { return mapJsoncError(e, text); });
  return { value, errors: mapped, dialect: 'jsonc', bigIntSafe: false };
}

function parseJson5(text) {
  try {
    const value = JSON5.parse(text);
    return { value, errors: [], dialect: 'json5', bigIntSafe: false };
  } catch (e) {
    return { value: undefined, errors: [parserErrorFromException(e, text)], dialect: 'json5' };
  }
}

function parserErrorFromException(err, text) {
  let line = 0;
  let col = 0;
  let offset = 0;
  const msg = (err && err.message) || 'parse error';
  if (err && Number.isInteger(err.lineNumber)) line = Math.max(0, err.lineNumber - 1);
  if (err && Number.isInteger(err.columnNumber)) col = Math.max(0, err.columnNumber - 1);

  const m = /position\s+(\d+)/i.exec(msg);
  if (m) {
    offset = parseInt(m[1], 10);
    const before = text.slice(0, offset);
    const lines = before.split(/\r?\n/);
    line = lines.length - 1;
    col = lines[lines.length - 1].length;
  }
  return { message: msg, line: line, column: col, offset: offset, severity: 'error' };
}

function mapJsoncError(err, text) {
  const offset = err.offset || 0;
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  const line = lines.length - 1;
  const column = lines[lines.length - 1].length;
  return {
    message: jsoncErrorMessage(err.error),
    line: line,
    column: column,
    offset: offset,
    length: err.length || 1,
    severity: 'error',
  };
}

function jsoncErrorMessage(code) {
  switch (code) {
    case 1: return 'Invalid symbol';
    case 2: return 'Invalid number format';
    case 3: return 'Property name expected';
    case 4: return 'Value expected';
    case 5: return 'Colon expected';
    case 6: return 'Comma expected';
    case 7: return 'Closing brace expected';
    case 8: return 'Closing bracket expected';
    case 9: return 'End of file expected';
    case 10: return 'Invalid comment token';
    case 11: return 'Unexpected end of comment';
    case 12: return 'Unexpected end of string';
    case 13: return 'Unexpected end of number';
    case 14: return 'Invalid unicode';
    case 15: return 'Invalid escape character';
    case 16: return 'Invalid character';
    default: return 'Parse error';
  }
}

function isLosslessNumber(v) {
  return v != null && typeof v === 'object' &&
    typeof v.isLosslessNumber === 'boolean' && v.isLosslessNumber;
}

module.exports = {
  BOM: BOM,
  detectDialectFromUri: detectDialectFromUri,
  uriToPath: uriToPath,
  stripBOM: stripBOM,
  detectLineEndings: detectLineEndings,
  detectTrailingNewline: detectTrailingNewline,
  detectIndent: detectIndent,
  parse: parse,
  isLosslessNumber: isLosslessNumber,
};
