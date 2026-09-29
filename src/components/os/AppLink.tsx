import { Link } from "@tanstack/react-router";

/**
 * A `Link` that leaves the scroll position alone.
 *
 * The router resets scroll the moment a navigation commits, which is before React has
 * rendered the route you asked for. Measured on the endeavour page: 362px down, click,
 * the page you are leaving jumps to its top, and only two frames later does the new one
 * appear. One navigation, two visible steps.
 *
 * Handing it off to {@link ScrollToTop}, which runs in an effect after the new route has
 * rendered, makes it one step again — in every browser, rather than only in the ones with
 * view transitions to hide it.
 *
 * Back and forward are untouched: they do not go through this component, so the router's
 * scroll restoration still returns you to where you were.
 *
 * Use this for links inside the app. A plain `Link` is not wrong, it just brings the jump
 * back with it.
 */
export const AppLink: typeof Link = (props) => <Link resetScroll={false} {...props} />;
