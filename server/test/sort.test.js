'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { sortValue, buildKeyOrderer, isAlreadySorted } = require('../src/sort');
const { DEFAULT_CONFIG } = require('../src/config');

function cfg(over) {
  return Object.assign({}, DEFAULT_CONFIG, over || {});
}

test('sorts keys alphabetically (ascending, recursive)', function tc() {
  const input = { b: 2, a: { d: 4, c: 3 } };
  const out = sortValue(input, cfg());
  assert.deepStrictEqual(Object.keys(out), ['a', 'b']);
  assert.deepStrictEqual(Object.keys(out.a), ['c', 'd']);
});

test('sorts keys descending', function tc() {
  const out = sortValue({ a: 1, b: 2, c: 3 }, cfg({ sortOrder: 'desc' }));
  assert.deepStrictEqual(Object.keys(out), ['c', 'b', 'a']);
});

test('case-insensitive sort', function tc() {
  const out = sortValue({ banana: 1, Apple: 2, cherry: 3 }, cfg({ caseInsensitive: true }));
  assert.deepStrictEqual(Object.keys(out), ['Apple', 'banana', 'cherry']);
});

test('natural sort handles numeric suffixes', function tc() {
  const out = sortValue({ item10: 'x', item2: 'y', item1: 'z' }, cfg({ naturalSort: true }));
  assert.deepStrictEqual(Object.keys(out), ['item1', 'item2', 'item10']);
});

test('homogeneous string arrays are sorted', function tc() {
  const out = sortValue(['b', 'a', 'c'], cfg());
  assert.deepStrictEqual(out, ['a', 'b', 'c']);
});

test('mixed-type arrays are NOT sorted (but recursed)', function tc() {
  const out = sortValue([{ b: 1, a: 2 }, 'x', 3], cfg());
  assert.deepStrictEqual(out.length, 3);
  assert.deepStrictEqual(Object.keys(out[0]), ['a', 'b']);
  assert.strictEqual(out[1], 'x');
  assert.strictEqual(out[2], 3);
});

test('number arrays sorted only when sortNumberArrays=true', function tc() {
  assert.deepStrictEqual(sortValue([3, 1, 2], cfg()), [3, 1, 2]);
  assert.deepStrictEqual(sortValue([3, 1, 2], cfg({ sortNumberArrays: true })), [1, 2, 3]);
});

test('sortObjectArraysBy sorts arrays of objects by key', function tc() {
  const out = sortValue(
    [{ id: 'b' }, { id: 'a' }, { id: 'c' }],
    cfg({ sortObjectArraysBy: 'id' })
  );
  assert.deepStrictEqual(out.map(function f(x) { return x.id; }), ['a', 'b', 'c']);
});

test('priority keys come first then alphabetic', function tc() {
  const orderer = buildKeyOrderer(cfg(), ['name', 'version']);
  const out = orderer(['z', 'version', 'a', 'name', 'b']);
  assert.deepStrictEqual(out, ['name', 'version', 'a', 'b', 'z']);
});

test('null is preserved (not treated as object)', function tc() {
  const out = sortValue({ b: null, a: 1 }, cfg());
  assert.strictEqual(out.b, null);
});

test('empty object stays empty', function tc() {
  assert.deepStrictEqual(sortValue({}, cfg()), {});
});

test('empty array stays empty', function tc() {
  assert.deepStrictEqual(sortValue([], cfg()), []);
});

test('isAlreadySorted detects sorted', function tc() {
  assert.strictEqual(isAlreadySorted({ a: 1, b: 2 }, cfg()), true);
  assert.strictEqual(isAlreadySorted({ b: 1, a: 2 }, cfg()), false);
});

test('non-recursive mode does NOT sort nested', function tc() {
  const out = sortValue({ b: 2, a: { d: 4, c: 3 } }, cfg({ recursive: false }));
  assert.deepStrictEqual(Object.keys(out), ['a', 'b']);
  assert.deepStrictEqual(Object.keys(out.a), ['d', 'c']);
});
