import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Journal enfant avec un préfixe — un par module. */
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Répertoire de journalisation. Absent = console seulement. */
  dir?: string;
  pretty?: boolean;
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

export function createLogger(options: LoggerOptions = {}, scope = 'valmont'): Logger {
  const level = options.level ?? 'info';
  const pretty = options.pretty ?? process.stdout.isTTY === true;
  const file = options.dir ? join(options.dir, `${new Date().toISOString().slice(0, 10)}.log`) : null;

  function write(entry: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[entry] < LEVEL_ORDER[level]) return;
    const at = new Date().toISOString();
    const record = { at, level: entry, scope, message, ...(data ? { data } : {}) };

    if (pretty) {
      const color = COLORS[entry];
      const extra = data ? ` \x1b[90m${JSON.stringify(data)}\x1b[0m` : '';
      // eslint-disable-next-line no-console
      console.log(
        `${color}${entry.toUpperCase().padEnd(5)}\x1b[0m \x1b[90m${at.slice(11, 19)}\x1b[0m [${scope}] ${message}${extra}`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(record));
    }

    if (file) {
      try {
        appendFileSync(file, `${JSON.stringify(record)}\n`);
      } catch {
        /* la journalisation ne doit jamais casser l'exécution */
      }
    }
  }

  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (childScope) => createLogger(options, `${scope}:${childScope}`),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
