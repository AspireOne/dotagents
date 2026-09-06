export const MCP_TARGET_IDS = ["claude", "cursor", "codex", "vscode", "opencode"] as const;

export type McpTargetId = typeof MCP_TARGET_IDS[number];
