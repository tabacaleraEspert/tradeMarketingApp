import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { ObjetivosRubricaCobertura } from "./ObjetivosRubricaCobertura";
import { ObjetivosRubricaComunicacion } from "./ObjetivosRubricaComunicacion";

interface Props {
  isAdmin: boolean;
}

export function ObjetivosRubricasSection({ isAdmin }: Props) {
  return (
    <Card>
      <CardContent className="p-5 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Rúbricas</h3>
            <p className="text-xs text-muted-foreground">Reglas usadas por el motor de KPIs para calificar PDVs.</p>
          </div>
          {!isAdmin && <Badge variant="secondary">Solo lectura</Badge>}
        </div>

        <ObjetivosRubricaCobertura isAdmin={isAdmin} />
        <div className="border-t border-border pt-6">
          <ObjetivosRubricaComunicacion isAdmin={isAdmin} />
        </div>
      </CardContent>
    </Card>
  );
}
