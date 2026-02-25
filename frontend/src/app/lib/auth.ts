export interface StoredUser {
  id: string;
  name: string;
  email: string;
  zone: string;
  zoneId?: number;
  role: string;
}

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function getCurrentUser(): StoredUser {
  const user = getStoredUser();
  return (
    user ?? {
      id: "0",
      name: "Usuario",
      email: "",
      zone: "-",
      role: "vendedor",
    }
  );
}
