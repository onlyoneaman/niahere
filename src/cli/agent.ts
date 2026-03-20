import { scanAgents } from "../core/agents";

export async function agentCommand(): Promise<void> {
  const subcommand = process.argv[3];

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
      if (!name) {
        console.error("Usage: nia agent show <name>");
        process.exit(1);
      }
      const agents = scanAgents();
      const agent = agents.find((a) => a.name === name);
      if (!agent) {
        console.error(`Agent "${name}" not found.`);
        process.exit(1);
      }
      console.log(`Name:        ${agent.name}`);
      console.log(`Description: ${agent.description}`);
      if (agent.model) console.log(`Model:       ${agent.model}`);
      console.log(`Source:      ${agent.source}`);
      console.log(`\n--- Prompt ---\n`);
      console.log(agent.body);
      break;
    }

    default:
      console.log("Usage: nia agent <list|show>");
      console.log("  list          List all available agents");
      console.log("  show <name>   Show agent details and prompt");
  }
}
