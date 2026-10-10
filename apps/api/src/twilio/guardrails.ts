/** Voice geo-permissions: Canada and the US only, and never the high-risk ranges. Field names match Twilio's bulk update. */
export function voiceCountryPermission(iso: string): {
  iso_code: string;
  low_risk_numbers_enabled: boolean;
  high_risk_special_numbers_enabled: boolean;
  high_risk_tollfraud_numbers_enabled: boolean;
} {
  const allowed = iso === "CA" || iso === "US";
  return {
    iso_code: iso,
    low_risk_numbers_enabled: allowed,
    high_risk_special_numbers_enabled: false,
    high_risk_tollfraud_numbers_enabled: false,
  };
}

/** Daily spend alert in the account currency Twilio bills (USD). */
export function dailyTriggerUsd(alertCad: number, usdToCad: number): string {
  return (alertCad / usdToCad).toFixed(2);
}
