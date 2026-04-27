const STEPS = [
  { num: 1, label: "Formularios" },
  { num: 2, label: "Cobertura" },
  { num: 3, label: "POP" },
  { num: 4, label: "Acciones" },
];

interface Props {
  currentStep: number; // 1-4
}

export function VisitStepIndicator({ currentStep }: Props) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center gap-1">
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
              s.num === currentStep
                ? "bg-[#A48242] text-white"
                : s.num < currentStep
                  ? "bg-green-100 text-green-700"
                  : "bg-muted text-muted-foreground"
            }`}
            title={s.label}
          >
            {s.num}
          </span>
          {i < STEPS.length - 1 && <span className="w-3 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}
