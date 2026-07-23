#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderTaskReport, writeReport } from "./workflow.mjs";

export { renderTaskReport, writeReport };

async function run() {
  const [taskId, root = process.cwd()] = process.argv.slice(2);
  if (!taskId) throw new Error("Usage: render-report.mjs TASK [PROJECT_ROOT]");
  const result = await writeReport(path.resolve(root), taskId);
  process.stdout.write(`${result.files.report}\n`);
}

const direct = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (direct) await run();
