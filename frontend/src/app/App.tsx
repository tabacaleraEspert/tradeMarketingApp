import { RouterProvider } from "react-router";
import { router } from "./routes";
import { Toaster } from "./components/ui/sonner";
import { useArgentinaTheme } from "./lib/useArgentinaTheme";

export default function App() {
  useArgentinaTheme();

  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}
