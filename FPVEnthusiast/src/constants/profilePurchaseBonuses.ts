export function getPropsBonusForPrice(priceCents: number): number {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 0;
  if (priceCents <= 399) return 25;
  if (priceCents <= 599) return 35;
  if (priceCents <= 799) return 50;
  return 60;
}

export function formatPropsBonusLabel(priceCents: number): string {
  const bonus = getPropsBonusForPrice(priceCents);
  return bonus > 0 ? `+${bonus} props bonus` : '';
}
