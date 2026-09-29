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
    /*
     * On, for back and forward only. Returning to a list you had scrolled down should put
     * you back where you were, and this is what remembers that.
     *
     * Forward navigation does not use it: AppLink passes resetScroll false, which skips
     * this entirely and leaves the scroll to ScrollToTop, after the new route has
     * rendered. Doing it here instead scrolled the page you were leaving.
     */
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    /*
     * The swap itself, softened. A route change replaces most of the screen at once, and
     * a view transition lets the browser hold a snapshot across it so that lands as a
     * cross-fade rather than a cut.
     *
     * It is not what fixes the scroll jump — AppLink and ScrollToTop do that, and they
     * work in browsers that have no view transitions at all. This only has to look good.
     */
    defaultViewTransition: true,
  });

  // Data loaded during SSR is handed to the browser instead of being fetched twice.
  // The root route already provides the QueryClient.
  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: false });

  return router;
};
