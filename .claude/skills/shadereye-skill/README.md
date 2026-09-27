# Shadereye Skill

An agent skill for the `zajalist/shadereye` MCP server.

## Contents

- `SKILL.md` — trigger conditions, tool-selection policy, debugging workflows, and verification discipline.
- `references/tool-reference.md` — exact MCP arguments, defaults, limitations, and workflow patterns.

## Requirement

The shadereye MCP server must already be available to the agent. The upstream server is a stdio MCP binary named `shadereye-mcp`.

Typical MCP configuration:

```json
{
  "mcpServers": {
    "shadereye": {
      "command": "shadereye-mcp"
    }
  }
}
```

Optional environment variables:

- `SHADERTOY_API_KEY` — enables Shadertoy fetch/search tools.
- `SHADEREYE_BROWSER` — overrides Chrome/Chromium path for browser execution.
