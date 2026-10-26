/** Helpers para encuadrar mapas de Google en un set de PDVs (no en el país entero). */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Caja lat/lng de los puntos, recortando el 3% extremo (un PDV mal geolocalizado
 *  no estira el encuadre) y con margen `padDeg` (0.03° ≈ 3 km). */
export function pointsBox(pts: LatLng[], padDeg = 0) {
  if (pts.length === 0) return null;
  const lats = pts.map((p) => p.lat).sort((a, b) => a - b);
  const lngs = pts.map((p) => p.lng).sort((a, b) => a - b);
  const q = (arr: number[], t: number) => arr[Math.round((arr.length - 1) * t)];
  const trim = pts.length >= 10 ? 0.03 : 0;
  return {
    minLat: q(lats, trim) - padDeg,
    maxLat: q(lats, 1 - trim) + padDeg,
    minLng: q(lngs, trim) - padDeg,
    maxLng: q(lngs, 1 - trim) + padDeg,
  };
}

export function inBox(p: LatLng, box: NonNullable<ReturnType<typeof pointsBox>>) {
  return p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng;
}

/** Encuadra el mapa en los puntos (1 punto → zoom de calle). */
export function fitMapToPoints(map: google.maps.Map, pts: LatLng[]) {
  if (pts.length === 0) return;
  if (pts.length === 1) {
    map.setCenter(pts[0]);
    map.setZoom(15);
    return;
  }
  const b = pointsBox(pts)!;
  map.fitBounds(
    new google.maps.LatLngBounds({ lat: b.minLat, lng: b.minLng }, { lat: b.maxLat, lng: b.maxLng }),
    40
  );
}
