import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { PuchiAvatar, type PuchiState } from "./PuchiAvatar";

export const PUCHI_LABEL = "Puchi, asistente de consultas";

interface PuchiFabProps {
  open: boolean;
  answering: boolean;
  avatarState: PuchiState;
  onClick: () => void;
}

/**
 * Botón flotante de 56px abajo a la derecha. z-40: por encima del header
 * (z-30) y la sidebar (z-20) del admin, por debajo de diálogos Radix (z-50),
 * modales propios (z-1000) y toasts.
 */
export function PuchiFab({ open, answering, avatarState, onClick }: PuchiFabProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={PUCHI_LABEL}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full border-2 border-espert-gold bg-black shadow-lg shadow-black/25 transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-espert-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {answering && <span aria-hidden="true" className="puchi-ring absolute -inset-[5px] rounded-full" />}
          <PuchiAvatar size={48} state={avatarState} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{PUCHI_LABEL}</TooltipContent>
    </Tooltip>
  );
}
