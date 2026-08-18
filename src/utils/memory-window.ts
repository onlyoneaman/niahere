/**
 * Load the memory that earns its place in every prompt, and make the rest
 * reachable.
 *
 * `memory.md` reached 37.7 KB and, with `rules.md`, 54% of the chat system
 * prompt — paid on every turn, on every channel, forever. But the file is not
 * uniform: hand-organised topical sections (`## Personal`, `## Nia
 * Architecture`) are curated and durable, while `## Promoted <date>` sections
 * are an append log where recency is the best available proxy for relevance.
 *
 * So the topical sections always load, the newest dated ones load until a byte
 * budget is spent, and everything else stays one `search_memory` call away.
 * Rules are deliberately untouched: rules are verbs and an unloaded rule is
 * simply not followed, where memory is nouns and can be fetched on demand.
 */

/** Roughly a third of what memory.md had grown to. */
export const MEMORY_BUDGET_BYTES = 12_000;

const DATED = /\d{4}-\d{2}-\d{2}/;

interface Section {
  heading: string;
  body: string;
  dated: boolean;
}

function parseSections(text: string): { preamble: string; sections: Section[] } {
  const lines = text.split("\n");
  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1]!.trim(), body: "", dated: DATED.test(m[1]!) };
      continue;
    }
    if (current) current.body += line + "\n";
    else preamble.push(line);
  }
  if (current) sections.push(current);
  return { preamble: preamble.join("\n").trimEnd(), sections };
}

const render = (s: Section) => `## ${s.heading}\n${s.body}`.trimEnd();

export interface MemorySplit {
  /** What goes into the system prompt. */
  loaded: string;
  /** What was held back. */
  deferred: string;
  deferredSections: number;
  /** A line telling the model the rest exists. Empty when nothing was held. */
  pointer: string;
}

export function splitMemory(text: string, budgetBytes: number = MEMORY_BUDGET_BYTES): MemorySplit {
  const { preamble, sections } = parseSections(text);
  const topical = sections.filter((s) => !s.dated);
  const datedNewestFirst = sections.filter((s) => s.dated).reverse();

  const head = [preamble, ...topical.map(render)].filter(Boolean).join("\n\n");
  let used = head.length;
  const keep: Section[] = [];
  for (const s of datedNewestFirst) {
    const cost = render(s).length + 2;
    if (used + cost > budgetBytes && keep.length > 0) break;
    keep.push(s);
    used += cost;
  }

  const keptSet = new Set(keep);
  const held = sections.filter((s) => s.dated && !keptSet.has(s));
  // Restore document order for whatever is loaded.
  const loadedDated = sections.filter((s) => keptSet.has(s));

  const loaded = [head, ...loadedDated.map(render)].filter(Boolean).join("\n\n");
  const deferred = held.map(render).join("\n\n");
  const entries = held.reduce((n, s) => n + (s.body.match(/^- /gm)?.length ?? 0), 0);

  return {
    loaded,
    deferred,
    deferredSections: held.length,
    pointer: held.length
      ? `\n\n_(${entries} older memories from ${held.length} earlier dates are not shown. Use the \`search_memory\` tool to look them up before assuming something is not recorded.)_`
      : "",
  };
}

export interface MemoryHit {
  section: string;
  entry: string;
}

/** Plain substring search. At this size an exact scan beats an index that has
 *  to be kept in sync, and it cannot hallucinate a near-match. */
export function searchMemoryText(text: string, query: string, limit = 20): MemoryHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const { preamble, sections } = parseSections(text);
  const scan: { section: string; body: string }[] = [
    { section: "(top)", body: preamble },
    ...sections.map((s) => ({ section: s.heading, body: s.body })),
  ];

  const hits: MemoryHit[] = [];
  for (const { section, body } of scan) {
    for (const line of body.split("\n")) {
      if (!line.trim().startsWith("- ")) continue;
      if (line.toLowerCase().includes(needle)) {
        hits.push({ section, entry: line.trim() });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
