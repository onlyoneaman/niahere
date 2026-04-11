import { closeDb } from "./connection";
import { runMigrations } from "./migrate";

export async function withDb<T>(fn: () => Promise<T>): Promise<T> {
  await runMigrations();
  try {
    return await fn();
  } finally {
    await closeDb();
  }
}
