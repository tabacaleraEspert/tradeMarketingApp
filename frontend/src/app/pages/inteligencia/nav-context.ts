import { createContext, useContext } from "react";

/** Navegación de drill de Inteligencia sin prop-drilling: cualquier componente
 * anidado (matrices, mapa, oportunidades) puede abrir la ficha de un PDV. */
export const IntelNavContext = createContext<{ openPdv: (pdvId: number) => void }>({
  openPdv: () => {},
});

export const useIntelNav = () => useContext(IntelNavContext);
