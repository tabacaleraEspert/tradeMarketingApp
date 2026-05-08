import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Capacitor: hide native splash screen + configure status bar after React mounts
if ((window as unknown as { Capacitor?: unknown }).Capacitor) {
  import("@capacitor/splash-screen").then(({ SplashScreen }) => {
    SplashScreen.hide();
  }).catch(() => {});
  import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Dark });
    StatusBar.setBackgroundColor({ color: "#000000" });
  }).catch(() => {});
}
