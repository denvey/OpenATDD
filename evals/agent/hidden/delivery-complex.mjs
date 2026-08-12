import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2]);
const accounts = await import(pathToFileURL(path.join(root, "src", "accounts.mjs")));
const store = await import(pathToFileURL(path.join(root, "src", "store.mjs")));
const audit = await import(pathToFileURL(path.join(root, "src", "audit.mjs")));
for (const name of ["requestDeletion", "restoreAccount", "purgeDue"]) assert.equal(typeof accounts[name], "function", `${name} must be exported`);

const DAY = 24 * 60 * 60 * 1000;
const requestedAt = new Date("2026-01-01T00:00:00.000Z");
store.resetStore();
audit.resetAudit();

try {
  accounts.requestDeletion("acct-2", "acct-1", requestedAt);
} catch {
  // Throwing is allowed, but the contract only requires denial without side effects.
}
assert.equal(store.loadAccount("acct-1").status, "active");
assert.equal(audit.auditEvents().length, 0);

const pending = accounts.requestDeletion("acct-1", "acct-1", requestedAt);
assert.equal(pending.status, "pending-deletion");
assert.equal(new Date(pending.deletionRequestedAt).getTime(), requestedAt.getTime());
assert.equal(new Date(pending.eraseAt).getTime(), requestedAt.getTime() + 30 * DAY);
assert.equal(audit.auditEvents().length, 1);
const repeated = accounts.requestDeletion("acct-1", "acct-1", new Date(requestedAt.getTime() + DAY));
assert.equal(new Date(repeated.eraseAt).getTime(), new Date(pending.eraseAt).getTime());
assert.equal(audit.auditEvents().length, 1);

const restored = accounts.restoreAccount("admin-1", "acct-1", new Date(requestedAt.getTime() + 2 * DAY));
assert.equal(restored.status, "active");
assert.equal(restored.deletionRequestedAt ?? null, null);
assert.equal(restored.eraseAt ?? null, null);
assert.equal(audit.auditEvents().length, 2);

accounts.requestDeletion("admin-1", "acct-1", requestedAt);
assert.equal(audit.auditEvents().length, 3);
assert.deepEqual(accounts.purgeDue(new Date(requestedAt.getTime() + 29 * DAY)), []);
assert.equal(store.loadAccount("acct-1").name, "Alice");
assert.deepEqual(accounts.purgeDue(new Date(requestedAt.getTime() + 30 * DAY)), ["acct-1"]);
const deleted = store.loadAccount("acct-1");
assert.equal(deleted.status, "deleted");
assert.equal(deleted.name ?? null, null);
assert.equal(deleted.email ?? null, null);
assert.equal(deleted.id, "acct-1");
assert.equal(audit.auditEvents().length, 4);
try {
  accounts.restoreAccount("acct-1", "acct-1", new Date(requestedAt.getTime() + 31 * DAY));
} catch {
  // Throwing is allowed, but the contract only requires that deleted data cannot be restored.
}
assert.equal(store.loadAccount("acct-1").status, "deleted");
assert.equal(audit.auditEvents().length, 4);
assert.deepEqual(accounts.purgeDue(new Date(requestedAt.getTime() + 40 * DAY)), []);
assert.equal(audit.auditEvents().length, 4);
process.stdout.write("complex delivery acceptance passed\n");
