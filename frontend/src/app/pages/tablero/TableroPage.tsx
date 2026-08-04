import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { kpiApi } from "@/lib/api";
import { ResumenTab } from "./ResumenTab";
import { RutasTab } from "./RutasTab";
import { PdvsTab } from "./PdvsTab";

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

interface TmrOption {
  userId: number;
  name: string | null;
}

export function TableroPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tmrs, setTmrs] = useState<TmrOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  useEffect(() => {
    kpiApi.variable({ year, month })
      .then((rows) => setTmrs(rows.map((r) => ({ userId: r.userId, name: r.name }))))
      .catch(() => setTmrs([]));
  }, [year, month]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Tablero</h1>
          <p className="text-muted-foreground text-sm">Seguimiento de KPIs y variable de TM Reps</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTH_NAMES.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* TMR selector */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedUserId(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            selectedUserId === null
              ? "bg-espert-gold text-white"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          Todos
        </button>
        {tmrs.map((t) => (
          <button
            key={t.userId}
            onClick={() => setSelectedUserId(t.userId)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              selectedUserId === t.userId
                ? "bg-espert-gold text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {t.name ?? `Usuario #${t.userId}`}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="rutas">Rutas</TabsTrigger>
          <TabsTrigger value="pdvs">PDVs</TabsTrigger>
        </TabsList>
        <TabsContent value="resumen">
          <ResumenTab year={year} month={month} userId={selectedUserId} onSelectUser={setSelectedUserId} />
        </TabsContent>
        <TabsContent value="rutas">
          <RutasTab year={year} month={month} userId={selectedUserId} />
        </TabsContent>
        <TabsContent value="pdvs">
          <PdvsTab year={year} month={month} userId={selectedUserId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
