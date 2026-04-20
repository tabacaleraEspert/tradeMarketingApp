from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class User(Base):
    __tablename__ = "User"

    UserId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Email = Column(String(256), unique=True, nullable=False)
    PasswordHash = Column(String(256), nullable=True)  # bcrypt hash
    DisplayName = Column(String(120), nullable=False)
    ZoneId = Column(Integer, ForeignKey("Zone.ZoneId"), nullable=True)
    # Jerarquía: quién es el superior directo de este usuario (null = top-level, típicamente admin)
    ManagerUserId = Column(Integer, ForeignKey("User.UserId"), nullable=True)
    # Fuerza cambio de contraseña en el primer login
    MustChangePassword = Column(Boolean, default=False, nullable=False)
    # Avatar / foto de perfil (FK opcional a File)
    AvatarFileId = Column(Integer, ForeignKey("File.FileId"), nullable=True)
    IsActive = Column(Boolean, default=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    UpdatedAt = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    zone = relationship("Zone", backref="users")


class Role(Base):
    __tablename__ = "Role"

    RoleId = Column(Integer, primary_key=True, index=True, autoincrement=True)
    Name = Column(String(60), unique=True, nullable=False)
    CreatedAt = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class UserRole(Base):
    __tablename__ = "UserRole"

    UserId = Column(Integer, ForeignKey("User.UserId"), primary_key=True)
    RoleId = Column(Integer, ForeignKey("Role.RoleId"), primary_key=True)
