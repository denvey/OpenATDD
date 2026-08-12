const events = [];

export function recordAudit(event) {
  events.push(structuredClone(event));
}

export function auditEvents() {
  return events.map(structuredClone);
}

export function resetAudit() {
  events.length = 0;
}
