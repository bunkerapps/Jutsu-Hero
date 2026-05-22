import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../Builds/WebApp",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    headers: {},
    proxy: {
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
  assetsInclude: ["**/*.onnx", "**/*.task"],
});
