import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2]);
const { findContacts } = await import(pathToFileURL(path.join(root, "src", "contacts.mjs")));
assert.deepEqual(findContacts(" ALICE ").map((contact) => contact.id), ["c-1"]);
assert.deepEqual(findContacts("lic").map((contact) => contact.id), ["c-1", "c-3"]);
assert.deepEqual(findContacts(" nobody "), []);
const output = execFileSync(process.execPath, ["src/cli.mjs", "search", " alice "], { cwd: root, encoding: "utf8" });
assert.equal(output, "Alice Nguyen\n");
const empty = execFileSync(process.execPath, ["src/cli.mjs", "search", " nobody "], { cwd: root, encoding: "utf8" });
assert.equal(empty, "No contacts found\n");
process.stdout.write("simple delivery acceptance passed\n");
