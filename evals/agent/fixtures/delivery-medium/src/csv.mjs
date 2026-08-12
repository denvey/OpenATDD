function escapeCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function streamCsv(rows, fields) {
  const lines = [fields.join(",")];
  for (const row of rows) lines.push(fields.map((field) => escapeCell(row[field])).join(","));
  return `${lines.join("\n")}\n`;
}
