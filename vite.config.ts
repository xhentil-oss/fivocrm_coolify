import react from "@vitejs/plugin-react";
import tailwind from "tailwindcss";
import { defineConfig } from "vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
});
