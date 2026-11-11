declare namespace chrome {
    namespace runtime {
        const id: string;
        const lastError: {
            message?: string;
        } | undefined;
        function getURL(path: string): string;
        function sendMessage(message: unknown): Promise<unknown>;
        function openOptionsPage(): Promise<void>;
        const onInstalled: {
            addListener(fn: () => void): void;
        };
        const onMessage: {
            addListener(fn: (message: unknown, sender: MessageSender, reply: (value: unknown) => void) => boolean | void): void;
        };
        interface MessageSender {
            id?: string;
            url?: string;
            tab?: tabs.Tab;
            frameId?: number;
        }
    }
    namespace storage {
        interface Area {
            get(key?: string | string[] | null): Promise<Record<string, unknown>>;
            set(items: Record<string, unknown>): Promise<void>;
            remove(key: string | string[]): Promise<void>;
            clear(): Promise<void>;
            setAccessLevel(options: {
                accessLevel: 'TRUSTED_CONTEXTS';
            }): Promise<void>;
        }
        const local: Area;
        const onChanged: {
            addListener(fn: (changes: Record<string, {
                oldValue?: unknown;
                newValue?: unknown;
            }>, area: string) => void): void;
        };
    }
    namespace tabs {
        interface Tab {
            id?: number;
            url?: string;
        }
        function query(q: {
            active?: boolean;
            currentWindow?: boolean;
        }): Promise<Tab[]>;
        function sendMessage(id: number, message: unknown): Promise<unknown>;
        function create(p: {
            url: string;
        }): Promise<Tab>;
    }
    namespace scripting {
        function executeScript(p:{target:{tabId:number};world:'MAIN';func:()=>unknown}):Promise<Array<{result?:unknown}>>;
        function executeScript(p: {
            target: {
                tabId: number;
            };
            files: string[];
        }): Promise<unknown>;
        function registerContentScripts(p: {
            id: string;
            matches: string[];
            js: string[];
            runAt: 'document_idle';
            persistAcrossSessions: boolean;
        }[]): Promise<void>;
        function getRegisteredContentScripts(): Promise<{
            id: string;
        }[]>;
        function unregisterContentScripts(p: {
            ids: string[];
        }): Promise<void>;
    }
    namespace permissions {
        function request(p: {
            origins: string[];
        }): Promise<boolean>;
        function contains(p: {
            origins: string[];
        }): Promise<boolean>;
        function getAll(): Promise<{
            origins?: string[];
        }>;
        const onAdded: {
            addListener(fn: () => void): void;
        };
        const onRemoved: {
            addListener(fn: () => void): void;
        };
    }
    namespace contextMenus {
        function create(p: {
            id: string;
            title: string;
            contexts: string[];
        }): void;
        function removeAll(): Promise<void>;
        const onClicked: {
            addListener(fn: (info: {
                menuItemId: string | number;
                selectionText?: string;
            }, tab?: tabs.Tab) => void): void;
        };
    }
    namespace commands {
        const onCommand: {
            addListener(fn: (command: string, tab?: tabs.Tab) => void): void;
        };
    }
    namespace i18n {
        function detectLanguage(text: string): Promise<{
            isReliable: boolean;
            languages: {
                language: string;
                percentage: number;
            }[];
        }>;
    }
}

declare namespace chrome.sidePanel {function open(options:{tabId:number}):Promise<void>;}
