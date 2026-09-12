import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.outfit.app",
  appName: "Outfit",
  webDir: "dist/public",
  bundledWebRuntime: false,
  backgroundColor: "#172f3f",
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 0 },
    Camera: { presentationStyle: "fullscreen" },
  },
};

export default config;
