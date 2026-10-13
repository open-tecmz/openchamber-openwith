/**
 * Panel copy in the user's language.
 *
 * OpenChamber hands the guest a BCP-47 tag through `HostReadyContext.locale`
 * on every `onReady` snapshot; the panel picks the closest dictionary and
 * falls back to English. Adding a language is one block in `DICTIONARIES`.
 *
 * Manifest strings (panel name, description) cannot be localized by the
 * extension API — they stay as declared in `package.json`.
 */

export type Locale = 'en' | 'zh-cn' | 'zh-tw';

export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  title: 'Open With',
  noProject: 'No project open',
  'mode.service': 'Local service',
  'mode.off': 'Service off',
  'mode.unknown': 'Connecting',
  'count.detecting': 'Checking…',
  'count.available': '{n} available',
  'count.none': 'None found',
  refresh: 'Refresh',
  detecting: 'Checking installed apps…',
  'banner.off.title': 'The local service is off',
  'banner.off.body': 'Opening a project needs the extension local service. Approve it in Settings → Extensions, then reopen the panel.',
  'banner.error.title': 'Cannot reach the local service',
  'banner.error.body': 'Wait a moment or reopen the panel.',
  'empty.noProject.title': 'No project open',
  'empty.noProject.body': 'Open a project in OpenChamber to open it in an app.',
  'empty.none.title': 'No supported app installed',
  'empty.none.body': 'None of the apps this panel knows about were found. Install one and press Refresh.',
  'status.installed': 'Installed',
  'status.missing': 'Not installed',
  'open.ariaLabel': 'Open in {app}',
  'app.terminal': 'Terminal',
  'app.fileManager': 'File manager',
  'toast.opened': 'Opened with {app}',
  'toast.openFailed': 'Could not open with {app}',
  'toast.loadFailed': 'Could not check the installed apps',
} as const;

export type MessageKey = keyof typeof en;
type Dictionary = Record<MessageKey, string>;

const zhCn: Dictionary = {
  title: '打开方式',
  noProject: '未打开项目',
  'mode.service': '本地服务',
  'mode.off': '服务未启用',
  'mode.unknown': '连接中',
  'count.detecting': '检测中…',
  'count.available': '{n} 个可用',
  'count.none': '未找到',
  refresh: '刷新',
  detecting: '正在检测已安装的软件…',
  'banner.off.title': '本地服务未启用',
  'banner.off.body': '打开项目需要扩展的本地服务。请在「设置 → 扩展」中批准后重新打开面板。',
  'banner.error.title': '无法连接本地服务',
  'banner.error.body': '请稍候或重新打开面板。',
  'empty.noProject.title': '未打开项目',
  'empty.noProject.body': '在 OpenChamber 中打开一个项目后即可用其它软件打开它。',
  'empty.none.title': '没有可用的软件',
  'empty.none.body': '没有检测到面板支持的软件。安装一个后点击「刷新」。',
  'status.installed': '已安装',
  'status.missing': '未安装',
  'open.ariaLabel': '用 {app} 打开',
  'app.terminal': '终端',
  'app.fileManager': '文件管理器',
  'toast.opened': '已用 {app} 打开',
  'toast.openFailed': '无法用 {app} 打开',
  'toast.loadFailed': '检测已安装软件失败',
};

const zhTw: Dictionary = {
  title: '開啟方式',
  noProject: '未開啟專案',
  'mode.service': '本地服務',
  'mode.off': '服務未啟用',
  'mode.unknown': '連線中',
  'count.detecting': '偵測中…',
  'count.available': '{n} 個可用',
  'count.none': '未找到',
  refresh: '重新整理',
  detecting: '正在偵測已安裝的軟體…',
  'banner.off.title': '本地服務未啟用',
  'banner.off.body': '開啟專案需要擴充功能的本地服務。請在「設定 → 擴充功能」中核准後重新開啟面板。',
  'banner.error.title': '無法連線本地服務',
  'banner.error.body': '請稍候或重新開啟面板。',
  'empty.noProject.title': '未開啟專案',
  'empty.noProject.body': '在 OpenChamber 中開啟一個專案後即可用其它軟體開啟它。',
  'empty.none.title': '沒有可用的軟體',
  'empty.none.body': '沒有偵測到面板支援的軟體。安裝一個後點擊「重新整理」。',
  'status.installed': '已安裝',
  'status.missing': '未安裝',
  'open.ariaLabel': '用 {app} 開啟',
  'app.terminal': '終端機',
  'app.fileManager': '檔案管理器',
  'toast.opened': '已用 {app} 開啟',
  'toast.openFailed': '無法用 {app} 開啟',
  'toast.loadFailed': '偵測已安裝軟體失敗',
};

const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  'zh-cn': zhCn,
  'zh-tw': zhTw,
};

/** Map an OpenChamber locale tag to the closest dictionary, defaulting to English. */
export const resolveLocale = (tag: string | null | undefined): Locale => {
  const value = (tag ?? '').toLowerCase().replace('_', '-');
  if (value === 'en' || value.startsWith('en-')) return 'en';
  if (value.startsWith('zh')) {
    return /(tw|hk|mo|hant)/.test(value) ? 'zh-tw' : 'zh-cn';
  }
  return DEFAULT_LOCALE;
};

export type MessageParams = Record<string, string | number>;
export type Translator = (key: MessageKey, params?: MessageParams) => string;

const interpolate = (template: string, params?: MessageParams): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
};

export const createTranslator = (tag: string | null | undefined): Translator => {
  const dictionary = DICTIONARIES[resolveLocale(tag)];
  return (key, params) => interpolate(dictionary[key] ?? en[key] ?? key, params);
};
