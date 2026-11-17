import { useEffect, useRef, useState } from "react";
import { assistantApi } from "@/lib/api/assistant";
import { PuchiFab } from "./PuchiFab";
import { PuchiPanel } from "./PuchiPanel";
import type { PuchiState } from "./PuchiAvatar";
import { useAssistant } from "./useAssistant";

const WARM_EVERY_MS = 10 * 60 * 1000;

/**
 * Puchi completo (FAB + panel). Se monta solo para admin; si el backend dice
 * que está deshabilitado, o la consulta de estado falla, no renderiza nada.
 */
export function PuchiAssistant() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    assistantApi
      .status()
      .then((s) => alive && setEnabled(s.enabled === true))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return enabled ? <PuchiWidget /> : null;
}

function PuchiWidget() {
  const [open, setOpen] = useState(false);
  const assistant = useAssistant();
  const answering = assistant.status === "answering";

  // Al abrir el panel se le pide al servidor que precaliente el censo: armarlo
  // en frío tarda más que un turno entero y la primera pregunta se cortaba.
  // Como mucho una vez cada 10 minutos; si falla, no pasa nada.
  const lastWarm = useRef(0);
  useEffect(() => {
    if (!open || Date.now() - lastWarm.current < WARM_EVERY_MS) return;
    lastWarm.current = Date.now();
    assistantApi.warm().catch(() => {});
  }, [open]);
  const hasLiveText = assistant.messages.some((m) => m.streaming && m.content);
  const avatarState: PuchiState = !answering ? "idle" : hasLiveText && !assistant.toolLabel ? "talking" : "thinking";

  return (
    <>
      {open && <PuchiPanel assistant={assistant} avatarState={avatarState} onClose={() => setOpen(false)} />}
      <PuchiFab open={open} answering={answering} avatarState={avatarState} onClick={() => setOpen((o) => !o)} />
    </>
  );
}
