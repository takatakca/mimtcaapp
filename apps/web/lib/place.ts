// Display name for where a number is from. Twilio gives a raw rate-centre name (often missing,
// sometimes run together like "Pointeclaire"), so fall back to the area code's region.

const RATE_CENTRES: Record<string, string> = {
  pointeclaire: "Pointe-Claire",
  stjerome: "Saint-Jérôme",
  sthyacinthe: "Saint-Hyacinthe",
  stjeansurrichelieu: "Saint-Jean-sur-Richelieu",
  troisrivieres: "Trois-Rivières",
  ilebizard: "Île-Bizard",
};

const AREA_REGIONS: Record<string, { fr: string; en: string }> = {
  "514": { fr: "Montréal", en: "Montréal" },
  "438": { fr: "Montréal", en: "Montréal" },
  "263": { fr: "Montréal", en: "Montréal" },
  "450": { fr: "Couronne de Montréal", en: "Greater Montréal" },
  "579": { fr: "Couronne de Montréal", en: "Greater Montréal" },
  "354": { fr: "Couronne de Montréal", en: "Greater Montréal" },
  "418": { fr: "Québec et l'Est", en: "Québec City and East" },
  "581": { fr: "Québec et l'Est", en: "Québec City and East" },
  "367": { fr: "Québec et l'Est", en: "Québec City and East" },
  "819": { fr: "Ouest et Nord du Québec", en: "Western and Northern Québec" },
  "873": { fr: "Ouest et Nord du Québec", en: "Western and Northern Québec" },
  "416": { fr: "Toronto", en: "Toronto" },
  "647": { fr: "Toronto", en: "Toronto" },
  "437": { fr: "Toronto", en: "Toronto" },
};

export function placeName(e164: string, locality: string | null | undefined, region: string | null | undefined, fr: boolean): string {
  if (locality) {
    const key = locality.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
    return RATE_CENTRES[key] ?? locality;
  }
  const area = e164.replace(/^\+1/, "").slice(0, 3);
  const known = AREA_REGIONS[area];
  if (known) return fr ? known.fr : known.en;
  return region ?? "";
}

/** A short reason a number is easy to remember (last 4 digits), or null. Shown as a badge in the picker. */
export function memorable(e164: string, fr: boolean): string | null {
  const last4 = e164.replace(/\D/g, "").slice(-4);
  if (last4.length < 4) return null;
  const d = last4.split("").map(Number);
  if (/^(\d)\1{3}$/.test(last4)) return fr ? "Quatre chiffres pareils" : "Four of a kind";
  if (last4.endsWith("000")) return fr ? "Finit par 000" : "Ends in 000";
  if (d.every((x, i) => i === 0 || x === d[i - 1]! + 1) || d.every((x, i) => i === 0 || x === d[i - 1]! - 1)) return fr ? "Suite de chiffres" : "Digit run";
  if (last4.endsWith("00")) return fr ? "Finit par 00" : "Ends in 00";
  if (last4[0] === last4[2] && last4[1] === last4[3]) return fr ? "Motif qui se répète" : "Repeating pattern";
  if (/(\d)\1\1/.test(last4)) return fr ? "Trois chiffres pareils" : "Triple digits";
  if (last4[0] === last4[1] && last4[2] === last4[3]) return fr ? "Chiffres doublés" : "Double digits";
  if (last4 === last4.split("").reverse().join("")) return fr ? "Se lit dans les deux sens" : "Reads both ways";
  return null;
}
