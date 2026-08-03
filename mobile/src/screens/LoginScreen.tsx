import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../lib/auth';
import { toApiError } from '../api/client';
import { colors, gradients, radii, spacing, typography } from '../design/theme';
import type { AuthStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParams, 'Login'>;

export function LoginScreen({ navigation }: Props) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 3 && password.length > 0;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // On success the AuthProvider flips the root navigator — no manual nav needed.
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <LinearGradient colors={gradients.brand} style={styles.mark}>
            <Ionicons name="musical-notes" size={30} color={colors.text} />
          </LinearGradient>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to pick up where you left off.</Text>
        </View>

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secure
          placeholder="••••••••"
        />

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button label="Sign in" onPress={submit} loading={busy} disabled={!canSubmit} />
        <Button
          label="Create an account"
          variant="ghost"
          onPress={() => navigation.navigate('Register')}
          style={styles.secondary}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginTop: spacing.xxxl, marginBottom: spacing.xxl },
  mark: {
    width: 64,
    height: 64,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(240, 87, 107, 0.1)',
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { ...typography.caption, color: colors.danger, marginLeft: spacing.sm, flex: 1 },
  secondary: { marginTop: spacing.sm },
});
