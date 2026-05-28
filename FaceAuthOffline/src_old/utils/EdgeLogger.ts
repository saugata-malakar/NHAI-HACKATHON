import { EventEmitter } from 'events';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'sec';
  tag: string;
  message: string;
}

const MAX_LOGS = 200;
const logs: LogEntry[] = [];
const emitter = new EventEmitter();

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export const EdgeLogger = {
  log(level: 'info' | 'warn' | 'error' | 'sec', tag: string, message: string): void {
    const entry: LogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      level,
      tag,
      message
    };

    logs.push(entry);
    if (logs.length > MAX_LOGS) {
      logs.shift(); // Keep bounded at 200 entries
    }

    emitter.emit('log', entry);
    console.log(`[EdgeLogger] [${level.toUpperCase()}] [${tag}] ${message}`);
  },

  info(tag: string, message: string): void {
    this.log('info', tag, message);
  },

  warn(tag: string, message: string): void {
    this.log('warn', tag, message);
  },

  error(tag: string, message: string): void {
    this.log('error', tag, message);
  },

  sec(tag: string, message: string): void {
    this.log('sec', tag, message);
  },

  getLogs(): LogEntry[] {
    return [...logs];
  },

  clear(): void {
    logs.length = 0;
    emitter.emit('clear');
  },

  subscribe(callback: (log: LogEntry) => void): () => void {
    emitter.on('log', callback);
    return () => {
      emitter.off('log', callback);
    };
  },

  onClear(callback: () => void): () => void {
    emitter.on('clear', callback);
    return () => {
      emitter.off('clear', callback);
    };
  }
};
