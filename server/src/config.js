'use strict';

const DEFAULT_CONFIG = Object.freeze({
  indent: 2,
  preserveIndent: false,
  sortOrder: 'asc',
  caseInsensitive: false,
  naturalSort: false,
  sortArrays: true,
  sortNumberArrays: false,
  sortObjectArraysBy: null,
  recursive: true,
  preserveBOM: true,
  preserveTrailingNewline: true,
  preserveLineEndings: true,
  bigIntSafe: true,
  keyPriority: Object.freeze({
    'package.json': [
      'name', 'version', 'private', 'description', 'keywords', 'homepage',
      'bugs', 'license', 'author', 'contributors', 'funding', 'files',
      'main', 'browser', 'module', 'types', 'typings', 'exports', 'imports',
      'bin', 'man', 'directories', 'repository', 'scripts', 'config',
      'dependencies', 'devDependencies', 'peerDependencies',
      'peerDependenciesMeta', 'bundledDependencies', 'optionalDependencies',
      'overrides', 'engines', 'os', 'cpu', 'workspaces', 'packageManager',
      'publishConfig',
    ],
    'tsconfig.json': [
      'extends', 'compilerOptions', 'include', 'exclude', 'files', 'references',
      'compileOnSave', 'typeAcquisition', 'watchOptions', 'buildOptions',
    ],
    'jsconfig.json': [
      'extends', 'compilerOptions', 'include', 'exclude', 'files', 'references',
    ],
    'composer.json': [
      'name', 'description', 'type', 'keywords', 'homepage', 'license',
      'authors', 'support', 'require', 'require-dev', 'autoload',
      'autoload-dev', 'config', 'scripts',
    ],
  }),
  ignoredPaths: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  diagnostics: false,
  maxFileSizeBytes: 100 * 1024 * 1024,
  warnFileSizeBytes: 10 * 1024 * 1024,
  logLevel: 'warn',
});

const VALID_SORT_ORDER = new Set(['asc', 'desc']);
const VALID_LOG_LEVEL = new Set(['off', 'error', 'warn', 'info', 'debug']);
const VALID_INDENT = (v) =>
  v === 'tab' || (Number.isInteger(v) && v >= 0 && v <= 16);

function pickBool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}
function pickEnum(value, set, fallback) {
  return typeof value === 'string' && set.has(value) ? value : fallback;
}
function pickIndent(value, fallback) {
  return VALID_INDENT(value) ? value : fallback;
}
function pickStringOrNull(value, fallback) {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
function pickPositiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function pickStringArray(value, fallback) {
  if (Array.isArray(value) && value.every((s) => typeof s === 'string')) return value.slice();
  return fallback;
}

function resolveConfig(raw, logger) {
  const opts = (raw && typeof raw === 'object') ? raw : {};
  const cfg = {
    indent: pickIndent(opts.indent, DEFAULT_CONFIG.indent),
    preserveIndent: pickBool(opts.preserveIndent, DEFAULT_CONFIG.preserveIndent),
    sortOrder: pickEnum(opts.sortOrder, VALID_SORT_ORDER, DEFAULT_CONFIG.sortOrder),
    caseInsensitive: pickBool(opts.caseInsensitive, DEFAULT_CONFIG.caseInsensitive),
    naturalSort: pickBool(opts.naturalSort, DEFAULT_CONFIG.naturalSort),
    sortArrays: pickBool(opts.sortArrays, DEFAULT_CONFIG.sortArrays),
    sortNumberArrays: pickBool(opts.sortNumberArrays, DEFAULT_CONFIG.sortNumberArrays),
    sortObjectArraysBy: pickStringOrNull(opts.sortObjectArraysBy, DEFAULT_CONFIG.sortObjectArraysBy),
    recursive: pickBool(opts.recursive, DEFAULT_CONFIG.recursive),
    preserveBOM: pickBool(opts.preserveBOM, DEFAULT_CONFIG.preserveBOM),
    preserveTrailingNewline: pickBool(opts.preserveTrailingNewline, DEFAULT_CONFIG.preserveTrailingNewline),
    preserveLineEndings: pickBool(opts.preserveLineEndings, DEFAULT_CONFIG.preserveLineEndings),
    bigIntSafe: pickBool(opts.bigIntSafe, DEFAULT_CONFIG.bigIntSafe),
    keyPriority: resolveKeyPriority(opts.keyPriority, DEFAULT_CONFIG.keyPriority, logger),
    ignoredPaths: pickStringArray(opts.ignoredPaths, DEFAULT_CONFIG.ignoredPaths.slice()),
    diagnostics: pickBool(opts.diagnostics, DEFAULT_CONFIG.diagnostics),
    maxFileSizeBytes: pickPositiveInt(opts.maxFileSizeBytes, DEFAULT_CONFIG.maxFileSizeBytes),
    warnFileSizeBytes: pickPositiveInt(opts.warnFileSizeBytes, DEFAULT_CONFIG.warnFileSizeBytes),
    logLevel: pickEnum(opts.logLevel, VALID_LOG_LEVEL, DEFAULT_CONFIG.logLevel),
  };
  return cfg;
}

function resolveKeyPriority(raw, fallback, logger) {
  if (raw == null) return cloneKeyPriority(fallback);
  if (typeof raw !== 'object') {
    if (logger) logger.warn('keyPriority must be an object — using defaults');
    return cloneKeyPriority(fallback);
  }
  const out = {};
  for (const [filename, keys] of Object.entries(raw)) {
    if (Array.isArray(keys) && keys.every((k) => typeof k === 'string')) {
      out[filename] = keys.slice();
    } else if (logger) {
      logger.warn(`keyPriority["${filename}"] must be string[] — ignored`);
    }
  }
  // Fold in defaults for entries the user didn't override.
  for (const [filename, keys] of Object.entries(fallback)) {
    if (!(filename in out)) out[filename] = keys.slice();
  }
  return out;
}

function cloneKeyPriority(src) {
  const out = {};
  for (const [k, v] of Object.entries(src)) out[k] = v.slice();
  return out;
}

function withOverrides(cfg, overrides) {
  return Object.assign({}, cfg, overrides || {});
}

module.exports = {
  DEFAULT_CONFIG,
  resolveConfig,
  withOverrides,
};
