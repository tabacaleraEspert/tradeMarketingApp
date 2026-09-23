// Piezas de UI compartidas por las tres pantallas de "Mi gestión TMR".
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  AlertCircle,
  Cigarette,
  ClipboardCheck,
  LayoutTemplate,
  MapPin,
  Package,
  RefreshCw,
  Sparkles,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { formatPct, toneForGoal, type Tone } from "./mi-gestion-utils";

const ICONS: Record<string, LucideIcon> = {
  package: Package,
  "map-pin": MapPin,
  cigarette: Cigarette,
  layout: LayoutTemplate,
  sparkles: Sparkles,
  "clipboard-check": ClipboardCheck,
};

export function DrillIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Icon = ICONS[name] ?? Package;
  return <Icon size={size} className={className} />;
}

export const TONE_CLASSES: Record<Tone, { text: string; bar: string; pill: string; stroke: string }> = {
  green: { text: "text-green-600", bar: "bg-green-500", pill: "bg-green-100 text-green-700", stroke: "#16a34a" },
  yellow: { text: "text-amber-600", bar: "bg-amber-500", pill: "bg-amber-100 text-amber-700", stroke: "#d97706" },
  red: { text: "text-red-600", bar: "bg-red-500", pill: "bg-red-100 text-red-700", stroke: "#dc2626" },
};

export function PctPill({ pct, goal, muted = false }: { pct: number; goal: number; muted?: boolean }) {
  const cls = muted ? "bg-muted text-muted-foreground" : TONE_CLASSES[toneForGoal(pct, goal)].pill;
  return (
    <span className={`inline-flex items-center justify-center min-w-[52px] px-2 py-1 rounded-full text-xs font-bold tabular-nums ${cls}`}>
      {muted ? "—" : `${formatPct(pct)}%`}
    </span>
  );
}

const SCORE_PILL: Record<string, string> = {
  Excelente: "bg-green-100 text-green-700",
  "Muy Bueno": "bg-green-100 text-green-700",
  Bueno: "bg-emerald-50 text-emerald-700",
  Regular: "bg-amber-100 text-amber-700",
  "No cuenta": "bg-red-100 text-red-700",
};

export function ScorePill({ score }: { score: string | null | undefined }) {
  const label = score ?? "Sin relevar";
  const cls = score ? SCORE_PILL[score] ?? "bg-muted text-muted-foreground" : "bg-muted text-muted-foreground";
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{label}</span>;
}

export function MiniBadge({ children }: { children: ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">{children}</span>;
}

interface HeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Ruta a la que vuelve la flecha; si falta, navigate(-1). */
  backTo?: string;
  right?: ReactNode;
  children?: ReactNode;
}

export function MiGestionHeader({ eyebrow, title, subtitle, backTo, right, children }: HeaderProps) {
  const navigate = useNavigate();
  return (
    <div className="bg-black text-white px-3 pt-4 pb-5 rounded-b-2xl">
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => (backTo ? navigate(backTo) : navigate(-1))}
          aria-label="Volver"
          className="w-10 h-10 -ml-1 shrink-0 flex items-center justify-center rounded-full text-white/80 hover:bg-white/10 active:bg-white/20"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0 pt-1">
          <p className="text-[#A48242] text-[10px] font-semibold tracking-widest uppercase">{eyebrow}</p>
          <h1 className="text-lg font-bold leading-tight mt-0.5 truncate">{title}</h1>
          {subtitle && <p className="text-xs text-white/60 mt-0.5 truncate">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0 pt-1">{right}</div>}
      </div>
      {children && <div className="mt-3 pl-1">{children}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i}>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-3 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="p-6 text-center space-y-3">
        <AlertCircle size={32} className="mx-auto text-destructive/70" />
        <p className="text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 min-h-[40px] px-3 text-xs font-semibold text-[#A48242] hover:underline mx-auto"
        >
          <RefreshCw size={12} /> Reintentar
        </button>
      </CardContent>
    </Card>
  );
}

export function OfflineNote() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
      <WifiOff size={14} className="shrink-0" />
      <span>Sin conexión: mostrando los últimos datos guardados.</span>
    </div>
  );
}

export function EmptyCard({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <Card>
      <CardContent className="p-6 text-center space-y-2">
        <div className="mx-auto text-muted-foreground/50 flex justify-center">{icon}</div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {text && <p className="text-xs text-muted-foreground">{text}</p>}
      </CardContent>
    </Card>
  );
}
