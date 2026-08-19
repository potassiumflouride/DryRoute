import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 5173,
    allowedHosts: ["deadly-ready-bison.ngrok-free.app"],
    proxy: {
      "/tiles": {
        target: "http://localhost:8081",
        rewrite: (path) => path.replace(/^\/tiles/, ""),
      },
      "/api": {
        target: "http://localhost:8000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "DryRoute",
        short_name: "DryRoute",
        description: "Rain-avoiding route planner for Singapore",
        theme_color: "#0a0e14",
        background_color: "#0a0e14",
        display: "standalone",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
