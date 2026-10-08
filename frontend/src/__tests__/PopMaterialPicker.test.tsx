import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PopMaterialPicker } from "@/app/components/PopMaterialPicker";
import type { PopMaterial } from "@/lib/api/types";

const mat = (Code: string, Description: string, Line: string, Type: string): PopMaterial => ({
  Code, Description, Line, Type, Year: 2026, PhotoUrl: null, Stock: 3, IsActive: true,
});
const CATALOG = [
  mat("MKT-000211", "VLANK CELULOSA - COLGANTE", "VLANK CELULOSA", "COLGANTE"),
  mat("MKT-000210", "MILENIO - CIGARRERA AEREA", "MILENIO", "CIGARRERA AEREA"),
];

describe("PopMaterialPicker", () => {
  it("filtra por búsqueda y por chip de línea; selecciona", () => {
    const onSelect = vi.fn();
    render(<PopMaterialPicker open onClose={() => {}} materials={CATALOG} onSelect={onSelect} />);
    expect(screen.getByText("VLANK CELULOSA - COLGANTE")).toBeInTheDocument();
    expect(screen.getByText("MILENIO - CIGARRERA AEREA")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "MILENIO" }));
    expect(screen.queryByText("VLANK CELULOSA - COLGANTE")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Todas las líneas" }));
    fireEvent.change(screen.getByLabelText("Buscar material"), { target: { value: "211" } });
    expect(screen.queryByText("MILENIO - CIGARRERA AEREA")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("VLANK CELULOSA - COLGANTE"));
    expect(onSelect).toHaveBeenCalledWith(CATALOG[0]);
  });

  it("opción 'otro' con texto libre", () => {
    const onOther = vi.fn();
    render(<PopMaterialPicker open onClose={() => {}} materials={CATALOG} onSelect={() => {}} onOther={onOther} otherLabel="Otro material Espert" />);
    fireEvent.click(screen.getByText("Otro material Espert"));
    fireEvent.change(screen.getByPlaceholderText(/Describí la pieza/), { target: { value: "  Cigarrera vieja " } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(onOther).toHaveBeenCalledWith("Cigarrera vieja");
  });

  it("cerrado no renderiza nada", () => {
    const { container } = render(<PopMaterialPicker open={false} onClose={() => {}} materials={CATALOG} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
