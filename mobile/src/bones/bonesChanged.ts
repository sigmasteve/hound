// "Your Bones balance may have just changed": the top bar's Bones chip
// (TopNav) listens and re-reads it, so an award or a purchase on the same
// screen shows straight away instead of on the next tab change.

type Listener = () => void;
const listeners = new Set<Listener>();

export function onBonesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyBonesChanged(): void {
  listeners.forEach((l) => l());
}
