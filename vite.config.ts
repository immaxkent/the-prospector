// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * The TanStack devtools "Go to Source" transform stamps `data-tsd-source` on
 * every JSX element. On React Three Fiber elements that attribute reaches
 * applyProps and crashes ("Cannot set data-tsd-source"). Strip it from the
 * 3D scene modules after the devtools transform has run.
 */
function stripTsdSourceFromR3F() {
  return {
    name: "strip-tsd-source-from-r3f",
    enforce: "post" as const,
    transform(code: string, id: string) {
      if (!id.startsWith("/") || !/\/src\/components\/world\/.+\.tsx($|\?)/.test(id)) return null;
      if (!code.includes("data-tsd-source")) return null;
      const next = code.replace(/ data-tsd-source="[^"]*"/g, "");
      return next === code ? null : { code: next, map: null };
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  // Self-hosted on a Node box. Inside a Lovable build LOVABLE_NITRO_PRESET still
  // pins Cloudflare, so the Lovable preview is unaffected.
  nitro: { preset: process.env.NITRO_PRESET ?? "node-server" },
  vite: {
    plugins: [stripTsdSourceFromR3F()],
  },
});
