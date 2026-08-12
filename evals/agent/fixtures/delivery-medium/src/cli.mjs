import { filteredOrders } from "./orders.mjs";

const [, , command] = process.argv;
if (command === "list") {
  process.stdout.write(`${JSON.stringify(filteredOrders())}\n`);
} else {
  process.stderr.write("Usage: node src/cli.mjs list\n");
  process.exitCode = 1;
}
