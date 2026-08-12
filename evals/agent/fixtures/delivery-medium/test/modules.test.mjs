import assert from "node:assert/strict";
import test from "node:test";
import { streamCsv } from "../src/csv.mjs";
import { filteredOrders } from "../src/orders.mjs";

test("filters orders with existing query semantics", () => {
  assert.deepEqual(filteredOrders({ status: "paid", minTotal: 20 }).map((order) => order.id), ["o-1"]);
});

test("streams quoted CSV with an existing helper", () => {
  assert.equal(streamCsv([{ customer: "Acme, Inc." }], ["customer"]), "customer\n\"Acme, Inc.\"\n");
});
