import { Directory, File } from 'expo-file-system';
import { widgetsDirectory } from 'expo-widgets';

// The iPhone widget reads your hound's picture from a file in the app
// group it shares with the app. A new name for each look, so the widget
// never shows a stale copy; the old ones are cleared out.
export async function saveHoundImage(base64Png: string, key: string): Promise<string | null> {
  if (!widgetsDirectory) return null;
  const dir = new Directory(widgetsDirectory);
  const file = new File(dir, `hound-${key}.png`);
  // The new one first, so a write that fails leaves the widget its old
  // picture rather than a name that points at nothing.
  file.write(base64Png, { encoding: 'base64' });
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.startsWith('hound-') && entry.name !== file.name) entry.delete();
  }
  return file.uri;
}
