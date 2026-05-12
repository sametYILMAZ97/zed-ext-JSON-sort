'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  indentString,
  stringify,
  applyLineEndings,
  withBOM,
  withTrailingNewline,
} = require('../src/format');

test('indentString tab', function tc() {
  assert.strictEqual(indentString('tab'), '\t');
});

test('indentString numeric', function tc() {
  assert.strictEqual(indentString(4), '    ');
});

test('stringify JSON 2-space', function tc() {
  const out = stringify({ a: 1, b: 2 }, { dialect: 'json', indent: 2 });
  assert.strictEqual(out, '{\n  "a": 1,\n  "b": 2\n}');
});

test('stringify minify', function tc() {
  const out = stringify({ a: 1, b: 2 }, { dialect: 'json', minify: true });
  assert.strictEqual(out, '{"a":1,"b":2}');
});

test('applyLineEndings normalizes CRLF', function tc() {
  assert.strictEqual(applyLineEndings('a\r\nb', '\n'), 'a\nb');
  assert.strictEqual(applyLineEndings('a\nb', '\r\n'), 'a\r\nb');
});

test('withBOM adds BOM only when had + preserve', function tc() {
  assert.strictEqual(withBOM('{}', true,  true).charCodeAt(0), 0xFEFF);
  assert.strictEqual(withBOM('{}', false, true), '{}');
  assert.strictEqual(withBOM('{}', true,  false), '{}');
});

test('withTrailingNewline adds when missing', function tc() {
  assert.strictEqual(withTrailingNewline('{}', '\n'), '{}\n');
  assert.strictEqual(withTrailingNewline('{}\n', '\n'), '{}\n');
});
