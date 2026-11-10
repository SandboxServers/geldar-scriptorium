// Turns the Claude skills source into the Codex skills directory text. Pure: it reads
// nothing and writes nothing, so the output can be checked before anything is published.

export interface SkillSource {
  // The folder name under template/.claude/skills, which is also the skill name.
  name: string;
  // The full text of that folder's SKILL.md.
  text: string;
}

export interface AgentSkill {
  name: string;
  // The text of .agents/skills/<name>/SKILL.md.
  text: string;
}

export interface AgentSkills {
  // Skills a player or the model may invoke in any mode, sorted by name.
  skills: AgentSkill[];
  // Skills that are only for the birth. Codex has no documented invocation flag, so
  // this list stays out of the shipped directory until the mode-specific layout (C8) is chosen.
  setupOnly: AgentSkill[];
}

const setupName = 'setup';

// Each SKILL.md is `---`, `key: value` lines, `---`, then the body. Returns the lines
// between the fences and the body, which keeps its own newlines. Throws when a fence is missing.
function splitSkill(name: string, text: string): { front: string[]; body: string } {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error(`skill ${name}: frontmatter must open with ---`);
  const close = lines.indexOf('---', 1);
  if (close === -1) throw new Error(`skill ${name}: frontmatter must close with ---`);
  return { front: lines.slice(1, close), body: lines.slice(close + 1).join('\n') };
}

// Returns the raw `key: value` line for one frontmatter key, or throws when it is absent.
function requireLine(name: string, front: string[], key: string): string {
  const line = front.find((l) => {
    const at = l.indexOf(':');
    return at !== -1 && l.slice(0, at).trim() === key;
  });
  if (line === undefined) throw new Error(`skill ${name}: frontmatter needs a ${key}`);
  return line.trim();
}

function convert(source: SkillSource): AgentSkill {
  const { front, body } = splitSkill(source.name, source.text);
  const nameLine = requireLine(source.name, front, 'name');
  const descriptionLine = requireLine(source.name, front, 'description');
  // Only name and description are kept; disable-model-invocation and any other key go.
  const header = ['---', nameLine, descriptionLine, '---'].join('\n');
  return { name: source.name, text: `${header}\n${body}` };
}

// Deterministic: the same sources in any order give the same result.
export function agentSkills(sources: readonly SkillSource[]): AgentSkills {
  const converted = sources
    .map(convert)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    skills: converted.filter((s) => s.name !== setupName),
    setupOnly: converted.filter((s) => s.name === setupName),
  };
}
