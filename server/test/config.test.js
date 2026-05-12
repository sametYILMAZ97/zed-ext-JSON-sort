'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveConfig, DEFAULT_CONFIG, withOverrides } = require('../src/config');

test('resolveConfig returns defaults for null', function tc() {
  const c = resolveConfig(null);
  assert.strictEqual(c.indent, 2);
  assert.strictEqual(c.sortOrder, 'asc');
});

test('rejects invalid sortOrder', function tc() {
  const c = resolveConfig({ sortOrder: 'random' });
  assert.strictEqual(c.sortOrder, 'asc');
});

test('rejects invalid indent', function tc() {
  const c = resolveConfig({ indent: -1 });
  assert.strictEqual(c.indent, 2);
});

test('accepts tab indent', function tc() {
  const c = resolveConfig({ indent: 'tab' });
  assert.strictEqual(c.indent, 'tab');
});

test('user keyPriority overrides defaults', function tc() {
  const c = resolveConfig({ keyPriority: { 'package.json': ['version'] } });
  assert.deepStrictEqual(c.keyPriority['package.json'], ['version']);
  // Defaults preserved for other entries.
  assert.ok(Array.isArray(c.keyPriority['tsconfig.json']));
});

test('rejects non-string priority list', function tc() {
  const c = resolveConfig({ keyPriority: { 'package.json': [1, 2] } });
  // Falls back to default for that entry.
  assert.ok(c.keyPriority['package.json'].includes('name'));
});

test('withOverrides shallow-merges', function tc() {
  const c = withOverrides(DEFAULT_CONFIG, { sortOrder: 'desc' });
  assert.strictEqual(c.sortOrder, 'desc');
  assert.strictEqual(c.indent, 2);
});
