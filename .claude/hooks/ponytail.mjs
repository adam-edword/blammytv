// Injects the ponytail skill (default level, full) as session context, standing
// in for the plugin's own hooks, which need CLAUDE_PLUGIN_ROOT and so can't run
// from a repo. Ported from DietrichGebert/ponytail v5.2.0 (MIT, see
// .claude/skills/PONYTAIL-LICENSE).
//
//   node ponytail.mjs session    SessionStart: raw stdout becomes context
//   node ponytail.mjs subagent   SubagentStart: needs the JSON form, and
//                                SessionStart context never reaches subagents
//
// Fails open: a missing skill file must never block a session.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skill = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "ponytail", "SKILL.md");

let body;
try {
  body = readFileSync(skill, "utf8")
    .replace(/^---[\s\S]*?---\s*/, "")
    .split(/\r?\n/)
    .filter((line) => !/^\|\s*\*\*(lite|ultra)\*\*\s*\|/.test(line))
    .join("\n");
} catch {
  process.exit(0);
}

const context = `PONYTAIL MODE ACTIVE, level: full\n\n${body}\n\nWhere this repo's CLAUDE.md differs, it wins (see "Ponytail: on for every session").`;

if (process.argv[2] === "subagent") {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: context } }),
  );
} else {
  process.stdout.write(context);
}
