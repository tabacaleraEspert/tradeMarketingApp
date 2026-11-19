import { describe, expect, it } from "vitest";
import type { Chain } from "@/lib/api/types";
import {
  chainCreateFields,
  chainFieldFor,
  chainInfoFor,
  chainSelectionError,
  chainUpdateFields,
  filterChains,
  normalizeChainText,
} from "./chains";

const chain = (id: number, Name: string, ChannelId: number, o: Partial<Chain> = {}): Chain => ({
  ChainId: id, Name, ChannelId, Kind: "cadena", IsKeyAccount: false, AccountManagerUserId: null,
  StoreCount: null, Aliases: null, IsActive: true, CreatedAt: "2026-11-19T00:00:00Z", ...o,
});

const PROX = 22, ESTACION = 23, KIOSCO = 9;
const CHAINS: Chain[] = [
  chain(1, "Tommy Shop", PROX, { Aliases: "Tomyshop, Tommy's shop", IsKeyAccount: true }),
  chain(2, "365", PROX, { IsKeyAccount: true }),
  chain(3, "Open 25", PROX, { Aliases: "Open25" }),
  chain(4, "El Jevi", PROX),
  chain(5, "Vieja", PROX, { IsActive: false }),
  chain(10, "YPF", ESTACION, { Kind: "bandera" }),
  chain(11, "Shell", ESTACION, { Kind: "bandera" }),
];

describe("chainFieldFor", () => {
  it("canal con cadenas → modo cadena, ordenadas, sin inactivas", () => {
    const f = chainFieldFor(CHAINS, PROX);
    expect(f.mode).toBe("cadena");
    expect(f.options.map((c) => c.Name)).toEqual(["365", "El Jevi", "Open 25", "Tommy Shop"]);
  });
  it("estación de servicio → bandera opcional, salvo subcanal Independiente", () => {
    expect(chainFieldFor(CHAINS, ESTACION, "De bandera").mode).toBe("bandera");
    expect(chainFieldFor(CHAINS, ESTACION, null).options.map((c) => c.Name)).toEqual(["Shell", "YPF"]);
    expect(chainFieldFor(CHAINS, ESTACION, "Independiente")).toEqual({ mode: "none", options: [] });
  });
  it("canal sin cadenas, sin canal o sin cache → nada", () => {
    expect(chainFieldFor(CHAINS, KIOSCO).mode).toBe("none");
    expect(chainFieldFor(CHAINS, "").mode).toBe("none");
    expect(chainFieldFor([], PROX).mode).toBe("none");
  });
});

describe("filterChains", () => {
  const opts = chainFieldFor(CHAINS, PROX).options;
  it("busca por nombre y alias, sin tildes / mayúsculas / signos", () => {
    expect(filterChains(opts, "tomy").map((c) => c.Name)).toEqual(["Tommy Shop"]);
    expect(filterChains(opts, "TOMMYS").map((c) => c.Name)).toEqual(["Tommy Shop"]);
    expect(filterChains(opts, "open25").map((c) => c.Name)).toEqual(["Open 25"]);
    expect(filterChains(opts, "jeví").map((c) => c.Name)).toEqual(["El Jevi"]);
    expect(filterChains(opts, "  ")).toHaveLength(4);
    expect(filterChains(opts, "zzz")).toEqual([]);
  });
  it("normalizeChainText", () => {
    expect(normalizeChainText("  Tommy's   SHÓP ")).toBe("tommy s shop");
    expect(normalizeChainText(null)).toBe("");
  });
});

describe("validación y body", () => {
  it("la cadena es obligatoria solo en modo cadena", () => {
    expect(chainSelectionError("cadena", "")).toBe("Elegí la cadena del PDV");
    expect(chainSelectionError("cadena", 3)).toBeNull();
    expect(chainSelectionError("bandera", "")).toBeNull();
    expect(chainSelectionError("none", null)).toBeNull();
  });
  it("alta: en modo cadena manda ChainId y NO manda subcanal (lo deriva el server)", () => {
    expect(chainCreateFields("cadena", 3, 77)).toEqual({ ChainId: 3 });
  });
  it("alta: bandera opcional conserva el subcanal", () => {
    expect(chainCreateFields("bandera", 10, 5)).toEqual({ ChainId: 10, SubChannelId: 5 });
    expect(chainCreateFields("bandera", "", 5)).toEqual({ SubChannelId: 5 });
  });
  it("alta: si el dispositivo no conoce cadenas del canal, la clave ChainId no viaja (modo tolerante del server)", () => {
    const body = chainCreateFields("none", 3, 5);
    expect(body).toEqual({ SubChannelId: 5 });
    expect("ChainId" in body).toBe(false);
    expect("ChainId" in chainCreateFields("none", "", "")).toBe(false);
  });
  describe("edición: solo viaja lo que el usuario cambió", () => {
    const loaded = { ChannelId: PROX, SubChannelId: 77, ChainId: 3 };
    const form = (o: Partial<{ channelId: number | ""; subChannelId: number | ""; chainId: number | "" }> = {}) => ({
      channelId: PROX as number | "", subChannelId: 77 as number | "", chainId: 3 as number | "", ...o,
    });
    it("sin cambios de clasificación no manda canal, subcanal ni cadena (form desactualizado no pisa nada)", () => {
      expect(chainUpdateFields("cadena", form(), loaded)).toEqual({});
      // form cargado de cache viejo (canal 9 / subcanal 62, sin cadena): tampoco manda nada
      const stale = { ChannelId: KIOSCO, SubChannelId: 62, ChainId: null };
      expect(chainUpdateFields("none", { channelId: KIOSCO, subChannelId: 62, chainId: "" }, stale)).toEqual({});
    });
    it("cambiar la cadena manda solo ChainId (el subcanal lo deriva el server)", () => {
      expect(chainUpdateFields("cadena", form({ chainId: 4 }), loaded)).toEqual({ ChainId: 4 });
    });
    it("PDV con cadena inactiva (no hay selector): editar otra cosa no se la quita", () => {
      const inactive = { ChannelId: KIOSCO, SubChannelId: 5, ChainId: 5 };
      expect(chainUpdateFields("none", { channelId: KIOSCO, subChannelId: 5, chainId: 5 }, inactive)).toEqual({});
    });
    it("cambio de canal: viaja el canal y SIEMPRE la clave ChainId (cambio deliberado)", () => {
      expect(chainUpdateFields("none", form({ channelId: KIOSCO, subChannelId: "", chainId: "" }), loaded))
        .toEqual({ ChannelId: KIOSCO, SubChannelId: null, ChainId: null });
      const plain = { ChannelId: KIOSCO, SubChannelId: 5, ChainId: null };
      expect(chainUpdateFields("cadena", { channelId: PROX, subChannelId: "", chainId: 2 }, plain))
        .toEqual({ ChannelId: PROX, ChainId: 2 });
      // aunque no se haya podido cargar la lista de cadenas
      expect(chainUpdateFields("none", form({ channelId: KIOSCO, subChannelId: 5, chainId: "" }), loaded, false))
        .toEqual({ ChannelId: KIOSCO, SubChannelId: 5, ChainId: null });
    });
    it("bandera: elegir, cambiar y quitar", () => {
      const est = { ChannelId: ESTACION, SubChannelId: 8, ChainId: null };
      expect(chainUpdateFields("bandera", { channelId: ESTACION, subChannelId: 8, chainId: 10 }, est)).toEqual({ ChainId: 10 });
      const withFlag = { ...est, ChainId: 10 };
      expect(chainUpdateFields("bandera", { channelId: ESTACION, subChannelId: 8, chainId: "" }, withFlag)).toEqual({ ChainId: null });
      // pasar a "Independiente" (modo none por el subcanal) limpia la bandera
      expect(chainUpdateFields("none", { channelId: ESTACION, subChannelId: 9, chainId: 10 }, withFlag))
        .toEqual({ SubChannelId: 9, ChainId: null });
    });
    it("solo subcanal: no manda la cadena", () => {
      const plain = { ChannelId: KIOSCO, SubChannelId: 5, ChainId: null };
      expect(chainUpdateFields("none", { channelId: KIOSCO, subChannelId: 6, chainId: "" }, plain)).toEqual({ SubChannelId: 6 });
    });
    it("sin lista de cadenas cargada no se toca la cadena del PDV", () => {
      const withFlag = { ChannelId: ESTACION, SubChannelId: 8, ChainId: 10 };
      expect(chainUpdateFields("none", { channelId: ESTACION, subChannelId: 9, chainId: 10 }, withFlag, false))
        .toEqual({ SubChannelId: 9 });
    });
  });
  it("edición de un PDV viejo sin cadena: no bloquea", () => {
    expect(chainSelectionError("cadena", "", true)).toBeNull();
    expect(chainSelectionError("cadena", "", false)).not.toBeNull();
  });
  it("chainInfoFor arma los datos del PDV optimista", () => {
    expect(chainInfoFor(CHAINS, 1)).toEqual({ ChainId: 1, ChainName: "Tommy Shop", ChainKind: "cadena", IsKeyAccount: true });
    expect(chainInfoFor(CHAINS, null)).toEqual({ ChainId: null, ChainName: null, ChainKind: null, IsKeyAccount: false });
    expect(chainInfoFor(CHAINS, 999).ChainName).toBeNull();
  });
});
