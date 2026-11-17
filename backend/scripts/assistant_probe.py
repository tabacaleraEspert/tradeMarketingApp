"""Sonda del asistente "Puchi": hace preguntas REALES al modelo desde la terminal.

Arma el mismo loop que `POST /assistant/ask` (proveedor OpenAI real, herramientas
reales contra la DB configurada en backend/.env) e imprime los eventos, las
herramientas usadas, el tiempo y el costo. Sirve para validar la key, el modelo
y la calidad de las respuestas sin levantar el front.

Requiere OPENAI_API_KEY (env o backend/.env) y las tablas AssistantTurn /
AssistantToolUse en la DB (en SQLite se crean solas; en prod, correr antes
scripts/ddl_assistant_20261117.py). Cada pregunta queda auditada como un turno.

Uso (desde backend/):
    python scripts/assistant_probe.py                      # preguntas de ejemplo
    python scripts/assistant_probe.py "¿Cómo viene Cuyo?"  # una o más preguntas
    python scripts/assistant_probe.py --user admin@test.com "…"
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import database  # noqa: E402
from app.config import settings  # noqa: E402
from app.models import AssistantToolUse, Role, User, UserRole  # noqa: E402
from app.routers.assistant import _registry, get_provider  # noqa: E402
from app.services.assistant import loop  # noqa: E402

DEFAULT_QUESTIONS = [
    "¿Cómo viene la cobertura por zona?",
    "¿Cuántos PDVs activos llevan más de 60 días sin visita, por zona?",
    "¿Qué trades tienen menos visitas este mes?",
]


def main(argv: list[str]) -> None:
    email = None
    if "--user" in argv:
        i = argv.index("--user")
        email = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    questions = argv or DEFAULT_QUESTIONS

    provider = get_provider()
    if provider is None:
        sys.exit("Falta OPENAI_API_KEY (env o backend/.env)")
    if database._is_sqlite:
        database.Base.metadata.create_all(bind=database.engine)

    db = database.SessionLocal()
    q = db.query(User).join(UserRole, UserRole.UserId == User.UserId).join(Role, Role.RoleId == UserRole.RoleId)
    q = q.filter(User.Email == email) if email else q.filter(Role.Name == "admin", User.IsActive == True)  # noqa: E712
    user = q.order_by(User.UserId).first()
    if user is None:
        sys.exit("No encontré el usuario (o no hay ningún admin activo)")
    print(f"Modelo {settings.openai_model} · como {user.DisplayName} · DB {settings.resolved_database_url.split('@')[-1]}\n")

    history: list[dict] = []
    for question in questions:
        print(f"━━ {question}")
        answer = ""
        for ev in loop.ask(
            db=db, user=user, question=question, history=history,
            provider=provider, registry=_registry, model=settings.openai_model,
        ):
            if ev["type"] == "tool":
                print(f"   · {ev['label']}")
            elif ev["type"] == "error":
                print(f"   ! {ev['message']}")
            elif ev["type"] == "end":
                answer = ev["text"]
                print(f"\n{answer}\n\n   — {ev['durationMs'] / 1000:.1f} s · US$ {ev['costUsd']:.4f}")
        if answer:
            history += [{"role": "user", "content": question}, {"role": "assistant", "content": answer}]
            from app.models import AssistantTurn
            turn = db.query(AssistantTurn).filter(AssistantTurn.UserId == user.UserId).order_by(
                AssistantTurn.AssistantTurnId.desc()).first()
            uses = db.query(AssistantToolUse).filter(AssistantToolUse.AssistantTurnId == turn.AssistantTurnId).all()
            print(f"   vueltas {turn.Rounds} · tokens {turn.TokensIn}/{turn.TokensOut} (cacheados {turn.TokensCached})"
                  f" · ok {turn.Ok}{' · ' + turn.Error if turn.Error else ''}")
            for u in uses:
                print(f"   {u.Tool}({u.ArgsJson}) {u.DurationMs} ms")
        print()
    db.close()


if __name__ == "__main__":
    main(sys.argv[1:])
