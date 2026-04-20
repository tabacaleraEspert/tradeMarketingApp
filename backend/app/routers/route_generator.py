"""Auto-generación de rutas foco a partir de un conjunto de PDVs.

Algoritmo:
1. K-means clustering sobre lat/lng para agrupar PDVs geográficamente
2. Balanceo: redistribuir si algún cluster tiene más de max_pdvs o menos de min_pdvs
3. TSP (nearest-neighbor) dentro de cada cluster para ordenar
4. Devuelve propuesta sin crear nada — el frontend confirma

Endpoint:
    POST /routes/generate-proposal
"""
import math
import random
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import require_role, get_current_user
from ..database import get_db
from ..models.pdv import PDV as PDVModel
from ..models import User as UserModel


router = APIRouter(prefix="/routes", tags=["Generador de Rutas"])


class GenerateRequest(BaseModel):
    pdv_ids: list[int]
    max_routes: int = 10
    min_pdvs_per_route: int = 25
    max_pdvs_per_route: int = 35
    route_name_prefix: str = "Ruta"


class RoutePdvProposal(BaseModel):
    PdvId: int
    Name: str
    Address: str | None
    Lat: float | None
    Lon: float | None
    SortOrder: int


class RouteProposal(BaseModel):
    index: int
    name: str
    pdvs: list[RoutePdvProposal]
    total_distance_km: float
    estimated_minutes: int


class GenerateResponse(BaseModel):
    routes: list[RouteProposal]
    unassigned_pdv_ids: list[int]  # PDVs sin coordenadas que no se pudieron agrupar


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------
def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    to_rad = math.radians
    dlat = to_rad(lat2 - lat1)
    dlon = to_rad(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# K-means (simple, no numpy dependency)
# ---------------------------------------------------------------------------
def _kmeans(points: list[tuple[float, float]], k: int, max_iter: int = 50) -> list[int]:
    """Returns cluster assignment for each point."""
    n = len(points)
    if n <= k:
        return list(range(n))

    # Init centroids: k-means++ style
    centroids = [points[random.randint(0, n - 1)]]
    for _ in range(1, k):
        dists = []
        for p in points:
            min_d = min(_haversine_km(p[0], p[1], c[0], c[1]) for c in centroids)
            dists.append(min_d ** 2)
        total = sum(dists)
        if total == 0:
            centroids.append(points[random.randint(0, n - 1)])
            continue
        r = random.random() * total
        cumulative = 0
        for i, d in enumerate(dists):
            cumulative += d
            if cumulative >= r:
                centroids.append(points[i])
                break

    assignments = [0] * n
    for _ in range(max_iter):
        # Assign
        changed = False
        for i, p in enumerate(points):
            best_c = min(range(k), key=lambda c: _haversine_km(p[0], p[1], centroids[c][0], centroids[c][1]))
            if assignments[i] != best_c:
                assignments[i] = best_c
                changed = True
        if not changed:
            break
        # Update centroids
        for c in range(k):
            members = [points[i] for i in range(n) if assignments[i] == c]
            if members:
                centroids[c] = (
                    sum(m[0] for m in members) / len(members),
                    sum(m[1] for m in members) / len(members),
                )

    return assignments


# ---------------------------------------------------------------------------
# TSP nearest-neighbor con horarios
# ---------------------------------------------------------------------------
def _parse_time_minutes(t: str | None) -> int | None:
    """Convierte "HH:MM" a minutos desde medianoche. None si inválido."""
    if not t or ":" not in t:
        return None
    try:
        parts = t.strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return None


def _tsp_nn(
    points: list[tuple[float, float]],
    opening_times: list[str | None] | None = None,
    closing_times: list[str | None] | None = None,
    start_hour: int = 8,
) -> list[int]:
    """Nearest-neighbor TSP que prioriza por horario de cierre y penaliza almuerzo.

    Lógica de scoring (menor = mejor):
    - Base: distancia en km
    - Bonus: PDVs con cierre temprano se priorizan (cierra a las 13 → visitarlo antes de las 13)
    - Penalización: si la hora estimada de llegada cae en 12:00-14:00 y el PDV cierra en ese rango
    """
    if len(points) <= 1:
        return list(range(len(points)))

    n = len(points)
    has_schedule = opening_times is not None and closing_times is not None

    # Parse closing times
    close_mins: list[int | None] = []
    open_mins: list[int | None] = []
    if has_schedule:
        close_mins = [_parse_time_minutes(closing_times[i]) for i in range(n)]
        open_mins = [_parse_time_minutes(opening_times[i]) for i in range(n)]

    # Sort candidates that close earliest first as starting candidates
    if has_schedule:
        # Start with earliest-closing PDV (or index 0 if no schedule)
        candidates_with_close = [(i, close_mins[i]) for i in range(n) if close_mins[i] is not None]
        if candidates_with_close:
            start_idx = min(candidates_with_close, key=lambda x: x[1])[0]
        else:
            start_idx = 0
    else:
        start_idx = 0

    visited = [False] * n
    order = [start_idx]
    visited[start_idx] = True
    current_time_min = start_hour * 60  # Hora actual estimada en minutos

    for _ in range(n - 1):
        current = order[-1]
        best_score = float("inf")
        best_idx = -1

        for j in range(n):
            if visited[j]:
                continue

            dist = _haversine_km(points[current][0], points[current][1], points[j][0], points[j][1])

            # Estimar tiempo de llegada: distancia/25kmh + 15 min visita actual
            travel_min = (dist / 25) * 60
            arrival_min = current_time_min + 15 + travel_min  # 15 min en PDV actual + viaje

            # Score base = distancia
            score = dist

            if has_schedule:
                close_j = close_mins[j]
                open_j = open_mins[j]

                # Penalizar si llegaríamos después del cierre
                if close_j is not None and arrival_min > close_j:
                    score += 50  # Penalización fuerte: llegaríamos tarde

                # Bonus: priorizar PDVs que cierran pronto (urgencia)
                if close_j is not None:
                    time_left = close_j - arrival_min
                    if 0 < time_left < 60:  # Cierra en menos de 1h
                        score -= 5  # Bonus por urgencia

                # Penalizar si el PDV no abrió todavía
                if open_j is not None and arrival_min < open_j:
                    score += 10  # Llegaríamos antes de que abra

                # Penalizar horario de almuerzo (12:00-14:00)
                # Si el PDV cierra durante almuerzo, no penalizar (es cuando hay que ir)
                LUNCH_START = 12 * 60
                LUNCH_END = 14 * 60
                if LUNCH_START <= arrival_min <= LUNCH_END:
                    if close_j is None or close_j > LUNCH_END:
                        score += 3  # Leve penalización: mejor ir fuera de almuerzo

            if score < best_score:
                best_score = score
                best_idx = j

        if best_idx >= 0:
            visited[best_idx] = True
            order.append(best_idx)
            # Actualizar hora estimada
            dist = _haversine_km(points[current][0], points[current][1], points[best_idx][0], points[best_idx][1])
            current_time_min += 15 + (dist / 25) * 60

    return order


# ---------------------------------------------------------------------------
# Balanceo de clusters
# ---------------------------------------------------------------------------
def _balance_clusters(
    assignments: list[int],
    points: list[tuple[float, float]],
    k: int,
    min_size: int,
    max_size: int,
) -> list[int]:
    """Move PDVs between clusters to satisfy min/max constraints."""
    from collections import defaultdict

    clusters: dict[int, list[int]] = defaultdict(list)
    for i, c in enumerate(assignments):
        clusters[c].append(i)

    # Remove empty clusters
    active = [c for c in range(k) if len(clusters[c]) > 0]

    # Split oversized clusters
    new_assignments = list(assignments)
    new_cluster_id = max(active) + 1 if active else 0

    for c in list(active):
        while len(clusters[c]) > max_size:
            overflow = clusters[c][max_size:]
            clusters[c] = clusters[c][:max_size]
            clusters[new_cluster_id] = overflow
            for idx in overflow:
                new_assignments[idx] = new_cluster_id
            active.append(new_cluster_id)
            new_cluster_id += 1

    # Merge undersized clusters into nearest
    for c in list(active):
        if len(clusters[c]) < min_size and len(active) > 1:
            # Find nearest cluster
            centroid = (
                sum(points[i][0] for i in clusters[c]) / len(clusters[c]),
                sum(points[i][1] for i in clusters[c]) / len(clusters[c]),
            )
            best_target = None
            best_dist = float("inf")
            for other in active:
                if other == c or len(clusters[other]) + len(clusters[c]) > max_size:
                    continue
                other_centroid = (
                    sum(points[i][0] for i in clusters[other]) / len(clusters[other]),
                    sum(points[i][1] for i in clusters[other]) / len(clusters[other]),
                )
                d = _haversine_km(centroid[0], centroid[1], other_centroid[0], other_centroid[1])
                if d < best_dist:
                    best_dist = d
                    best_target = other

            if best_target is not None:
                for idx in clusters[c]:
                    new_assignments[idx] = best_target
                    clusters[best_target].append(idx)
                clusters[c] = []
                active.remove(c)

    return new_assignments


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.post(
    "/generate-proposal",
    response_model=GenerateResponse,
    dependencies=[Depends(require_role("vendedor"))],
)
def generate_route_proposal(
    data: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: UserModel = Depends(get_current_user),
):
    if len(data.pdv_ids) == 0:
        raise HTTPException(status_code=400, detail="Seleccioná al menos un PDV")

    # Load PDVs
    pdvs = db.query(PDVModel).filter(PDVModel.PdvId.in_(data.pdv_ids), PDVModel.IsActive == True).all()
    if not pdvs:
        raise HTTPException(status_code=404, detail="No se encontraron PDVs activos")

    # Separate PDVs with and without coordinates
    with_coords = [(p, float(p.Lat), float(p.Lon)) for p in pdvs if p.Lat is not None and p.Lon is not None]
    without_coords = [p for p in pdvs if p.Lat is None or p.Lon is None]

    if len(with_coords) == 0:
        raise HTTPException(status_code=400, detail="Ninguno de los PDVs seleccionados tiene coordenadas")

    # Determine number of clusters
    n = len(with_coords)
    ideal_per_route = (data.min_pdvs_per_route + data.max_pdvs_per_route) / 2
    k = max(1, min(data.max_routes, round(n / ideal_per_route)))

    # If too few PDVs for even 1 route at min, just make 1
    if n < data.min_pdvs_per_route:
        k = 1

    # Cluster
    points = [(lat, lon) for _, lat, lon in with_coords]
    assignments = _kmeans(points, k)

    # Balance
    assignments = _balance_clusters(assignments, points, k, data.min_pdvs_per_route, data.max_pdvs_per_route)

    # Group PDVs by cluster
    from collections import defaultdict
    clusters: dict[int, list[int]] = defaultdict(list)
    for i, c in enumerate(assignments):
        clusters[c].append(i)

    # Build proposals
    route_proposals: list[RouteProposal] = []
    route_idx = 0

    for cluster_id in sorted(clusters.keys()):
        indices = clusters[cluster_id]
        if not indices:
            continue

        cluster_points = [points[i] for i in indices]
        cluster_pdvs = [with_coords[i][0] for i in indices]

        # TSP order with schedules
        cluster_opening = [p.OpeningTime for p in cluster_pdvs]
        cluster_closing = [p.ClosingTime for p in cluster_pdvs]
        tsp_order = _tsp_nn(cluster_points, cluster_opening, cluster_closing)

        # Build ordered list
        ordered_pdvs: list[RoutePdvProposal] = []
        total_km = 0.0
        for sort_idx, tsp_idx in enumerate(tsp_order):
            pdv = cluster_pdvs[tsp_idx]
            ordered_pdvs.append(RoutePdvProposal(
                PdvId=pdv.PdvId,
                Name=pdv.Name,
                Address=pdv.Address,
                Lat=float(pdv.Lat) if pdv.Lat else None,
                Lon=float(pdv.Lon) if pdv.Lon else None,
                SortOrder=sort_idx,
            ))
            if sort_idx > 0:
                prev = cluster_points[tsp_order[sort_idx - 1]]
                curr = cluster_points[tsp_idx]
                total_km += _haversine_km(prev[0], prev[1], curr[0], curr[1])

        # Estimate time: ~25 km/h driving + 15 min per PDV
        drive_min = (total_km / 25) * 60
        visit_min = len(ordered_pdvs) * 15
        est_minutes = round(drive_min + visit_min)

        route_idx += 1
        route_proposals.append(RouteProposal(
            index=route_idx,
            name=f"{data.route_name_prefix} {route_idx}",
            pdvs=ordered_pdvs,
            total_distance_km=round(total_km, 1),
            estimated_minutes=est_minutes,
        ))

    return GenerateResponse(
        routes=route_proposals,
        unassigned_pdv_ids=[p.PdvId for p in without_coords],
    )
