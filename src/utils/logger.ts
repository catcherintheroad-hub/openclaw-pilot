export type PilotLogger = {
  debug?: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export function withScope(logger: PilotLogger, scope: string): PilotLogger {
  const prefix = `[command-pilot:${scope}]`;
  return {
    debug: logger.debug
      ? (message, meta) => logger.debug?.(`${prefix} ${message}`, meta)
      : undefined,
    info: (message, meta) => logger.info(`${prefix} ${message}`, meta),
    warn: (message, meta) => logger.warn(`${prefix} ${message}`, meta),
    error: (message, meta) => logger.error(`${prefix} ${message}`, meta),
  };
}
