export const logger = {
  info(message: string, extra?: unknown) {
    if (extra !== undefined) {
      console.log(`[INFO] ${message}`, extra);
      return;
    }
    console.log(`[INFO] ${message}`);
  },
  warn(message: string, extra?: unknown) {
    if (extra !== undefined) {
      console.warn(`[WARN] ${message}`, extra);
      return;
    }
    console.warn(`[WARN] ${message}`);
  },
  error(message: string, extra?: unknown) {
    if (extra !== undefined) {
      console.error(`[ERROR] ${message}`, extra);
      return;
    }
    console.error(`[ERROR] ${message}`);
  }
};
