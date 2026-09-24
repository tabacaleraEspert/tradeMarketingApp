import { createContext, useContext } from "react";

/** Navegación de drill de Inteligencia sin prop-drilling: cualquier componente
 * anidado (matrices, mapa, oportunidades) puede abrir la ficha de un PDV.
 * `readOnly`: vista sin sesión (reporte público por mail) — no se ofrecen
 * links a la ficha del PDV ni a la visita. */
export const IntelNavContext = createContext<{ openPdv: (pdvId: number) => void; readOnly?: boolean }>({
  openPdv: () => {},
});

export const useIntelNav = () => useContext(IntelNavContext);
