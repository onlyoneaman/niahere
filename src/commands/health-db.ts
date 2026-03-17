import postgres from "postgres";

/** Quick DB connectivity check. Returns true if SELECT 1 succeeds. */
export async function checkDbHealth(url: string): Promise<boolean> {
  const db = postgres(url, { onnotice: () => {}, connect_timeout: 5 });
  try {
    const [row] = await db`SELECT 1 as ok`;
    return row?.ok === 1;
  } finally {
    await db.end();
  }
}
