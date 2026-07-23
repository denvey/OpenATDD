import { sha256 } from "./lib.mjs";

const PLACEHOLDER = /\bTODO\b|\[replace|<replace|TBD/i;
const REQUIRED_ACCEPTANCE_FIELDS = ["Given", "When", "Then", "Evidence"];

function section(markdown, heading) {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function meaningful(value) {
  return Boolean(value?.trim()) && !PLACEHOLDER.test(value);
}

export function acceptanceTemplate(taskId, requirement) {
  return `# Acceptance card: ${taskId}\n\n## Goal\n\n${requirement}\n\n## Suggested user journey\n\n1. TODO: Describe the real user's first action.\n2. TODO: Describe the observable successful outcome.\n\n## Criteria\n\n### AC-01 [AUTO] [BLOCKING] TODO: Name an observable outcome\n- Given: TODO\n- When: TODO\n- Then: TODO\n- Evidence: TODO\n\n## Boundaries\n\n- TODO: State important scope, role, environment, or exclusion.\n`;
}

export function parseAcceptance(markdown) {
  const criteria = [];
  const heading = /^###\s+(AC-\d{2,})\s+\[(AUTO|ASSISTED|MANUAL)\]\s+\[(BLOCKING|NON_BLOCKING)\]\s+(.+)$/gm;
  const matches = [...markdown.matchAll(heading)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const fields = {};
    for (const name of REQUIRED_ACCEPTANCE_FIELDS) {
      const fieldMatch = new RegExp(`^-\\s+${name}:\\s*(.+)$`, "im").exec(body);
      fields[name.toLowerCase()] = fieldMatch?.[1]?.trim() ?? "";
    }
    criteria.push({
      id: match[1],
      classification: match[2],
      blocking: match[3] === "BLOCKING",
      title: match[4].trim(),
      ...fields,
    });
  }

  return {
    goal: section(markdown, "Goal"),
    journey: section(markdown, "Suggested user journey"),
    criteria,
    boundaries: section(markdown, "Boundaries"),
  };
}

export function validateAcceptance(markdown) {
  const parsed = parseAcceptance(markdown);
  const errors = [];
  const warnings = [];

  if (!meaningful(parsed.goal)) errors.push("The Goal section is missing or contains a placeholder.");
  if (!meaningful(parsed.journey)) errors.push("The Suggested user journey section is missing or contains a placeholder.");
  if (!meaningful(parsed.boundaries)) errors.push("The Boundaries section is missing or contains a placeholder.");
  if (parsed.criteria.length === 0) errors.push("At least one acceptance criterion is required.");
  if (parsed.criteria.length > 20) errors.push("Acceptance cards cannot contain more than 20 criteria.");
  if (parsed.criteria.length > 8) warnings.push("The acceptance card exceeds the default eight-criterion lightweight target.");

  const seen = new Set();
  for (const criterion of parsed.criteria) {
    if (seen.has(criterion.id)) errors.push(`Duplicate acceptance ID: ${criterion.id}`);
    seen.add(criterion.id);
    if (!meaningful(criterion.title)) errors.push(`${criterion.id} has a missing or placeholder title.`);
    for (const field of ["given", "when", "then", "evidence"]) {
      if (!meaningful(criterion[field])) errors.push(`${criterion.id} has a missing or placeholder ${field} field.`);
    }
  }

  return { parsed, errors, warnings };
}

export function solutionTemplate(taskId, criteria) {
  const traceRows = criteria
    .map((criterion) => `| ${criterion.id} | TODO: implementation | TODO: verification |`)
    .join("\n");

  return `# Solution card: ${taskId}\n\n## Implementation\n\n- TODO: Describe the smallest credible implementation.\n\n## Impact paths\n\n- \`TODO/path\`\n\n## Acceptance trace\n\n| Acceptance | Implementation | Verification |\n|---|---|---|\n${traceRows}\n\n## Risks\n\n- TODO: Name a material risk and mitigation.\n\n## Deliberate exclusions\n\n- TODO: State what this solution intentionally does not add.\n`;
}

export function parseSolution(markdown) {
  const impactBody = section(markdown, "Impact paths");
  const impactPaths = impactBody
    .split("\n")
    .map((line) => /^\s*-\s+(?:`([^`]+)`|(.+))\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => (match[1] ?? match[2]).trim());

  const traceBody = section(markdown, "Acceptance trace");
  const trace = [];
  for (const line of traceBody.split("\n")) {
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 3 || !/^AC-\d{2,}$/.test(cells[0])) continue;
    trace.push({ acceptanceId: cells[0], implementation: cells[1], verification: cells[2] });
  }

  return {
    implementation: section(markdown, "Implementation"),
    impactPaths,
    trace,
    risks: section(markdown, "Risks"),
    exclusions: section(markdown, "Deliberate exclusions"),
  };
}

export function validateSolution(markdown, acceptanceCriteria) {
  const parsed = parseSolution(markdown);
  const errors = [];
  const warnings = [];

  if (!meaningful(parsed.implementation)) errors.push("The Implementation section is missing or contains a placeholder.");
  if (!meaningful(parsed.risks)) errors.push("The Risks section is missing or contains a placeholder.");
  if (parsed.impactPaths.length === 0) errors.push("At least one concrete impact path is required.");
  for (const impactPath of parsed.impactPaths) {
    if (!meaningful(impactPath)) errors.push("Impact paths cannot contain placeholders.");
    if (impactPath.startsWith("/") || impactPath.includes("..")) {
      errors.push(`Impact path must be project-relative and cannot traverse upward: ${impactPath}`);
    }
  }

  const expected = new Set(acceptanceCriteria.map((criterion) => criterion.id));
  const seen = new Set();
  for (const row of parsed.trace) {
    if (seen.has(row.acceptanceId)) errors.push(`Duplicate solution trace row: ${row.acceptanceId}`);
    seen.add(row.acceptanceId);
    if (!expected.has(row.acceptanceId)) errors.push(`Solution traces unknown criterion: ${row.acceptanceId}`);
    if (!meaningful(row.implementation)) errors.push(`${row.acceptanceId} trace has placeholder implementation.`);
    if (!meaningful(row.verification)) errors.push(`${row.acceptanceId} trace has placeholder verification.`);
  }
  for (const criterion of acceptanceCriteria) {
    if (!seen.has(criterion.id)) errors.push(`Solution does not trace acceptance criterion ${criterion.id}.`);
  }
  if (!meaningful(parsed.exclusions)) warnings.push("Consider stating deliberate exclusions to keep the solution bounded.");

  return { parsed, errors, warnings };
}

export function fingerprint(markdown) {
  return sha256(markdown);
}
