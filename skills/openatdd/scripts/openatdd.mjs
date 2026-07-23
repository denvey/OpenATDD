#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenATDDError, asArray } from "./lib.mjs";
import {
  adoptTask,
  approveAcceptance,
  approveSolution,
  beginImplementation,
  beginPreUat,
  createTask,
  draftSolution,
  initProject,
  loadTask,
  markReady,
  recordAcceptanceResult,
  recordCheck,
  recordIssue,
  reopenAcceptance,
  reopenSolution,
  searchMemory,
  summarizeState,
  validateTask,
  writeReport,
} from "./workflow.mjs";

const HELP = `OpenATDD — acceptance-first AI delivery

Usage:
  openatdd init [--root PATH]
  openatdd new TASK --requirement TEXT [--root PATH]
  openatdd adopt TASK --requirement TEXT [--root PATH]
  openatdd status TASK [--json]
  openatdd approve-acceptance TASK
  openatdd draft-solution TASK
  openatdd approve-solution TASK
  openatdd reopen-acceptance TASK --reason TEXT
  openatdd reopen-solution TASK --reason TEXT
  openatdd begin TASK
  openatdd pre-uat TASK
  openatdd record TASK --acceptance AC-01 --status STATUS [--summary TEXT] --evidence PATH
  openatdd check TASK --name NAME --status STATUS --command COMMAND --evidence PATH
  openatdd issue TASK --acceptance AC-01 --status open --symptom TEXT [--evidence PATH]
  openatdd issue TASK --id ISSUE-001 --status resolved --root-cause TEXT
                  --regression TEST --invariant TEXT --paths PATH --evidence PATH
  openatdd validate TASK [--json]
  openatdd ready TASK
  openatdd report TASK
  openatdd memory QUERY [--limit N] [--json]

Repeat --evidence, --paths, --regression, or --tags to record multiple values.
`;

function parseArguments(argv) {
  const command = argv[0];
  const positionals = [];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? undefined : token.slice(equals + 1);
    if (value === undefined && argv[index + 1] !== undefined && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined) value = true;
    if (options[key] === undefined) options[key] = value;
    else options[key] = [...asArray(options[key]), value];
  }
  return { command, positionals, options };
}

function required(value, name) {
  if (value === undefined || value === true || String(value).trim() === "") {
    throw new OpenATDDError("ARGUMENT_REQUIRED", `Missing required argument: ${name}`);
  }
  return String(value);
}

function taskId(positionals) {
  return required(positionals[0], "TASK");
}

function outputJson(io, value) {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function outputState(io, state) {
  const summary = summarizeState(state);
  io.stdout.write(`${summary.taskId}: ${summary.phase}\n`);
  io.stdout.write(`Acceptance approved: ${summary.acceptanceApproved ? "yes" : "no"}\n`);
  io.stdout.write(`Solution approved: ${summary.solutionApproved ? "yes" : "no"}\n`);
  if (summary.acceptance.length > 0) {
    for (const item of summary.acceptance) {
      io.stdout.write(`- ${item.id} [${item.classification}] ${item.status}\n`);
    }
  }
  if (summary.affectedDependencies.length > 0) {
    io.stdout.write(`Affected dependencies: ${summary.affectedDependencies.map((item) => item.taskId).join(", ")}\n`);
  }
}

async function execute(parsed, io) {
  const { command, positionals, options } = parsed;
  const root = path.resolve(String(options.root ?? io.cwd));
  const json = Boolean(options.json);

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      io.stdout.write(HELP);
      return 0;
    case "init": {
      const files = await initProject(root);
      if (json) outputJson(io, { root: files.root, openatdd: files.openatdd });
      else io.stdout.write(`Initialized OpenATDD at ${files.openatdd}\n`);
      return 0;
    }
    case "new": {
      const result = await createTask(root, taskId(positionals), required(options.requirement, "--requirement"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Created acceptance draft: ${result.files.acceptance}\n`);
      return 0;
    }
    case "adopt": {
      const result = await adoptTask(root, taskId(positionals), required(options.requirement, "--requirement"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Adopted existing acceptance card: ${result.files.acceptance}\n`);
      return 0;
    }
    case "status": {
      const { state } = await loadTask(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(state));
      else outputState(io, state);
      return 0;
    }
    case "approve-acceptance": {
      const result = await approveAcceptance(root, taskId(positionals));
      if (json) outputJson(io, { ...summarizeState(result.state), warnings: result.warnings, unchanged: result.unchanged });
      else {
        io.stdout.write(`${result.unchanged ? "Acceptance remains approved" : "Approved acceptance"}: ${result.state.taskId}\n`);
        for (const warning of result.warnings) io.stdout.write(`Warning: ${warning}\n`);
      }
      return 0;
    }
    case "draft-solution": {
      const result = await draftSolution(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Solution draft ready: ${result.files.solution}\n`);
      return 0;
    }
    case "approve-solution": {
      const result = await approveSolution(root, taskId(positionals));
      const payload = {
        ...summarizeState(result.state),
        warnings: result.warnings,
        unchanged: result.unchanged,
        affectedDependencies: result.affectedDependencies,
      };
      if (json) outputJson(io, payload);
      else {
        io.stdout.write(`${result.unchanged ? "Solution remains approved" : "Approved solution"}: ${result.state.taskId}\n`);
        for (const dependency of result.affectedDependencies) {
          io.stdout.write(`Affected historical task: ${dependency.taskId} (${dependency.acceptanceIds.join(", ")})\n`);
        }
        for (const warning of result.warnings) io.stdout.write(`Warning: ${warning}\n`);
      }
      return 0;
    }
    case "reopen-acceptance": {
      const result = await reopenAcceptance(root, taskId(positionals), required(options.reason, "--reason"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Reopened acceptance: ${result.state.taskId}\n`);
      return 0;
    }
    case "reopen-solution": {
      const result = await reopenSolution(root, taskId(positionals), required(options.reason, "--reason"));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Reopened solution: ${result.state.taskId}\n`);
      return 0;
    }
    case "begin": {
      const result = await beginImplementation(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Implementation started: ${result.state.taskId}\n`);
      return 0;
    }
    case "pre-uat": {
      const result = await beginPreUat(root, taskId(positionals));
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Pre-UAT started: ${result.state.taskId}\n`);
      return 0;
    }
    case "record": {
      const result = await recordAcceptanceResult(root, taskId(positionals), {
        acceptanceId: required(options.acceptance, "--acceptance"),
        status: required(options.status, "--status"),
        summary: options.summary,
        evidence: options.evidence,
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded ${options.acceptance}: ${options.status}\n`);
      return 0;
    }
    case "check": {
      const result = await recordCheck(root, taskId(positionals), {
        name: required(options.name, "--name"),
        status: required(options.status, "--status"),
        command: required(options.command, "--command"),
        summary: options.summary,
        evidence: options.evidence,
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded check ${options.name}: ${options.status}\n`);
      return 0;
    }
    case "issue": {
      const result = await recordIssue(root, taskId(positionals), {
        id: options.id,
        acceptanceId: options.acceptance,
        status: required(options.status, "--status"),
        symptom: options.symptom,
        rootCause: options["root-cause"],
        regression: options.regression,
        invariant: options.invariant,
        paths: options.paths,
        tags: options.tags,
        area: options.area,
        evidence: options.evidence,
      });
      if (json) outputJson(io, summarizeState(result.state));
      else io.stdout.write(`Recorded issue state for ${result.state.taskId}: ${options.status}\n`);
      return 0;
    }
    case "validate": {
      const result = await validateTask(root, taskId(positionals));
      if (json) outputJson(io, result);
      else {
        io.stdout.write(`${result.valid ? "Valid" : "Invalid"}: ${result.state.taskId}\n`);
        for (const error of result.errors) io.stdout.write(`Error: ${error}\n`);
        for (const warning of result.warnings) io.stdout.write(`Warning: ${warning}\n`);
      }
      return result.valid ? 0 : 1;
    }
    case "ready": {
      const result = await markReady(root, taskId(positionals));
      if (json) outputJson(io, { ...summarizeState(result.state), report: result.files.report, notification: result.files.notification });
      else io.stdout.write(`READY_FOR_UAT: ${result.state.taskId}\nReport: ${result.files.report}\nNotification draft: ${result.files.notification}\n`);
      return 0;
    }
    case "report": {
      const result = await writeReport(root, taskId(positionals));
      if (json) outputJson(io, { taskId: result.state.taskId, report: result.files.report });
      else io.stdout.write(`Wrote report: ${result.files.report}\n`);
      return 0;
    }
    case "memory": {
      const query = required(positionals.join(" ") || options.query, "QUERY");
      const rawLimit = Number(options.limit ?? 10);
      const result = await searchMemory(root, query, Number.isFinite(rawLimit) ? rawLimit : 10);
      if (json) outputJson(io, result);
      else if (result.matches.length === 0) io.stdout.write("No relevant project memory found.\n");
      else {
        for (const match of result.matches) {
          io.stdout.write(`${match.id} [score ${match.score}] ${match.title} — ${match.file}\n`);
        }
      }
      return 0;
    }
    default:
      throw new OpenATDDError("UNKNOWN_COMMAND", `Unknown command: ${command}`);
  }
}

function writeError(io, error) {
  const code = error instanceof OpenATDDError ? error.code : "UNEXPECTED_ERROR";
  io.stderr.write(`[${code}] ${error.message}\n`);
  for (const item of error?.details?.errors ?? []) io.stderr.write(`- ${item}\n`);
}

export async function main(argv = process.argv.slice(2), overrides = {}) {
  const io = {
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    cwd: overrides.cwd ?? process.cwd(),
  };
  try {
    return await execute(parseArguments(argv), io);
  } catch (error) {
    writeError(io, error);
    return 1;
  }
}

const direct = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (direct) process.exitCode = await main();
