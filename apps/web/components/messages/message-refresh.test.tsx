// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  OrderConversationView,
  OrderConversationsPage,
  OrderMessagesPage,
} from "@freshmarkets/contracts";
import { playInAppNotificationSound } from "@/lib/notifications/in-app-sound";
import { useOrderMessagesInbox } from "./use-order-messages-inbox";
import { useOrderThread } from "./use-order-thread";

vi.mock("@/lib/notifications/in-app-sound", () => ({
  notificationSoundMuted: () => false,
  playInAppNotificationSound: vi.fn(async () => undefined),
  setNotificationSoundMuted: vi.fn(),
}));

const conversation = (sequence: number, incoming: number[], unread = 1): OrderConversationView => ({
  orderId: "order-1",
  orderNumber: "FM-1",
  latestMessageAt: new Date(1_800_000_000_000 + sequence).toISOString(),
  latestMessagePreview: "Update",
  unreadCount: unread,
  lastSequence: sequence,
  recentIncomingSequences: incoming,
  expiresAt: null,
});

function reply<T>(value: T): Response {
  return { ok: true, json: async () => ({ ok: true, value, requestId: "test" }) } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(playInAppNotificationSound).mockClear();
  vi.stubGlobal(
    "WebSocket",
    class {
      static OPEN = 1;
      readyState = 0;
      close() {}
    },
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("sounds each new incoming sequence when unread count stays constant and focus catches up", async () => {
  const first: OrderConversationsPage = {
    items: [conversation(1, [1])],
    nextCursor: null,
    totalUnreadCount: 1,
  };
  const second: OrderConversationsPage = {
    items: [conversation(3, [1, 2, 3])],
    nextCursor: null,
    totalUnreadCount: 1,
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(reply(first))
    .mockResolvedValueOnce(reply(second));
  vi.stubGlobal("fetch", fetchMock);
  function Probe() {
    const inbox = useOrderMessagesInbox("CUSTOMER");
    return <span>{inbox.totalUnreadCount}</span>;
  }
  await act(async () => root.render(<Probe />));
  expect(host.textContent).toBe("1");
  expect(playInAppNotificationSound).not.toHaveBeenCalled();
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(vi.mocked(playInAppNotificationSound).mock.calls).toEqual([
    ["message:order-1:2"],
    ["message:order-1:3"],
  ]);
});

it("keeps the newest thread response when overlapping reads finish backward", async () => {
  const older = deferred<Response>();
  const newer = deferred<Response>();
  const empty: OrderMessagesPage = {
    conversation: conversation(0, [], 0),
    items: [],
    nextBeforeSequence: null,
  };
  const updated: OrderMessagesPage = {
    ...empty,
    items: [
      {
        id: "message-1",
        orderId: "order-1",
        sequence: 1,
        senderKind: "ADMIN",
        body: "New update",
        attachments: [],
        createdAt: new Date(1_800_000_000_001).toISOString(),
      },
    ],
  };
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") return Promise.resolve({ ok: true } as Response);
      gets++;
      return gets === 1
        ? Promise.resolve(reply(empty))
        : gets === 2
          ? older.promise
          : newer.promise;
    }),
  );
  let refresh!: () => void;
  function Probe() {
    const thread = useOrderThread("CUSTOMER", "order-1");
    refresh = thread.refresh;
    return <span>{thread.page?.items.map((item) => item.body).join(",") ?? ""}</span>;
  }
  await act(async () => root.render(<Probe />));
  await act(async () => {
    refresh();
    refresh();
  });
  await act(async () => newer.resolve(reply(updated)));
  expect(host.textContent).toBe("New update");
  await act(async () => older.resolve(reply(empty)));
  expect(host.textContent).toBe("New update");
  expect(playInAppNotificationSound).toHaveBeenCalledWith("message:order-1:1");
});
