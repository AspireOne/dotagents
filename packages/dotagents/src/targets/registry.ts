import type { AgentDefinition } from "./types.js";
import claude from "./definitions/claude.js";
import cursor from "./definitions/cursor.js";
import codex from "./definitions/codex.js";
import vscode from "./definitions/vscode.js";
import opencode from "./definitions/opencode.js";
import copilot from "./definitions/copilot.js";
import { MCP_TARGET_IDS } from "./ids.js";

const DEFINITIONS_BY_ID = { claude, cursor, codex, vscode, opencode, copilot } satisfies Record<
  typeof MCP_TARGET_IDS[number],
  AgentDefinition
>;
const ALL_AGENTS: AgentDefinition[] = MCP_TARGET_IDS.map((id) => DEFINITIONS_BY_ID[id]);

const AGENT_REGISTRY = new Map<string, AgentDefinition>(
  ALL_AGENTS.map((a) => [a.id, a]),
);

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.get(id);
}

export function allAgentIds(): string[] {
  return [...AGENT_REGISTRY.keys()];
}

export function allAgents(): AgentDefinition[] {
  return ALL_AGENTS;
}
