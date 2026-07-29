import { log } from "./log";

/** Extract a human-readable message from an unknown error value. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Normalize an unknown to an Error, keeping the original when it already is one
 *  so its stack survives a rethrow. */
export function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(errMsg(err));
}

type Report = (context: string, err: string) => void;

const report: Report = (context, err) => log.debug({ err }, `ignored failure: ${context}`);

/**
 * Await best-effort work whose failure must not stop the caller — cleanup,
 * bookkeeping, teardown. Use instead of `.catch(() => {})`: the outcome is the
 * same, but a failure leaves a trace rather than vanishing, so a persistent one
 * is discoverable instead of silent.
 */
export async function ignore(work: Promise<unknown>, context: string, onError: Report = report): Promise<void> {
  try {
    await work;
  } catch (err) {
    onError(context, errMsg(err));
  }
}
