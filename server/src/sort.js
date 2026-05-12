'use strict';

const { isLosslessNumber } = require('./dialect');

function buildComparator(options) {
  const opts = options || {};
  const order = opts.sortOrder === 'desc' ? -1 : 1;

  if (opts.naturalSort) {
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: opts.caseInsensitive ? 'base' : 'variant',
    });
    return function natural(a, b) { return order * collator.compare(a, b); };
  }

  if (opts.caseInsensitive) {
    return function ci(a, b) {
      const al = a.toLowerCase();
      const bl = b.toLowerCase();
      if (al < bl) return -1 * order;
      if (al > bl) return  1 * order;
      if (a < b) return -1 * order;
      if (a > b) return  1 * order;
      return 0;
    };
  }

  return function plain(a, b) {
    if (a < b) return -1 * order;
    if (a > b) return  1 * order;
    return 0;
  };
}

function buildKeyOrderer(options, priorityKeys) {
  const cmp = buildComparator(options);
  if (!priorityKeys || priorityKeys.length === 0) {
    return function order(keys) { return keys.slice().sort(cmp); };
  }
  const priorityIndex = new Map();
  priorityKeys.forEach(function setIdx(k, i) { priorityIndex.set(k, i); });

  return function order(keys) {
    const pinned = [];
    const rest = [];
    for (const k of keys) {
      if (priorityIndex.has(k)) pinned.push(k);
      else rest.push(k);
    }
    pinned.sort(function pinSort(a, b) {
      return priorityIndex.get(a) - priorityIndex.get(b);
    });
    rest.sort(cmp);
    return pinned.concat(rest);
  };
}

function sortValue(value, options) {
  return _sort(value, options, 0);
}

function _sort(value, options, depth) {
  if (Array.isArray(value)) return sortArray(value, options, depth);
  if (value !== null && typeof value === 'object' && !isLosslessNumber(value)) {
    return sortObject(value, options, depth);
  }
  return value;
}

function sortObject(obj, options, depth) {
  const order = options.keyOrderer || buildKeyOrderer(options, null);
  const keys = order(Object.keys(obj));
  const out = {};
  for (const k of keys) {
    const v = obj[k];
    out[k] = options.recursive === false && depth >= 0
      ? v
      : _sort(v, options, depth + 1);
  }
  return out;
}

function sortArray(arr, options, depth) {
  const recursed = options.recursive === false
    ? arr.slice()
    : arr.map(function eachItem(v) { return _sort(v, options, depth + 1); });

  if (!options.sortArrays && !options.sortNumberArrays && !options.sortObjectArraysBy) {
    return recursed;
  }

  if (recursed.length === 0) return recursed;

  if (options.sortArrays && recursed.every(function isStr(v) { return typeof v === 'string'; })) {
    const cmp = buildComparator(options);
    return recursed.slice().sort(cmp);
  }

  if (options.sortNumberArrays && recursed.every(isNumericLeaf)) {
    const order = options.sortOrder === 'desc' ? -1 : 1;
    return recursed.slice().sort(function numCmp(a, b) {
      return order * (numericLeafValue(a) - numericLeafValue(b));
    });
  }

  if (options.sortObjectArraysBy &&
      recursed.every(function isObj(v) {
        return v != null && typeof v === 'object' &&
               !Array.isArray(v) && !isLosslessNumber(v);
      })) {
    const key = options.sortObjectArraysBy;
    const cmp = buildComparator(options);
    return recursed.slice().sort(function objCmp(a, b) {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string' && typeof bv === 'string') return cmp(av, bv);
      const order = options.sortOrder === 'desc' ? -1 : 1;
      if (typeof av === 'number' && typeof bv === 'number') return order * (av - bv);
      return cmp(String(av), String(bv));
    });
  }

  return recursed;
}

function isNumericLeaf(v) {
  return typeof v === 'number' || isLosslessNumber(v);
}

function numericLeafValue(v) {
  if (typeof v === 'number') return v;
  if (isLosslessNumber(v)) return Number(v.value);
  return NaN;
}

function isAlreadySorted(value, options) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isLosslessNumber(value)) {
    return true;
  }
  const order = options.keyOrderer || buildKeyOrderer(options, null);
  const actual = Object.keys(value);
  const expected = order(actual);
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) return false;
  }
  if (options.recursive === false) return true;
  for (const k of actual) {
    if (!isAlreadySorted(value[k], options)) return false;
  }
  return true;
}

module.exports = {
  buildComparator: buildComparator,
  buildKeyOrderer: buildKeyOrderer,
  sortValue: sortValue,
  isAlreadySorted: isAlreadySorted,
};
