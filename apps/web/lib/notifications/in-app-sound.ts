"use client";

const MUTE_KEY = "freshmarkets:notification-sound-muted";
const LAST_KEY = "freshmarkets:notification-sound-last";
let channel: BroadcastChannel | null = null;
const heard = new Set<string>();
let interacted = false;
let audioContext: AudioContext | null = null;

function resumeAudio(): void {
  if (typeof AudioContext === "undefined") return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state !== "running") void audioContext.resume().catch(() => {});
  } catch {
    /* An unavailable audio device must not affect the notification. */
  }
}

if (typeof document !== "undefined") {
  const activate = () => {
    interacted = true;
    if (!notificationSoundMuted()) resumeAudio();
  };
  document.addEventListener("pointerdown", activate, { once: true, capture: true });
  document.addEventListener("keydown", activate, { once: true, capture: true });
}

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
  if (!muted) resumeAudio();
}

/** A short cue only for a new event in a visible, previously interacted-with tab. */
export async function playInAppNotificationSound(identity: string): Promise<void> {
  if (
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    notificationSoundMuted() ||
    heard.has(identity) ||
    !(navigator.userActivation?.hasBeenActive || interacted)
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
    resumeAudio();
    const audio = audioContext;
    if (!audio) return;
    if (audio.state !== "running") await audio.resume();
    if (audio.state !== "running") return;
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
  } catch {
    /* Autoplay policy or device settings may prevent sound. */
  }
}
