import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "../components/os/AppShell";
import { fetchSession } from "../api/session";
import { datasetQuery } from "../data/queries";

/** Routes reachable without a session. Server routes under /auth never pass through the router. */
const PUBLIC_PATHS = ["/login"];

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-mono text-[13px] uppercase tracking-[0.22em] text-muted-foreground">404 / NO ROUTE</h1>
        <h2 className="mt-4 text-xl font-medium text-foreground">This surface does not exist</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The screen you're looking for isn't part of CBO OS.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-[3px] bg-primary px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-primary-foreground hover:bg-signal"
          >
            Back to command
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-medium tracking-tight text-foreground">This screen didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something failed locally. Try again, or return to the command surface.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-[3px] bg-primary px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-primary-foreground hover:bg-signal"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-[3px] border border-border bg-card px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-foreground hover:bg-accent"
          >
            Command
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ location }) => {
    if (PUBLIC_PATHS.includes(location.pathname)) return { session: null };
    const session = await fetchSession();
    if (session.mode === "live" && !session.user) {
      throw redirect({ to: "/login", search: { returnTo: location.href, error: undefined } });
    }
    return { session };
  },
  loader: async ({ context }) => {
    // Render live screens with data on first paint; later reads come from the query cache.
    if (context.session?.mode === "live" && context.session.user) {
      await context.queryClient.ensureQueryData(datasetQuery);
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CBO OS — Commercial command interface" },
      {
        name: "description",
        content:
          "CBO OS turns a commercial objective into qualified human conversations and measurable outcomes, run by a local agent.",
      },
      { property: "og:title", content: "CBO OS — Commercial command interface" },
      {
        property: "og:description",
        content: "A local-first digital chief business development officer: endeavours, prospects, pipeline, approvals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;500&family=Marcellus&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (PUBLIC_PATHS.includes(pathname)) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AppShell>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
      </AppShell>
    </QueryClientProvider>
  );
}
