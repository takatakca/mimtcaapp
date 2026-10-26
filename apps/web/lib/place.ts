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
