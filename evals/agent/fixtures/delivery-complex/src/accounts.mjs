import { loadAccount } from "./store.mjs";

export function findAccount(id) {
  return loadAccount(id);
}
