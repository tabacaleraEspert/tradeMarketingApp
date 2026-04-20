"""
Jerarquía organizacional.

El modelo es un árbol flexible via `User.ManagerUserId` (FK a otro User).
Un usuario puede tener N descendientes directos, pero sólo 1 manager directo.
La cadena puede saltarse niveles (un TM Rep puede reportar directo a un Territory
Manager si no hay Ejecutivo intermedio).

Uso típico:

    # "¿Qué usuarios están debajo de X?" (para filtrar reportes por sub-árbol)
    subordinate_ids = get_all_subordinate_ids(db, manager_user_id)

    # "¿X puede ver los datos de Y?" (chequeo de permisos por jerarquía)
    if user_id in get_all_subordinate_ids(db, current_user.UserId) or user_id == current_user.UserId:
        # OK
"""
from sqlalchemy.orm import Session

from .models import User as UserModel


def get_direct_subordinates(db: Session, manager_id: int) -> list[UserModel]:
    """Usuarios cuyo ManagerUserId apunta directamente a `manager_id`."""
    return db.query(UserModel).filter(UserModel.ManagerUserId == manager_id).all()


def get_all_subordinate_ids(db: Session, manager_id: int) -> set[int]:
    """Todos los UserId del sub-árbol (recursivo) debajo de `manager_id`, sin incluirlo.

    Implementación: BFS iterativo en Python. Para piloto con 6-20 usuarios es más
    que suficiente. Si en el futuro la jerarquía crece a miles, migrar a una CTE
    recursiva (`WITH RECURSIVE`) nativa de la DB.
    """
    result: set[int] = set()
    # Pre-cargamos TODOS los usuarios activos en un dict {manager_id: [user_id, ...]}
    # para no hacer N queries. Para piloto es despreciable.
    all_users = db.query(UserModel.UserId, UserModel.ManagerUserId).all()
    children_by_manager: dict[int, list[int]] = {}
    for uid, mid in all_users:
        if mid is not None:
            children_by_manager.setdefault(mid, []).append(uid)

    # BFS
    frontier = [manager_id]
    while frontier:
        next_frontier: list[int] = []
        for current_id in frontier:
            children = children_by_manager.get(current_id, [])
            for child_id in children:
                if child_id not in result:
                    result.add(child_id)
                    next_frontier.append(child_id)
        frontier = next_frontier

    return result


def get_visible_user_ids(db: Session, current_user: UserModel, role_name: str) -> set[int] | None:
    """Conjunto de UserIds cuyos datos puede ver `current_user` según su rol.

    - admin → None (sin restricciones: ve todo)
    - territory_manager / ejecutivo / supervisor → su sub-árbol + él mismo
    - vendedor (tm rep) → sólo él mismo
    - cualquier otro → sólo él mismo (fail-safe)

    Devolver None significa "sin filtro" (visibilidad total).
    """
    role = (role_name or "").lower()
    if role == "admin":
        return None
    if role in {"regional_manager", "territory_manager", "ejecutivo", "supervisor"}:
        subs = get_all_subordinate_ids(db, current_user.UserId)
        subs.add(current_user.UserId)
        return subs
    # vendedor / default
    return {current_user.UserId}


def is_in_subtree_of(db: Session, manager_id: int, target_user_id: int) -> bool:
    """True si target_user_id es manager_id o está en su sub-árbol."""
    if manager_id == target_user_id:
        return True
    return target_user_id in get_all_subordinate_ids(db, manager_id)
