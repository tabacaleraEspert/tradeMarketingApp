import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Layout } from "./components/Layout";
import { getCurrentUser } from "./lib/auth";

// Vendor pages — lazy loaded
const RouteList = lazy(() => import("./pages/RouteList").then(m => ({ default: m.RouteList })));
const RouteFocoPage = lazy(() => import("./pages/RouteFocoPage").then(m => ({ default: m.RouteFocoPage })));
const PointOfSaleDetail = lazy(() => import("./pages/PointOfSaleDetail").then(m => ({ default: m.PointOfSaleDetail })));
const CheckIn = lazy(() => import("./pages/CheckIn").then(m => ({ default: m.CheckIn })));
const SurveyForm = lazy(() => import("./pages/SurveyForm").then(m => ({ default: m.SurveyForm })));
const PhotoCapture = lazy(() => import("./pages/PhotoCapture").then(m => ({ default: m.PhotoCapture })));
const NewPointOfSale = lazy(() => import("./pages/NewPointOfSale").then(m => ({ default: m.NewPointOfSale })));
const History = lazy(() => import("./pages/History").then(m => ({ default: m.History })));
const Alerts = lazy(() => import("./pages/Alerts").then(m => ({ default: m.Alerts })));
const Sync = lazy(() => import("./pages/Sync").then(m => ({ default: m.Sync })));
const Profile = lazy(() => import("./pages/Profile").then(m => ({ default: m.Profile })));
const MyRoutesPage = lazy(() => import("./pages/MyRoutesPage").then(m => ({ default: m.MyRoutesPage })));
const MyRouteEditorPage = lazy(() => import("./pages/MyRouteEditorPage").then(m => ({ default: m.MyRouteEditorPage })));
const RouteGeneratorPage = lazy(() => import("./pages/RouteGeneratorPage").then(m => ({ default: m.RouteGeneratorPage })));
const CoverageFormPage = lazy(() => import("./pages/CoverageFormPage").then(m => ({ default: m.CoverageFormPage })));
const POPCensusPage = lazy(() => import("./pages/POPCensusPage").then(m => ({ default: m.POPCensusPage })));
const VisitActionsPage = lazy(() => import("./pages/VisitActionsPage").then(m => ({ default: m.VisitActionsPage })));
const VisitSummaryPage = lazy(() => import("./pages/VisitSummaryPage").then(m => ({ default: m.VisitSummaryPage })));
const MarketNewsStepPage = lazy(() => import("./pages/MarketNewsStepPage").then(m => ({ default: m.MarketNewsStepPage })));
const EndOfDayPage = lazy(() => import("./pages/EndOfDayPage").then(m => ({ default: m.EndOfDayPage })));

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

function LazyFallback() {
  return <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" /></div>;
}

function SuspenseWrap({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LazyFallback />}>{children}</Suspense>;
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
      { path: "pos/:id", element: <SuspenseWrap><PointOfSaleDetail /></SuspenseWrap> },
      { path: "pos/:id/checkin", element: <SuspenseWrap><CheckIn /></SuspenseWrap> },
      { path: "pos/:id/survey", element: <SuspenseWrap><SurveyForm /></SuspenseWrap> },
      { path: "pos/:id/coverage", element: <SuspenseWrap><CoverageFormPage /></SuspenseWrap> },
      { path: "pos/:id/pop", element: <SuspenseWrap><POPCensusPage /></SuspenseWrap> },
      { path: "pos/:id/actions", element: <SuspenseWrap><VisitActionsPage /></SuspenseWrap> },
      { path: "pos/:id/market-news", element: <SuspenseWrap><MarketNewsStepPage /></SuspenseWrap> },
      { path: "pos/:id/photos", element: <SuspenseWrap><PhotoCapture /></SuspenseWrap> },
      { path: "pos/:id/summary", element: <SuspenseWrap><VisitSummaryPage /></SuspenseWrap> },
      { path: "pos/:id/history", element: <SuspenseWrap><History /></SuspenseWrap> },
      { path: "new-pos", element: <SuspenseWrap><NewPointOfSale /></SuspenseWrap> },
      { path: "end-of-day", element: <SuspenseWrap><EndOfDayPage /></SuspenseWrap> },
      { path: "alerts", element: <SuspenseWrap><Alerts /></SuspenseWrap> },
      { path: "sync", element: <SuspenseWrap><Sync /></SuspenseWrap> },
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
