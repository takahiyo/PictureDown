import { CONFIG } from './config.js';

const DOM = {
  startBtn: document.querySelector(CONFIG.SELECTORS.START_BTN),
  statusText: document.querySelector(CONFIG.SELECTORS.STATUS_TEXT),
  progressBar: document.querySelector(CONFIG.SELECTORS.PROGRESS_BAR)
};

/**
 * ステータスメッセージを更新する。
 */
const updateStatus = (message, isError = false) => {
  DOM.statusText.textContent = message;
  DOM.statusText.classList.remove(CONFIG.CLASSES.HIDDEN);
  if (isError) {
    DOM.statusText.classList.add(CONFIG.CLASSES.ERROR);
  } else {
    DOM.statusText.classList.remove(CONFIG.CLASSES.ERROR);
  }
};

/**
 * プログレスバーを更新する。
 */
const updateProgress = (percentage) => {
  document.documentElement.style.setProperty(
    CONFIG.CSS_VARS.PROGRESS_WIDTH,
    `${percentage}%`
  );
};

/**
 * バックグラウンドからのメッセージを処理する。
 */
const handleMessage = (request) => {
  if (request.type === CONFIG.REQUEST_TYPES.PROGRESS) {
    updateProgress(request.percentage);
    const failInfo = request.failCount > 0
      ? ` | 失敗: ${request.failCount}`
      : '';
    updateStatus(
      `${CONFIG.MESSAGES.START} (${request.current}/${request.total}${failInfo})`
    );
  }

  if (request.type === CONFIG.REQUEST_TYPES.DONE) {
    updateProgress(100);
    const resultMsg = request.failCount > 0
      ? `${CONFIG.MESSAGES.DONE} (成功: ${request.successCount}, 失敗: ${request.failCount})`
      : CONFIG.MESSAGES.DONE;
    updateStatus(resultMsg);
    DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
  }

  if (request.type === CONFIG.REQUEST_TYPES.ERROR) {
    updateProgress(100);
    updateStatus(
      `${request.message || CONFIG.MESSAGES.ERROR} (成功: ${request.successCount}, 失敗: ${request.failCount})`,
      true
    );
    DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
  }
};

/**
 * 初期化処理。ボタンのクリックイベントとメッセージリスナーを設定する。
 */
const init = () => {
  chrome.runtime.onMessage.addListener(handleMessage);

  DOM.startBtn.addEventListener('click', async () => {
    DOM.startBtn.classList.add(CONFIG.CLASSES.HIDDEN);
    DOM.progressBar.classList.remove(CONFIG.CLASSES.HIDDEN);
    updateProgress(0);
    updateStatus(CONFIG.MESSAGES.START);

    // 現在のアクティブタブの情報を取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.includes(CONFIG.DOMAIN)) {
      // URLからarticleIdを取得
      const urlParams = new URLSearchParams(new URL(tab.url).search);
      const articleId = urlParams.get('articleId');

      if (!articleId) {
        updateStatus('記事IDが見つかりません', true);
        DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
        return;
      }

      // バックグラウンドにタブIDと一緒にダウンロード開始を通知
      chrome.runtime.sendMessage({
        type: CONFIG.REQUEST_TYPES.START,
        tabId: tab.id,
        articleId: articleId,
        maxPages: CONFIG.DEFAULT_MAX_PAGES
      });
    } else {
      updateStatus(CONFIG.MESSAGES.ERROR, true);
      DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
    }
  });
};

init();
