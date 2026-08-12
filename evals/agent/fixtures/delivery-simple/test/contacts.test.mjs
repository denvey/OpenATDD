import assert from "node:assert/strict";
import test from "node:test";
import { findContacts } from "../src/contacts.mjs";

test("finds an exact name fragment", () => {
  assert.deepEqual(findContacts("Alice").map((contact) => contact.id), ["c-1"]);
});
