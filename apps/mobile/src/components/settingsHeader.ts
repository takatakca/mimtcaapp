import { colors } from "../theme";

/**
 * Header for pushed settings screens that are not listed in app/_layout.tsx (same look as the ones
 * there), so new screens do not need to edit the root layout.
 */
export const settingsHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: colors.white,
  headerTitleStyle: { fontWeight: "700" as const },
};
