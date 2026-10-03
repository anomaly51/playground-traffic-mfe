import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  define: {
    __API_BASE_URL__: JSON.stringify("http://localhost:3000"),
    __EVENTS_BASE_URL__: JSON.stringify("http://localhost:3003"),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
