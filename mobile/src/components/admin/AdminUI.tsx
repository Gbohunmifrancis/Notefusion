import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "../Icon";
import { Touchable } from "../Touchable";
import { fonts, motion, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import type { Tone } from "../../lib/adminFormat";

/**
 * The phone admin's pieces (board f-admin), each the web console's at phone size: the panel (`nf-panel`), the stat
 * tile (StatStrip), the badge's tones (Badge.tsx), the segmented switch, filter chips, list rows, grouped action rows,
 * meters and definition rows. Colour is status only: mint, amber and red tint a pill or a figure's change, gold is
 * Pro's, violet the choir's, and red is never a button or an icon.
 */

// ── Containers ─────────────────────────────────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  titleExtra,
  hint,
  action,
  children,
  style,
  bodyStyle,
}: {
  title?: string;
  /** Beside the title (Health's "NEW" on Push). */
  titleExtra?: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
}) {
  const s = useAdminStyles(makeStyles);
  return (
    <View style={[s.panel, style]}>
      {title ? (
        <View style={s.panelHead}>
          <View style={s.flex}>
            <View style={s.panelTitleRow}>
              <Text style={s.panelTitle}>{title}</Text>
              {titleExtra}
            </View>
            {hint ? <Text style={s.panelHint}>{hint}</Text> : null}
          </View>
          {action}
        </View>
      ) : null}
      {children ? <View style={[s.panelBody, !title && s.panelBodyAlone, bodyStyle]}>{children}</View> : null}
    </View>
  );
}

/** A section's heading between panels, with an optional link on the right ("Growth"). */
export function SectionHead({ title, link, onLink }: { title: string; link?: string; onLink?: () => void }) {
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {link ? <LinkText label={link} onPress={onLink} /> : null}
    </View>
  );
}

/** A group's small label above it ("Payments", "Account actions", "Operations"). */
export function GroupLabel({ children, right }: { children: string; right?: string }) {
  const s = useAdminStyles(makeStyles);
  return (
    <View style={s.groupLabelRow}>
      <Text style={s.groupLabel}>{children}</Text>
      {right ? <Text style={s.groupLabelRight}>{right}</Text> : null}
    </View>
  );
}

/** Brand-blue words that act (a link, "View all", "Open Transcriptions"). */
export function LinkText({ label, onPress, style }: { label: string; onPress?: () => void; style?: StyleProp<TextStyle> }) {
  const s = useAdminStyles(makeStyles);
  return (
    <Touchable onPress={onPress} haptic="light" style={s.linkHit} accessibilityLabel={label}>
      <Text style={[s.link, style]}>{label}</Text>
    </Touchable>
  );
}

// ── Figures ────────────────────────────────────────────────────────────────────────────────────────────────────

/** "↗ 12%" in mint or "↘ 4%" in red: the change against the period before. */
export function Change({ pct, suffix }: { pct: number | null; suffix?: string }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  if (pct === null) return null;
  const up = pct >= 0;
  const color = up ? a.okDeep : a.badDeep;
  return (
    <View style={s.change}>
      <Icon name={up ? "trend-up" : "trend-down"} size={13} color={color} />
      <Text style={[s.changeText, { color }]}>{`${Math.abs(pct)}%${suffix ? ` ${suffix}` : ""}`}</Text>
    </View>
  );
}

/** The console's stat tile: label, one big tabular figure, the change, one quiet line; a sparkline top right. */
export function StatTile({
  label,
  value,
  sub,
  pct,
  corner,
  tone,
  onPress,
  style,
}: {
  label: string;
  value: string;
  sub?: string;
  pct?: number | null;
  corner?: React.ReactNode;
  /** The two amber tiles on Payments: the only colour that asks for something. */
  tone?: "warn";
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const body = (
    <View style={[s.tile, tone === "warn" && { borderColor: a.warnTint[1] }, style]}>
      <Text style={[s.tileLabel, corner ? s.tileLabelCorner : null]} numberOfLines={1}>
        {label}
      </Text>
      <View style={s.tileValueRow}>
        <Text style={[s.tileValue, tone === "warn" && { color: a.warn }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {pct !== undefined ? <Change pct={pct} /> : null}
      </View>
      {sub ? (
        <Text style={s.tileSub} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
      {corner ? <View style={s.tileCorner}>{corner}</View> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Touchable onPress={onPress} scaleTo={motion.scale.default} accessibilityLabel={`${label}: ${value}`} style={style ? undefined : s.flex1}>
      {body}
    </Touchable>
  );
}

/** Two tiles a row, the console's grid at phone width. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  const s = useAdminStyles(makeStyles);
  const items = React.Children.toArray(children).filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View style={s.grid}>
      {rows.map((row, i) => (
        <View key={i} style={s.gridRow}>
          {row.map((item, j) => (
            <View key={j} style={s.flex1}>
              {item}
            </View>
          ))}
          {row.length === 1 ? <View style={s.flex1} /> : null}
        </View>
      ))}
    </View>
  );
}

// ── Status ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The web console's Badge: a tint, its deep text and a hairline of its colour. */
export function Badge({ label, tone = "neutral", style }: { label: string; tone?: Tone; style?: StyleProp<ViewStyle> }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const [bg, line, fg] = toneColors(a, tone);
  return (
    <View style={[s.badge, { backgroundColor: bg, borderColor: line }, style]}>
      <Text style={[s.badgeText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function toneColors(a: AdminPalette, tone: Tone): [string, string, string] {
  switch (tone) {
    case "ok":
      return [a.okTint[0], a.okTint[1], a.okDeep];
    case "warn":
      return [a.warnTint[0], a.warnTint[1], a.warnDeep];
    case "bad":
      return [a.badTint[0], a.badTint[1], a.badDeep];
    case "blue":
      return [a.blueTint[0], a.blueTint[1], a.brandDeep];
    case "prem":
      return [a.premTint[0], a.premTint[1], a.premDeep];
    case "choir":
      return [a.choirTint[0], a.choirTint[1], a.choir];
    default:
      return [a.sub, a.line, a.muted];
  }
}

/** A status dot with its halo: mint, amber, or red only for "Down". */
export function Dot({ tone = "ok", size = 8 }: { tone?: Tone; size?: number }) {
  const a = useAdminColors();
  const color = tone === "warn" ? a.warn : tone === "bad" ? a.bad : a.ok;
  const halo = tone === "warn" ? a.warnTint[0] : tone === "bad" ? a.badTint[0] : a.okTint[0];
  return (
    <View
      style={{
        width: size + 8,
        height: size + 8,
        borderRadius: (size + 8) / 2,
        backgroundColor: halo,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

/** The amber line that appears only when something needs a look; it opens what it names. */
export function AttentionLine({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const body = (
    <View style={s.attention}>
      <Icon name="problem" size={17} color={a.warn} />
      <Text style={s.attentionText}>{children}</Text>
      {onPress ? <Icon name="chevron" size={16} color={a.warn} /> : null}
    </View>
  );
  return onPress ? (
    <Touchable onPress={onPress} haptic="light">
      {body}
    </Touchable>
  ) : (
    body
  );
}

/** An amber note inside a card (the shared-inbox warning). */
export function WarnNote({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <View style={[s.warnNote, style]}>
      <Icon name="problem" size={16} color={a.warn} />
      <Text style={s.warnNoteText}>{children}</Text>
    </View>
  );
}

// ── Controls ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The console's segmented switch: a grey track, the chosen one raised. `wide` fills the row. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  wide = false,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  wide?: boolean;
}) {
  const s = useAdminStyles(makeStyles);
  return (
    <View style={[s.seg, wide && s.segWide]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Touchable
            key={o.value}
            onPress={() => onChange(o.value)}
            haptic="light"
            style={wide ? s.flex1 : undefined}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
          >
            <View style={[s.segItem, on && s.segOn]}>
              <Text style={[s.segText, on && s.segTextOn]}>{o.label}</Text>
            </View>
          </Touchable>
        );
      })}
    </View>
  );
}

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** An amber count after the label ("Needs a look 3"). */
  count?: number;
  /** A mint dot before it ("Online now"). */
  dot?: boolean;
}

/** The web's filters as a row of chips that scrolls sideways. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Touchable key={o.value} onPress={() => onChange(o.value)} haptic="light" accessibilityState={{ selected: on }} accessibilityLabel={o.label}>
            <View style={[s.chip, on && s.chipOn]}>
              {o.dot ? <View style={[s.chipDot, { backgroundColor: a.ok }]} /> : null}
              <Text style={[s.chipText, on && s.chipTextOn]}>{o.label}</Text>
              {o.count ? <Text style={s.chipCount}>{o.count}</Text> : null}
            </View>
          </Touchable>
        );
      })}
    </ScrollView>
  );
}

/** The console's switch (shadcn Switch): the fill blue when on. */
export function AdminSwitch({
  value,
  onChange,
  disabled,
  label,
}: {
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  const a = useAdminColors();
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: a.line, true: a.fill }}
      thumbColor="#FFFFFF"
      ios_backgroundColor={a.line}
      accessibilityLabel={label}
    />
  );
}

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A person's initials in a circle, with the mint dot while they are online. */
export function Initials({ text, size = 36, online = false }: { text: string; size?: number; online?: boolean }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.35 }]}>{text}</Text>
      {online ? <View style={[s.onDot, { backgroundColor: a.ok, borderColor: a.card }]} /> : null}
    </View>
  );
}

/** A list of rows in one card, with hairlines between them that start after the avatar. */
export function List({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useAdminStyles(makeStyles);
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.list, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={s.listRule} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** A row you tap: who or what, a quiet line, and an end column (an amount and a pill, a time). */
export function ListRow({
  leading,
  title,
  titleExtra,
  line,
  end,
  onPress,
  onLongPress,
  selected,
  accessibilityLabel,
}: {
  leading?: React.ReactNode;
  title: string;
  titleExtra?: React.ReactNode;
  line?: string;
  end?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  accessibilityLabel?: string;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const body = (
    <View style={[s.row, selected && { backgroundColor: a.selected }]}>
      {leading}
      <View style={s.rowMid}>
        <View style={s.rowTitleLine}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          {titleExtra}
        </View>
        {line ? (
          <Text style={s.rowLine} numberOfLines={1}>
            {line}
          </Text>
        ) : null}
      </View>
      {end ? <View style={s.rowEnd}>{end}</View> : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      scaleTo={motion.scale.row}
      accessibilityLabel={accessibilityLabel ?? [title, line].filter(Boolean).join(", ")}
    >
      {body}
    </Touchable>
  );
}

/** Grouped action rows (console actions on the phone): a neutral tile, a label, a line, a chevron or a switch. */
export function ActionRow({
  icon,
  label,
  hint,
  value,
  destructive,
  chevron = true,
  external,
  toggle,
  trailing,
  onPress,
  disabled,
}: {
  icon?: IconName;
  label: string;
  hint?: string;
  value?: string;
  /** The one red word (Suspend account): the label alone, never the icon or a fill. */
  destructive?: boolean;
  chevron?: boolean;
  external?: boolean;
  toggle?: { value: boolean; onChange: (on: boolean) => void; disabled?: boolean };
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const body = (
    <View style={[s.action, disabled && s.dim]}>
      {icon ? (
        <View style={s.actionTile}>
          <Icon name={icon} size={16} color={a.icon} />
        </View>
      ) : null}
      <View style={s.flex}>
        <Text style={[s.actionLabel, destructive && { color: a.bad }]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? <Text style={s.actionHint}>{hint}</Text> : null}
      </View>
      {value ? (
        <Text style={s.actionValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {toggle ? <AdminSwitch value={toggle.value} onChange={toggle.onChange} disabled={toggle.disabled} label={label} /> : null}
      {external ? <Icon name="external" size={15} color={a.dim} /> : !toggle && chevron && onPress ? <Icon name="chevron" size={15} color={a.dim} /> : null}
    </View>
  );
  if (!onPress || disabled) return body;
  return (
    <Touchable onPress={onPress} scaleTo={motion.scale.row} haptic={destructive ? "warning" : "light"} accessibilityLabel={label}>
      {body}
    </Touchable>
  );
}

/** A card of action rows with hairlines that start after the tile. */
export function ActionGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useAdminStyles(makeStyles);
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.list, style]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={s.actionRule} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** Definition rows: a muted term on the left, the value on the right. */
export function DefRows({ rows }: { rows: readonly { term: string; value: React.ReactNode; tone?: Tone; mono?: boolean }[] }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.term} style={[s.def, i > 0 && s.defRule]}>
          <Text style={s.defTerm}>{r.term}</Text>
          {typeof r.value === "string" ? (
            <Text
              style={[s.defValue, r.mono && s.mono, r.tone === "ok" && { color: a.ok }, r.tone === "warn" && { color: a.warn }]}
              numberOfLines={2}
            >
              {r.value}
            </Text>
          ) : (
            r.value
          )}
        </View>
      ))}
    </View>
  );
}

/** A thin bar: the free week, email quota, transcription outcomes. `mark` draws the optional-mail line. */
export function Meter({ pct, color, mark }: { pct: number; color: string; mark?: number }) {
  const a = useAdminColors();
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: a.sub, overflow: "visible", justifyContent: "center" }}>
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.max(0, Math.min(100, pct))}%`, borderRadius: 3, backgroundColor: color }} />
      {mark !== undefined ? (
        <View style={{ position: "absolute", left: `${Math.max(0, Math.min(100, mark))}%`, top: -3, width: 2, height: 12, borderRadius: 1, backgroundColor: a.muted }} />
      ) : null}
    </View>
  );
}

/** A centred spinner, an empty or failed state's sentence, and a try-again link. */
export function LoadState({ loading, error, empty, onRetry }: { loading?: boolean; error?: string | null; empty?: string; onRetry?: () => void }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  if (loading)
    return (
      <View style={s.state}>
        <ActivityIndicator color={a.muted} />
      </View>
    );
  if (error)
    return (
      <View style={s.state}>
        <Icon name="problem" size={20} color={a.warn} />
        <Text style={s.stateText}>{error}</Text>
        {onRetry ? <LinkText label="Try again" onPress={onRetry} /> : null}
      </View>
    );
  if (empty)
    return (
      <View style={s.state}>
        <Text style={s.stateText}>{empty}</Text>
      </View>
    );
  return null;
}

/** A square icon button with the console's hairline (search, re-check). */
export function IconBox({ icon, onPress, label, active }: { icon: IconName; onPress: () => void; label: string; active?: boolean }) {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  return (
    <Touchable onPress={onPress} accessibilityLabel={label} haptic="light">
      <View style={[s.iconBox, active && { borderColor: a.brand }]}>
        <Icon name={icon} size={18} color={active ? a.brand : a.text} />
      </View>
    </Touchable>
  );
}

export const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    flex1: { flex: 1 },
    dim: { opacity: 0.45 },
    mono: { fontFamily: "JetBrainsMono_500Medium", fontSize: 12.5 },

    panel: { backgroundColor: a.card, borderWidth: 1, borderColor: a.line, borderRadius: 12 },
    panelHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, paddingTop: 13, paddingHorizontal: 14 },
    panelTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    panelTitle: { fontFamily: fonts.semibold, fontSize: 14.5, color: a.text, letterSpacing: -0.1 },
    panelHint: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 2, lineHeight: 17 },
    panelBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
    panelBodyAlone: { paddingTop: 14 },

    section: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginTop: 18,
      paddingTop: 18,
      borderTopWidth: 1,
      borderTopColor: a.line,
      marginBottom: 12,
    },
    sectionTitle: { fontFamily: fonts.semibold, fontSize: 15.5, color: a.text, letterSpacing: -0.1 },
    groupLabelRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, marginBottom: 8, marginHorizontal: 4 },
    groupLabel: { fontFamily: fonts.medium, fontSize: 12.5, color: a.faint },
    groupLabelRight: { fontFamily: fonts.medium, fontSize: 12.5, color: a.muted },
    link: { fontFamily: fonts.medium, fontSize: 13, color: a.brand },
    linkHit: { minHeight: 32, justifyContent: "center" },

    change: { flexDirection: "row", alignItems: "center", gap: 1 },
    changeText: { fontFamily: fonts.medium, fontSize: 12, fontVariant: ["tabular-nums"] },

    grid: { gap: 10 },
    gridRow: { flexDirection: "row", gap: 10 },
    // flexGrow: two tiles in a row stay the same height when one sub-line takes two lines.
    tile: { flexGrow: 1, backgroundColor: a.card, borderWidth: 1, borderColor: a.line, borderRadius: 12, padding: 12, minHeight: 104 },
    tileLabel: { fontFamily: fonts.medium, fontSize: 12.5, color: a.muted },
    tileLabelCorner: { paddingRight: 60 },
    tileValueRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 10, flexWrap: "wrap" },
    tileValue: { fontFamily: fonts.semibold, fontSize: 24, color: a.text, letterSpacing: -0.4, fontVariant: ["tabular-nums"] },
    tileSub: { fontFamily: fonts.regular, fontSize: 12, color: a.muted, marginTop: 6 },
    tileCorner: { position: "absolute", right: 10, top: 12 },

    badge: { height: 21, paddingHorizontal: 5, borderRadius: 6, borderWidth: 1, alignSelf: "flex-start", justifyContent: "center" },
    badgeText: { fontFamily: fonts.medium, fontSize: 11 },

    attention: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: a.warnTint[1],
      backgroundColor: a.warnTint[0],
    },
    attentionText: { flex: 1, fontFamily: fonts.medium, fontSize: 13.5, color: a.warnDeep },
    warnNote: {
      flexDirection: "row",
      gap: 9,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.warnTint[1],
      backgroundColor: a.warnTint[0],
    },
    warnNoteText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: a.warnDeep },

    seg: { flexDirection: "row", gap: 2, padding: 2, borderRadius: 8, backgroundColor: a.sub, borderWidth: 1, borderColor: a.line, alignSelf: "flex-start" },
    segWide: { alignSelf: "stretch" },
    segItem: { minHeight: 32, paddingHorizontal: 12, borderRadius: 6, alignItems: "center", justifyContent: "center" },
    segOn: { backgroundColor: a.segOn, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    segText: { fontFamily: fonts.medium, fontSize: 13, color: a.muted },
    segTextOn: { color: a.text },

    chips: { gap: 6, paddingRight: 16 },
    chip: { minHeight: 34, paddingHorizontal: 11, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "transparent" },
    chipOn: { backgroundColor: a.sub, borderColor: a.line },
    chipDot: { width: 7, height: 7, borderRadius: 4 },
    chipText: { fontFamily: fonts.medium, fontSize: 13, color: a.muted },
    chipTextOn: { color: a.text },
    chipCount: { fontFamily: fonts.semibold, fontSize: 13, color: a.warn },

    avatar: { backgroundColor: a.sub, borderWidth: 1, borderColor: a.line, alignItems: "center", justifyContent: "center" },
    avatarText: { fontFamily: fonts.semibold, color: a.text },
    onDot: { position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },

    list: { backgroundColor: a.card, borderWidth: 1, borderColor: a.line, borderRadius: 12, overflow: "hidden" },
    listRule: { height: 1, backgroundColor: a.line, marginLeft: 60 },
    row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 62, paddingVertical: 10, paddingHorizontal: 12 },
    rowMid: { flex: 1, minWidth: 0 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    rowTitle: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14.5, color: a.text },
    rowLine: { fontFamily: fonts.regular, fontSize: 12, color: a.muted, marginTop: 3 },
    rowEnd: { alignItems: "flex-end", gap: 4 },

    action: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 8, paddingHorizontal: 12 },
    actionTile: { width: 30, height: 30, borderRadius: 8, backgroundColor: a.sub, alignItems: "center", justifyContent: "center" },
    actionLabel: { fontFamily: fonts.medium, fontSize: 15, color: a.text },
    actionHint: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, marginTop: 1, lineHeight: 17 },
    actionValue: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted, maxWidth: 140 },
    actionRule: { height: 1, backgroundColor: a.line, marginLeft: 54 },

    def: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 14, paddingVertical: 10 },
    defRule: { borderTopWidth: 1, borderTopColor: a.line2 },
    defTerm: { fontFamily: fonts.regular, fontSize: 13.5, color: a.muted },
    defValue: { flexShrink: 1, textAlign: "right", fontFamily: fonts.medium, fontSize: 13.5, color: a.text, fontVariant: ["tabular-nums"] },

    state: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 36, paddingHorizontal: 20 },
    stateText: { fontFamily: fonts.regular, fontSize: 14, color: a.muted, textAlign: "center", lineHeight: 20 },

    iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: a.sub, borderWidth: 1, borderColor: a.line, alignItems: "center", justifyContent: "center" },
  });
