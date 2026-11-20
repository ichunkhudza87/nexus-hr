const SENSITIVE_KEY_PATTERN =
  /(secret|key|token|authorization|cookie|password|passwd|sig|signature|jwt|hmac)/i;

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const HEX64_PATTERN = /\b[a-fA-F0-9]{64}\b/g;

export function sanitizeString(input: string): string {
  return input
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(HEX64_PATTERN, '[REDACTED_HEX64]');
}

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[MAX_DEPTH]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeForLog(v, depth + 1);
      }
    }
    return out;
  }
  return '[UNSERIALIZABLE]';
}

export interface Logger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
}

export function createStructuredLogger(
  sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const emit = (level: string, event: string, meta?: Record<string, unknown>) => {
    const record = {
      ts: new Date().toISOString(),
      level,
      event: sanitizeString(event),
      ...(meta ? { meta: sanitizeForLog(meta) } : {}),
    };
    sink(JSON.stringify(record));
  };

  return {
    info: (event, meta) => emit('INFO', event, meta),
    warn: (event, meta) => emit('WARN', event, meta),
    error: (event, meta) => emit('ERROR', event, meta),
  };
}
