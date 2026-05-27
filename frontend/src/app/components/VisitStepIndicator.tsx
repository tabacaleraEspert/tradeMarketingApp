import { useNavigate, useParams } from "react-router";

const STEPS = [
  { num: 1, label: "Formularios", path: "survey" },
  { num: 2, label: "Cobertura", path: "coverage" },
  { num: 3, label: "POP", path: "pop" },
  { num: 4, label: "Proveedores", path: "suppliers" },
  { num: 5, label: "Acciones", path: "actions" },
  { num: 6, label: "Novedades", path: "market-news" },
];

interface Props {
  currentStep: number;
}

export function VisitStepIndicator({ currentStep }: Props) {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const goToStep = (step: typeof STEPS[number]) => {
    if (step.num === currentStep) return;
    navigate(`/pos/${id}/${step.path}`);
  };

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => goToStep(s)}
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${
              s.num === currentStep
                ? "bg-[#A48242] text-white"
                : s.num < currentStep
                  ? "bg-green-100 text-green-700 active:bg-green-200"
                  : "bg-muted text-muted-foreground active:bg-muted/80"
            }`}
            title={s.label}
          >
            {s.num}
          </button>
          {i < STEPS.length - 1 && <span className="w-3 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}
