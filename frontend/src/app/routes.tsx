import { createBrowserRouter, Navigate } from "react-router";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { RouteList } from "./pages/RouteList";
import { RouteFocoPage } from "./pages/RouteFocoPage";
import { PointOfSaleDetail } from "./pages/PointOfSaleDetail";
import { CheckIn } from "./pages/CheckIn";
import { SurveyForm } from "./pages/SurveyForm";
import { PhotoCapture } from "./pages/PhotoCapture";
import { NewPointOfSale } from "./pages/NewPointOfSale";
import { History } from "./pages/History";
import { Alerts } from "./pages/Alerts";
import { Sync } from "./pages/Sync";
import { Profile } from "./pages/Profile";
import { Layout } from "./components/Layout";
import { AdminLayout } from "./components/AdminLayout";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { POSManagement } from "./pages/admin/POSManagement";
import { RouteManagement } from "./pages/admin/RouteManagement";
import { RouteEditorPage } from "./pages/admin/RouteEditorPage";
import { FormBuilder } from "./pages/admin/FormBuilder";
import { FormEditorPage } from "./pages/admin/FormEditorPage";
import { Reports } from "./pages/admin/Reports";
import { ChannelManagement } from "./pages/admin/ChannelManagement";
import { ProductManagement } from "./pages/admin/ProductManagement";
import { NotificationManagement } from "./pages/admin/NotificationManagement";
import { UserManagement } from "./pages/admin/UserManagement";
import { TerritoryManagement } from "./pages/admin/TerritoryManagement";
// MandatoryActivityManagement merged into FormBuilder as "Plantillas de Visita"
import { PlantLayout } from "./pages/plant/PlantLayout";
import { PlantDashboard } from "./pages/plant/PlantDashboard";
import { MyRoutesPage } from "./pages/MyRoutesPage";
import { MyRouteEditorPage } from "./pages/MyRouteEditorPage";
import { RouteGeneratorPage } from "./pages/RouteGeneratorPage";
import { CoverageFormPage } from "./pages/CoverageFormPage";
import { POPCensusPage } from "./pages/POPCensusPage";
import { VisitActionsPage } from "./pages/VisitActionsPage";
import { VisitSummaryPage } from "./pages/VisitSummaryPage";
import { MarketNewsStepPage } from "./pages/MarketNewsStepPage";
import { EndOfDayPage } from "./pages/EndOfDayPage";
import { getCurrentUser } from "./lib/auth";

function AdminGuard() {
  const user = getCurrentUser();
  const adminRoles = ["admin", "regional_manager", "territory_manager", "ejecutivo"];
  if (!adminRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <AdminLayout />;
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
      { path: "route", Component: RouteFocoPage },
      { path: "my-routes", Component: MyRoutesPage },
      { path: "my-routes/new", Component: RouteEditorPage },
      { path: "my-routes/generate", Component: RouteGeneratorPage },
      { path: "my-routes/:routeId", Component: MyRouteEditorPage },
      { path: "my-routes/:routeId/edit", Component: RouteEditorPage },
      { path: "search-pdv", Component: RouteList },
      { path: "pos/:id", Component: PointOfSaleDetail },
      { path: "pos/:id/checkin", Component: CheckIn },
      { path: "pos/:id/survey", Component: SurveyForm },
      { path: "pos/:id/coverage", Component: CoverageFormPage },
      { path: "pos/:id/pop", Component: POPCensusPage },
      { path: "pos/:id/actions", Component: VisitActionsPage },
      { path: "pos/:id/market-news", Component: MarketNewsStepPage },
      { path: "pos/:id/photos", Component: PhotoCapture },
      { path: "pos/:id/summary", Component: VisitSummaryPage },
      { path: "pos/:id/history", Component: History },
      { path: "new-pos", Component: NewPointOfSale },
      { path: "end-of-day", Component: EndOfDayPage },
      { path: "alerts", Component: Alerts },
      { path: "sync", Component: Sync },
      { path: "profile", Component: Profile },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
  {
    path: "/admin",
    Component: AdminGuard,
    children: [
      { index: true, Component: AdminDashboard },
      { path: "pos-management", Component: POSManagement },
      { path: "channels", Component: ChannelManagement },
      { path: "products", Component: ProductManagement },
      { path: "routes", Component: RouteManagement },
      { path: "routes/:routeId/edit", Component: RouteEditorPage },
      { path: "territory", Component: TerritoryManagement },
      { path: "forms", Component: FormBuilder },
      { path: "notifications", Component: NotificationManagement },
      { path: "forms/:formId/edit", Component: FormEditorPage },
      { path: "reports", Component: Reports },
      { path: "users", Component: UserManagement },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
  {
    path: "/plant",
    Component: AdminGuard,
    children: [
      { index: true, Component: PlantDashboard },
      { path: "*", element: <Navigate to="/login" replace /> },
    ],
  },
  {
    path: "*",
    element: <Navigate to="/login" replace />,
  },
]);