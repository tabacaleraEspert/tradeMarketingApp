import { useEffect, useState } from "react";
import { assistantApi } from "@/lib/api/assistant";
import { PuchiFab } from "./PuchiFab";
import { PuchiPanel } from "./PuchiPanel";
import type { PuchiState } from "./PuchiAvatar";
import { useAssistant } from "./useAssistant";

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
  const hasLiveText = assistant.messages.some((m) => m.streaming && m.content);
  const avatarState: PuchiState = !answering ? "idle" : hasLiveText && !assistant.toolLabel ? "talking" : "thinking";

  return (
    <>
      {open && <PuchiPanel assistant={assistant} avatarState={avatarState} onClose={() => setOpen(false)} />}
      <PuchiFab open={open} answering={answering} avatarState={avatarState} onClick={() => setOpen((o) => !o)} />
    </>
  );
}
