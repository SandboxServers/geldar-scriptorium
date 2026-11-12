// The published template file set (docs/analysis/scriptorium/work-packets.md, "The template").
// Paths are relative to the repo root.
export const allowedFiles: readonly string[] = [
  'template/README.md',
  'template/player.json',
  'template/CLAUDE.md',
  'template/AGENTS.md',
  'template/.mcp.json',
  'template/.gitattributes',
  'template/.gitignore',
  'template/.claude/settings.json',
  'template/.claude/agents/planner.md',
  'template/.claude/hooks/session-start.sh',
  'template/.claude/hooks/post-tool-use.sh',
  'template/.claude/hooks/session-end.sh',
  'template/.claude/hooks/context-meter.sh',
  'template/.claude/skills/play/SKILL.md',
  'template/.claude/skills/reflect/SKILL.md',
  'template/.claude/skills/trade/SKILL.md',
  'template/.claude/skills/author/SKILL.md',
  'template/.claude/skills/moot/SKILL.md',
  'template/.claude/skills/setup/SKILL.md',
  'template/.claude/skills/keep-living-loop/SKILL.md',
  'template/.claude/skills/reading-your-status/SKILL.md',
  'template/.claude/skills/escape-a-pit/SKILL.md',
  'template/.claude/skills/intents-and-limits/SKILL.md',
  'template/.claude/skills/eating-and-hunger/SKILL.md',
  'template/.claude/skills/night-safety/SKILL.md',
  'template/.claude/skills/fighting-or-fleeing/SKILL.md',
  'template/.claude/skills/water-and-drowning/SKILL.md',
  'template/.claude/agents/worker.md',
  'template/memory/identity.md',
  'template/memory/goals.md',
  'template/memory/beliefs.md',
  'template/memory/summary.md',
  'template/memory/people/.gitkeep',
  'template/memory/journal/current.md',
  'template/skills/README.md',
];

// Listed above but shipped by later packets: allowed, not yet required.
// Each packet removes the files it ships from this list.
export const pendingFiles: readonly string[] = [];
