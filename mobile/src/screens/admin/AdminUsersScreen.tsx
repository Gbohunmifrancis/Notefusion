import React, { useEffect, useState } from "react";
import { Linking, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AdminPage, AdminTopBar, PageTitle } from "../../components/admin/AdminChrome";
import { Badge, FilterChips, Initials, List, ListRow, LoadState } from "../../components/admin/AdminUI";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { Touchable } from "../../components/Touchable";
import { adminApi } from "../../api/endpoints";
import type { AdminUserRow, LiveActivity, PagedResult } from "../../api/types";
import { useAdminData, useAdminQuery } from "../../lib/adminCache";
import { showDialog } from "../../lib/dialog";
import { fonts, type AdminPalette } from "../../design/theme";
import { useAdminColors, useAdminStyles } from "../../lib/theme";
import { ago, count, initials, parseUtc } from "../../lib/adminFormat";
import type { AdminStackParams } from "../../navigation/types";

type Filter = "all" | "pro" | "free" | "online" | "suspended";
type Sort = "lastSeen" | "newest";

const PAGE = 30;

/**
 * The web's Users table as rows (board f-admin/05): search by name or email, its filters as chips, its two sorts,
 * team and test accounts hidden unless asked for. Each row: who, Pro in gold (choir in violet), email and country,
 * last seen (mint while online) and transcriptions. A long press offers Email and Copy email.
 */
export function AdminUsersScreen() {
  const a = useAdminColors();
  const s = useAdminStyles(makeStyles);
  const nav = useNavigation<NativeStackNavigationProp<AdminStackParams>>();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("lastSeen");
  const [team, setTeam] = useState(false);
  const [pages, setPages] = useState(1);
  const live = useAdminData<LiveActivity>("live");

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPages(1), [term, filter, sort, team]);

  const users = useAdminQuery<PagedResult<AdminUserRow>>(`users:${term}:${filter}:${sort}:${team}:${pages}`, () =>
    adminApi.users({
      page: 1,
      pageSize: PAGE * pages,
      search: term || undefined,
      sort: sort === "lastSeen" ? "lastSeen" : undefined,
      includeInternal: team || undefined,
      lastSeen: filter === "online" ? "online" : undefined,
      isActive: filter === "suspended" ? false : undefined,
      plan: filter === "pro" || filter === "free" ? filter : undefined,
    }),
  );

  const now = new Date();
  const rows = users.data?.items ?? [];

  const pickSort = () =>
    showDialog({
      title: "Sort",
      actions: [
        { label: "Recently seen", icon: "clock", selected: sort === "lastSeen", onPress: () => setSort("lastSeen") },
        { label: "Newest accounts", icon: "user-plus", selected: sort === "newest", onPress: () => setSort("newest") },
      ],
    });

  const offer = (u: AdminUserRow) =>
    showDialog({
      title: u.fullName || u.email,
      message: u.email,
      actions: [
        { label: "Email", icon: "mail", onPress: () => void Linking.openURL(`mailto:${u.email}`).catch(() => undefined) },
        { label: "Copy email", icon: "copy", onPress: () => void Share.share({ message: u.email }).catch(() => undefined) },
        { label: "Cancel", style: "cancel" },
      ],
    });

  return (
    <AdminPage header={<AdminTopBar />} onRefresh={users.refresh} refreshing={users.refreshing}>
      <PageTitle
        title="Users"
        sub={users.data ? `${count(users.data.totalCount)} accounts · ${team ? "team included" : "customers only"}` : " "}
      />
      <View style={s.search}>
        <Icon name="search" size={17} color={a.faint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or email"
          placeholderTextColor={a.dim}
          style={s.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search by name or email"
        />
      </View>
      <View style={s.gap12}>
        <FilterChips
          options={[
            { value: "all", label: "All" },
            { value: "pro", label: "Pro" },
            { value: "free", label: "Free" },
            { value: "online", label: live ? `Online now ${live.online.length}` : "Online now", dot: true },
            { value: "suspended", label: "Suspended" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </View>
      <View style={s.sortRow}>
        <Touchable onPress={pickSort} ripple={false} accessibilityLabel="Sort">
          <View style={s.sort}>
            <Text style={s.sortMuted}>Sort</Text>
            <Text style={s.sortValue}>{sort === "lastSeen" ? "Recently seen" : "Newest accounts"}</Text>
            <Icon name="down" size={14} color={a.muted} />
          </View>
        </Touchable>
        <Touchable onPress={() => setTeam((t) => !t)} ripple={false} accessibilityLabel={team ? "Hide team accounts" : "Show team accounts"}>
          <Text style={s.sortMuted}>{team ? "Team accounts shown" : "Team accounts hidden"}</Text>
        </Touchable>
      </View>

      {rows.length ? (
        <List>
          {rows.map((u) => {
            const seen = u.lastSeenAtUtc ? parseUtc(u.lastSeenAtUtc) : null;
            return (
              <ListRow
                key={u.id}
                leading={<Initials text={initials(u.fullName || u.email)} online={u.isOnline} />}
                title={u.fullName || u.email}
                titleExtra={
                  <View style={s.badges}>
                    {!u.isActive ? <Badge label="Suspended" tone="bad" /> : null}
                    <Badge label={u.hasProAccess || u.inChoir ? "Pro" : "Free"} tone={u.hasProAccess || u.inChoir ? "prem" : "neutral"} />
                    {u.inChoir ? <Badge label="Choir" tone="choir" /> : null}
                  </View>
                }
                line={[u.email, u.country].filter(Boolean).join(" · ")}
                end={
                  <>
                    <Text style={[s.seen, u.isOnline && { color: a.ok }]}>{u.isOnline ? "Online" : seen ? ago(seen, now) : "Never"}</Text>
                    <View style={s.countRow}>
                      <Icon name="transcribe" size={12} color={a.faint} />
                      <Text style={s.count}>{count(u.transcriptionCount)}</Text>
                    </View>
                  </>
                }
                onPress={() => nav.navigate("AdminUser", { userId: u.id })}
                onLongPress={() => offer(u)}
              />
            );
          })}
        </List>
      ) : (
        <LoadState loading={users.loading} error={users.error} empty={term ? "No account matches that." : "No accounts here."} onRetry={users.refresh} />
      )}
      {users.data && users.data.totalCount > rows.length ? (
        <Button label="Show more" variant="text" onPress={() => setPages((p) => p + 1)} style={s.more} />
      ) : null}
    </AdminPage>
  );
}

const makeStyles = (a: AdminPalette) =>
  StyleSheet.create({
    gap12: { marginTop: 12 },
    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      height: 48,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: a.line,
      backgroundColor: a.card,
      marginTop: 14,
    },
    searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 16, color: a.text, paddingVertical: 0 },
    sortRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, marginBottom: 8, paddingHorizontal: 2 },
    sort: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 40 },
    sortMuted: { fontFamily: fonts.regular, fontSize: 13, color: a.muted },
    sortValue: { fontFamily: fonts.medium, fontSize: 13, color: a.text },
    badges: { flexDirection: "row", gap: 4 },
    seen: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, fontVariant: ["tabular-nums"] },
    countRow: { flexDirection: "row", alignItems: "center", gap: 3 },
    count: { fontFamily: fonts.regular, fontSize: 12.5, color: a.muted, fontVariant: ["tabular-nums"] },
    more: { alignSelf: "center", marginTop: 8 },
  });
