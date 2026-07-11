import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Anti-copy / hardening: never emit source maps in production (they would
    // hand a would-be copier the original, readable TypeScript source). esbuild
    // minification also mangles local names and strips comments, which is not
    // copy-proof but raises the effort to lift the code.
    sourcemap: false,
    minify: "esbuild",
    // Keep heavy, on-demand vendor chunks OUT of the initial <link
    // rel="modulepreload"> set. Without this, Vite eagerly preloads big vendor
    // bundles on first paint even though they're only needed on specific
    // tabs/pages. They still load on demand via dynamic import() when the user
    // actually opens those features.
    //   - pdf   (~640KB) jsPDF/html2canvas — only on export/print actions
    //   - charts(~440KB) recharts/d3      — only on dashboards & analytics
    //   - ui    (~260KB) full Radix set (dialog, dropdown, popover, command,
    //           drawer, carousel, accordion…) — the login screen and shell need
    //           none of it; deferring it cuts first-paint JS by ~55%.
    //   - icons (~45KB)  lucide/react-icons — the vast majority render deep in
    //           feature pages, not on the login/first screen.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !/(^|\/)(pdf|charts|ui|icons)-[A-Za-z0-9_-]+\.js$/.test(dep)),
    },
    rollupOptions: {
      output: {
        // Group many tiny modules into a few larger bundles. Through the S3
        // deploy proxy each chunk is a separate high-latency round-trip, so
        // dozens of micro-chunks (esp. individual lucide icons) made portal
        // logins slow. Bundling them cuts requests from ~16 to a handful.
        manualChunks(id) {
          // Vite injects a tiny shared "preload helper" module used by every
          // dynamic import() in the app. Rollup would otherwise fold it into
          // whichever vendor chunk happens to depend on it first (it landed in
          // the 618KB `pdf` chunk), which forced the entry chunk to statically
          // import `pdf` on first paint just to get the helper. Isolate it in
          // its own micro-chunk so the entry pulls in ~1KB instead of jsPDF.
          if (id.includes("vite/preload-helper") || id.includes("vite/modulepreload-polyfill")) {
            return "vite";
          }
          if (!id.includes("node_modules")) return undefined;
          // IMPORTANT: never split React core / react-dom / the JSX runtime /
          // scheduler into their own chunk. Doing so caused an init-order bug
          // ("Cannot set properties of undefined (setting 'Children')") because
          // a vendor chunk loaded before React was defined. Leaving them in the
          // main entry chunk guarantees React is available first, and the
          // icons/charts/pdf/ui bundling below still delivers the latency win.
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("react-icons")) return "icons";
          if (
            id.includes("recharts") ||
            id.includes("d3-") ||
            id.includes("victory") ||
            id.includes("internmap")
          )
            return "charts";
          // Rarely-used heavy widgets (command palette, drawer, carousel) go in
          // their own chunk so the core Radix `ui` bundle stays lean when it
          // does load. These only appear on specific surfaces.
          if (
            id.includes("cmdk") ||
            id.includes("vaul") ||
            id.includes("embla")
          )
            return "ui-extra";
          if (id.includes("@radix-ui")) return "ui";
          if (id.includes("@tanstack")) return "query";
          if (
            id.includes("jspdf") ||
            id.includes("html2canvas") ||
            id.includes("dompurify")
          )
            return "pdf";
          // Everything else (including React, react-dom, scheduler, wouter)
          // stays with the main entry so React initializes before consumers.
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
