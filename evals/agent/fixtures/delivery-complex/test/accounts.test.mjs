import assert from "node:assert/strict";
import test from "node:test";
import { findAccount } from "../src/accounts.mjs";
import { resetStore } from "../src/store.mjs";

test("finds a safe copy of an active account", () => {
  resetStore();
  const account = findAccount("acct-1");
  account.name = "changed";
  assert.equal(findAccount("acct-1").name, "Alice");
});
