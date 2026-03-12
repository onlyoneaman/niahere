import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/niahere";

export const sql = postgres(DATABASE_URL, {
  onnotice: () => {},
});

export async function closeDb(): Promise<void> {
  await sql.end();
}
