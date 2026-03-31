import { scanAgents } from "../core/agents";
import { fail } from "../utils/cli";

const HELP = `Usage: nia agent <command>

Commands:
  list          List all available agents
  show <name>   Show agent details and prompt`;

export async function agentCommand(): Promise<void> {
  const subcommand = process.argv[3];

  if (subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    console.log(HELP);
    return;
  }

  switch (subcommand) {
    case "list": {
      const agents = scanAgents();
      if (agents.length === 0) {
        console.log("No agents found. Create agents in ~/.niahere/agents/<name>/AGENT.md");
      } else {
        for (const a of agents) {
          const model = a.model ? `  (${a.model})` : "";
          console.log(`  ${a.name}${model}  [${a.source}]`);
          if (a.description) console.log(`    ${a.description}`);
        }
      }
      break;
    }

    case "show": {
      const name = process.argv[4];
      if (!name) fail("Usage: nia agent show <name>");
      const agents = scanAgents();
      const agent = agents.find((a) => a.name === name);
      if (!agent) fail(`Agent "${name}" not found.`);
      console.log(`Name:        ${agent.name}`);
      console.log(`Description: ${agent.description}`);
      if (agent.model) console.log(`Model:       ${agent.model}`);
      console.log(`Source:      ${agent.source}`);
      console.log(`\n--- Prompt ---\n`);
      console.log(agent.body);
      break;
    }

    default:
      if (subcommand) console.error(`Unknown subcommand: ${subcommand}`);
      console.log(HELP);
      process.exit(subcommand ? 1 : 0);
  }
}
