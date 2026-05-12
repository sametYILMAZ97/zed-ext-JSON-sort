'use strict';

const losslessJSON = require('lossless-json');
const JSON5 = require('json5');
const { isLosslessNumber } = require('./dialect');

function indentString(indent) {
  if (indent === 'tab') return '\t';
  if (Number.isInteger(indent) && indent >= 0) return ' '.repeat(indent);
  return '  ';
}

function stringify(value, options) {
  const opts = options || {};
  const dialect = opts.dialect || 'json';
  const minify = !!opts.minify;
  const indent = minify ? 0 : indentString(opts.indent);

  switch (dialect) {
    case 'jsonc':
      return stringifyJson(value, indent, !!opts.bigIntSafe);
    case 'json5':
      return stringifyJson5(value, indent);
    case 'json':
    default:
      return stringifyJson(value, indent, !!opts.bigIntSafe);
  }
}

function stringifyJson(value, indent, bigIntSafe) {
  if (bigIntSafe || containsLosslessNumber(value)) {
    return losslessJSON.stringify(value, null, indent === 0 ? undefined : indent);
  }
  return JSON.stringify(value, null, indent === 0 ? undefined : indent);
}

function stringifyJson5(value, indent) {
  if (containsLosslessNumber(value)) {
    return losslessJSON.stringify(value, null, indent === 0 ? undefined : indent);
  }
  return JSON5.stringify(value, {
    space: indent === 0 ? undefined : indent,
    quote: '"',
  });
}

function containsLosslessNumber(v) {
  if (isLosslessNumber(v)) return true;
  if (v == null) return false;
  if (Array.isArray(v)) {
    for (const item of v) if (containsLosslessNumber(item)) return true;
    return false;
  }
  if (typeof v === 'object') {
    for (const k in v) {
      if (Object.prototype.hasOwnProperty.call(v, k)) {
        if (containsLosslessNumber(v[k])) return true;
      }
    }
  }
  return false;
}

function applyLineEndings(text, eol) {
  if (!eol || eol === '\n') return text.replace(/\r\n/g, '\n');
  if (eol === '\r\n') return text.replace(/\r?\n/g, '\r\n');
  return text;
}

function withBOM(text, hadBOM, preserveBOM) {
  if (hadBOM && preserveBOM) return '﻿' + text;
  return text;
}

function withTrailingNewline(text, trailing) {
  if (!trailing) return text;
  if (text.endsWith(trailing)) return text;
  if (text.endsWith('\n') && trailing === '\r\n') return text.slice(0, -1) + '\r\n';
  return text + trailing;
}

module.exports = {
  indentString: indentString,
  stringify: stringify,
  applyLineEndings: applyLineEndings,
  withBOM: withBOM,
  withTrailingNewline: withTrailingNewline,
  containsLosslessNumber: containsLosslessNumber,
};
