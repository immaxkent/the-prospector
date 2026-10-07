/**
 * Whether an address is a generic inbox rather than a named person.
 *
 * This lives here, not beside the rest of the contact rules, because both sides of the app
 * need it: the server scores how reachable a company is, and the prospects list says on the
 * row whether there is a real person behind the address. `src/server` is server-only by
 * build rule, so the shared half is the half that moved.
 */
const GENERIC_LOCAL_PARTS = new Set([
  "hello",
  "info",
  "contact",
  "team",
  "support",
  "enquiries",
  "inquiries",
  "sales",
  "partnerships",
  "bd",
  "hi",
  "admin",
  "office",
]);

export function isGenericInbox(address: string): boolean {
  const local = address.trim().toLowerCase().split("@")[0] ?? "";
  // "hello+bd@" and "info.uk@" are the same inbox wearing a tag.
  const base = local.split(/[+.]/)[0] ?? "";
  return GENERIC_LOCAL_PARTS.has(base);
}
