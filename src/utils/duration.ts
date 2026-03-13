const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  if (!input) throw new Error("Empty duration string");

  const matches = input.matchAll(/(\d+)\s*([smhd])/g);
  let total = 0;
  let matched = false;

  for (const match of matches) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    total += value * UNITS[unit];
    matched = true;
  }

  if (!matched) throw new Error(`Invalid duration: "${input}"`);
  return total;
}
