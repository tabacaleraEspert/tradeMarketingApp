import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.espert.trademarketing",
  appName: "TM Espert",
  webDir: "dist",
  // No server.url — loads from local built files (faster, works offline)
  plugins: {
    SplashScreen: {
      launchAutoHide: false, // We hide it manually after React mounts
      backgroundColor: "#000000",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#000000",
    },
  },
  android: {
    // Allow mixed content (HTTP images from local network during dev)
    allowMixedContent: true,
    // Enable cleartext for dev; production backend is HTTPS
    server: {
      cleartext: true,
    },
  },
};

export default config;
