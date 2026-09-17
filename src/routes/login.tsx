import { createFileRoute } from "@tanstack/react-router";
import { MachineLabel } from "@/components/os/primitives";

const ERRORS: Record<string, string> = {
  not_allowed: "This Google account is not on the access list.",
  email_unverified: "Google has not verified this email address.",
  state_mismatch: "The sign-in request expired or was tampered with. Try again.",
  provider_error: "Google could not complete the sign-in. Try again.",
  access_denied: "Sign-in was cancelled.",
  google_not_configured: "Google sign-in is not configured on this server.",
};

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search["error"] === "string" ? search["error"] : undefined,
    returnTo: typeof search["returnTo"] === "string" ? search["returnTo"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Sign in — Prospector" }] }),
  component: LoginScreen,
});

function LoginScreen() {
  const { error, returnTo } = Route.useSearch();
  const href = `/auth/google${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="display text-[32px] font-medium tracking-tight text-foreground">Prospector</h1>
          <MachineLabel className="mt-2 block">CHIEF BUSINESS OFFICER OPERATING SYSTEM</MachineLabel>
        </div>
        {message && (
          <p role="alert" className="rounded-[3px] border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            {message}
          </p>
        )}
        <a
          href={href}
          className="inline-flex w-full items-center justify-center rounded-[3px] bg-primary px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.1em] text-primary-foreground hover:bg-signal"
        >
          Sign in with Google
        </a>
        <MachineLabel className="block">ACCESS IS LIMITED TO APPROVED ACCOUNTS</MachineLabel>
      </div>
    </main>
  );
}
