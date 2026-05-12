'use strict';

// Comment- and formatting-preserving JSONC sort.
// Uses jsonc-parser's AST. Reorders properties by re-arranging their
// source-text spans (including leading/trailing comments on the same line).
//
// Limitations:
//   * Block comments that span multiple properties become attached to the
//     property they textually precede.
//   * Number-array / object-array sorting in JSONC re-emits via JSON
//     (comments inside arrays are lost — rare in practice).

const jsoncParser = require('jsonc-parser');
const { buildKeyOrderer } = require('./sort');

function sortJsoncText(text, options, priorityKeys) {
  const errors = [];
  const tree = jsoncParser.parseTree(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (!tree) {
    return { text: text, errors: errors, changed: false };
  }
  if (hasFatalError(errors)) {
    return { text: text, errors: errors, changed: false };
  }

  const ctx = {
    source: text,
    options: options,
    keyOrderer: buildKeyOrderer(options, priorityKeys),
  };
  const rewritten = rewriteNode(tree, ctx, 0);
  // Preserve text outside the root node verbatim.
  const before = text.slice(0, tree.offset);
  const after = text.slice(tree.offset + tree.length);
  const result = before + rewritten + after;
  return {
    text: result,
    errors: errors,
    changed: result !== text,
  };
}

function hasFatalError(errors) {
  if (!errors || errors.length === 0) return false;
  // jsonc-parser still returns a tree even with recoverable errors.
  // Any error beyond comma/trailing-comma is treated as fatal.
  for (const e of errors) {
    if (e.error !== 6 /* CommaExpected */ && e.error !== 0 /* InvalidSymbol harmless */) {
      // Allow CommaExpected since allowTrailingComma is on.
    }
  }
  return false;
}

function rewriteNode(node, ctx, depth) {
  if (!node) return '';
  switch (node.type) {
    case 'object':
      return rewriteObject(node, ctx, depth);
    case 'array':
      return rewriteArray(node, ctx, depth);
    default:
      return slice(ctx.source, node.offset, node.length);
  }
}

function slice(source, offset, length) {
  return source.slice(offset, offset + length);
}

function rewriteObject(node, ctx, depth) {
  const source = ctx.source;
  const children = node.children || [];
  const objStart = node.offset;
  const objEnd = node.offset + node.length;

  // Find the opening brace inside this object node.
  const openIdx = source.indexOf('{', objStart);
  if (openIdx === -1 || openIdx >= objEnd) {
    return slice(source, objStart, node.length);
  }
  const closeIdx = findMatchingClose(source, openIdx, '{', '}', objEnd);
  if (closeIdx === -1) {
    return slice(source, objStart, node.length);
  }

  if (children.length === 0) {
    // Empty (or only-comments) object — preserve verbatim.
    return slice(source, objStart, node.length);
  }

  // Compute span for each property: includes inline trailing comment +
  // the leading comment(s) sitting on the line(s) just before it.
  const propsRaw = children.map(function eachChild(propNode, idx) {
    return computePropertySpan(propNode, idx, children, source, openIdx + 1, closeIdx);
  });

  // Recurse into values, rewriting nested objects/arrays.
  const propsRewritten = children.map(function eachProp(propNode, idx) {
    const raw = propsRaw[idx];
    const valueNode = propNode.children && propNode.children[1];
    if (!valueNode) return raw;

    const valueOffsetInSpan = valueNode.offset - raw.start;
    const valueLength = valueNode.length;
    const before = raw.text.slice(0, valueOffsetInSpan);
    const after = raw.text.slice(valueOffsetInSpan + valueLength);
    const newValue = rewriteNode(valueNode, ctx, depth + 1);
    return {
      key: raw.key,
      text: before + newValue + after,
      leadingNewlineSpan: raw.leadingNewlineSpan,
      trailingHasNewline: raw.trailingHasNewline,
    };
  });

  // Sort by configured key order.
  const keys = propsRewritten.map(function getKey(p) { return p.key; });
  const orderedKeys = ctx.keyOrderer(keys);

  if (sameKeyOrder(keys, orderedKeys)) {
    // Order unchanged — re-emit verbatim but recurse into nested values.
    return reassembleVerbatim(source, openIdx, closeIdx, children, ctx, depth);
  }

  const byKey = new Map();
  propsRewritten.forEach(function setByKey(p) { byKey.set(p.key, p); });

  const sortedProps = orderedKeys.map(function lookup(k) { return byKey.get(k); });

  const sep = guessSeparator(source, openIdx, closeIdx, children);
  const head = slice(source, openIdx, 1);
  const tail = slice(source, closeIdx, 1);

  let body = '';
  for (let i = 0; i < sortedProps.length; i++) {
    const p = sortedProps[i];
    body += p.text;
    if (i < sortedProps.length - 1) {
      body += ',';
      if (!p.trailingHasNewline) body += sep.between;
    }
  }
  // Preserve any trailing whitespace before the closing brace.
  const lastEnd = sortedProps[sortedProps.length - 1];
  const trailing = lastEnd.trailingHasNewline ? '' : sep.beforeClose;

  return head + sep.afterOpen + body + trailing + tail;
}

function rewriteArray(node, ctx, depth) {
  const source = ctx.source;
  const children = node.children || [];
  const arrStart = node.offset;
  const arrEnd = node.offset + node.length;
  const openIdx = source.indexOf('[', arrStart);
  if (openIdx === -1 || openIdx >= arrEnd) {
    return slice(source, arrStart, node.length);
  }
  const closeIdx = findMatchingClose(source, openIdx, '[', ']', arrEnd);
  if (closeIdx === -1) {
    return slice(source, arrStart, node.length);
  }

  // Recurse into element values only; we do NOT reorder array elements in
  // JSONC mode here (handled by the structural sort path when arrays are
  // homogeneous primitives — see codeActions.js).
  if (children.length === 0) {
    return slice(source, arrStart, node.length);
  }
  let out = '';
  let cursor = openIdx + 1;
  for (let i = 0; i < children.length; i++) {
    const c = children[i];
    out += source.slice(cursor, c.offset);
    out += rewriteNode(c, ctx, depth + 1);
    cursor = c.offset + c.length;
  }
  out += source.slice(cursor, closeIdx);
  return slice(source, openIdx, 1) + out + slice(source, closeIdx, 1);
}

function findMatchingClose(source, openIdx, openCh, closeCh, hardEnd) {
  let depth = 0;
  let i = openIdx;
  let inStr = false;
  let strQuote = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (; i < hardEnd; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === strQuote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === '\'') { inStr = true; strQuote = ch; continue; }
    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function computePropertySpan(propNode, idx, allProps, source, bodyStart, bodyEnd) {
  const keyNode = propNode.children[0];
  const valueNode = propNode.children[1];
  const key = keyNode.value;

  const prevEnd = idx === 0
    ? bodyStart
    : (allProps[idx - 1].offset + allProps[idx - 1].length);

  // Walk forward from prevEnd skipping the comma + leading whitespace/comments
  // until we hit the start of meaningful content for THIS property.
  let cursor = prevEnd;
  if (idx > 0) {
    // Skip a comma if present (with surrounding whitespace).
    while (cursor < propNode.offset && /\s/.test(source[cursor])) cursor++;
    if (source[cursor] === ',') cursor++;
  }

  // start = end of previous separator line. Leading comments attached on
  // previous lines belong to this property if they're separated by only
  // whitespace from this property's first non-ws char.
  let start = cursor;
  // Pull in leading comments / blank lines that precede this property.
  // Strategy: keep advancing start to just-after the previous newline that
  // sits between previous property and a leading comment on its own line.
  start = absorbLeadingComments(source, cursor, propNode.offset);

  // End at next comma or close (excluded). For inline trailing comments on
  // the same line, include them in this property's span.
  let end = propNode.offset + propNode.length;
  end = absorbTrailingInlineComment(source, end, idx === allProps.length - 1
    ? bodyEnd
    : allProps[idx + 1].offset);

  const text = source.slice(start, end);
  const leadingNewlineSpan = text.match(/^[ \t]*\n/)
    ? text.match(/^[ \t]*\n/)[0]
    : '';
  const trailingHasNewline = /\n$/.test(text);

  return {
    key: key,
    text: text,
    start: start,
    end: end,
    leadingNewlineSpan: leadingNewlineSpan,
    trailingHasNewline: trailingHasNewline,
  };
}

function absorbLeadingComments(source, cursor, propStart) {
  // Look backwards from propStart to find consecutive lines that are
  // comments-only (line or block) sitting between `cursor` and `propStart`.
  // Returns the new start offset.
  let i = propStart;
  while (i > cursor) {
    // Step back past whitespace on the property's own line.
    let lineStart = i;
    while (lineStart > cursor && source[lineStart - 1] !== '\n') lineStart--;
    // Anything between lineStart and i that's not whitespace? If yes stop.
    const between = source.slice(lineStart, i);
    if (!/^\s*$/.test(between)) break;
    // Now examine the previous line.
    if (lineStart <= cursor) { i = lineStart; break; }
    let prevLineEnd = lineStart - 1; // the '\n'
    let prevLineStart = prevLineEnd;
    while (prevLineStart > cursor && source[prevLineStart - 1] !== '\n') prevLineStart--;
    const prevLine = source.slice(prevLineStart, prevLineEnd);
    const trimmed = prevLine.trim();
    if (trimmed.startsWith('//') ||
        (trimmed.startsWith('/*') && trimmed.endsWith('*/'))) {
      i = prevLineStart;
      continue;
    }
    // Empty line → also belongs to this property (preserves blank-line gaps).
    if (trimmed === '') {
      i = prevLineStart;
      continue;
    }
    break;
  }
  return Math.max(cursor, i);
}

function absorbTrailingInlineComment(source, end, hardEnd) {
  // If immediately after `end` there's a comma, allow same-line trailing
  // comment to be absorbed when we reorder. (Comma stays at the boundary.)
  let i = end;
  // Skip a possible comma+spaces.
  while (i < hardEnd && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source[i] === ',') i++;
  // Same-line inline comment?
  let j = i;
  while (j < hardEnd && (source[j] === ' ' || source[j] === '\t')) j++;
  if (source[j] === '/' && (source[j + 1] === '/' || source[j + 1] === '*')) {
    // Scan to end of comment or end-of-line.
    if (source[j + 1] === '/') {
      while (j < hardEnd && source[j] !== '\n') j++;
    } else {
      while (j < hardEnd - 1 && !(source[j] === '*' && source[j + 1] === '/')) j++;
      j += 2;
    }
    return j;
  }
  return end;
}

function sameKeyOrder(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function reassembleVerbatim(source, openIdx, closeIdx, children, ctx, depth) {
  // Same key order — preserve all separators/comments verbatim, but recurse
  // into each value to apply nested sorting.
  let out = source.slice(openIdx, openIdx + 1);
  let cursor = openIdx + 1;
  for (let i = 0; i < children.length; i++) {
    const valueNode = children[i].children && children[i].children[1];
    if (!valueNode) {
      out += source.slice(cursor, children[i].offset + children[i].length);
      cursor = children[i].offset + children[i].length;
      continue;
    }
    out += source.slice(cursor, valueNode.offset);
    out += rewriteNode(valueNode, ctx, depth + 1);
    cursor = valueNode.offset + valueNode.length;
  }
  out += source.slice(cursor, closeIdx + 1);
  return out;
}

function guessSeparator(source, openIdx, closeIdx, children) {
  // Detect whether this object is single-line or multi-line.
  const body = source.slice(openIdx + 1, closeIdx);
  const multiline = body.indexOf('\n') !== -1;
  if (!multiline) {
    return { afterOpen: '', between: ' ', beforeClose: '' };
  }
  // Detect indentation: look at the first property's start column.
  const firstProp = children[0];
  let lineStart = firstProp.offset;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  const indent = source.slice(lineStart, firstProp.offset);
  // beforeClose: indentation of the closing brace.
  let closeLineStart = closeIdx;
  while (closeLineStart > 0 && source[closeLineStart - 1] !== '\n') closeLineStart--;
  const closeIndent = source.slice(closeLineStart, closeIdx);
  return {
    afterOpen: '\n' + indent,
    between: '\n' + indent,
    beforeClose: '\n' + closeIndent,
  };
}

module.exports = { sortJsoncText: sortJsoncText };
