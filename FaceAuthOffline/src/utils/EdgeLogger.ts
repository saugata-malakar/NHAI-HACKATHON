/**
 * EdgeLogger
 * Circular buffer (200 entries max) + EventEmitter for the live terminal UI.
 * Every catch block and ML step calls EdgeLogger.error / info / sys / val.
 *
 * Usage:
 *   EdgeLogger.info('[FaceDB] Initialized');
 *   EdgeLogger.error('[SyncManager] Upload failed: ' + err.message);
 *   EdgeLogger.subscribe(entries => setTerminalLines(entries));
 */

type LogLevel = 'INFO' | 'SYS' | 'VAL' | 'ERR' | 'SYNC';

export interface LogEntry {
  ts: string;            // "HH:MM:SS AM/PM"
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 200;
const _buffer: LogEntry[] = [];
const _listeners: Set<(entries: LogEntry[]) => void> = new Set();

function fmt(level: LogLevel, message: string): LogEntry {
  const now = new Date();
  const hh = now.getHours() % 12 || 12;
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  return { ts: `${hh}:${mm}:${ss} ${ampm}`, level, message };
}

function push(entry: LogEntry): void {
  _buffer.push(entry);
  if (_buffer.length > MAX_ENTRIES) _buffer.shift();
  _listeners.forEach(fn => fn([..._buffer]));
}

export const EdgeLogger = {
  info(message: string): void  { push(fmt('INFO',  message)); },
  sys(message: string): void   { push(fmt('SYS',   message)); },
  val(message: string): void   { push(fmt('VAL',   message)); },
  error(message: string): void { push(fmt('ERR',   message)); },
  sync(message: string): void  { push(fmt('SYNC',  message)); },

  getAll(): LogEntry[] { return [..._buffer]; },

  subscribe(fn: (entries: LogEntry[]) => void): () => void {
    _listeners.add(fn);
    fn([..._buffer]); // immediate snapshot on subscribe
    return () => _listeners.delete(fn);
  },

  clear(): void {
    _buffer.length = 0;
    _listeners.forEach(fn => fn([]));
  },
};
