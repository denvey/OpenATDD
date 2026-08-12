const INITIAL = [
  { id: "acct-1", name: "Alice", email: "alice@example.test", status: "active", deletionRequestedAt: null, eraseAt: null },
  { id: "acct-2", name: "Bob", email: "bob@example.test", status: "active", deletionRequestedAt: null, eraseAt: null }
];

const accounts = new Map();

export function resetStore() {
  accounts.clear();
  for (const account of INITIAL) accounts.set(account.id, structuredClone(account));
}

export function loadAccount(id) {
  const account = accounts.get(id);
  return account ? structuredClone(account) : null;
}

export function saveAccount(account) {
  accounts.set(account.id, structuredClone(account));
  return loadAccount(account.id);
}

export function allAccounts() {
  return [...accounts.values()].map(structuredClone);
}

resetStore();
