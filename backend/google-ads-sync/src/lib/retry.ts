export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(100, options.baseDelayMs ?? 500);
  const shouldRetry = options.shouldRetry ?? (() => false);

  let currentError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      currentError = error;
      const isLast = i === attempts - 1;
      if (isLast || !shouldRetry(error)) {
        throw error;
      }
      const wait = baseDelayMs * (2 ** i);
      await sleep(wait);
    }
  }

  throw currentError;
}
