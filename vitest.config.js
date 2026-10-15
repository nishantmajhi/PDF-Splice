import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // PDF_SPLICE_SRC points the suite at another copy of src/ - see
      // tests/against-original.mjs, which runs it against the original code.
      "@": path.resolve(__dirname, process.env.PDF_SPLICE_SRC || "./src"),
      // Test-only: see tests/helpers/workerUrlShim.js for why this exists.
      "pdfjs-dist/build/pdf.worker.min.mjs?url": path.resolve(
        __dirname,
        "tests/helpers/workerUrlShim.js"
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.js"],
    testTimeout: 20000,
  },
});
