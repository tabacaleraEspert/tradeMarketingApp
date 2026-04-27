import { useState, useEffect } from "react";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import {
  CheckCircle2,
  XCircle,
  Target,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { visitIndicatorsApi } from "@/lib/api";
import type { VisitIndicators } from "@/lib/api/types";

interface Props {
  visitId: number;
  refreshKey?: number;
}

export function VisitIndicatorsBar({ visitId, refreshKey }: Props) {
  const [data, setData] = useState<VisitIndicators | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    visitIndicatorsApi.get(visitId).then(setData).catch(() => {});
  }, [visitId, refreshKey]);

  if (!data) return null;

  const pct = Math.round(data.completeness * 100);

  return (
    <Card
      className={`overflow-hidden transition-all ${
        data.effective
          ? "border-green-300 bg-green-50/50"
          : "border-amber-300 bg-amber-50/50"
      }`}
    >
      <CardContent className="p-3">
        <div
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Effectiveness icon */}
          <div className={`p-1.5 rounded-full ${data.effective ? "bg-green-100" : "bg-amber-100"}`}>
            {data.effective ? (
              <Target size={18} className="text-green-700" />
            ) : (
              <Target size={18} className="text-amber-700" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${data.effective ? "text-green-800" : "text-amber-800"}`}>
                {data.effective ? "Visita Efectiva" : "Visita No Efectiva"}
              </span>
              <span className="text-xs text-muted-foreground">{pct}%</span>
            </div>
            <Progress value={pct} className="h-1.5 mt-1" />
          </div>

          {expanded ? (
            <ChevronUp size={16} className="text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" />
          )}
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border/50 space-y-1.5">
            {data.steps.map((step) => (
              <div key={step.name} className="flex items-center gap-2">
                {step.done ? (
                  <CheckCircle2 size={14} className="text-green-600 flex-shrink-0" />
                ) : (
                  <XCircle size={14} className={`flex-shrink-0 ${step.mandatory ? "text-red-500" : "text-muted-foreground"}`} />
                )}
                <span className={`text-xs ${step.done ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.label}
                </span>
                {step.mandatory && !step.done && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                    Obligatorio
                  </span>
                )}
              </div>
            ))}

            {data.missing_for_close.length > 0 && (
              <p className="text-[11px] text-red-600 mt-2 pt-2 border-t border-border/50">
                Falta completar para cerrar: {data.missing_for_close.join(", ")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
