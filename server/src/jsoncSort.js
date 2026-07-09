'use strict';

// Comment- and formatting-preserving JSONC sort.
// Uses jsonc-parser's AST. Reorders properties and (when configured) array
// elements by re-arranging their source-text spans, including leading/
// trailing comments on the same line — same convention for both.
//
// Limitations:
//   * Block comments that span multiple properties/elements become attached
//     to the property/element they textually precede.

const jsoncParser = require('jsonc-parser');
const { buildKeyOrderer, buildComparator } = require('./sort');

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
  // Allow CommaExpected (6) since allowTrailingComma is on; anything else
  // means the tree is unreliable and should not be rewritten.
  for (const e of errors) {
    if (e.error !== 6 /* CommaExpected */) return true;
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
  const propsRaw = computePropertySpans(children, source, openIdx + 1, closeIdx);

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
      trailingSpacing: raw.trailingSpacing,
      trailingComment: raw.trailingComment,
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
    body += stripLeadingSeparator(p.text, sep);
    const isLast = i === sortedProps.length - 1;
    body = appendCommaAndComment(body, p, isLast);
    if (!isLast && !p.trailingHasNewline) body += sep.between;
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
  if (children.length === 0) {
    return slice(source, arrStart, node.length);
  }

  const sortOrder = computeArraySortOrder(children, ctx.options);
  if (!sortOrder || isIdentityOrder(sortOrder)) {
    // Not eligible for reordering, or already in sorted order — just
    // recurse into each element in place, preserving everything else
    // (whitespace, comments, trailing commas) verbatim.
    return rewriteArrayElementsInPlace(source, openIdx, closeIdx, children, ctx, depth);
  }

  // Reordering: compute a span per element (comma + leading comments +
  // same-line trailing comment) so all of that travels with the element,
  // the same convention rewriteObject uses for properties.
  const elemSpans = computeItemSpans(children, source, openIdx + 1, closeIdx);
  const rewrittenElems = children.map(function eachElem(elNode, idx) {
    const raw = elemSpans[idx];
    const valueOffsetInSpan = elNode.offset - raw.start;
    const before = raw.text.slice(0, valueOffsetInSpan);
    const after = raw.text.slice(valueOffsetInSpan + elNode.length);
    const newValue = rewriteNode(elNode, ctx, depth + 1);
    return {
      text: before + newValue + after,
      trailingSpacing: raw.trailingSpacing,
      trailingComment: raw.trailingComment,
      trailingHasNewline: raw.trailingHasNewline,
    };
  });

  const sep = guessSeparator(source, openIdx, closeIdx, children);
  const head = slice(source, openIdx, 1);
  const tail = slice(source, closeIdx, 1);

  let body = '';
  for (let i = 0; i < sortOrder.length; i++) {
    const el = rewrittenElems[sortOrder[i]];
    body += stripLeadingSeparator(el.text, sep);
    const isLast = i === sortOrder.length - 1;
    body = appendCommaAndComment(body, el, isLast);
    if (!isLast && !el.trailingHasNewline) body += sep.between;
  }
  const lastEl = rewrittenElems[sortOrder[sortOrder.length - 1]];
  const trailing = lastEl.trailingHasNewline ? '' : sep.beforeClose;

  return head + sep.afterOpen + body + trailing + tail;
}

function rewriteArrayElementsInPlace(source, openIdx, closeIdx, children, ctx, depth) {
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

// Mirrors sort.js's sortArray eligibility rules (same precedence: string
// arrays, then number arrays, then object arrays by key), but works off
// jsonc-parser AST node types/values instead of parsed JS values so
// comments can stay attached to their element during reordering.
function computeArraySortOrder(children, options) {
  if (options.sortArrays && children.every(isStringNode)) {
    const cmp = buildComparator(options);
    return stableSortIndices(children, function strCmp(a, b) {
      return cmp(a.value, b.value);
    });
  }
  if (options.sortNumberArrays && children.every(isNumberNode)) {
    const order = options.sortOrder === 'desc' ? -1 : 1;
    return stableSortIndices(children, function numCmp(a, b) {
      return order * (a.value - b.value);
    });
  }
  if (options.sortObjectArraysBy && children.every(isObjectNode)) {
    const key = options.sortObjectArraysBy;
    const cmp = buildComparator(options);
    const order = options.sortOrder === 'desc' ? -1 : 1;
    return stableSortIndices(children, function objCmp(a, b) {
      const av = objectPropertyLeaf(a, key);
      const bv = objectPropertyLeaf(b, key);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return cmp(av, bv);
      if (typeof av === 'number' && typeof bv === 'number') return order * (av - bv);
      return cmp(String(av), String(bv));
    });
  }
  return null;
}

function isStringNode(n) { return n.type === 'string'; }
function isNumberNode(n) { return n.type === 'number'; }
function isObjectNode(n) { return n.type === 'object'; }

function objectPropertyLeaf(objNode, key) {
  const props = objNode.children || [];
  for (const prop of props) {
    const keyNode = prop.children && prop.children[0];
    const valueNode = prop.children && prop.children[1];
    if (keyNode && keyNode.value === key && valueNode) {
      return (valueNode.type === 'string' || valueNode.type === 'number')
        ? valueNode.value
        : undefined;
    }
  }
  return undefined;
}

function stableSortIndices(children, nodeCmp) {
  const indices = children.map(function eachIdx(_, i) { return i; });
  indices.sort(function stableCmp(a, b) {
    const r = nodeCmp(children[a], children[b]);
    return r !== 0 ? r : a - b;
  });
  return indices;
}

function isIdentityOrder(order) {
  for (let i = 0; i < order.length; i++) {
    if (order[i] !== i) return false;
  }
  return true;
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

// Computes the source-text span each item (object property or array
// element) occupies once its leading comments/blank lines are absorbed into
// it. The trailing comma and any same-line trailing comment are tracked
// SEPARATELY (not folded into `text`) so reassembly stays the single place
// that ever emits a comma — an item's own span never embeds one, so
// reordering can't produce a doubled-up comma.
//
// Spans are threaded sequentially (each item's search boundary is the
// PREVIOUS item's actual consumed end — through its trailing comment, if
// any — not its raw AST node end) so a same-line trailing comment claimed
// by item N can never also be re-claimed as a leading comment by item N+1.
function computeItemSpans(items, source, bodyStart, bodyEnd) {
  const spans = [];
  let prevEnd = bodyStart;
  for (let idx = 0; idx < items.length; idx++) {
    const itemNode = items[idx];

    // Walk forward from prevEnd skipping same-line whitespace + a comma
    // until we hit the start of meaningful content for THIS item. Only
    // same-line whitespace (not newlines) is skipped here — if the
    // previous item's span already consumed through a trailing comment,
    // prevEnd sits at that comment's line end and there's no comma left to
    // find; crossing the newline would eat into this item's own leading
    // indentation/comments instead of leaving that to absorbLeadingComments.
    let cursor = prevEnd;
    if (idx > 0) {
      while (cursor < itemNode.offset && (source[cursor] === ' ' || source[cursor] === '\t')) cursor++;
      if (source[cursor] === ',') cursor++;
    }

    // Pull in leading comments / blank lines that precede this item.
    const start = absorbLeadingComments(source, cursor, itemNode.offset);

    // The item's own text: leading comments through the value's own end —
    // deliberately excludes the trailing comma and trailing comment.
    const valueEnd = itemNode.offset + itemNode.length;
    const text = source.slice(start, valueEnd);

    const hardEnd = idx === items.length - 1 ? bodyEnd : items[idx + 1].offset;
    const trailing = scanTrailingComment(source, valueEnd, hardEnd);
    const trailingHasNewline = /\n$/.test(source.slice(start, trailing.end));

    spans.push({
      text: text,
      start: start,
      trailingSpacing: trailing.spacing,
      trailingComment: trailing.comment,
      trailingHasNewline: trailingHasNewline,
    });
    prevEnd = trailing.end;
  }
  return spans;
}

// From right after a value, skips an optional comma + whitespace and
// captures a same-line trailing comment if present (with the exact
// whitespace that separated it from the comma, for fidelity). Returns the
// comment text (empty if none) and the absolute offset actually consumed,
// for threading `prevEnd` forward — the comma itself is never included.
function scanTrailingComment(source, valueEnd, hardEnd) {
  let i = valueEnd;
  while (i < hardEnd && (source[i] === ' ' || source[i] === '\t')) i++;
  if (source[i] === ',') i++;
  const wsStart = i;
  let j = i;
  while (j < hardEnd && (source[j] === ' ' || source[j] === '\t')) j++;
  if (source[j] === '/' && (source[j + 1] === '/' || source[j + 1] === '*')) {
    let k = j;
    if (source[j + 1] === '/') {
      while (k < hardEnd && source[k] !== '\n') k++;
    } else {
      while (k < hardEnd - 1 && !(source[k] === '*' && source[k + 1] === '/')) k++;
      k += 2;
    }
    return { spacing: source.slice(wsStart, j), comment: source.slice(j, k), end: k };
  }
  return { spacing: '', comment: '', end: valueEnd };
}

function computePropertySpans(props, source, bodyStart, bodyEnd) {
  const spans = computeItemSpans(props, source, bodyStart, bodyEnd);
  return spans.map(function addKey(span, idx) {
    const keyNode = props[idx].children[0];
    return {
      key: keyNode.value,
      text: span.text,
      start: span.start,
      trailingSpacing: span.trailingSpacing,
      trailingComment: span.trailingComment,
      trailingHasNewline: span.trailingHasNewline,
    };
  });
}

// Appends exactly one comma (unless this is the last item in the new
// order) plus any trailing comment, using the item's own recorded spacing.
function appendCommaAndComment(body, item, isLast) {
  if (!isLast) body += ',';
  if (item.trailingComment) body += item.trailingSpacing + item.trailingComment;
  return body;
}

// An item's own span may carry a leading separator gap absorbed from the
// original text — a newline (multi-line format) or a plain space (single-
// line format) that sat between the previous comma and this item. `sep`
// (afterOpen/between) already supplies an equivalent gap during reassembly,
// so strip exactly the one that's redundant: in multi-line format only the
// leading newline itself (indentation/comment lines after it are real
// content and must stay); in single-line format the whole leading run of
// spaces/tabs (there's no indentation concept to preserve).
function stripLeadingSeparator(text, sep) {
  if (sep.afterOpen === '') {
    return text.replace(/^[ \t]+/, '');
  }
  return text.startsWith('\n') ? text.slice(1) : text;
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
    afterOpen: '\n',
    between: '\n',
    beforeClose: '\n' + closeIndent,
  };
}

module.exports = { sortJsoncText: sortJsoncText };
