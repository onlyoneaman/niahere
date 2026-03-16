# Agent Principles

## Core

1. **UI parity.** Whatever the user can do through the UI, the agent should be able to achieve through tools.
2. **Atomic tools.** Tools should be atomic primitives. Features are outcomes achieved by an agent operating in a loop.
3. **Prompts as features.** With atomic tools and parity, you can create new features just by writing new prompts.
4. **Emergent capability.** The agent can accomplish things you didn't explicitly design for.
5. **Compounding context.** Agent-native applications get better through accumulated context and prompt refinement.

## Implications for tool design

- One tool = one side effect. If a tool does two things, split it.
- Tools return structured data. Let the agent decide what to do with it.
- Don't encode workflows into tools. The agent IS the workflow engine.
- Error details > error handling. Return the error, don't swallow it. The agent will retry or adapt.
- Discovery matters. The agent needs to know what tools exist and what they accept.

## Implications for agent design

- Loop, don't script. Agents should observe → decide → act → observe, not follow a fixed sequence.
- Context is memory. What the agent has seen informs what it does next. Preserve it.
- Composition over features. Ten atomic tools > one do-everything tool. The agent composes.
- Fail forward. When a tool fails, the agent picks a different path. Design for this.

## Anti-patterns

- **Fat tools** that bundle read + transform + write. Break them apart.
- **Hardcoded workflows** in tool code. That logic belongs in prompts.
- **Silent failures** that hide errors from the agent. Surface everything.
- **Assumptions about intent** baked into tools. Let the agent express intent through tool selection and arguments.

---

References:
- [ai-2027.com](https://ai-2027.com/)
- [web4.ai](https://web4.ai/)
- [Agent-Native Applications](https://every.to/guides/agent-native)
