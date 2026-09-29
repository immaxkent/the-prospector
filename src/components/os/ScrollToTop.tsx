import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Puts a new route at the top, after it has rendered.
 *
 * The router's own reset did it before the swap, so the page you were leaving visibly
 * jumped to its top and only then became the page you asked for. Measured: 362px down a
 * 4,169px list, click, scroll to 0 two frames before the new route appears — one
 * navigation, two visible steps.
 *
 * A view transition hides that, but only where the browser has one; Firefox does not, so
 * the fix has to be the ordering rather than a cover over it. This runs in an effect,
 * which is after React has committed the new route, so the scroll lands on the content you
 * actually asked for. {@link AppLink} is the other half: it tells the router not to do it
 * first.
 *
 * Back and forward are left alone. Returning to a list you had scrolled down should return
 * you where you were, and the router's scroll restoration does that on a popstate —
 * resetting there would trade one annoyance for a worse one.
 */
export function ScrollToTop() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const first = useRef(true);
  // Set by the browser's own event, which fires before the router renders the route it
  // brings up. Read once and cleared, so it only ever affects that one navigation.
  const popped = useRef(false);

  useEffect(() => {
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    // The first render is a fresh document: the browser has already placed it, and an
    // anchor in the URL is the reader's own request.
    if (first.current) {
      first.current = false;
      return;
    }
    if (popped.current) {
      popped.current = false;
      return;
    }
    if (window.location.hash) return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}
