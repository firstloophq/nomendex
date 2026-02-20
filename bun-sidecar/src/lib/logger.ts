import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, appendFileSync, writeFileSync } from 'fs';

// Centralized log directory in app support (shared across all workspaces)
const LOG_DIR = join(homedir(), 'Library/Application Support/com.firstloop.nomendex');
const LOG_FILE = join(LOG_DIR, 'logs.txt');

// Startup mode flag - only log to file during startup
let isStartupMode = true;

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'HTTP' | 'DEBUG';
type LogLevelName = Lowercase<LogLevel>;

const LOG_LEVEL_PRIORITIES: Record<LogLevelName, number> = {
  error: 0,
  warn: 1,
  info: 2,
  http: 2,
  debug: 3,
};

const DEFAULT_LOG_LEVEL: LogLevelName =
  process.env.NODE_ENV === 'development' ? 'warn' : 'info';

const configuredLogLevel = (() => {
  const raw = process.env.NOMENDEX_LOG_LEVEL?.toLowerCase();
  if (raw && raw in LOG_LEVEL_PRIORITIES) {
    return raw as LogLevelName;
  }
  return DEFAULT_LOG_LEVEL;
})();

function shouldLog(level: LogLevel): boolean {
  const normalized = level.toLowerCase() as LogLevelName;
  return LOG_LEVEL_PRIORITIES[normalized] <= LOG_LEVEL_PRIORITIES[configuredLogLevel];
}

function getLogDir(): string {
  return LOG_DIR;
}

function getLogFile(): string {
  return LOG_FILE;
}

// Mark startup as complete - stops file logging
export function markStartupComplete(): void {
  if (isStartupMode) {
    writeStartupLog('STARTUP', 'Startup complete - file logging disabled');
    isStartupMode = false;
  }
}

// Check if still in startup mode
export function isInStartupMode(): boolean {
  return isStartupMode;
}

// Ensure log directory exists
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch (error) {
  console.error('Failed to create log directory:', error);
}

// Clear previous startup logs and start fresh
try {
  writeFileSync(LOG_FILE, '');
} catch (error) {
  console.error('Failed to clear log file:', error);
}

// Write a startup log entry (only during startup mode)
function writeStartupLog(level: string, message: string, meta?: Record<string, unknown>): void {
  if (!isStartupMode) return;

  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  const logEntry = `${timestamp} [${level}] ${message}${metaStr}\n`;

  try {
    appendFileSync(LOG_FILE, logEntry);
  } catch (error) {
    console.error('Failed to write startup log:', error);
  }
}

// Console logging (always active)
function consoleLog(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${timestamp} [${level}] ${message}${metaStr}`);
}

// Startup logger - writes to both console and file (during startup only)
export const startupLog = {
  error: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('ERROR')) {
      consoleLog('ERROR', message, meta);
      writeStartupLog('ERROR', message, meta);
    }
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('WARN')) {
      consoleLog('WARN', message, meta);
      writeStartupLog('WARN', message, meta);
    }
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('INFO')) {
      consoleLog('INFO', message, meta);
      writeStartupLog('INFO', message, meta);
    }
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (shouldLog('DEBUG')) {
      consoleLog('DEBUG', message, meta);
      writeStartupLog('DEBUG', message, meta);
    }
  },
};

// Create service-specific loggers (console only after startup)
export const createServiceLogger = (service: string) => {
  return {
    error: (message: string, meta?: Record<string, unknown>) => consoleLog('ERROR', `[${service}] ${message}`, meta),
    warn: (message: string, meta?: Record<string, unknown>) => consoleLog('WARN', `[${service}] ${message}`, meta),
    info: (message: string, meta?: Record<string, unknown>) => consoleLog('INFO', `[${service}] ${message}`, meta),
    http: (message: string, meta?: Record<string, unknown>) => consoleLog('HTTP', `[${service}] ${message}`, meta),
    debug: (message: string, meta?: Record<string, unknown>) => consoleLog('DEBUG', `[${service}] ${message}`, meta),
  };
};

// Default logger without service tag (console only after startup)
export const log = {
  error: (message: string, meta?: Record<string, unknown>) => consoleLog('ERROR', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => consoleLog('WARN', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => consoleLog('INFO', message, meta),
  http: (message: string, meta?: Record<string, unknown>) => consoleLog('HTTP', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => consoleLog('DEBUG', message, meta),
};

// Log startup initialization
startupLog.info('Server starting', {
  logFile: LOG_FILE,
  port: process.env.PORT || '1234',
  environment: process.env.NODE_ENV || 'development'
});

export default { log, startupLog, markStartupComplete, isInStartupMode };
export { LOG_FILE, LOG_DIR, getLogDir, getLogFile };
