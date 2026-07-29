/** `nia test` — run the suite, showing only the summary unless -v. */

const SUMMARY = [/^\s*\d+ pass/, /^\s*\d+ fail/, /^Ran \d+ tests/, /expect\(\) calls/];
const FAILURE = /^✗|FAIL|error:/i;

function isWorthShowing(line: string): boolean {
  return SUMMARY.some((p) => p.test(line)) || FAILURE.test(line.trim());
}

export async function testCommand(argv: string[]): Promise<never> {
  const verbose = argv.includes("-v") || argv.includes("--verbose");
  const extraArgs = argv.filter((a) => a !== "-v" && a !== "--verbose");

  const proc = Bun.spawn(["bun", "test", ...extraArgs], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: import.meta.dir + "/../..",
    env: { ...process.env, LOG_LEVEL: "silent" },
  });

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  const output = stdout + stderr;

  if (verbose) {
    process.stdout.write(output);
  } else {
    for (const line of output.split("\n")) {
      if (isWorthShowing(line)) console.log(line);
    }
  }
  process.exit(exitCode);
}
