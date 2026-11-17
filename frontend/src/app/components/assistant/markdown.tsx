/**
 * Markdown mínimo y seguro para las respuestas de Puchi.
 *
 * Arma nodos de React (nunca dangerouslySetInnerHTML): lo que parezca HTML se
 * muestra como texto. Soporta **negrita**, `código`, viñetas (- / *), títulos
 * (# a ###, como línea en negrita) y tablas con pipes. Lo que no reconoce
 * (p. ej. un ** sin cerrar) queda como texto visible, así que se puede llamar
 * con texto parcial mientras llega el stream.
 */
import type { ReactNode } from "react";

const INLINE = /`([^`\n]+)`|\*\*(?=\S)((?:[^*\n]|\*(?!\*))+?)\*\*/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${i++}`;
    if (m[1] !== undefined) {
      out.push(
        <code key={key} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>
      );
    } else {
      out.push(
        <strong key={key} className="font-semibold">
          {renderInline(m[2], key)}
        </strong>
      );
    }
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (line: string) => line.trim().startsWith("|");
const isTableSeparator = (line: string) => {
  const t = line.trim();
  return t.includes("-") && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t);
};
/** ¿El texto trae una tabla de 4 columnas o más? El panel se ensancha para que entre. */
export function hasWideTable(text: string): boolean {
  const lines = text.split("\n");
  return lines.some(
    (line, i) => i > 0 && isTableSeparator(line) && isTableRow(lines[i - 1]) && splitRow(lines[i - 1]).length >= 4
  );
}

const splitRow = (line: string) => {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
};
const BULLET = /^\s*[-*]\s+(.*)$/;
const HEADING = /^\s*#{1,3}\s+(.*)$/;

export function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key}>
        {paragraph.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderInline(line, `${key}-${i}`)}
          </span>
        ))}
      </p>
    );
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      i++;
      continue;
    }

    // Tabla: fila de encabezado + separador. Sin separador todavía (stream a
    // medio llegar) la fila cae como texto y se convierte sola al completarse.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const head = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const key = `t${blocks.length}`;
      blocks.push(
        <div key={key} className="max-w-full overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-foreground/5">
                {head.map((cell, c) => (
                  <th key={c} className="whitespace-nowrap px-2 py-1.5 font-semibold">
                    {renderInline(cell, `${key}-h${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-t border-border">
                  {head.map((_, c) => (
                    <td key={c} className="whitespace-nowrap px-2 py-1 tabular-nums">
                      {renderInline(row[c] ?? "", `${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const key = `h${blocks.length}`;
      blocks.push(
        <p key={key} className="font-bold">
          {renderInline(heading[1], key)}
        </p>
      );
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      flushParagraph();
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        items.push(BULLET.exec(lines[i])![1]);
        i++;
      }
      const key = `u${blocks.length}`;
      blocks.push(
        <ul key={key} className="list-disc space-y-0.5 pl-5">
          {items.map((item, n) => (
            <li key={n}>{renderInline(item, `${key}-${n}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    paragraph.push(line);
    i++;
  }
  flushParagraph();
  return blocks;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`space-y-2 break-words ${className ?? ""}`}>{renderMarkdown(text)}</div>;
}
