const CONTACTS = [
  { id: "c-1", name: "Alice Nguyen" },
  { id: "c-2", name: "Bob Smith" },
  { id: "c-3", name: "Alicia Torres" }
];

export function findContacts(query) {
  return CONTACTS.filter((contact) => contact.name.includes(query));
}
