"use client";

const MUTE_KEY = "freshmarkets:notification-sound-muted";
const LAST_KEY = "freshmarkets:notification-sound-last";
const RECENT_KEY = "freshmarkets:notification-sound-recent";
const SOUND_LOCK = "freshmarkets-notification-sound";
const MAX_RECENT = 128;
let channel: BroadcastChannel | null = null;
const heard = new Set<string>();
let interacted = false;
let audioContext: AudioContext | null = null;
let lastScheduledAt = Number.NEGATIVE_INFINITY;

function remember(identity: string): void {
  heard.delete(identity);
  heard.add(identity);
  if (heard.size > MAX_RECENT) {
    const oldest = heard.values().next().value;
    if (oldest) heard.delete(oldest);
  }
}

function recentIdentities(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (Array.isArray(stored) && stored.length)
      return stored
        .filter((value): value is string => typeof value === "string")
        .slice(-MAX_RECENT);
    const last = localStorage.getItem(LAST_KEY);
    return last ? [last] : [];
  } catch {
    try {
      const last = localStorage.getItem(LAST_KEY);
      return last ? [last] : [];
    } catch {
      return [];
    }
  }
}

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
  soundChannel();
  window.addEventListener("storage", (event) => {
    if (event.key === RECENT_KEY) for (const identity of recentIdentities()) remember(identity);
  });
}

function soundChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  try {
    channel = new BroadcastChannel(SOUND_LOCK);
  } catch {
    return null;
  }
  channel.onmessage = (event: MessageEvent<string>) => {
    if (typeof event.data === "string") remember(event.data);
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
  if (typeof document === "undefined") return;
  const play = async () => {
    if (
      document.visibilityState !== "visible" ||
      notificationSoundMuted() ||
      heard.has(identity) ||
      recentIdentities().includes(identity) ||
      !(navigator.userActivation?.hasBeenActive || interacted)
    )
      return;
    try {
      resumeAudio();
      const audio = audioContext;
      if (!audio) return;
      if (audio.state !== "running") await audio.resume();
      if (audio.state !== "running") return;
      const startAt = Math.max(audio.currentTime, lastScheduledAt + 0.22);
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(880, startAt + 0.12);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.19);
      lastScheduledAt = startAt;
      remember(identity);
      try {
        localStorage.setItem(
          RECENT_KEY,
          JSON.stringify([...recentIdentities(), identity].slice(-MAX_RECENT)),
        );
        localStorage.setItem(LAST_KEY, identity);
      } catch {
        /* Browser storage is optional. */
      }
      soundChannel()?.postMessage(identity);
    } catch {
      /* Autoplay policy or device settings may prevent sound. */
    }
  };
  try {
    if (navigator.locks) await navigator.locks.request(SOUND_LOCK, play);
    else await play();
  } catch {
    await play();
  }
}
