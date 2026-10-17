import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BuildingsIcon, PawPrintIcon, ShieldCheckIcon } from 'phosphor-react-native';
import { font, withAlpha, type Palette } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';

// The slim bar above every tab: the Hound mark (tap it to go to Today),
// and the two management icons for the people who have something to
// manage. Everything else
// that used to live up here (Help, Locker, your name for Settings) is on
// the You tab, and the tabs themselves are at the bottom (TabBar).
export function TopNav({
  onHome,
  onAdmin,
  onOrgManagement,
}: {
  onHome: () => void;
  onAdmin: () => void;
  // Passed the caller's own org id when they're only an org admin (not a
  // platform admin) — MainScreen uses that to skip straight to
  // OrgDetailScreen for their one org. Omitted (undefined) for a
  // platform admin, who lands on the OrgManagementScreen hub instead.
  onOrgManagement: (organizationId?: string) => void;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const canManageOrgs = !!user?.isAdmin || user?.orgRole === 'admin';

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.brandRow}>
        <Pressable
          style={({ pressed }) => [styles.brandLink, pressed && { opacity: 0.7 }]}
          onPress={onHome}
          hitSlop={6}
          accessibilityRole="link"
          accessibilityLabel="Hound, go to Today"
        >
          <View style={styles.brandMark}>
            <PawPrintIcon size={16} color={colors.accent} weight="fill" />
          </View>
          <Text style={styles.brandName}>Hound</Text>
        </Pressable>
        <View style={styles.pushRight} />
        {canManageOrgs && (
          <Pressable
            style={styles.iconButton}
            onPress={() => onOrgManagement(user?.isAdmin ? undefined : user?.organizationId ?? undefined)}
            accessibilityLabel="Organizations"
          >
            <BuildingsIcon size={16} color={colors.accent} />
          </Pressable>
        )}
        {user?.isAdmin && (
          <Pressable style={styles.iconButton} onPress={onAdmin} accessibilityLabel="Admin">
            <ShieldCheckIcon size={16} color={colors.accent} />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    safe: {
      backgroundColor: withAlpha(colors.bg, 0.96),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
      minHeight: 48,
    },
    // The mark and name together, as one tap target, gapped like the row.
    brandLink: { flexDirection: 'row', alignItems: 'center', gap: 9 },
    brandMark: {
      width: 28,
      height: 28,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandName: { fontFamily: font.headingSemibold, fontSize: 17, color: colors.text, letterSpacing: 0.2 },
    pushRight: { flex: 1 },
    iconButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
    },
  });
}
