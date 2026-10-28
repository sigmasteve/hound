import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Text } from '../components/Text';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme } from '../theme/ThemeContext';
import { adPrivacyOptionsRequired, showAdPrivacyOptions } from './rewardedBones';

// Settings → Ads: lets someone in the EU or UK change the choice they made
// on Google's consent form. Only shown where Google says it's needed.
export function AdPrivacyCard() {
  const { text } = useTheme();
  const [required, setRequired] = useState(false);

  useEffect(() => {
    adPrivacyOptionsRequired().then(setRequired);
  }, []);

  if (!required) return null;
  return (
    <Card style={{ gap: 10 }} elevated={false}>
      <Text style={text.h4}>Ads</Text>
      <Button
        label="Ad privacy choices"
        variant="secondary"
        small
        onPress={() =>
          showAdPrivacyOptions().catch((e) =>
            Alert.alert("Couldn't open your choices", e instanceof Error ? e.message : 'Try again.'),
          )
        }
      />
    </Card>
  );
}
