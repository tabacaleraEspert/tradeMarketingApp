import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./app/App.tsx";
import { Splash } from "./app/components/Splash";
import "./styles/index.css";

// Splash de Espert (infraestructura/estandar-splash.md). La sesión se lee sincrónica de
// localStorage, así que la app está lista al montar: el splash solo garantiza los 2 s de intro.
// No se muestra en /login (el login es propio y se llega ahí también por recarga tras sesión
// vencida o logout: repetir la intro molesta), ni en páginas públicas sueltas: /r/:token
// (reporte por mail) y /tablero-tmr (estático). Al abrir la app ("/" o cualquier ruta interna,
// con o sin sesión) y al volver del Command Center por /sso, sí.
const path = window.location.pathname;
const splashAtStart =
  path !== "/login" && !path.startsWith("/r/") && !path.startsWith("/tablero-tmr");

createRoot(document.getElementById("root")!).render(
  splashAtStart ? (
    <Splash ready>
      <App />
    </Splash>
  ) : (
    <App />
  ),
);

// Register PWA service worker with auto-reload on update
registerSW({
  onNeedRefresh() {
    // New version available — reload silently
    window.location.reload();
  },
  onOfflineReady() {
    console.info("[SW] App ready to work offline");
  },
});

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
