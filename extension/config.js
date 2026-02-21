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
    ERROR: "ERROR OCCURRED"
  },
  REQUEST_TYPES: {
    START: "START_DOWNLOAD",
    PROGRESS: "PROGRESS",
    DONE: "DONE"
  },
  DEFAULT_MAX_PAGES: 43
};
