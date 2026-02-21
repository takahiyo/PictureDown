import { CONFIG } from './config.js';

const DOM = {
  startBtn: document.querySelector(CONFIG.SELECTORS.START_BTN),
  statusText: document.querySelector(CONFIG.SELECTORS.STATUS_TEXT),
  progressBar: document.querySelector(CONFIG.SELECTORS.PROGRESS_BAR),
  folderName: document.querySelector(CONFIG.SELECTORS.FOLDER_NAME),
  pageInfo: document.querySelector(CONFIG.SELECTORS.PAGE_INFO)
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
 * 記事一覧ページからビューアページへのリンクURLを収集する。
 */
const scanArticlePage = async (tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // ビューアページへのリンクを収集
      const viewerLinks = [];
      const anchors = document.querySelectorAll('a[href*="viewer"]');
      for (const a of anchors) {
        const href = a.href;
        if (href && !viewerLinks.includes(href)) {
          viewerLinks.push(href);
        }
      }

      // imagedelivery.net の画像URLも念のため収集
      const imageUrls = [];
      const seenIds = new Set();
      const getImageId = (url) => {
        const match = url.match(/imagedelivery\.net\/[^/]+\/([^/]+)/);
        return match ? match[1] : url;
      };

      // __NEXT_DATA__ から画像URLを取得
      const nextDataEl = document.querySelector('#__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const data = JSON.parse(nextDataEl.textContent);
          const jsonStr = JSON.stringify(data?.props?.pageProps);
          const matches = jsonStr.matchAll(/https:\/\/imagedelivery\.net\/[^"\\]+/g);
          for (const m of matches) {
            const imgId = getImageId(m[0]);
            if (!seenIds.has(imgId)) {
              seenIds.add(imgId);
              imageUrls.push(m[0]);
            }
          }
        } catch (_e) {
          // 無視
        }
      }

      // DOM上のimgタグからも収集
      if (imageUrls.length === 0) {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
          const src = img.src || img.getAttribute('data-src') || '';
          if (src.includes('imagedelivery.net')) {
            const imgId = getImageId(src);
            if (!seenIds.has(imgId)) {
              seenIds.add(imgId);
              imageUrls.push(src);
            }
          }
        }
      }

      return { viewerLinks, imageUrls };
    }
  });

  return results?.[0]?.result ?? { viewerLinks: [], imageUrls: [] };
};

/**
 * URLから記事IDを取得する（2つの形式に対応）。
 */
const extractArticleId = (tabUrl) => {
  const url = new URL(tabUrl);
  const queryId = url.searchParams.get('articleId');
  if (queryId) return queryId;
  const pathMatch = url.pathname.match(/\/(\d+)(?:\/|$)/);
  if (pathMatch) return pathMatch[1];
  return null;
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
 * 初期化処理。
 */
const init = async () => {
  chrome.runtime.onMessage.addListener(handleMessage);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url.includes(CONFIG.DOMAIN)) {
    const articleId = extractArticleId(tab.url);
    if (articleId) {
      DOM.folderName.value = `hentaipaw_${articleId}`;

      // 記事ページをスキャン
      try {
        const scanResult = await scanArticlePage(tab.id);
        const pageCount = scanResult.viewerLinks.length || scanResult.imageUrls.length;
        if (pageCount > 0) {
          DOM.pageInfo.textContent = `${pageCount} ページ検出`;
          DOM.pageInfo.classList.remove(CONFIG.CLASSES.HIDDEN);
        }
      } catch (_e) {
        // スキャン失敗は無視
      }
    }
  }

  DOM.startBtn.addEventListener('click', async () => {
    DOM.startBtn.classList.add(CONFIG.CLASSES.HIDDEN);
    DOM.progressBar.classList.remove(CONFIG.CLASSES.HIDDEN);
    updateProgress(0);
    updateStatus(CONFIG.MESSAGES.SCANNING);

    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (currentTab && currentTab.url.includes(CONFIG.DOMAIN)) {
      const articleId = extractArticleId(currentTab.url);

      if (!articleId) {
        updateStatus('記事IDが見つかりません', true);
        DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
        return;
      }

      const folderName = DOM.folderName.value.trim() || `hentaipaw_${articleId}`;

      // 記事ページをスキャン
      let scanResult = { viewerLinks: [], imageUrls: [] };
      try {
        scanResult = await scanArticlePage(currentTab.id);
        console.log('[PictureDown] スキャン結果:', scanResult);
      } catch (e) {
        console.warn('[PictureDown] スキャン失敗:', e);
      }

      updateStatus(CONFIG.MESSAGES.START);

      chrome.runtime.sendMessage({
        type: CONFIG.REQUEST_TYPES.START,
        tabId: currentTab.id,
        articleId,
        folderName,
        viewerLinks: scanResult.viewerLinks,
        imageUrls: scanResult.imageUrls
      });
    } else {
      updateStatus(CONFIG.MESSAGES.ERROR, true);
      DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
    }
  });
};

init();
