import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Badge } from "../../components/ui/badge";
import { Modal, ConfirmModal } from "../../components/ui/modal";
import { Switch } from "../../components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Users,
  Shield,
  MapPin,
  Mail,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  User as UserIcon,
  FolderTree,
  List,
} from "lucide-react";
import { usersApi, rolesApi, zonesApi } from "@/lib/api";
import type { User, Role, Zone } from "@/lib/api";
import { toast } from "sonner";
import { getCurrentUser } from "../../lib/auth";

interface UserWithRole extends User {
  roleId?: number | null;
  roleName?: string | null;
  AvatarUrl?: string | null;
}

export function UserManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null);
  const [deleteUser, setDeleteUser] = useState<UserWithRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [viewMode, setViewMode] = useState<"list" | "tree">("list");
  const [collapsedNodes, setCollapsedNodes] = useState<Set<number>>(new Set());
  const toggleCollapse = (userId: number) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const [form, setForm] = useState({
    Email: "",
    DisplayName: "",
    Password: "",
    ZoneId: "" as number | "",
    RoleId: "" as number | "",
    ManagerUserId: "" as number | "",
    IsActive: true,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, roleList, zoneList] = await Promise.all([
        usersApi.list(),
        rolesApi.list(),
        zonesApi.list(),
      ]);
      setRoles(roleList);
      setZones(zoneList);

      // Fetch roles for each user
      const usersWithRoles: UserWithRole[] = await Promise.all(
        userList.map(async (u) => {
          try {
            const r = await usersApi.getRole(u.UserId);
            return { ...u, roleId: r.roleId, roleName: r.roleName };
          } catch {
            return { ...u, roleId: null, roleName: null };
          }
        })
      );
      setUsers(usersWithRoles);
    } catch {
      toast.error("Error al cargar usuarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = users.filter((u) => {
    const term = searchTerm.toLowerCase();
    return (
      u.DisplayName.toLowerCase().includes(term) ||
      u.Email.toLowerCase().includes(term) ||
      (u.roleName || "").toLowerCase().includes(term)
    );
  });

  const resetForm = () => {
    setForm({ Email: "", DisplayName: "", Password: "", ZoneId: "", RoleId: "", ManagerUserId: "", IsActive: true });
    setEditingUser(null);
    setShowPassword(false);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (u: UserWithRole) => {
    setEditingUser(u);
    setForm({
      Email: u.Email,
      DisplayName: u.DisplayName,
      Password: "",
      ZoneId: u.ZoneId ?? "",
      RoleId: u.roleId ?? "",
      ManagerUserId: u.ManagerUserId ?? "",
      IsActive: u.IsActive,
    });
    setShowPassword(false);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.Email || !form.DisplayName) {
      toast.error("Email y nombre son obligatorios");
      return;
    }
    setSaving(true);
    try {
      if (editingUser) {
        // Update user
        const updateData: Record<string, unknown> = {
          Email: form.Email,
          DisplayName: form.DisplayName,
          ZoneId: form.ZoneId || null,
          ManagerUserId: form.ManagerUserId || null,
          IsActive: form.IsActive,
        };
        if (form.Password) updateData.Password = form.Password;
        await usersApi.update(editingUser.UserId, updateData as Parameters<typeof usersApi.update>[1]);

        // Update role
        if (form.RoleId) {
          await usersApi.setRole(editingUser.UserId, Number(form.RoleId));
        }
        toast.success("Usuario actualizado");
      } else {
        // Create user
        const createData: Record<string, unknown> = {
          Email: form.Email,
          DisplayName: form.DisplayName,
          ZoneId: form.ZoneId || null,
          ManagerUserId: form.ManagerUserId || null,
          IsActive: form.IsActive,
        };
        if (form.Password) createData.Password = form.Password;
        const newUser = await usersApi.create(createData as Parameters<typeof usersApi.create>[0]);

        // Assign role
        if (form.RoleId) {
          await usersApi.setRole(newUser.UserId, Number(form.RoleId));
        }
        toast.success("Usuario creado");
      }
      setIsModalOpen(false);
      resetForm();
      loadData();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    try {
      await usersApi.delete(deleteUser.UserId);
      toast.success("Usuario eliminado");
      setDeleteUser(null);
      loadData();
    } catch {
      toast.error("Error al eliminar usuario");
    }
  };

  const handleToggleActive = async (u: UserWithRole) => {
    try {
      await usersApi.update(u.UserId, { IsActive: !u.IsActive });
      setUsers((prev) =>
        prev.map((x) => (x.UserId === u.UserId ? { ...x, IsActive: !x.IsActive } : x))
      );
      toast.success(u.IsActive ? "Usuario desactivado" : "Usuario activado");
    } catch {
      toast.error("Error al cambiar estado");
    }
  };

  const getZoneName = (zoneId: number | null) => {
    if (!zoneId) return "-";
    return zones.find((z) => z.ZoneId === zoneId)?.Name || "-";
  };

  const getRoleBadge = (roleName: string | null | undefined) => {
    if (!roleName) return <Badge variant="outline">Sin rol</Badge>;
    const colors: Record<string, string> = {
      admin: "bg-espert-gold/10 text-espert-gold",
      regional_manager: "bg-espert-gold/10 text-espert-gold",
      territory_manager: "bg-blue-100 text-blue-800",
      ejecutivo: "bg-purple-100 text-purple-800",
      vendedor: "bg-green-100 text-green-800",
    };
    return (
      <Badge className={colors[roleName] || "bg-muted text-foreground"}>
        {roleName.charAt(0).toUpperCase() + roleName.slice(1)}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Cargando usuarios...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Gestión de Usuarios</h1>
          <p className="text-muted-foreground">{users.length} usuarios registrados</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus size={16} />
          Nuevo Usuario
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4 text-center">
            <Users size={24} className="mx-auto text-espert-gold mb-1" />
            <p className="text-2xl font-bold text-foreground">{users.length}</p>
            <p className="text-xs text-espert-gold">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 text-center">
            <Users size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-900">{users.filter((u) => u.IsActive).length}</p>
            <p className="text-xs text-green-600">Activos</p>
          </CardContent>
        </Card>
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4 text-center">
            <Shield size={24} className="mx-auto text-espert-gold mb-1" />
            <p className="text-2xl font-bold text-foreground">
              {users.filter((u) => u.roleName === "admin" || u.roleName === "regional_manager").length}
            </p>
            <p className="text-xs text-espert-gold">Admin/Regional</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 text-center">
            <MapPin size={24} className="mx-auto text-amber-600 mb-1" />
            <p className="text-2xl font-bold text-amber-900">
              {new Set(users.filter((u) => u.ZoneId).map((u) => u.ZoneId)).size}
            </p>
            <p className="text-xs text-amber-600">Zonas con usuarios</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email o rol..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === "list" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <List size={14} /> Lista
          </button>
          <button
            onClick={() => setViewMode("tree")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === "tree" ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <FolderTree size={14} /> Jerarquía
          </button>
        </div>
      </div>

      {/* Tree view */}
      {viewMode === "tree" && (() => {
        // Build tree from ManagerUserId
        const childrenMap = new Map<number | null, UserWithRole[]>();
        for (const u of filtered) {
          const mid = u.ManagerUserId ?? null;
          if (!childrenMap.has(mid)) childrenMap.set(mid, []);
          childrenMap.get(mid)!.push(u);
        }
        // Sort children by name
        for (const [, children] of childrenMap) {
          children.sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
        }
        const roots = childrenMap.get(null) || [];
        // Also grab orphans (their manager is not in the filtered list)
        const allIds = new Set(filtered.map((u) => u.UserId));
        const orphans = filtered.filter(
          (u) => u.ManagerUserId != null && !allIds.has(u.ManagerUserId) && !roots.includes(u)
        );
        const topLevel = [...roots, ...orphans];

        const renderNode = (user: UserWithRole, depth: number): React.ReactNode => {
          const children = childrenMap.get(user.UserId) || [];
          const isLeaf = children.length === 0;
          const isCollapsed = collapsedNodes.has(user.UserId);
          return (
            <div key={user.UserId}>
              <div
                className={`flex items-center gap-2 py-2 px-3 hover:bg-muted/40 rounded-lg transition-colors ${
                  !user.IsActive ? "opacity-50" : ""
                }`}
                style={{ paddingLeft: `${depth * 24 + 12}px` }}
              >
                {!isLeaf ? (
                  <button
                    onClick={() => toggleCollapse(user.UserId)}
                    className="p-0.5 rounded hover:bg-muted shrink-0 transition-transform"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} className="text-muted-foreground" />
                    ) : (
                      <ChevronDown size={14} className="text-muted-foreground" />
                    )}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                  {user.AvatarUrl ? (
                    <img src={user.AvatarUrl} className="w-7 h-7 rounded-full object-cover" alt="" />
                  ) : (
                    <UserIcon size={14} className="text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground truncate block">{user.DisplayName}</span>
                  <span className="text-[10px] text-muted-foreground truncate block">{user.Email}</span>
                </div>
                {getRoleBadge(user.roleName)}
                {children.length > 0 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">{children.length} a cargo</span>
                )}
                <button
                  onClick={() => openEdit(user)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground shrink-0"
                >
                  <Edit size={13} />
                </button>
              </div>
              {!isCollapsed && children.map((c) => renderNode(c, depth + 1))}
            </div>
          );
        };

        return (
          <Card>
            <CardContent className="p-2">
              {topLevel.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">Sin usuarios que coincidan</p>
              ) : (
                topLevel.map((u) => renderNode(u, 0))
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* User table */}
      {viewMode === "list" && (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Usuario</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Rol</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Zona</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Reporta a</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.UserId} className="border-b border-border hover:bg-muted transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-foreground">{u.DisplayName}</p>
                      <p className="text-xs text-muted-foreground">ID: {u.UserId}</p>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Mail size={14} className="text-muted-foreground" />
                        {u.Email}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">{getRoleBadge(u.roleName)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-sm text-muted-foreground">{getZoneName(u.ZoneId)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-muted-foreground">
                        {u.ManagerUserId
                          ? users.find((m) => m.UserId === u.ManagerUserId)?.DisplayName ?? `#${u.ManagerUserId}`
                          : "—"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Switch checked={u.IsActive} onCheckedChange={() => handleToggleActive(u)} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(u)}>
                          <Edit size={16} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteUser(u)}>
                          <Trash2 size={16} className="text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No se encontraron usuarios
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editingUser ? "Editar Usuario" : "Nuevo Usuario"}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setIsModalOpen(false); resetForm(); }}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : editingUser ? "Actualizar" : "Crear"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre completo *</Label>
            <Input
              placeholder="Ej: Carlos Martínez"
              value={form.DisplayName}
              onChange={(e) => setForm((f) => ({ ...f, DisplayName: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>Email *</Label>
            <Input
              type="email"
              placeholder="carlos@empresa.com"
              value={form.Email}
              onChange={(e) => setForm((f) => ({ ...f, Email: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>{editingUser ? "Nueva Contraseña (dejar vacío para no cambiar)" : "Contraseña"}</Label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder={editingUser ? "Sin cambios" : "Contraseña"}
                value={form.Password}
                onChange={(e) => setForm((f) => ({ ...f, Password: e.target.value }))}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={form.RoleId ? String(form.RoleId) : ""}
                onValueChange={(v) => setForm((f) => ({ ...f, RoleId: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar rol..." />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const cu = getCurrentUser();
                    const hierarchy = ["admin", "regional_manager", "territory_manager", "ejecutivo", "vendedor"];
                    const myIdx = hierarchy.indexOf(cu.role);
                    const allowed = myIdx >= 0 ? hierarchy.slice(myIdx) : ["vendedor"];
                    return roles.filter((r) => allowed.includes(r.Name));
                  })().map((r) => (
                    <SelectItem key={r.RoleId} value={String(r.RoleId)}>
                      {r.Name.charAt(0).toUpperCase() + r.Name.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Zona</Label>
              <Select
                value={form.ZoneId ? String(form.ZoneId) : ""}
                onValueChange={(v) => setForm((f) => ({ ...f, ZoneId: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar zona..." />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.ZoneId} value={String(z.ZoneId)}>
                      {z.Name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Reporta a (superior directo)</Label>
              <select
                className="w-full h-10 px-3 border border-border rounded-md text-sm bg-background"
                value={form.ManagerUserId === "" ? "" : String(form.ManagerUserId)}
                onChange={(e) => setForm((f) => ({ ...f, ManagerUserId: e.target.value ? Number(e.target.value) : "" }))}
              >
                <option value="">Sin superior directo</option>
                {users
                  .filter((u) => u.UserId !== editingUser?.UserId)
                  .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName))
                  .map((u) => (
                    <option key={u.UserId} value={u.UserId}>
                      {u.DisplayName} ({u.roleName || "sin rol"})
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Switch
              checked={form.IsActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, IsActive: v }))}
            />
            <Label>Usuario activo</Label>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteUser}
        onClose={() => setDeleteUser(null)}
        onConfirm={handleDelete}
        title="Eliminar Usuario"
        message={`¿Estás seguro de eliminar a "${deleteUser?.DisplayName}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        type="danger"
      />
    </div>
  );
}
