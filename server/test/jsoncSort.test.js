'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sortJsoncText } = require('../src/jsoncSort');
const { DEFAULT_CONFIG } = require('../src/config');

function cfg(over) {
  return Object.assign({}, DEFAULT_CONFIG, over || {});
}

test('sorts top-level keys preserving comments', function tc() {
  const input = '{\n  // comment for b\n  "b": 1,\n  "a": 2\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.ok(out.text.indexOf('"a"') < out.text.indexOf('"b"'));
  assert.ok(out.text.indexOf('// comment for b') >= 0);
});

test('preserves trailing commas', function tc() {
  const input = '{\n  "b": 1,\n  "a": 2,\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.ok(out.text.indexOf('"a"') < out.text.indexOf('"b"'));
});

test('already-sorted is a no-op', function tc() {
  const input = '{\n  "a": 1,\n  "b": 2\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.strictEqual(out.text, input);
});

test('nested object sorted recursively', function tc() {
  const input = '{\n  "z": {\n    "b": 1,\n    "a": 2\n  }\n}';
  const out = sortJsoncText(input, cfg(), null);
  const aIdx = out.text.indexOf('"a"');
  const bIdx = out.text.indexOf('"b"');
  assert.ok(aIdx > 0 && bIdx > 0 && aIdx < bIdx);
});

test('priority keys applied', function tc() {
  const input = '{\n  "version": "1",\n  "description": "x",\n  "name": "pkg"\n}';
  const out = sortJsoncText(input, cfg(), ['name', 'version']);
  const nameIdx = out.text.indexOf('"name"');
  const versionIdx = out.text.indexOf('"version"');
  const descIdx = out.text.indexOf('"description"');
  assert.ok(nameIdx < versionIdx);
  assert.ok(versionIdx < descIdx);
});
