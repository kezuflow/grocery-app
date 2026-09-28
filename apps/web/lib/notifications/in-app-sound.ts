"use client";

const MUTE_KEY = "freshmarkets:notification-sound-muted";
const LAST_KEY = "freshmarkets:notification-sound-last";
let channel: BroadcastChannel | null = null;
let heard = new Set<string>();

function soundChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel("freshmarkets-notification-sound");
  channel.onmessage = (event: MessageEvent<string>) => {
    if (typeof event.data === "string") heard.add(event.data);
  };
  return channel;
}

export function notificationSoundMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotificationSoundMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* This tab still updates its control. */
  }
}

/** A short cue only for a new event in a visible, previously interacted-with tab. */
export async function playInAppNotificationSound(identity: string): Promise<void> {
  if (
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    notificationSoundMuted() ||
    heard.has(identity) ||
    !navigator.userActivation?.hasBeenActive
  )
    return;
  try {
    if (localStorage.getItem(LAST_KEY) === identity) return;
    localStorage.setItem(LAST_KEY, identity);
  } catch {
    /* Browser storage is optional. */
  }
  heard.add(identity);
  soundChannel()?.postMessage(identity);
  try {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, audio.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.19);
    window.setTimeout(() => void audio.close(), 350);
  } catch {
    /* Autoplay policy or device settings may prevent sound. */
  }
}
