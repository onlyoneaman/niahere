import { getConfig } from "../utils/config";
import { runMigrations } from "../db/migrate";
import { closeDb, getSql } from "../db/connection";
import { errMsg } from "../utils/errors";

export async function dbSetup(): Promise<void> {
  console.log("Setting up PostgreSQL...\n");

  const pgCheck = Bun.spawnSync(["which", "psql"]);
  const hasPostgres = pgCheck.exitCode === 0;

  if (!hasPostgres) {
    if (process.platform === "darwin") {
      console.log("  PostgreSQL not found. Installing via Homebrew...");
      const brew = Bun.spawn(["brew", "install", "postgresql@17"], { stdout: "inherit", stderr: "inherit" });
      if (await brew.exited !== 0) {
        console.log("  \u2717 brew install failed. Install manually: brew install postgresql@17");
        return;
      }
      console.log("  \u2713 PostgreSQL installed");

      console.log("  Starting PostgreSQL...");
      const start = Bun.spawn(["brew", "services", "start", "postgresql@17"], { stdout: "pipe", stderr: "pipe" });
      if (await start.exited !== 0) {
        console.log("  \u2717 could not start. Try: brew services start postgresql@17");
        return;
      }
      console.log("  \u2713 PostgreSQL started");
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      console.log("  PostgreSQL not found.");
      console.log("  Install it:");
      console.log("    Ubuntu/Debian: sudo apt install postgresql");
      console.log("    Fedora: sudo dnf install postgresql-server");
      console.log("    Arch: sudo pacman -S postgresql");
      return;
    }
  } else {
    const ready = Bun.spawnSync(["pg_isready"]);
    if (ready.exitCode !== 0) {
      console.log("  PostgreSQL installed but not running.");
      if (process.platform === "darwin") {
        console.log("  Starting...");
        const start = Bun.spawn(["brew", "services", "start", "postgresql@17"], { stdout: "pipe", stderr: "pipe" });
        await start.exited;
        await new Promise((r) => setTimeout(r, 2000));
        if (Bun.spawnSync(["pg_isready"]).exitCode === 0) {
          console.log("  \u2713 PostgreSQL started");
        } else {
          console.log("  \u2717 could not start. Check: brew services list");
          return;
        }
      } else {
        console.log("  Start it: sudo systemctl start postgresql");
        return;
      }
    } else {
      console.log("  \u2713 PostgreSQL running");
    }
  }

  // Create database
  const config = getConfig();
  const dbName = config.database_url.split("/").pop() || "niahere";
  const createDb = Bun.spawnSync(["createdb", dbName]);
  if (createDb.exitCode === 0) {
    console.log(`  \u2713 database "${dbName}" created`);
  } else {
    const stderr = new TextDecoder().decode(createDb.stderr);
    if (stderr.includes("already exists")) {
      console.log(`  \u2713 database "${dbName}" already exists`);
    } else {
      console.log(`  \u2717 createdb failed: ${stderr.trim()}`);
      return;
    }
  }

  // Run migrations
  try {
    await runMigrations();
    console.log("  \u2713 migrations done");
    await closeDb();
  } catch (err) {
    console.log(`  \u2717 migrations failed: ${errMsg(err)}`);
  }

  console.log("\nDatabase ready.");
}

export async function dbCommand(): Promise<void> {
  const sub = process.argv[3];

  switch (sub) {
    case "setup":
      await dbSetup();
      break;

    case "migrate": {
      try {
        await runMigrations();
        console.log("Migrations done.");
        await closeDb();
      } catch (err) {
        console.log(`Failed: ${errMsg(err)}`);
        process.exit(1);
      }
      break;
    }

    case "status": {
      try {
        const sql = getSql();
        await sql`SELECT 1`;
        console.log("Database: connected");
        await closeDb();
      } catch (err) {
        console.log(`Database: unavailable (${errMsg(err)})`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log("Usage: nia db <command>\n");
      console.log("  setup    — install PostgreSQL + create database + migrate");
      console.log("  migrate  — run database migrations");
      console.log("  status   — check database connection");
      break;
  }
}
