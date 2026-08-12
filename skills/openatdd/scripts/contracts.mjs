import { inferHumanLanguage, sha256 } from "./lib.mjs";

const PLACEHOLDER = /\bTODO\b|\[replace|<replace|TBD|待填写/i;
const REQUIRED_ACCEPTANCE_FIELDS = Object.freeze({
  given: ["Given", "前提"],
  when: ["When", "操作"],
  then: ["Then", "结果"],
  evidence: ["Evidence", "证据"],
});
const REQUIREMENT_SECTIONS = new Set(["delivery", "acceptance", "solution", "details"]);

function escaped(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function section(markdown, heading) {
  const headings = Array.isArray(heading) ? heading : [heading];
  const pattern = new RegExp(`^##\\s+(?:${headings.map(escaped).join("|")})\\s*$`, "im");
  const match = pattern.exec(markdown);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function markedSection(markdown, name, fallbackHeading = undefined) {
  const startMarker = `<!-- openatdd:${name} -->`;
  const endMarker = `<!-- /openatdd:${name} -->`;
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start !== -1 && end > start) {
    return markdown.slice(start + startMarker.length, end).replace(/^\s*##\s+.*$/m, "").trim();
  }
  return fallbackHeading ? section(markdown, fallbackHeading) : "";
}

function sectionStart(markdown, name, headings) {
  const marker = markdown.indexOf(`<!-- openatdd:${name} -->`);
  if (marker !== -1) return marker;
  const aliases = Array.isArray(headings) ? headings : [headings];
  const pattern = new RegExp(`^##\\s+(?:${aliases.map(escaped).join("|")})\\s*$`, "im");
  return pattern.exec(markdown)?.index ?? -1;
}

function meaningful(value) {
  return Boolean(value?.trim()) && !PLACEHOLDER.test(value);
}

export function acceptanceTemplate(taskId, requirement) {
  if (inferHumanLanguage(requirement) === "zh-CN") {
    return `# 验收卡：${taskId}\n\n## 目标\n\n${requirement}\n\n## 建议用户旅程\n\n1. 待填写：描述真实用户的第一个动作。\n2. 待填写：描述可观察的成功结果。\n\n## 验收标准\n\n### AC-01 [AUTO] [BLOCKING] 待填写：命名一个可观察结果\n- 前提：待填写\n- 操作：待填写\n- 结果：待填写\n- 证据：待填写\n\n## 边界\n\n- 待填写：说明重要范围、角色、环境或排除项。\n`;
  }
  return `# Acceptance card: ${taskId}\n\n## Goal\n\n${requirement}\n\n## Suggested user journey\n\n1. TODO: Describe the real user's first action.\n2. TODO: Describe the observable successful outcome.\n\n## Criteria\n\n### AC-01 [AUTO] [BLOCKING] TODO: Name an observable outcome\n- Given: TODO\n- When: TODO\n- Then: TODO\n- Evidence: TODO\n\n## Boundaries\n\n- TODO: State important scope, role, environment, or exclusion.\n`;
}

function sectionMarkers(name) {
  if (!REQUIREMENT_SECTIONS.has(name)) throw new Error(`Unknown requirement section: ${name}`);
  return {
    start: `<!-- openatdd:${name} -->`,
    end: `<!-- /openatdd:${name} -->`,
  };
}

export function extractRequirementSection(markdown, name) {
  const markers = sectionMarkers(name);
  const start = markdown.indexOf(markers.start);
  const end = markdown.indexOf(markers.end, start + markers.start.length);
  if (start === -1 || end === -1) return "";
  return markdown.slice(start + markers.start.length, end).trim();
}

export function replaceRequirementSection(markdown, name, content) {
  const markers = sectionMarkers(name);
  const start = markdown.indexOf(markers.start);
  const end = markdown.indexOf(markers.end, start + markers.start.length);
  if (start === -1 || end === -1) throw new Error(`Requirement document is missing the ${name} markers.`);
  const before = markdown.slice(0, start + markers.start.length);
  const after = markdown.slice(end);
  return `${before}\n${String(content ?? "").trim()}\n${after}`;
}

function initialDelivery(taskId, language) {
  if (language === "zh-CN") {
    return `## 状态与合并建议\n\n- 状态：验收契约待完善\n- 合并建议：暂不可合并\n\n## 交付结论\n\n需求已创建，等待完成验收与方案门禁。\n\n## 人工验收入口\n\n尚未进入交付验收。完成实现和自动验证后，本节会显示完整操作链路。\n\n## Reviewer 重点\n\n- 先确认验收标准是否准确覆盖真实用户结果。\n\n## 实际变更与验收摘要\n\n- 尚未开始实现。`;
  }
  return `## Status and merge recommendation\n\n- Status: acceptance contract pending\n- Merge recommendation: do not merge yet\n\n## Delivery conclusion\n\nThe requirement exists and is waiting for its acceptance and solution gates.\n\n## Human acceptance entry\n\nDelivery acceptance has not started. This section will contain the complete operation chain after implementation and automatic verification.\n\n## Reviewer focus\n\n- Confirm that the acceptance criteria cover the real user outcome.\n\n## Actual changes and acceptance summary\n\n- Implementation has not started.`;
}

export function requirementDocument(taskId, requirement) {
  const language = inferHumanLanguage(requirement);
  const title = language === "zh-CN" ? `# 需求交付：${taskId}` : `# Requirement delivery: ${taskId}`;
  const details = language === "zh-CN"
    ? `## 追溯说明\n\n此处保留验证、修复和运行历史的摘要；机器原始产物存放在 Git 私有运行目录。`
    : `## Traceability notes\n\nThis area keeps verification, repair, and runtime-history summaries. Raw machine artifacts live in Git-private runtime storage.`;
  return `${title}\n\n<!-- openatdd:delivery -->\n${initialDelivery(taskId, language)}\n<!-- /openatdd:delivery -->\n\n<!-- openatdd:acceptance -->\n${acceptanceTemplate(taskId, requirement).trim()}\n<!-- /openatdd:acceptance -->\n\n<!-- openatdd:solution -->\n<!-- /openatdd:solution -->\n\n<!-- openatdd:details -->\n${details}\n<!-- /openatdd:details -->\n`;
}

export function acceptanceContract(markdown) {
  return extractRequirementSection(markdown, "acceptance") || markdown;
}

export function solutionContract(markdown) {
  return extractRequirementSection(markdown, "solution") || markdown;
}

export function acceptanceFingerprint(markdown) {
  return fingerprint(acceptanceContract(markdown));
}

export function solutionFingerprint(markdown) {
  return fingerprint(solutionContract(markdown));
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
    for (const [name, aliases] of Object.entries(REQUIRED_ACCEPTANCE_FIELDS)) {
      const fieldMatch = new RegExp(`^-\\s+(?:${aliases.map(escaped).join("|")})[:：]\\s*(.+)$`, "im").exec(body);
      fields[name] = fieldMatch?.[1]?.trim() ?? "";
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
    goal: section(markdown, ["Goal", "目标"]),
    journey: section(markdown, ["Suggested user journey", "建议用户旅程"]),
    criteria,
    boundaries: section(markdown, ["Boundaries", "边界"]),
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
  const language = inferHumanLanguage(criteria.map((criterion) => [criterion.title, criterion.given, criterion.when, criterion.then]));
  const traceRows = criteria
    .map((criterion) => language === "zh-CN"
      ? `| ${criterion.id} | 待填写：实现 | 待填写：验证 |`
      : `| ${criterion.id} | TODO: implementation | TODO: verification |`)
    .join("\n");

  if (language === "zh-CN") {
    return `# 方案卡：${taskId}\n\n<!-- openatdd:recommendation -->\n## 推荐方案\n\n待填写：用几句话说明最小可信方案。\n<!-- /openatdd:recommendation -->\n\n<!-- openatdd:rationale -->\n## 为什么适合当前项目\n\n- 待填写：说明如何复用项目架构并保持简洁。\n<!-- /openatdd:rationale -->\n\n<!-- openatdd:changes -->\n## 主要改动\n\n- 待填写：列出人需要了解的少量关键变化。\n<!-- /openatdd:changes -->\n\n<!-- openatdd:risks -->\n## 风险\n\n- 待填写：说明重要风险及缓解方式。\n<!-- /openatdd:risks -->\n\n<!-- openatdd:exclusions -->\n## 明确排除\n\n- 待填写：说明方案明确不增加什么。\n<!-- /openatdd:exclusions -->\n\n## 实现细节\n\n- 待填写：提供按需查看的简洁技术细节。\n\n## 影响路径\n\n- \`待填写/路径\`\n\n## 验收追踪\n\n| 验收 | 实现 | 验证 |\n|---|---|---|\n${traceRows}\n`;
  }
  return `# Solution card: ${taskId}\n\n<!-- openatdd:recommendation -->\n## Recommendation\n\nTODO: State the smallest credible approach in a few sentences.\n<!-- /openatdd:recommendation -->\n\n<!-- openatdd:rationale -->\n## Why this fits\n\n- TODO: Explain why this reuses the project's architecture and stays simple.\n<!-- /openatdd:rationale -->\n\n<!-- openatdd:changes -->\n## Main changes\n\n- TODO: Name the few material changes a person should understand.\n<!-- /openatdd:changes -->\n\n<!-- openatdd:risks -->\n## Risks\n\n- TODO: Name a material risk and mitigation.\n<!-- /openatdd:risks -->\n\n<!-- openatdd:exclusions -->\n## Deliberate exclusions\n\n- TODO: State what this solution intentionally does not add.\n<!-- /openatdd:exclusions -->\n\n## Implementation\n\n- TODO: Describe the concise technical detail available on demand.\n\n## Impact paths\n\n- \`TODO/path\`\n\n## Acceptance trace\n\n| Acceptance | Implementation | Verification |\n|---|---|---|\n${traceRows}\n`;
}

export function parseSolution(markdown) {
  const impactBody = section(markdown, ["Impact paths", "影响路径"]);
  const impactPaths = impactBody
    .split("\n")
    .map((line) => /^\s*-\s+(?:`([^`]+)`|(.+))\s*$/.exec(line))
    .filter(Boolean)
    .map((match) => (match[1] ?? match[2]).trim());

  const traceBody = section(markdown, ["Acceptance trace", "验收追踪"]);
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
    recommendation: markedSection(markdown, "recommendation", "Recommendation"),
    rationale: markedSection(markdown, "rationale", "Why this fits"),
    changes: markedSection(markdown, "changes", "Main changes"),
    implementation: section(markdown, ["Implementation", "实现细节"]),
    impactPaths,
    trace,
    risks: markedSection(markdown, "risks", ["Risks", "风险"]),
    exclusions: markedSection(markdown, "exclusions", ["Deliberate exclusions", "明确排除"]),
  };
}

export function validateSolution(markdown, acceptanceCriteria, options = {}) {
  const parsed = parseSolution(markdown);
  const errors = [];
  const warnings = [];

  if (options.progressive) {
    if (!meaningful(parsed.recommendation)) errors.push("The recommendation summary is missing or contains a placeholder.");
    if (!meaningful(parsed.rationale)) errors.push("The project-fit rationale is missing or contains a placeholder.");
    if (!meaningful(parsed.changes)) errors.push("The main-changes summary is missing or contains a placeholder.");
    if (!meaningful(parsed.risks)) errors.push("The material-risks summary is missing or contains a placeholder.");
    if (!meaningful(parsed.exclusions)) errors.push("The deliberate-exclusions summary is missing or contains a placeholder.");
    const orderedSections = [
      ["recommendation", ["Recommendation", "推荐方案"]],
      ["rationale", ["Why this fits", "为什么适合当前项目"]],
      ["changes", ["Main changes", "主要改动"]],
      ["risks", ["Risks", "风险"]],
      ["exclusions", ["Deliberate exclusions", "明确排除"]],
      ["implementation", ["Implementation", "实现细节"]],
      ["impact", ["Impact paths", "影响路径"]],
      ["trace", ["Acceptance trace", "验收追踪"]],
    ].map(([name, headings]) => ({ name, position: sectionStart(markdown, name, headings) }));
    if (orderedSections.every((item) => item.position !== -1)) {
      for (let index = 1; index < orderedSections.length; index += 1) {
        if (orderedSections[index].position < orderedSections[index - 1].position) {
          errors.push("The progressive solution must present recommendation, rationale, changes, risks, and exclusions before optional technical details.");
          break;
        }
      }
    }
  }
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
  if (!meaningful(parsed.exclusions) && !options.progressive) warnings.push("Consider stating deliberate exclusions to keep the solution bounded.");

  return { parsed, errors, warnings };
}

export function fingerprint(markdown) {
  return sha256(markdown);
}
