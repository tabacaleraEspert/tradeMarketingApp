import { lazy, Suspense, Component, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Layout } from "./components/Layout";
import { getCurrentUser } from "./lib/auth";
import { VisitFlowProvider } from "@/lib/VisitFlowContext";

// ── Critical trade rep pages — eager loaded for offline support ──
import { PointOfSaleDetail } from "./pages/PointOfSaleDetail";
import { CheckIn } from "./pages/CheckIn";
import { SurveyForm } from "./pages/SurveyForm";
import { CoverageFormPage } from "./pages/CoverageFormPage";
import { POPCensusPage } from "./pages/POPCensusPage";
import { SupplierCensusPage } from "./pages/SupplierCensusPage";
import { VisitActionsPage } from "./pages/VisitActionsPage";
import { MarketNewsStepPage } from "./pages/MarketNewsStepPage";
import { VisitSummaryPage } from "./pages/VisitSummaryPage";
import { EndOfDayPage } from "./pages/EndOfDayPage";
import { PhotoCapture } from "./pages/PhotoCapture";
import { Sync } from "./pages/Sync";

// ── Other vendor pages — lazy loaded ──
const RouteList = lazy(() => import("./pages/RouteList").then(m => ({ default: m.RouteList })));
const RouteFocoPage = lazy(() => import("./pages/RouteFocoPage").then(m => ({ default: m.RouteFocoPage })));
const NewPointOfSale = lazy(() => import("./pages/NewPointOfSale").then(m => ({ default: m.NewPointOfSale })));
const History = lazy(() => import("./pages/History").then(m => ({ default: m.History })));
const Alerts = lazy(() => import("./pages/Alerts").then(m => ({ default: m.Alerts })));
const Profile = lazy(() => import("./pages/Profile").then(m => ({ default: m.Profile })));
const MyRoutesPage = lazy(() => import("./pages/MyRoutesPage").then(m => ({ default: m.MyRoutesPage })));
const MyRouteEditorPage = lazy(() => import("./pages/MyRouteEditorPage").then(m => ({ default: m.MyRouteEditorPage })));
const RouteGeneratorPage = lazy(() => import("./pages/RouteGeneratorPage").then(m => ({ default: m.RouteGeneratorPage })));

// Admin pages — lazy loaded (only admins need these)
const AdminLayout = lazy(() => import("./components/AdminLayout").then(m => ({ default: m.AdminLayout })));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));
const POSManagement = lazy(() => import("./pages/admin/POSManagement").then(m => ({ default: m.POSManagement })));
const RouteManagement = lazy(() => import("./pages/admin/RouteManagement").then(m => ({ default: m.RouteManagement })));
const RouteEditorPage = lazy(() => import("./pages/admin/RouteEditorPage").then(m => ({ default: m.RouteEditorPage })));
const FormBuilder = lazy(() => import("./pages/admin/FormBuilder").then(m => ({ default: m.FormBuilder })));
const FormEditorPage = lazy(() => import("./pages/admin/FormEditorPage").then(m => ({ default: m.FormEditorPage })));
const Reports = lazy(() => import("./pages/admin/Reports").then(m => ({ default: m.Reports })));
const ChannelManagement = lazy(() => import("./pages/admin/ChannelManagement").then(m => ({ default: m.ChannelManagement })));
const ProductManagement = lazy(() => import("./pages/admin/ProductManagement").then(m => ({ default: m.ProductManagement })));
const NotificationManagement = lazy(() => import("./pages/admin/NotificationManagement").then(m => ({ default: m.NotificationManagement })));
const UserManagement = lazy(() => import("./pages/admin/UserManagement").then(m => ({ default: m.UserManagement })));
const TerritoryManagement = lazy(() => import("./pages/admin/TerritoryManagement").then(m => ({ default: m.TerritoryManagement })));
const VisitDataExplorer = lazy(() => import("./pages/admin/VisitDataExplorer").then(m => ({ default: m.VisitDataExplorer })));
const PlantDashboard = lazy(() => import("./pages/plant/PlantDashboard").then(m => ({ default: m.PlantDashboard })));
const AuditTimeline = lazy(() => import("./pages/admin/AuditTimeline").then(m => ({ default: m.AuditTimeline })));
const SupplierConfig = lazy(() => import("./pages/admin/SupplierConfig").then(m => ({ default: m.SupplierConfig })));

function LazyFallback() {
  return <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" /></div>;
}

/** Catches lazy-load failures (offline / chunk missing) and offers retry. */
class LazyErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidMount() {
    // Auto-retry when connection comes back
    window.addEventListener("online", this.handleOnline);
  }

  componentWillUnmount() {
    window.removeEventListener("online", this.handleOnline);
  }

  handleOnline = () => {
    if (this.state.error) this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const isChunkError = this.state.error.message?.includes("dynamically imported module") ||
        this.state.error.message?.includes("Failed to fetch");
      return (
        <div className="flex flex-col items-center justify-center h-64 px-6 text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-xl">!</div>
          <p className="text-sm text-muted-foreground">
            {isChunkError
              ? "No se pudo cargar esta pantalla. Verificá tu conexión."
              : "Ocurrió un error inesperado."}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 bg-[#A48242] text-white rounded-lg text-sm font-semibold"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function SuspenseWrap({ children }: { children: React.ReactNode }) {
  return (
    <LazyErrorBoundary>
      <Suspense fallback={<LazyFallback />}>{children}</Suspense>
    </LazyErrorBoundary>
  );
}

function AdminGuard() {
  const user = getCurrentUser();
  const adminRoles = ["admin", "regional_manager", "territory_manager", "ejecutivo"];
  if (!adminRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <SuspenseWrap><AdminLayout /></SuspenseWrap>;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "route", element: <SuspenseWrap><RouteFocoPage /></SuspenseWrap> },
      { path: "my-routes", element: <SuspenseWrap><MyRoutesPage /></SuspenseWrap> },
      { path: "my-routes/new", element: <SuspenseWrap><RouteEditorPage /></SuspenseWrap> },
      { path: "my-routes/generate", element: <SuspenseWrap><RouteGeneratorPage /></SuspenseWrap> },
      { path: "my-routes/:routeId", element: <SuspenseWrap><MyRouteEditorPage /></SuspenseWrap> },
      { path: "my-routes/:routeId/edit", element: <SuspenseWrap><RouteEditorPage /></SuspenseWrap> },
      { path: "search-pdv", element: <SuspenseWrap><RouteList /></SuspenseWrap> },
      { path: "pos/:id", element: <PointOfSaleDetail /> },
      { path: "pos/:id/checkin", element: <CheckIn /> },
      // Census flow — shared VisitFlowContext pre-loads PDV, products, forms once
      {
        path: "pos/:id",
        Component: VisitFlowProvider,
        children: [
          { path: "survey", element: <SurveyForm /> },
          { path: "coverage", element: <CoverageFormPage /> },
          { path: "pop", element: <POPCensusPage /> },
          { path: "suppliers", element: <SupplierCensusPage /> },
          { path: "actions", element: <VisitActionsPage /> },
          { path: "market-news", element: <MarketNewsStepPage /> },
        ],
      },
      { path: "pos/:id/photos", element: <PhotoCapture /> },
      { path: "pos/:id/summary", element: <VisitSummaryPage /> },
      { path: "pos/:id/history", element: <SuspenseWrap><History /></SuspenseWrap> },
      { path: "new-pos", element: <SuspenseWrap><NewPointOfSale /></SuspenseWrap> },
      { path: "end-of-day", element: <EndOfDayPage /> },
      { path: "alerts", element: <SuspenseWrap><Alerts /></SuspenseWrap> },
      { path: "sync", element: <Sync /> },
      { path: "profile", element: <SuspenseWrap><Profile /></SuspenseWrap> },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
  {
    path: "/admin",
    Component: AdminGuard,
    children: [
      { index: true, element: <SuspenseWrap><AdminDashboard /></SuspenseWrap> },
      { path: "pos-management", element: <SuspenseWrap><POSManagement /></SuspenseWrap> },
      { path: "channels", element: <SuspenseWrap><ChannelManagement /></SuspenseWrap> },
      { path: "supplier-config", element: <SuspenseWrap><SupplierConfig /></SuspenseWrap> },
      { path: "products", element: <SuspenseWrap><ProductManagement /></SuspenseWrap> },
      { path: "routes", element: <SuspenseWrap><RouteManagement /></SuspenseWrap> },
      { path: "routes/:routeId/edit", element: <SuspenseWrap><RouteEditorPage /></SuspenseWrap> },
      { path: "territory", element: <SuspenseWrap><TerritoryManagement /></SuspenseWrap> },
      { path: "forms", element: <SuspenseWrap><FormBuilder /></SuspenseWrap> },
      { path: "notifications", element: <SuspenseWrap><NotificationManagement /></SuspenseWrap> },
      { path: "forms/:formId/edit", element: <SuspenseWrap><FormEditorPage /></SuspenseWrap> },
      { path: "reports", element: <SuspenseWrap><Reports /></SuspenseWrap> },
      { path: "visit-data", element: <SuspenseWrap><VisitDataExplorer /></SuspenseWrap> },
      { path: "users", element: <SuspenseWrap><UserManagement /></SuspenseWrap> },
      { path: "audit", element: <SuspenseWrap><AuditTimeline /></SuspenseWrap> },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
  {
    path: "/plant",
    Component: AdminGuard,
    children: [
      { index: true, element: <SuspenseWrap><PlantDashboard /></SuspenseWrap> },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/login" replace />,
  },
]);
