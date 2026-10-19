// Android's widget takes the picture as data, which is stored with the
// rest of the widget's numbers (houndImage.ios.ts saves a file instead).
export async function saveHoundImage(base64Png: string, _key: string): Promise<string | null> {
  return `data:image/png;base64,${base64Png}`;
}
