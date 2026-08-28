const BRANDS = ["Van Kiff", "Milenio", "Melbourne", "Mill", "Bold", "Lebonn", "Blank", "Dito", "Fleek"];

/** "Milenio Red" → marca atenuada + variante en negrita: una lista de SKUs no
 * es una pared de nombres repetidos, el ojo agrupa por marca solo. */
export function SkuName({ name }: { name: string }) {
  const brand = BRANDS.find((b) => name.startsWith(b));
  const variant = brand ? name.slice(brand.length).trim() : "";
  if (!brand || !variant) return <span className="font-semibold text-foreground">{name}</span>;
  return (
    <span>
      <span className="text-muted-foreground">{brand}</span>{" "}
      <span className="font-semibold text-foreground">{variant}</span>
    </span>
  );
}
