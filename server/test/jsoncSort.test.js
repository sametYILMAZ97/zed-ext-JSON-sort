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

test('homogeneous string array is sorted', function tc() {
  const input = '{\n  "fruits": [\n    "pear",\n    "apple",\n    "banana"\n  ]\n}';
  const out = sortJsoncText(input, cfg(), null);
  const pearIdx = out.text.indexOf('"pear"');
  const appleIdx = out.text.indexOf('"apple"');
  const bananaIdx = out.text.indexOf('"banana"');
  assert.ok(appleIdx < bananaIdx && bananaIdx < pearIdx);
});

test('string array sort keeps leading/trailing comments attached to their element', function tc() {
  const input = '{\n  "fruits": [\n    "pear", // last\n    // first\n    "apple",\n    "banana"\n  ]\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.ok(out.text.indexOf('// first') < out.text.indexOf('"apple"'));
  assert.ok(out.text.indexOf('"pear"') < out.text.indexOf('// last'));
});

test('mixed-type array is left untouched (only contents recursed)', function tc() {
  const input = '{\n  "mixed": [3, "b", true, null]\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.strictEqual(out.text, input);
});

test('number array sorted only when sortNumberArrays=true', function tc() {
  const input = '{\n  "nums": [3, 1, 2]\n}';
  const off = sortJsoncText(input, cfg(), null);
  assert.strictEqual(off.text, input);
  const on = sortJsoncText(input, cfg({ sortNumberArrays: true }), null);
  const i1 = on.text.indexOf('1');
  const i2 = on.text.indexOf('2');
  const i3 = on.text.indexOf('3');
  assert.ok(i1 < i2 && i2 < i3);
});

test('sortObjectArraysBy reorders object arrays by key', function tc() {
  const input = '{\n  "items": [\n    { "id": "b" },\n    { "id": "a" }\n  ]\n}';
  const out = sortJsoncText(input, cfg({ sortObjectArraysBy: 'id' }), null);
  const aIdx = out.text.indexOf('"a"');
  const bIdx = out.text.indexOf('"b"');
  assert.ok(aIdx < bIdx);
});

test('array already in sorted order is a no-op', function tc() {
  const input = '{\n  "fruits": [\n    "apple",\n    "banana",\n    "pear"\n  ]\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.strictEqual(out.text, input);
});

test('nested array inside sorted object is reordered too', function tc() {
  const input = '{\n  "z": {\n    "fruits": ["pear", "apple"]\n  },\n  "a": 1\n}';
  const out = sortJsoncText(input, cfg(), null);
  assert.ok(out.text.indexOf('"a"') < out.text.indexOf('"z"'));
  assert.ok(out.text.indexOf('"apple"') < out.text.indexOf('"pear"'));
});
