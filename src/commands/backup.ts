import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { getNiaHome } from "../utils/paths";
import { getConfig } from "../utils/config";

const MAX_BACKUPS = 10;

function getBackupDir(): string {
  const dir = join(getNiaHome(), "backups");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function humanDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function pruneOldBackups(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("niahere-") && f.endsWith(".tar.gz"))
    .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(MAX_BACKUPS)) {
    unlinkSync(join(dir, file.name));
    console.log(`  pruned old backup: ${file.name}`);
  }
}

export async function createBackup(silent = false): Promise<string> {
  const home = getNiaHome();
  const backupDir = getBackupDir();
  const filename = `niahere-${humanDate()}-${Math.floor(Date.now() / 1000)}.tar.gz`;
  const outPath = join(backupDir, filename);

  // Directories/files to include (relative to home)
  const includes: string[] = [];
  if (existsSync(join(home, "config.yaml"))) includes.push("config.yaml");
  if (existsSync(join(home, "self"))) includes.push("self");
  if (existsSync(join(home, "agents"))) includes.push("agents");
  if (existsSync(join(home, "skills"))) includes.push("skills");

  // Database dump
  const config = getConfig();
  const dbUrl = config.database_url;
  let dbDumped = false;
  if (dbUrl) {
    const dumpPath = join(home, "tmp", "db-backup.sql");
    mkdirSync(join(home, "tmp"), { recursive: true });
    const pg = Bun.spawn(["pg_dump", dbUrl, "-f", dumpPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await pg.exited;
    if (exitCode === 0 && existsSync(dumpPath)) {
      // Copy to a relative path for tar
      const relDump = "db-backup.sql";
      const { copyFileSync } = await import("fs");
      copyFileSync(dumpPath, join(home, relDump));
      includes.push(relDump);
      dbDumped = true;
    } else if (!silent) {
      const stderr = await new Response(pg.stderr).text();
      console.log(`  ⚠ db dump skipped: ${stderr.trim() || `exit ${exitCode}`}`);
    }
  }

  if (includes.length === 0) {
    console.log("Nothing to back up.");
    return "";
  }

  // Create tar.gz
  const tar = Bun.spawn(["tar", "czf", outPath, ...includes], {
    cwd: home,
    stdout: "pipe",
    stderr: "pipe",
  });
  const tarExit = await tar.exited;
  if (tarExit !== 0) {
    const stderr = await new Response(tar.stderr).text();
    throw new Error(`tar failed: ${stderr.trim()}`);
  }

  // Clean up temp db dump
  if (dbDumped) {
    try { unlinkSync(join(home, "db-backup.sql")); } catch {}
    try { unlinkSync(join(home, "tmp", "db-backup.sql")); } catch {}
  }

  const size = statSync(outPath).size;
  if (!silent) {
    console.log(`✓ backup created: ${filename} (${formatSize(size)})`);
    if (dbDumped) console.log("  includes: files + database");
    else console.log("  includes: files only (no database)");
  }

  pruneOldBackups(backupDir);

  return outPath;
}

export function listBackups(): void {
  const dir = getBackupDir();
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("niahere-") && f.endsWith(".tar.gz"))
    .map((f) => {
      const stat = statSync(join(dir, f));
      return { name: f, size: stat.size, mtime: stat.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    console.log("No backups found.");
    return;
  }

  console.log(`${files.length} backup(s) in ${dir}:\n`);
  for (const f of files) {
    const date = new Date(f.mtime).toLocaleString();
    console.log(`  ${f.name}  ${formatSize(f.size)}  ${date}`);
  }
}

export async function backupCommand(): Promise<void> {
  const sub = process.argv[3];
  if (sub === "list") {
    listBackups();
  } else if (!sub) {
    await createBackup();
  } else {
    console.log("Usage:");
    console.log("  nia backup        — create a backup");
    console.log("  nia backup list   — list existing backups");
  }
}
