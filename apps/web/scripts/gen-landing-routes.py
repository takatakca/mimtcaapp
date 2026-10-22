#!/usr/bin/env python3
"""Writes the app/ route files for the landing pages (lib/landing.ts). Run from apps/web: python3 scripts/gen-landing-routes.py"""
import os

ROUTES = {
    "cityMontreal": ("numero-virtuel-montreal", "virtual-number-montreal"),
    "cityQuebec": ("numero-virtuel-quebec", "virtual-number-quebec-city"),
    "cityLaval": ("numero-virtuel-laval", "virtual-number-laval"),
    "cityGatineau": ("numero-virtuel-gatineau", "virtual-number-gatineau"),
    "cityToronto": ("numero-virtuel-toronto", "virtual-number-toronto"),
    "useVirtual": ("numero-virtuel", "virtual-phone-number"),
    "useSecond": ("deuxieme-numero", "second-phone-number"),
    "useVoip": ("telephonie-ip-affaires", "business-voip"),
}

for key, (fr, en) in ROUTES.items():
    for lang, d in (("fr", f"app/(fr)/{fr}"), ("en", f"app/(en)/en/{en}")):
        os.makedirs(d, exist_ok=True)
        with open(f"{d}/page.tsx", "w") as f:
            f.write(
                f'''import {{ LandingPage }} from "@/components/pages/LandingPage";
import {{ metadataFor }} from "@/lib/meta";

export const metadata = metadataFor("{lang}", "{key}");

export default function Page() {{
  return <LandingPage lang="{lang}" page="{key}" />;
}}
'''
            )
