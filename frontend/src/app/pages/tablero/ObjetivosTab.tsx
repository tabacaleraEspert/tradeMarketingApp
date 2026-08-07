import { useMemo } from "react";
import { Badge } from "../../components/ui/badge";
import { getCurrentUser } from "../../lib/auth";
import { ObjetivosMetasSection } from "./ObjetivosMetasSection";
import { ObjetivosRubricasSection } from "./ObjetivosRubricasSection";
import { ObjetivosResueltaSection } from "./ObjetivosResueltaSection";

// Pestaña visible para todos los roles del tablero; solo admin ve controles de
// edición (config de KPIs paga compensación). territory_manager/supervisor y
// el resto ven todo en modo lectura.
export function ObjetivosTab() {
  const currentUser = useMemo(() => getCurrentUser(), []);
  const isAdmin = currentUser.role === "admin";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">
          Configuración de KPIs del tablero: metas, pesos, rúbricas de scoring y config resuelta por usuario.
        </p>
        {!isAdmin && <Badge variant="secondary">Solo lectura</Badge>}
      </div>

      <ObjetivosMetasSection isAdmin={isAdmin} />
      <ObjetivosRubricasSection isAdmin={isAdmin} />
      <ObjetivosResueltaSection />
    </div>
  );
}
