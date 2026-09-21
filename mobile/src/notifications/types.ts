export interface NotificationPreferences {
  pushEnabled: boolean;
  emailEnabled: boolean;
}

// The two "Alerts" toggles (SettingsScreen) that are actually wired to a
// real backend job — see 0025_challenge_alerts.sql,
// send-stale-data-alerts, send-daily-standings. The card's third toggle
// ("Someone closes within 2 miles of me") needs live GPS tracking this
// app doesn't have yet, so it isn't part of this shape and stays hidden
// in the UI rather than wired to nothing.
export interface AlertPreferences {
  staleDataEnabled: boolean;
  dailyStandingsEnabled: boolean;
}
