import { formatPct, toneFor, toneClasses } from "./resumen-utils";

interface Props {
  percent: number;
  size?: number;
}

export function VariableRing({ percent, size = 96 }: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const colors = toneClasses[toneFor(clamped)];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          stroke={colors.stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-xl font-black ${colors.text}`}>{formatPct(clamped)}%</span>
        <span className="text-[9px] text-muted-foreground">variable</span>
      </div>
    </div>
  );
}
