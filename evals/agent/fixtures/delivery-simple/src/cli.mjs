import { findContacts } from "./contacts.mjs";

const [, , command, ...parts] = process.argv;
if (command !== "search") {
  process.stderr.write("Usage: node src/cli.mjs search <name>\n");
  process.exitCode = 1;
} else {
  const matches = findContacts(parts.join(" "));
  process.stdout.write(matches.length > 0 ? `${matches.map((contact) => contact.name).join("\n")}\n` : "No contacts found\n");
}
