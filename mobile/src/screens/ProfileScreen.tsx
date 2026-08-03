import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../lib/auth';
import { meApi, authApi } from '../api/endpoints';
import { toApiError } from '../api/client';
import { colors, radii, spacing, typography } from '../design/theme';
import type { MyProfile } from '../api/types';

/** Account overview + password change + sign out. */
export function ProfileScreen() {
  const { user, setUser, signOut } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [name, setName] = useState(user?.fullName ?? '');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    meApi.get().then(setProfile).catch(() => undefined);
  }, []);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.fullName) return;
    try {
      const updated = await meApi.update(trimmed);
      setProfile(updated);
      setUser({ ...user!, fullName: updated.fullName });
    } catch (e) {
      Alert.alert('Could not update', toApiError(e).message);
    }
  }

  async function changePassword() {
    setPwBusy(true);
    try {
      await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      Alert.alert('Password updated');
    } catch (e) {
      Alert.alert('Could not change password', toApiError(e).message);
    } finally {
      setPwBusy(false);
    }
  }

  const initials = (user?.fullName ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <Text style={styles.name}>{user?.fullName}</Text>
      <Text style={styles.email}>{user?.email}</Text>
      <Text style={styles.role}>{profile?.role ?? user?.role ?? 'User'}</Text>

      <Text style={styles.section}>Profile</Text>
      <Card>
        <TextField label="Full name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Button label="Save name" variant="secondary" onPress={saveName} disabled={!name.trim() || name.trim() === user?.fullName} />
      </Card>

      <Text style={styles.section}>Password</Text>
      <Card>
        <TextField label="Current password" value={current} onChangeText={setCurrent} secure />
        <TextField label="New password" value={next} onChangeText={setNext} secure />
        <Button label="Change password" variant="secondary" onPress={changePassword} loading={pwBusy} disabled={!current || next.length < 8} />
      </Card>

      <Button label="Sign out" variant="danger" icon="log-out-outline" onPress={() => signOut()} style={styles.signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 120 },
  avatar: {
    alignSelf: 'center',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  avatarText: { ...typography.title, color: colors.onInk },
  name: { ...typography.heading, color: colors.text, textAlign: 'center', marginTop: spacing.md },
  email: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  role: {
    alignSelf: 'center',
    ...typography.caption,
    color: colors.onAccent,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  section: { ...typography.heading, color: colors.text, marginTop: spacing.xxl, marginBottom: spacing.md },
  signOut: { marginTop: spacing.xxl },
});
