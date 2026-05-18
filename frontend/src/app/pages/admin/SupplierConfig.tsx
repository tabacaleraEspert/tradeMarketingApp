import { useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Plus, Edit, Trash2, Truck, Package } from "lucide-react";
import {
  useApiList,
  supplierTypesApi,
  supplierProductTypesApi,
} from "@/lib/api";
import { toast } from "sonner";

function LookupSection({
  title,
  icon: Icon,
  items,
  onAdd,
  onUpdate,
  onDelete,
  idKey,
}: {
  title: string;
  icon: React.ElementType;
  items: Array<{ Name: string; IsActive: boolean; [k: string]: unknown }>;
  onAdd: (name: string) => Promise<void>;
  onUpdate: (id: number, data: { Name?: string; IsActive?: boolean }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  idKey: string;
}) {
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await onAdd(newName.trim());
      setNewName("");
      toast.success("Agregado");
    } catch { toast.error("Error al agregar"); }
    setAdding(false);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await onUpdate(id, { Name: editName.trim() });
      setEditId(null);
      toast.success("Actualizado");
    } catch { toast.error("Error al actualizar"); }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-[#A48242]" />
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <Badge variant="outline" className="ml-auto">{items.length}</Badge>
        </div>

        {/* Add form */}
        <div className="flex gap-2">
          <Input
            placeholder="Nuevo nombre..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="bg-[#A48242] hover:bg-[#8B6E38] text-white">
            <Plus size={16} />
          </Button>
        </div>

        {/* List */}
        <div className="divide-y divide-border">
          {items.map((item) => {
            const itemId = item[idKey] as number;
            return (
              <div key={itemId} className="flex items-center gap-2 py-2">
                {editId === itemId ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(itemId)}
                      className="flex-1"
                      autoFocus
                    />
                    <Button size="sm" variant="outline" onClick={() => handleSaveEdit(itemId)}>OK</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>X</Button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 text-sm ${!item.IsActive ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {item.Name}
                    </span>
                    {!item.IsActive && <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>}
                    <button onClick={() => { setEditId(itemId); setEditName(item.Name); }} className="p-1.5 hover:bg-muted rounded text-muted-foreground">
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        if (item.IsActive) {
                          await onDelete(itemId);
                          toast.success("Desactivado");
                        } else {
                          await onUpdate(itemId, { IsActive: true });
                          toast.success("Reactivado");
                        }
                      }}
                      className={`p-1.5 rounded ${item.IsActive ? "hover:bg-red-50 text-red-400" : "hover:bg-green-50 text-green-600"}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function SupplierConfig() {
  const { data: types, refetch: refetchTypes } = useApiList(() => supplierTypesApi.listAll());
  const { data: productTypes, refetch: refetchProducts } = useApiList(() => supplierProductTypesApi.listAll());

  return (
    <div className="p-4 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurar Proveedores</h1>
        <p className="text-sm text-muted-foreground mt-1">Gestioná los tipos de proveedor y productos disponibles para el censo</p>
      </div>

      <LookupSection
        title="Tipos de Proveedor"
        icon={Truck}
        items={types}
        idKey="SupplierTypeId"
        onAdd={async (name) => { await supplierTypesApi.create({ Name: name }); refetchTypes(); }}
        onUpdate={async (id, data) => { await supplierTypesApi.update(id, data); refetchTypes(); }}
        onDelete={async (id) => { await supplierTypesApi.delete(id); refetchTypes(); }}
      />

      <LookupSection
        title="Productos de Proveedor"
        icon={Package}
        items={productTypes}
        idKey="SupplierProductTypeId"
        onAdd={async (name) => { await supplierProductTypesApi.create({ Name: name }); refetchProducts(); }}
        onUpdate={async (id, data) => { await supplierProductTypesApi.update(id, data); refetchProducts(); }}
        onDelete={async (id) => { await supplierProductTypesApi.delete(id); refetchProducts(); }}
      />
    </div>
  );
}
