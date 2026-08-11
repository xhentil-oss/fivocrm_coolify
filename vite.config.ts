import react from "@vitejs/plugin-react";
import tailwind from "tailwindcss";
import { defineConfig, loadEnv, type Plugin } from "vite";
import path from "path";
import fs from "fs";

/**
 * Bakes the Firebase config into `firebase-messaging-sw.js` at build time.
 *
 * The service worker used to wait for the page to hand it the config over
 * `postMessage`. A service worker is torn down when idle and restarted by the push
 * event itself — with the app closed there is no page to send that message, so
 * `onBackgroundMessage` was never registered and the background notification was
 * silently dropped. That is precisely the case push exists for.
 *
 * Replacing the placeholder at build time makes the worker self-sufficient on a cold
 * start. It runs in dev too (via configureServer) so the behaviour matches.
 */
function firebaseSwConfig(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), "");
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: env.VITE_FIREBASE_APP_ID || "",
  };
  const PLACEHOLDER = /__FIREBASE_CONFIG__/g;
  // Kept OUT of publicDir so the un-substituted template can never be copied to dist.
  const swPath = path.resolve(process.cwd(), "sw", "firebase-messaging-sw.js");
  const render = () => {
    const template = fs.readFileSync(swPath, "utf8");
    const out = template.replace(PLACEHOLDER, JSON.stringify(config));
    // A worker still carrying the placeholder is a ReferenceError on startup, which
    // takes background push down entirely — fail the build instead of shipping it.
    if (out.includes("__FIREBASE" + "_CONFIG__")) {
      throw new Error("firebase-messaging-sw.js: placeholder was not substituted");
    }
    return out;
  };

  return {
    name: "firebase-messaging-sw-config",
    apply: () => true,
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== "/firebase-messaging-sw.js") return next();
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(render());
      });
    },
    generateBundle() {
      if (!config.apiKey) {
        this.warn(
          "VITE_FIREBASE_API_KEY is empty — the messaging service worker will not be able to show background push notifications.",
        );
      }
      this.emitFile({ type: "asset", fileName: "firebase-messaging-sw.js", source: render() });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), firebaseSwConfig(mode)],
  publicDir: "./static",
  base: "/",
  css: {
    postcss: {
      plugins: [tailwind()],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code out of the 1.1MB main chunk so it
        // caches independently and loads in parallel. jspdf/html2canvas/recharts
        // are already route- or call-split via dynamic import, so they stay out
        // of these groups automatically.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return "vendor-react";
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase"))
            return "vendor-firebase";
          if (id.includes("node_modules/@radix-ui")) return "vendor-radix";
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror"))
            return "vendor-editor";
          return undefined;
        },
      },
    },
  },
}));
