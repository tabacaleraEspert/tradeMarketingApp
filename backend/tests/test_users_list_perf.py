"""GET /users: sin N+1 (antes 2-3 queries POR usuario) y sin cortar en 100."""
import uuid

from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from app.database import engine
from app.models import File as FileModel, Role as RoleModel, User as UserModel, UserRole as UserRoleModel


def _seed(n):
    db = sessionmaker(bind=engine)()
    role = db.query(RoleModel).filter(RoleModel.Name == "vendedor").first() or RoleModel(Name="vendedor")
    db.add(role)
    db.flush()
    tag = uuid.uuid4().hex[:6]
    ids = []
    for i in range(n):
        f = FileModel(BlobKey=f"avatar_{tag}_{i}", OriginalName="a.jpg")
        db.add(f)
        db.flush()
        u = UserModel(Email=f"perf_{tag}_{i}@u.test", DisplayName=f"Perf {i}", PasswordHash="x",
                      IsActive=True, AvatarFileId=f.FileId)
        db.add(u)
        db.flush()
        db.add(UserRoleModel(UserId=u.UserId, RoleId=role.RoleId))
        ids.append(u.UserId)
    db.commit()
    db.close()
    return set(ids)


def _count_queries(fn):
    n = [0]

    def before(*_a, **_k):
        n[0] += 1
    event.listen(engine, "before_cursor_execute", before)
    try:
        r = fn()
    finally:
        event.remove(engine, "before_cursor_execute", before)
    return r, n[0]


def test_users_list_queries_constantes_y_sin_tope_100(client):
    ids = _seed(110)
    r, queries = _count_queries(lambda: client.get("/users"))
    assert r.status_code == 200
    body = r.json()
    got = {u["UserId"]: u for u in body if u["UserId"] in ids}
    assert len(got) == 110, "no debe cortar en 100"
    assert all(u["RoleName"] == "vendedor" and u["AvatarUrl"] for u in got.values())
    # auth + rol del solicitante + users + roles + avatars (+ margen); antes eran >300.
    assert queries <= 10, queries
