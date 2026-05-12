'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { priorityKeysForUri } = require('../src/schemaPriority');
const { DEFAULT_CONFIG } = require('../src/config');

test('returns package.json priority keys', function tc() {
  const keys = priorityKeysForUri('file:///proj/package.json', DEFAULT_CONFIG.keyPriority);
  assert.ok(keys.indexOf('name') === 0);
});

test('returns tsconfig.json priority keys', function tc() {
  const keys = priorityKeysForUri('file:///proj/tsconfig.json', DEFAULT_CONFIG.keyPriority);
  assert.ok(keys.indexOf('compilerOptions') > 0);
});

test('tsconfig.build.json falls back to tsconfig.json keys', function tc() {
  const keys = priorityKeysForUri('file:///proj/tsconfig.build.json', DEFAULT_CONFIG.keyPriority);
  assert.ok(keys);
  assert.ok(keys.indexOf('compilerOptions') >= 0);
});

test('unknown filename returns null', function tc() {
  const keys = priorityKeysForUri('file:///proj/random.json', DEFAULT_CONFIG.keyPriority);
  assert.strictEqual(keys, null);
});

test('null uri returns null', function tc() {
  assert.strictEqual(priorityKeysForUri(null, DEFAULT_CONFIG.keyPriority), null);
});
