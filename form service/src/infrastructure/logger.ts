type Level = 'info' | 'warn' | 'error';

/** Structured JSON logger. Never pass tokens, headers or submission values. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === 'test') return;
  console.log(JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields }));
}
