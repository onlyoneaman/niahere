import { scanSkills } from "../core/skills";

/** `nia skills [source]` — list discovered skills, optionally filtered by source. */
export function skillsCommand(filter?: string): void {
  const skills = filter ? scanSkills().filter((s) => s.source === filter) : scanSkills();
  if (skills.length === 0) {
    console.log(filter ? `No skills found in "${filter}".` : "No skills found.");
    return;
  }
  for (const s of skills) {
    console.log(`  ${s.name}${filter ? "" : `  [${s.source}]`}`);
  }
}
