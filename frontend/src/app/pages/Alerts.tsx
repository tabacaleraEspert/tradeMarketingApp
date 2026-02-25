import { useState, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { ArrowLeft, AlertTriangle, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useIncidentsWithPdvNames, incidentsApi } from "@/lib/api";
import { incidentToAlertUI } from "@/lib/api";

export function Alerts() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | "open" | "in-progress" | "resolved">("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const [newAlert, setNewAlert] = useState({
    type: "",
    priority: "medium",
    description: "",
  });

  const { data: incidents, loading, refetch } = useIncidentsWithPdvNames();
  const alerts = useMemo(() => incidents.map(incidentToAlertUI), [incidents]);

  const filteredAlerts = alerts.filter((alert) => {
    const matchesFilter = filter === "all" || alert.status === filter;
    const matchesSearch =
      alert.posName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      alert.description.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const getAlertIcon = (type: string) => {
    return <AlertTriangle size={20} />;
  };

  const getAlertTypeLabel = (type: string) => {
    const labels = {
      "stock-out": "Quiebre de Stock",
      "missing-material": "Falta Material",
      "price-issue": "Precio Incorrecto",
      closed: "PDV Cerrado",
    };
    return labels[type as keyof typeof labels] || type;
  };

  const getPriorityColor = (priority: string) => {
    const colors = {
      high: "bg-red-100 text-red-700 border-red-200",
      medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
      low: "bg-blue-100 text-blue-700 border-blue-200",
    };
    return colors[priority as keyof typeof colors] || "";
  };

  const getStatusBadgeVariant = (status: string) => {
    const variants = {
      open: "destructive" as const,
      "in-progress": "default" as const,
      resolved: "secondary" as const,
    };
    return variants[status as keyof typeof variants] || "default";
  };

  const getStatusLabel = (status: string) => {
    const labels = {
      open: "Abierta",
      "in-progress": "En Proceso",
      resolved: "Resuelta",
    };
    return labels[status as keyof typeof labels] || status;
  };

  const handleCreateAlert = async () => {
    if (!newAlert.type || !newAlert.description) {
      toast.error("Completa todos los campos obligatorios");
      return;
    }

    try {
      const priorityMap = { high: 1, medium: 2, low: 3 };
      await incidentsApi.create({
        Type: newAlert.type,
        Notes: newAlert.description,
        Priority: priorityMap[newAlert.priority as keyof typeof priorityMap],
      });
      toast.success("Incidencia creada correctamente");
      setIsCreateDialogOpen(false);
      setNewAlert({ type: "", priority: "medium", description: "" });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear incidencia");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Alertas e Incidencias</h1>
            <p className="text-sm text-slate-600">{filteredAlerts.length} registros</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <Input
            placeholder="Buscar por PDV o descripción..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            Todas ({alerts.length})
          </Button>
          <Button
            size="sm"
            variant={filter === "open" ? "default" : "outline"}
            onClick={() => setFilter("open")}
          >
            Abiertas ({alerts.filter((a) => a.status === "open").length})
          </Button>
          <Button
            size="sm"
            variant={filter === "in-progress" ? "default" : "outline"}
            onClick={() => setFilter("in-progress")}
          >
            En Proceso ({alerts.filter((a) => a.status === "in-progress").length})
          </Button>
          <Button
            size="sm"
            variant={filter === "resolved" ? "default" : "outline"}
            onClick={() => setFilter("resolved")}
          >
            Resueltas ({alerts.filter((a) => a.status === "resolved").length})
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Create Alert Button */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="w-full h-12 font-semibold" size="lg">
              <Plus size={20} className="mr-2" />
              Crear Nueva Incidencia
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Nueva Incidencia</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Tipo de Incidencia *</Label>
                <Select
                  value={newAlert.type}
                  onValueChange={(value) => setNewAlert({ ...newAlert, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stock-out">Quiebre de Stock</SelectItem>
                    <SelectItem value="missing-material">Falta Material POP</SelectItem>
                    <SelectItem value="price-issue">Precio Incorrecto</SelectItem>
                    <SelectItem value="closed">PDV Cerrado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Prioridad</Label>
                <Select
                  value={newAlert.priority}
                  onValueChange={(value) => setNewAlert({ ...newAlert, priority: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="low">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Descripción *</Label>
                <Textarea
                  placeholder="Describe el problema..."
                  rows={4}
                  value={newAlert.description}
                  onChange={(e) => setNewAlert({ ...newAlert, description: e.target.value })}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  Cancelar
                </Button>
                <Button className="flex-1" onClick={handleCreateAlert}>
                  Crear Incidencia
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Alerts List */}
        <div className="space-y-3">
          {loading ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-slate-500">Cargando incidencias...</p>
              </CardContent>
            </Card>
          ) : filteredAlerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <AlertTriangle size={48} className="mx-auto mb-4 text-slate-300" />
                <p className="text-slate-500">No se encontraron incidencias</p>
              </CardContent>
            </Card>
          ) : (
            filteredAlerts.map((alert) => (
              <Card
                key={alert.id}
                className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${
                  alert.priority === "high"
                    ? "border-l-red-500"
                    : alert.priority === "medium"
                    ? "border-l-yellow-500"
                    : "border-l-blue-500"
                }`}
              >
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div
                        className={`rounded-full p-2 ${
                          alert.priority === "high"
                            ? "bg-red-100"
                            : alert.priority === "medium"
                            ? "bg-yellow-100"
                            : "bg-blue-100"
                        }`}
                      >
                        {getAlertIcon(alert.type)}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900 mb-1">
                          {getAlertTypeLabel(alert.type)}
                        </h3>
                        <p className="text-sm text-slate-600 mb-2">{alert.posName}</p>
                      </div>
                    </div>
                    <Badge variant={getStatusBadgeVariant(alert.status)}>
                      {getStatusLabel(alert.status)}
                    </Badge>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-slate-700 mb-3 pl-12">{alert.description}</p>

                  {/* Footer */}
                  <div className="flex items-center justify-between pl-12 text-xs text-slate-500">
                    <span>
                      {new Date(alert.createdAt).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        alert.priority === "high"
                          ? "border-red-300 text-red-700"
                          : alert.priority === "medium"
                          ? "border-yellow-300 text-yellow-700"
                          : "border-blue-300 text-blue-700"
                      }
                    >
                      Prioridad:{" "}
                      {alert.priority === "high"
                        ? "Alta"
                        : alert.priority === "medium"
                        ? "Media"
                        : "Baja"}
                    </Badge>
                  </div>

                  {/* Resolved Date */}
                  {alert.resolvedAt && (
                    <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-green-700 pl-12">
                      Resuelta el{" "}
                      {new Date(alert.resolvedAt).toLocaleDateString("es-AR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
