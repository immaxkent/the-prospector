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
     * On. Back and forward return you to where you were on the page you are going back to,
     * and forward navigation starts at the top.
     *
     * It also puts the browser's own restoration into manual mode, which matters: with
     * this off, the browser and the router both tried to place the page.
     *
     * The router does this on its onRendered hook, which is the frame the new route
     * appears in. Doing it from an effect instead — on a location change, before the route
     * has rendered — was measured to be three frames *earlier*, on the page you are
     * leaving, which is the thing that looked wrong in the first place.
     */
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    /*
     * The swap itself, softened. A route change replaces most of the screen at once, and
     * a view transition lets the browser hold a snapshot across it so that lands as a
     * cross-fade rather than a cut.
     *
     * It also covers the last frame or two of the swap, where the new route is placed at
     * the top before it is painted. Browsers without view transitions — Firefox — still
     * see that; measured at two to three frames once the session stopped being fetched on
     * every click, against seven before it.
     */
    defaultViewTransition: true,
  });

  // Data loaded during SSR is handed to the browser instead of being fetched twice.
  // The root route already provides the QueryClient.
  setupRouterSsrQueryIntegration({ router, queryClient, wrapQueryClient: false });

  return router;
};
