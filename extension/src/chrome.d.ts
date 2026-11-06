// Minimal ambient typings for the chrome.* APIs used by the Vosio extension (no @types/chrome dependency allowed).

type ChromeListener = (...args: never[]) => unknown;

interface ChromeEvent<T extends ChromeListener> {
  addListener(callback: T): void;
  removeListener(callback: T): void;
  hasListener(callback: T): boolean;
}

declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
      origin?: string;
    }
    interface ExtensionContext {
      contextType: string;
      contextId: string;
      documentUrl?: string;
    }
    const id: string;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    function getURL(path: string): string;
    function getContexts(filter: { contextTypes?: string[]; documentUrls?: string[] }): Promise<ExtensionContext[]>;
    function getManifest(): { version: string; name: string };
    function openOptionsPage(): Promise<void>;
    const onMessage: ChromeEvent<(message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void>;
    const onInstalled: ChromeEvent<(details: { reason: string }) => void>;
    const onStartup: ChromeEvent<() => void>;
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    interface StorageArea {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
    const sync: StorageArea;
    const session: StorageArea;
    const onChanged: ChromeEvent<(changes: Record<string, StorageChange>, areaName: string) => void>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      windowId?: number;
      url?: string;
      title?: string;
      active?: boolean;
      status?: string;
    }
    interface TabChangeInfo {
      url?: string;
      status?: string;
      title?: string;
    }
    function query(queryInfo: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean; url?: string | string[] }): Promise<Tab[]>;
    function get(tabId: number): Promise<Tab>;
    function create(properties: { url: string; active?: boolean }): Promise<Tab>;
    function sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
    const onRemoved: ChromeEvent<(tabId: number) => void>;
    const onUpdated: ChromeEvent<(tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void>;
    const onActivated: ChromeEvent<(activeInfo: { tabId: number; windowId: number }) => void>;
  }

  namespace tabCapture {
    function getMediaStreamId(options: { targetTabId?: number; consumerTabId?: number }): Promise<string>;
  }

  namespace offscreen {
    function createDocument(parameters: { url: string; reasons: string[]; justification: string }): Promise<void>;
    function closeDocument(): Promise<void>;
  }

  namespace identity {
    function launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string | undefined>;
    function getRedirectURL(path?: string): string;
  }

  namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
    }
    function create(name: string, alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    const onAlarm: ChromeEvent<(alarm: Alarm) => void>;
  }

  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
    function setPopup(details: { popup: string; tabId?: number }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
    function openPopup(): Promise<void>;
    const onClicked: ChromeEvent<(tab: tabs.Tab) => void>;
  }

  namespace commands {
    const onCommand: ChromeEvent<(command: string, tab?: tabs.Tab) => void>;
    function getAll(): Promise<Array<{ name?: string; description?: string; shortcut?: string }>>;
  }

  namespace notifications {
    function create(notificationId: string, options: { type: "basic"; iconUrl: string; title: string; message: string }): Promise<string>;
    function clear(notificationId: string): Promise<boolean>;
    const onClicked: ChromeEvent<(notificationId: string) => void>;
  }

  namespace permissions {
    interface Permissions {
      origins?: string[];
      permissions?: string[];
    }
    function request(permissions: Permissions): Promise<boolean>;
    function contains(permissions: Permissions): Promise<boolean>;
    function remove(permissions: Permissions): Promise<boolean>;
  }

  namespace scripting {
    interface RegisteredContentScript {
      id: string;
      matches?: string[];
      js?: string[];
      runAt?: "document_start" | "document_end" | "document_idle";
      persistAcrossSessions?: boolean;
    }
    function registerContentScripts(scripts: RegisteredContentScript[]): Promise<void>;
    function unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
    function getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<RegisteredContentScript[]>;
  }
}

// Chrome-specific constraints accepted by getUserMedia for tab capture streams.
interface MediaTrackConstraintSet {
  mandatory?: { chromeMediaSource: string; chromeMediaSourceId: string };
}
