/** Parses AUTH_ALLOWED_EMAILS. Entries are exact addresses or `@domain.com` for a whole domain. */
export function parseAllowlist(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string, allowlist: readonly string[]) {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return false;
  const domain = address.slice(at);
  return allowlist.some((entry) => entry === address || (entry.startsWith("@") && entry === domain));
}
