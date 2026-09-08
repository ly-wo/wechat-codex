import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

export interface SkillInfo { name: string; description: string; path: string }

function readSkill(path: string): SkillInfo | undefined {
  try {
    const content = readFileSync(join(path, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
    const front = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
    const name = front?.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (!name) return;
    const raw = front?.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
    const description = /^[>|][+-]?$/.test(raw)
      ? (front?.match(/^description:[^\n]*\n((?:[ \t]+[^\n]*\n?)*)/m)?.[1] ?? '').replace(/\s+/g, ' ').trim()
      : raw.replace(/^["']|["']$/g, '');
    return { name, description, path };
  } catch { return; }
}

/** Project skills take precedence; include user, legacy Codex, and cached plugin skills. */
export function scanAllSkills(cwd = process.cwd(), home = homedir(), codexHome = process.env.CODEX_HOME || join(home, '.codex')): SkillInfo[] {
  const roots: Array<[string, number]> = [];
  for (let dir = cwd; ; dir = dirname(dir)) {
    roots.push([join(dir, '.agents', 'skills'), 2], [join(dir, '.codex', 'skills'), 2]);
    if (dirname(dir) === dir) break;
  }
  roots.push([join(home, '.agents', 'skills'), 2], [join(codexHome, 'skills'), 2], [join(codexHome, 'plugins', 'cache'), 6]);
  const skills = new Map<string, SkillInfo>();
  const visited = new Set<string>();
  function visit(path: string, depth: number): void {
    if (depth < 0 || !existsSync(path)) return;
    try {
      const real = realpathSync(path);
      if (visited.has(real) || !statSync(path).isDirectory()) return;
      visited.add(real);
      const skill = readSkill(path);
      if (skill) {
        if (!skills.has(skill.name.toLowerCase())) skills.set(skill.name.toLowerCase(), skill);
        return;
      }
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) visit(join(path, entry.name), depth - 1);
      }
    } catch { /* Ignore unreadable paths and broken links. */ }
  }
  for (const [root, depth] of roots) visit(root, depth);
  return [...skills.values()];
}

export function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
  return skills.find(s => s.name.toLowerCase() === name.toLowerCase() || s.name.toLowerCase().replace(/\s+/g, '-') === name.toLowerCase());
}
