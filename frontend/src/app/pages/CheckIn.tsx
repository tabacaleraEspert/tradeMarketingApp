import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { ArrowLeft, MapPin, Clock, CheckCircle2, AlertTriangle, Navigation2, MessageSquare, UserCircle, AlertCircle, StickyNote, UserCog, WifiOff } from "lucide-react";
import { pdvsApi, visitsApi, incidentsApi, pdvNotesApi, ApiError } from "@/lib/api";
import type { Incident, PdvNote } from "@/lib/api";
import { executeOrEnqueue } from "@/lib/offline";
import { QuickContactsModal } from "../components/QuickContactsModal";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";

export function CheckIn() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number; visitId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [lastReminder, setLastReminder] = useState<string | null>(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [currentVisitId, setCurrentVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [reminderForNext, setReminderForNext] = useState("");
  const [gpsStatus, setGpsStatus] = useState<"checking" | "ok" | "out-of-range" | "no-pdv-coords" | "denied" | "unavailable">("checking");
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const GPS_PERIMETER_METERS = 200;
  const [pendingIncidents, setPendingIncidents] = useState<Incident[]>([]);
  const [openNotes, setOpenNotes] = useState<PdvNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [contactsModalOpen, setContactsModalOpen] = useState(false);

  const currentUser = getCurrentUser();
  const currentTime = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  useEffect(() => {
    if (!id) return;
    const pdvId = Number(id);
    pdvsApi
      .get(pdvId)
      .then((p) => {
        setPdv(p);
        setLoadError(null);
      })
      .catch((err) => {
        setPdv(null);
        setLoadError(
          err instanceof ApiError
            ? err.message
            : "No se pudo cargar el PDV. Verificá tu conexión."
        );
      });

    visitsApi
      .list({ pdv_id: pdvId, status: "CLOSED" })
      .then((visits) => {
        const last = visits[0];
        setLastReminder(last?.CloseReason || null);
      })
      .catch(() => {});

    // Load pending incidents for this PDV
    incidentsApi
      .list({ pdv_id: pdvId, status: "OPEN" })
      .then(setPendingIncidents)
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load open PDV notes (TODOs left by previous TM Reps)
    pdvNotesApi
      .list(pdvId, true)
      .then(setOpenNotes)
      .catch(() => setOpenNotes([]));
  }, [id]);

  const handleResolveNote = async (noteId: number) => {
    try {
      await pdvNotesApi.update(noteId, {
        IsResolved: true,
        ResolvedByUserId: Number(currentUser.id) || undefined,
      });
      setOpenNotes((prev) => prev.filter((n) => n.PdvNoteId !== noteId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  // Haversine distance in meters
  const distanceMetersBetween = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  };

  // Verify GPS proximity to PDV
  useEffect(() => {
    if (!pdv) return;
    if (pdv.Lat == null || pdv.Lon == null) {
      setGpsStatus("no-pdv-coords");
      return;
    }
    if (!navigator.geolocation) {
      setGpsStatus("unavailable");
      return;
    }
    setGpsStatus("checking");
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lon: longitude });
        const d = distanceMetersBetween(latitude, longitude, pdv.Lat as number, pdv.Lon as number);
        setDistanceMeters(d);
        setGpsStatus(d <= GPS_PERIMETER_METERS ? "ok" : "out-of-range");
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGpsStatus("denied");
        else setGpsStatus("unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [pdv]);

  // Genera un ID temporal negativo único para visitas offline
  const generateTempVisitId = () => -(Date.now() % 1000000);

  const handleCheckIn = async () => {
    if (!id || !pdv) return;
    setSaving(true);
    try {
      let visitId: number;

      if (navigator.onLine) {
        // Online: crear visita en el server inmediatamente
        const visit = await visitsApi.create({
          PdvId: Number(id),
          UserId: Number(currentUser.id),
          RouteDayId: routeDayId ?? undefined,
          Status: "OPEN",
        });
        visitId = visit.VisitId;
        toast.success("Check-in registrado correctamente");
      } else {
        // Offline: generar tempId y encolar la creación para sincronizar después
        visitId = generateTempVisitId();
        await executeOrEnqueue({
          kind: "visit_create",
          method: "POST",
          url: "/visits",
          body: {
            PdvId: Number(id),
            UserId: Number(currentUser.id),
            RouteDayId: routeDayId ?? undefined,
            Status: "OPEN",
          },
          label: `Check-in en ${pdv.Name}`,
          _tempVisitId: visitId,
        });
        toast.success("Check-in guardado. Se sincronizará cuando vuelva la conexión.");
      }

      // GPS check-in (best effort, offline-tolerant)
      if (userCoords) {
        try {
          await executeOrEnqueue({
            kind: "visit_check",
            method: "POST",
            url: `/visits/${visitId}/checks`,
            body: {
              CheckType: "IN",
              Lat: userCoords.lat,
              Lon: userCoords.lon,
              DistanceToPdvM: distanceMeters ?? undefined,
            },
            label: `Check-in GPS en ${pdv.Name}`,
            _tempVisitId: visitId < 0 ? visitId : undefined,
          });
        } catch {
          // No es bloqueante
        }
      }
      setCurrentVisitId(visitId);
      setIsCheckedIn(true);

      setTimeout(() => {
        navigate(`/pos/${id}/survey`, {
          state: { routeDayId, visitId: visit.VisitId },
        });
      }, 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al registrar check-in");
    } finally {
      setSaving(false);
    }
  };

  const handleCheckOut = async () => {
    if (!currentVisitId) {
      toast.error("No hay visita activa para cerrar");
      return;
    }
    setSaving(true);
    const isTempVisit = currentVisitId < 0;
    try {
      // El cierre es offline-tolerant: si no hay señal, queda en la queue
      const result = await executeOrEnqueue({
        kind: "visit_update",
        method: "PATCH",
        url: `/visits/${currentVisitId}`,
        body: {
          Status: "CLOSED",
          CloseReason: reminderForNext.trim() || undefined,
        },
        label: `Cierre de visita en ${pdv?.Name ?? "PDV"}`,
        _tempVisitId: isTempVisit ? currentVisitId : undefined,
      });

      // Registrar el GPS check-out también (best effort)
      if (userCoords) {
        try {
          await executeOrEnqueue({
            kind: "visit_check",
            method: "POST",
            url: `/visits/${currentVisitId}/checks`,
            body: {
              CheckType: "OUT",
              Lat: userCoords.lat,
              Lon: userCoords.lon,
            },
            label: `Check-out GPS en ${pdv?.Name ?? "PDV"}`,
            _tempVisitId: isTempVisit ? currentVisitId : undefined,
          });
        } catch {
          /* noop */
        }
      }

      if (result.queued) {
        toast.success("Visita guardada. Se sincronizará cuando vuelva la conexión.");
      } else {
        toast.success("Visita finalizada correctamente");
      }
      navigate("/route");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Error al cerrar visita");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Cargando...</p>
      </div>
    );
  }

  if (!pdv) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertCircle size={48} className="mx-auto text-destructive/70" />
          <p className="text-base font-semibold text-foreground">
            {loadError || "No se pudo cargar el PDV"}
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reintentar
            </Button>
            <Button onClick={() => navigate(-1)}>
              Volver
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/pos/${id}`)}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground">
              {isCheckedIn ? "Check-out" : "Check-in"}
            </h1>
            <p className="text-sm text-muted-foreground truncate">{pdv.Name}</p>
          </div>
          <button
            onClick={() => setContactsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Editar contactos del PDV"
          >
            <UserCog size={14} />
            Contactos
          </button>
        </div>
      </div>

      <QuickContactsModal
        isOpen={contactsModalOpen}
        onClose={() => setContactsModalOpen(false)}
        pdv={pdv}
        onSaved={(updated) => setPdv(updated)}
      />

      <div className="p-4 space-y-4">
        {/* Notas pendientes del PDV (TODOs dejados por TM Reps anteriores) */}
        {!isCheckedIn && openNotes.length > 0 && (
          <Card className="bg-amber-50/70 border-amber-300">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <StickyNote size={18} className="text-amber-700" />
                <h3 className="font-semibold text-amber-900">Notas pendientes ({openNotes.length})</h3>
              </div>
              <p className="text-xs text-amber-800 mb-3">Cosas para resolver en esta visita:</p>
              <div className="space-y-2">
                {openNotes.map((n) => (
                  <div key={n.PdvNoteId} className="flex items-start gap-2 p-2.5 bg-white rounded-lg border border-amber-200">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{n.Content}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {n.CreatedByName ?? "Usuario"} · {new Date(n.CreatedAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <button
                      onClick={() => handleResolveNote(n.PdvNoteId)}
                      className="p-1.5 rounded hover:bg-emerald-100 text-emerald-600 shrink-0"
                      title="Marcar como resuelta"
                    >
                      <CheckCircle2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recordatorio próxima visita (legacy CloseReason) */}
        {!isCheckedIn && lastReminder && (
          <Card className="bg-amber-50/60 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MessageSquare size={22} className="text-amber-600/80 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-900 mb-1">Recordatorio última visita</h3>
                  <p className="text-sm text-amber-800">{lastReminder}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pending Incidents (Step 3) */}
        {!isCheckedIn && pendingIncidents.length > 0 && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle size={18} className="text-red-600" />
                <h3 className="font-semibold text-red-900">Tareas Pendientes ({pendingIncidents.length})</h3>
              </div>
              <p className="text-xs text-red-700 mb-2">Revisar antes de entrar al local</p>
              <div className="space-y-2">
                {pendingIncidents.map((inc) => (
                  <div key={inc.IncidentId} className="flex items-start gap-2 p-2 bg-card rounded-lg border border-red-100">
                    <Badge variant={inc.Priority === 1 ? "destructive" : "outline"} className="text-xs shrink-0 mt-0.5">
                      {inc.Priority === 1 ? "Alta" : inc.Priority === 2 ? "Media" : "Baja"}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{inc.Type}</p>
                      {inc.Notes && <p className="text-xs text-muted-foreground truncate">{inc.Notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contact Info (Step 4) */}
        {!isCheckedIn && pdv.Contacts && pdv.Contacts.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <UserCircle size={18} className="text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Contacto del PDV</h3>
              </div>
              <div className="space-y-2">
                {pdv.Contacts.map((contact, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-muted">
                    <div>
                      <p className="text-sm font-medium text-foreground">{contact.ContactName}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {contact.ContactRole && (
                          <Badge variant="outline" className="text-xs">{contact.ContactRole}</Badge>
                        )}
                        {contact.DecisionPower && (
                          <Badge variant={contact.DecisionPower === "alto" ? "default" : "secondary"} className="text-xs">
                            Decisión: {contact.DecisionPower}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {contact.ContactPhone && (
                      <a href={`tel:${contact.ContactPhone}`} className="text-espert-gold text-sm">{contact.ContactPhone}</a>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Location Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="bg-espert-gold/10 rounded-full p-3">
                <MapPin size={24} className="text-espert-gold" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground mb-1">{pdv.Name}</h3>
                <p className="text-sm text-muted-foreground">{pdv.Address || pdv.City || "-"}</p>
              </div>
            </div>

            {/* GPS Status */}
            <div
              className={`flex items-center gap-2 p-3 rounded-lg border ${
                gpsStatus === "ok"
                  ? "bg-green-50 border-green-200"
                  : gpsStatus === "checking"
                  ? "bg-muted border-border"
                  : gpsStatus === "no-pdv-coords"
                  ? "bg-amber-50 border-amber-200"
                  : "bg-red-50 border-red-200"
              }`}
            >
              {gpsStatus === "ok" && (
                <>
                  <Navigation2 size={20} className="text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-900">Ubicación Confirmada</p>
                    <p className="text-xs text-green-700">
                      Dentro del perímetro ({distanceMeters !== null ? `${Math.round(distanceMeters)}m del PDV` : ""})
                    </p>
                  </div>
                  <CheckCircle2 size={20} className="text-green-600" />
                </>
              )}
              {gpsStatus === "checking" && (
                <>
                  <Navigation2 size={20} className="text-muted-foreground animate-pulse" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">Verificando ubicación...</p>
                    <p className="text-xs text-muted-foreground">Obteniendo coordenadas GPS</p>
                  </div>
                </>
              )}
              {gpsStatus === "out-of-range" && (
                <>
                  <AlertTriangle size={20} className="text-red-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-900">Fuera de Rango</p>
                    <p className="text-xs text-red-700">
                      {distanceMeters !== null ? `A ${Math.round(distanceMeters)}m del PDV (máx. ${GPS_PERIMETER_METERS}m)` : "Fuera del perímetro"}
                    </p>
                  </div>
                </>
              )}
              {gpsStatus === "no-pdv-coords" && (
                <>
                  <AlertTriangle size={20} className="text-amber-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-900">PDV sin coordenadas</p>
                    <p className="text-xs text-amber-700">Este PDV no tiene ubicación registrada</p>
                  </div>
                </>
              )}
              {gpsStatus === "denied" && (
                <>
                  <AlertTriangle size={20} className="text-red-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-900">Permiso denegado</p>
                    <p className="text-xs text-red-700">Habilitá la ubicación en el navegador</p>
                  </div>
                </>
              )}
              {gpsStatus === "unavailable" && (
                <>
                  <AlertTriangle size={20} className="text-red-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-900">GPS no disponible</p>
                    <p className="text-xs text-red-700">No se pudo obtener la ubicación</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Time Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-espert-gold/10 rounded-full p-3">
                <Clock size={24} className="text-espert-gold" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Hora Actual</p>
                <p className="text-2xl font-bold text-foreground">{currentTime}</p>
              </div>
            </div>

            {isCheckedIn && (
              <div className="pt-3 border-t border-border">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Check-in realizado:</span>
                  <span className="font-semibold text-foreground">{currentTime}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recordatorio al cerrar - campo para dejar comentario */}
        {isCheckedIn && (
          <Card>
            <CardContent className="p-4">
              <Label className="text-sm font-semibold text-foreground mb-2 block">
                Recordatorio próxima visita
              </Label>
              <Textarea
                placeholder="Deja un comentario o tarea para la próxima visita (ej: Verificar stock de producto X, Pedir reposición de material POP...)"
                value={reminderForNext}
                onChange={(e) => setReminderForNext(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </CardContent>
          </Card>
        )}

        {/* Visit Info */}
        {!isCheckedIn && (
          <Card className="bg-espert-gold/10 border-espert-gold">
            <CardContent className="p-4">
              <h3 className="font-semibold text-foreground mb-2">Información de Visita</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-espert-gold font-bold">•</span>
                  <span>Asegúrate de estar dentro del perímetro del punto de venta</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-espert-gold font-bold">•</span>
                  <span>La hora de check-in será registrada automáticamente</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-espert-gold font-bold">•</span>
                  <span>Después del check-in podrás completar el relevamiento</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="space-y-3 pb-4">
          {!isCheckedIn ? (
            <>
              {/* Banner de alerta GPS si corresponde */}
              {gpsStatus !== "ok" && gpsStatus !== "checking" && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold mb-0.5">
                        {gpsStatus === "out-of-range" && `Estás a ${distanceMeters ? Math.round(distanceMeters) : "?"}m del PDV (fuera del perímetro de ${GPS_PERIMETER_METERS}m).`}
                        {gpsStatus === "no-pdv-coords" && "Este PDV no tiene coordenadas cargadas."}
                        {gpsStatus === "denied" && "El permiso de ubicación está denegado."}
                        {gpsStatus === "unavailable" && "El GPS no está disponible en este dispositivo."}
                      </p>
                      <p className="text-amber-800">
                        Podés iniciar la visita igual, pero esto va a quedar marcado como
                        <strong> alerta para tu supervisor</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <Button
                className="w-full h-14 text-base font-semibold"
                size="lg"
                onClick={handleCheckIn}
                disabled={saving || gpsStatus === "checking"}
              >
                <CheckCircle2 className="mr-2" size={20} />
                {saving
                  ? "Registrando..."
                  : gpsStatus === "checking"
                  ? "Esperando GPS..."
                  : gpsStatus === "ok"
                  ? "Confirmar Check-in"
                  : "Iniciar visita igual"}
              </Button>
            </>
          ) : (
            <>
              <Button
                className="w-full h-14 text-base font-semibold"
                size="lg"
                onClick={() =>
                  navigate(`/pos/${id}/survey`, {
                    state: { routeDayId, visitId: currentVisitId },
                  })
                }
              >
                Continuar con Relevamiento
              </Button>
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={handleCheckOut}
                disabled={saving}
              >
                {saving ? "Cerrando..." : "Cerrar Visita"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
