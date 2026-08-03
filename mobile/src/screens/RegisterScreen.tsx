import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useAuth } from '../lib/auth';
import { toApiError } from '../api/client';
import { colors, radii, spacing, typography } from '../design/theme';
import type { AuthStackParams } from '../navigation/types';

type Props = NativeStackScreenProps<AuthStackParams, 'Register'>;

export function RegisterScreen({ navigation }: Props) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Mirror the server's RegisterCommandValidator so users get instant feedback.
  const nameOk = fullName.trim().length >= 2;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const pwOk = password.length >= 8;
  const canSubmit = nameOk && emailOk && pwOk;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await signUp(fullName.trim(), email.trim(), password);
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Start turning melodies into notation.</Text>

        <View style={styles.form}>
          <TextField
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            placeholder="Ada Lovelace"
          />
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            placeholder="you@example.com"
            error={email.length > 0 && !emailOk ? 'Enter a valid email' : undefined}
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secure
            placeholder="At least 8 characters"
            error={password.length > 0 && !pwOk ? 'Minimum 8 characters' : undefined}
          />
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Button label="Create account" onPress={submit} loading={busy} disabled={!canSubmit} />
        <Button
          label="Back to sign in"
          variant="ghost"
          onPress={() => navigation.navigate('Login')}
          style={styles.secondary}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.title, color: colors.text, marginTop: spacing.xxl },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  form: { marginTop: spacing.xl },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: { ...typography.caption, color: colors.danger, marginLeft: spacing.sm, flex: 1 },
  secondary: { marginTop: spacing.sm },
});
