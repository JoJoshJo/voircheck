// The few Chrome extension APIs the popup uses (typecheck only; not shipped).
declare namespace chrome {
  namespace tabs {
    function query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<{ url?: string }[]>;
    function create(createProperties: { url: string }): Promise<unknown>;
  }
  namespace i18n {
    function getMessage(messageName: string): string;
    function getUILanguage(): string;
  }
}
