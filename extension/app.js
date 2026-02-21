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
 * 記事一覧ページからページ数とサムネイルURL一覧を取得する。
 * タブ内でスクリプトを実行し、サムネイル画像の情報を返す。
 */
const scanArticlePage = async (tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // 記事ページのサムネイル画像を収集する
      const imageUrls = [];

      // 方法1: __NEXT_DATA__ からページデータを取得
      const nextDataEl = document.querySelector('#__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const data = JSON.parse(nextDataEl.textContent);
          const jsonStr = JSON.stringify(data?.props?.pageProps);
          // imagedelivery.net のURLをすべて取得
          const cdnMatches = jsonStr.matchAll(/https:\/\/imagedelivery\.net\/[^"\\]+/g);
          for (const m of cdnMatches) {
            if (!imageUrls.includes(m[0])) {
              imageUrls.push(m[0]);
            }
          }
        } catch (_e) {
          // パースエラーは無視
        }
      }

      // 方法2: DOM上のimgタグからimagedelivery.netのURLを取得
      if (imageUrls.length === 0) {
        const allImages = document.querySelectorAll('img');
        for (const img of allImages) {
          const src = img.src || img.getAttribute('data-src') || '';
          if (src.includes('imagedelivery.net') && !imageUrls.includes(src)) {
            imageUrls.push(src);
          }
        }
      }

      // 方法3: サムネイルへのリンク(a[href*="viewer"])の数からページ数を取得
      const viewerLinks = document.querySelectorAll('a[href*="viewer"]');
      const linkCount = viewerLinks.length;

      return {
        imageUrls,
        linkCount,
        totalFromDom: Math.max(imageUrls.length, linkCount)
      };
    }
  });

  return results?.[0]?.result ?? { imageUrls: [], linkCount: 0, totalFromDom: 0 };
};

/**
 * URLから記事IDを取得する（2つの形式に対応）。
 */
const extractArticleId = (tabUrl) => {
  const url = new URL(tabUrl);

  // 形式1: /viewer?articleId=2374668
  const queryId = url.searchParams.get('articleId');
  if (queryId) return queryId;

  // 形式2: /articles/2374668
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
 * ページ情報のスキャンとボタン・メッセージリスナーの設定。
 */
const init = async () => {
  chrome.runtime.onMessage.addListener(handleMessage);

  // 現在のタブから記事IDを取得してフォルダ名のデフォルト値を設定
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url.includes(CONFIG.DOMAIN)) {
    const articleId = extractArticleId(tab.url);
    if (articleId) {
      // フォルダ名のデフォルト値を設定
      DOM.folderName.value = `hentaipaw_${articleId}`;

      // 記事ページのサムネイル数を自動取得
      try {
        const scanResult = await scanArticlePage(tab.id);
        if (scanResult.totalFromDom > 0) {
          DOM.pageInfo.textContent = `${scanResult.totalFromDom} ページ検出`;
          DOM.pageInfo.classList.remove(CONFIG.CLASSES.HIDDEN);
        }
      } catch (_e) {
        // スキャン失敗は無視（手動で進行可能）
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

      // フォルダ名を取得（空の場合はデフォルト値を使用）
      const folderName = DOM.folderName.value.trim() || `hentaipaw_${articleId}`;

      // 記事ページからサムネイルURLを取得
      let scanResult = { imageUrls: [], linkCount: 0, totalFromDom: 0 };
      try {
        scanResult = await scanArticlePage(currentTab.id);
      } catch (_e) {
        // スキャン失敗時はフォールバック
      }

      updateStatus(CONFIG.MESSAGES.START);

      // バックグラウンドにダウンロード開始を通知
      chrome.runtime.sendMessage({
        type: CONFIG.REQUEST_TYPES.START,
        tabId: currentTab.id,
        articleId,
        folderName,
        imageUrls: scanResult.imageUrls,
        totalPages: scanResult.totalFromDom
      });
    } else {
      updateStatus(CONFIG.MESSAGES.ERROR, true);
      DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
    }
  });
};

init();
