'use strict';

const LEVELS = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

class Logger {
  constructor(connection, level = 'warn') {
    this.connection = connection;
    this.level = LEVELS[level] != null ? LEVELS[level] : LEVELS.warn;
  }

  setLevel(level) {
    if (LEVELS[level] != null) this.level = LEVELS[level];
  }

  _send(method, threshold, message) {
    if (this.level >= threshold && this.connection && this.connection.console) {
      try {
        this.connection.console[method](`[json-sort] ${message}`);
      } catch (_) {
        // swallow — connection may be closed
      }
    }
  }

  error(msg) { this._send('error', LEVELS.error, msg); }
  warn(msg)  { this._send('warn',  LEVELS.warn,  msg); }
  info(msg)  { this._send('info',  LEVELS.info,  msg); }
  debug(msg) { this._send('log',   LEVELS.debug, msg); }
}

module.exports = { Logger, LEVELS };
