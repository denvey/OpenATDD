#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateTask } from "./workflow.mjs";

export { validateAcceptance, validateSolution } from "./contracts.mjs";
export { validateTask } from "./workflow.mjs";

async function run() {
  const [taskId, root = process.cwd()] = process.argv.slice(2);
  if (!taskId) throw new Error("Usage: validate-contract.mjs TASK [PROJECT_ROOT]");
  const result = await validateTask(path.resolve(root), taskId);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

const direct = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (direct) await run();
