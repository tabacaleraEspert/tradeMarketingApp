from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from ..database import Base


class Chain(Base):
    """Cadena (o bandera de estación de servicio) a la que pertenece un PDV.

    Eje independiente del formato del local (Channel › SubChannel): el canal dice
    QUÉ es el local, la cadena dice DE QUIÉN es. Key account = atributo de la cadena.
    Kind: 'cadena' (retail, obligatoria en su canal) | 'bandera' (estaciones, opcional).
    """
    __tablename__ = "Chain"
    __table_args__ = (
        UniqueConstraint("ChannelId", "Name", name="uq_Chain_ChannelId_Name"),
    )

    ChainId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(80), nullable=False)
    # Canal en el que vive la cadena (un PDV solo puede tener cadenas de SU canal)
    ChannelId = Column(Integer, ForeignKey("Channel.ChannelId"), nullable=False, index=True)
    Kind = Column(String(20), nullable=False, default="cadena", server_default="cadena")
    IsKeyAccount = Column(Boolean, nullable=False, default=False, server_default="0")
    # Responsable de la cuenta clave (ej. KAM)
    AccountManagerUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    # Cantidad real de locales de la cadena en el mercado (carga admin). NULL = usar
    # la cantidad de PDVs activos de la cadena en la app.
    StoreCount = Column(Integer, nullable=True)
    # Nombres alternativos separados por coma (matching / historial de fusiones)
    Aliases = Column(String(500), nullable=True)
    IsActive = Column(Boolean, nullable=False, default=True, server_default="1")
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
