import { createBrowserRouter } from "react-router";
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
      { path: "search-pdv", Component: RouteList },
      { path: "pos/:id", Component: PointOfSaleDetail },
      { path: "pos/:id/checkin", Component: CheckIn },
      { path: "pos/:id/survey", Component: SurveyForm },
      { path: "pos/:id/photos", Component: PhotoCapture },
      { path: "pos/:id/history", Component: History },
      { path: "new-pos", Component: NewPointOfSale },
      { path: "alerts", Component: Alerts },
      { path: "sync", Component: Sync },
      { path: "profile", Component: Profile },
    ],
  },
  {
    path: "/admin",
    Component: AdminLayout,
    children: [
      { index: true, Component: AdminDashboard },
      { path: "pos-management", Component: POSManagement },
      { path: "routes", Component: RouteManagement },
      { path: "routes/:routeId/edit", Component: RouteEditorPage },
      { path: "forms", Component: FormBuilder },
      { path: "forms/:formId/edit", Component: FormEditorPage },
      { path: "reports", Component: Reports },
    ],
  },
]);