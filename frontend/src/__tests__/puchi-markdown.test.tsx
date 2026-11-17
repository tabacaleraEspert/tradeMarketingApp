import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/app/components/assistant/markdown";

describe("Markdown de Puchi", () => {
  it("muestra como texto lo que parece HTML", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> y <script>alert(2)</script> **<b>ojo</b>**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelector("strong")?.textContent).toBe("<b>ojo</b>");
  });

  it("negrita, código, títulos y viñetas", () => {
    const { container } = render(<Markdown text={"## Resumen\nHay **12 PDVs** en `Cuyo`.\n\n- uno\n* dos"} />);
    expect(screen.getByText("Resumen")).toHaveClass("font-bold");
    expect(container.querySelector("strong")?.textContent).toBe("12 PDVs");
    expect(container.querySelector("code")?.textContent).toBe("Cuyo");
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["uno", "dos"]);
    expect(container.textContent).not.toContain("#");
  });

  it("un ** sin cerrar queda literal", () => {
    const { container } = render(<Markdown text={"Cobertura **47,7% en Cuyo"} />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("Cobertura **47,7% en Cuyo");
  });

  it("renderiza una tabla con pipes", () => {
    const { container } = render(
      <Markdown text={"Por zona:\n\n| Zona | Cobertura |\n|---|---:|\n| Cuyo | **47,7%** |\n| AMBA | 81% |\n\nListo."} />
    );
    expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Zona", "Cobertura"]);
    const rows = [...container.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([["Cuyo", "47,7%"], ["AMBA", "81%"]]);
    expect(container.querySelector("td strong")?.textContent).toBe("47,7%");
    expect(container.textContent).not.toContain("---");
    expect(screen.getByText("Listo.")).toBeInTheDocument();
  });

  it("no rompe con una tabla a medio llegar, en ningún corte del stream", () => {
    const full = "| Zona | Cobertura | Visitas |\n|---|---|---|\n| Cuyo | 47,7% | 12 |\n| AMBA | 81";
    for (let cut = 0; cut <= full.length; cut++) {
      expect(() => render(<Markdown text={full.slice(0, cut)} />).unmount()).not.toThrow();
    }
    // Fila incompleta: las celdas que faltan quedan vacías.
    const { container } = render(<Markdown text={full} />);
    const last = [...container.querySelectorAll("tbody tr")].pop()!;
    expect([...last.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["AMBA", "81", ""]);
  });

  it("encabezado de tabla sin separador todavía se ve como texto", () => {
    const { container } = render(<Markdown text={"| Zona | Cobertura |"} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toBe("| Zona | Cobertura |");
  });
});
