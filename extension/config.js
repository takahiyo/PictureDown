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
    PROGRESS_BAR: "#progress"
  },
  MESSAGES: {
    START: "DOWNLOADING...",
    DONE: "COMPLETED",
    ERROR: "ERROR OCCURRED",
    ERROR_NO_IMAGE: "NO IMAGE FOUND",
    ERROR_PAGE_LOAD: "PAGE LOAD FAILED"
  },
  REQUEST_TYPES: {
    START: "START_DOWNLOAD",
    PROGRESS: "PROGRESS",
    DONE: "DONE",
    ERROR: "ERROR"
  },
  // ページ読み込み完了を待つ最大時間（ミリ秒）
  PAGE_LOAD_TIMEOUT: 15000,
  // リクエスト間の待機時間（ミリ秒）
  REQUEST_DELAY: 1500,
  DEFAULT_MAX_PAGES: 43
};
