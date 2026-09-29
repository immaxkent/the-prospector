import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true } },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    /*
     * Without this, a navigation reads as a flash on the page you are leaving: scroll
     * snaps to the top of the *old* content, and only then does the new route render.
     * Measured on the endeavour page — 362px down an 819px list, click, scroll to 0, then
     * the document grows to 5,812px. Two visible steps for one navigation.
     *
     * A view transition lets the browser hold a snapshot across the swap, so the reflow
     * happens behind a cross-fade instead of in front of one. Browsers without it ignore
     * the flag and behave exactly as before.
     */
    defaultViewTransition: true,
  });

  // Data loaded during SSR is handed to the browser instead of being fetched twice.
  // The root route already provides the QueryClient.
  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: false });

  return router;
};
