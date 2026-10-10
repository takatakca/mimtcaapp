// Small design-system primitives: dark navy theme, big tap targets, labels for screen readers,
// text that scales with the system font size (no fixed heights on text containers).
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, TAP, type } from "../theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Screen({
  children,
  scroll = true,
  edges = ["top", "bottom"],
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: ("top" | "bottom")[];
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{children}</View>
      )}
    </SafeAreaView>
  );
}

/** Text placeholder for the logo. The official TAKATAK files go in knowledgeAI/brand/; never redraw them. */
export function Wordmark({ by }: { by: string }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`MIMT, ${by}`} style={styles.wordmark}>
      <Text style={styles.wordmarkTitle}>MIMT</Text>
      <Text style={styles.wordmarkBy}>{by.toUpperCase()}</Text>
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={[type.title, { marginBottom: spacing.sm }]}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={[type.heading, { marginTop: spacing.md, marginBottom: spacing.sm }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[muted ? type.secondary : type.body, { lineHeight: 22 }, style]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={[type.label, { marginBottom: spacing.xs }]}>{children}</Text>;
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  hint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = {
    primary: colors.brandBlue,
    secondary: colors.midnightRaised,
    danger: colors.danger,
    success: colors.success,
    ghost: "transparent",
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        variant === "ghost" && styles.ghost,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={22} color={colors.white} /> : null}
          <Text style={styles.buttonText}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#6F7F99"
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...props}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
      {children}
    </Text>
  );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "warning" }) {
  const border = { info: colors.electric, success: colors.success, warning: colors.warning }[tone];
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { borderLeftColor: border }]}>
      <Text style={type.body}>{children}</Text>
    </View>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.checkRow}
    >
      <View style={[styles.checkBox, checked && { backgroundColor: colors.electric, borderColor: colors.electric }]}>
        {checked ? <Ionicons name="checkmark" size={22} color={colors.navy} /> : null}
      </View>
      <Text style={[type.body, { flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({
  title,
  subtitle,
  icon,
  onPress,
  onLongPress,
  right,
  label,
  danger,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  onPress?: () => void;
  /** Secondary actions (e.g. the call-log menu). */
  onLongPress?: () => void;
  right?: ReactNode;
  label?: string;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label ?? [title, subtitle].filter(Boolean).join(", ")}
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={onLongPress ? [{ name: "longpress" }] : undefined}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && onLongPress?.()}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.midnightRaised }]}
    >
      {icon ? <Ionicons name={icon} size={24} color={danger ? colors.danger : colors.electric} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[type.body, danger && { color: colors.danger }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={type.secondary} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={20} color={colors.silver} /> : null}
    </Pressable>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View accessibilityLabel={label} style={styles.loading}>
      <ActivityIndicator size="large" color={colors.electric} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  fill: { flex: 1 },
  wordmark: { alignItems: "center", marginVertical: spacing.xl },
  wordmarkTitle: { fontSize: 56, fontWeight: "900", letterSpacing: 6, color: colors.white },
  wordmarkBy: { fontSize: 12, letterSpacing: 4, color: colors.cyan, fontWeight: "700", marginTop: spacing.xs },
  button: {
    minHeight: TAP + 8,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: spacing.xs,
  },
  ghost: { borderWidth: 1, borderColor: colors.border },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700", textAlign: "center" },
  card: {
    backgroundColor: colors.midnight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    minHeight: TAP,
    backgroundColor: colors.midnight,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.white,
    fontSize: 17,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  error: { color: colors.danger, fontSize: 15, marginTop: spacing.xs },
  notice: {
    backgroundColor: colors.midnight,
    borderLeftWidth: 4,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: TAP, paddingVertical: spacing.sm },
  checkBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.silver,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: TAP + 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
});
