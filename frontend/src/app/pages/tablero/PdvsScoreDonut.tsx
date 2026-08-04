import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { LEVEL_ORDER, levelLabel, levelStyle } from "./pdvs-utils";

interface Props {
  title: string;
  dist: Record<string, number>;
}

export function PdvsScoreDonut({ title, dist }: Props) {
  const total = Object.values(dist).reduce((s, n) => s + n, 0);
  const pieData = LEVEL_ORDER
    .filter((level) => (dist[level] ?? 0) > 0)
    .map((level) => ({ level, name: levelLabel(level), value: dist[level] }));

  return (
    <div className="flex-1 min-w-[220px]">
      <h4 className="text-xs font-semibold text-muted-foreground mb-2">{title}</h4>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-8">Sin datos</p>
      ) : (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-[120px] h-[120px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell key={entry.level} fill={levelStyle(entry.level).hex} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number, name: string) => [`${value}`, name]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-1 text-xs">
            {LEVEL_ORDER.filter((level) => (dist[level] ?? 0) > 0).map((level) => (
              <li key={level} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: levelStyle(level).hex }} />
                <span className="text-foreground">{levelLabel(level)}</span>
                <span className="text-muted-foreground">({dist[level]})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
