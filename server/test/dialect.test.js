'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  detectDialectFromUri,
  stripBOM,
  detectLineEndings,
  detectTrailingNewline,
  detectIndent,
  parse,
} = require('../src/dialect');

test('detects JSONC by extension', function tc() {
  assert.strictEqual(detectDialectFromUri('file:///x.jsonc'), 'jsonc');
});

test('detects JSON5 by extension', function tc() {
  assert.strictEqual(detectDialectFromUri('file:///x.json5'), 'json5');
});

test('detects tsconfig.json as JSONC', function tc() {
  assert.strictEqual(detectDialectFromUri('file:///proj/tsconfig.json'), 'jsonc');
});

test('detects tsconfig.build.json as JSONC', function tc() {
  assert.strictEqual(detectDialectFromUri('file:///proj/tsconfig.build.json'), 'jsonc');
});

test('plain .json is JSON', function tc() {
  assert.strictEqual(detectDialectFromUri('file:///x.json'), 'json');
});

test('stripBOM detects and removes BOM', function tc() {
  const s = '﻿{"a":1}';
  const r = stripBOM(s);
  assert.strictEqual(r.hadBOM, true);
  assert.strictEqual(r.text, '{"a":1}');
});

test('detectLineEndings finds CRLF', function tc() {
  assert.strictEqual(detectLineEndings('a\r\nb'), '\r\n');
  assert.strictEqual(detectLineEndings('a\nb'), '\n');
});

test('detectTrailingNewline', function tc() {
  assert.strictEqual(detectTrailingNewline('x\n'), '\n');
  assert.strictEqual(detectTrailingNewline('x\r\n'), '\r\n');
  assert.strictEqual(detectTrailingNewline('x'), '');
});

test('detectIndent returns space count', function tc() {
  assert.strictEqual(detectIndent('{\n  "a": 1\n}'), 2);
  assert.strictEqual(detectIndent('{\n    "a": 1\n}'), 4);
  assert.strictEqual(detectIndent('{\n\t"a": 1\n}'), 'tab');
});

test('parse JSON happy path', function tc() {
  const r = parse('{"a":1}', 'json');
  assert.strictEqual(r.errors.length, 0);
});

test('parse JSON returns errors instead of throwing', function tc() {
  const r = parse('not json', 'json');
  assert.ok(r.errors.length > 0);
});

test('parse JSONC tolerates comments and trailing commas', function tc() {
  const r = parse('{\n  // hi\n  "a": 1,\n}', 'jsonc');
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.value, { a: 1 });
});

test('parse JSON5 tolerates single quotes', function tc() {
  const r = parse("{a:'x'}", 'json5');
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.value, { a: 'x' });
});

test('parse JSON bigint-safe preserves large numbers', function tc() {
  const r = parse('{"big": 99999999999999999}', 'json', { bigIntSafe: true });
  assert.strictEqual(r.errors.length, 0);
  assert.ok(r.value.big);
});
