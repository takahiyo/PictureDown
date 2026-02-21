export const CONFIG = {
  DOMAIN: "hentaipaw.com",
  BASE_URL: "https://hentaipaw.com/viewer?articleId=",
  PAGE_PARAM: "&page=",
  CLASSES: {
    HIDDEN: "is-hidden",
    ACTIVE: "is-active",
    ERROR: "is-error"
  },
  CSS_VARS: {
    PROGRESS_WIDTH: "--progress-width"
  },
  SELECTORS: {
    START_BTN: "#start-download",
    STATUS_TEXT: "#status-message",
    PROGRESS_BAR: "#progress",
    FOLDER_NAME: "#folder-name",
    PAGE_INFO: "#page-info"
  },
  MESSAGES: {
    START: "DOWNLOADING...",
    DONE: "COMPLETED",
    ERROR: "ERROR OCCURRED",
    ERROR_NO_IMAGE: "NO IMAGE FOUND",
    ERROR_PAGE_LOAD: "PAGE LOAD FAILED",
    SCANNING: "SCANNING PAGES..."
  },
  REQUEST_TYPES: {
    START: "START_DOWNLOAD",
    PROGRESS: "PROGRESS",
    DONE: "DONE",
    ERROR: "ERROR"
  },
  // ダウンロード間の待機時間（ミリ秒）
  DOWNLOAD_DELAY: 500,
  // ページ遷移方式のリクエスト間隔（ミリ秒・フォールバック用）
  REQUEST_DELAY: 1500,
  // ページ読み込みタイムアウト（ミリ秒・フォールバック用）
  PAGE_LOAD_TIMEOUT: 15000,
  // Cloudflare Image Delivery のvariant変換リスト
  // サムネイルのvariantをフルサイズに変換するためのパターン
  FULLSIZE_VARIANTS: ["public", "original"],
  THUMBNAIL_VARIANTS: ["thumbnail", "small", "thumb", "sm", "md", "medium", "w=200", "w=300", "w=400"]
};
