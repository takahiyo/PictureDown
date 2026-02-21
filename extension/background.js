import { CONFIG } from './config.js';

/**
 * タブのページ読み込み完了を待つ。
 * タイムアウト時間を超えた場合は reject する。
 */
const waitForTabLoad = (tabId) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('ページ読み込みタイムアウト'));
    }, CONFIG.PAGE_LOAD_TIMEOUT);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
};

/**
 * タブ内でスクリプトを実行し、画像URLを取得する。
 *
 * Next.js の __NEXT_DATA__ や DOM 上の img タグから画像URLを探す。
 * この関数はタブのコンテキスト内で実行されるため、
 * document へ直接アクセスできる。
 */
const extractImageFromTab = async (tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // 方法1: __NEXT_DATA__ から画像URLを取得
      const nextDataEl = document.querySelector('#__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const data = JSON.parse(nextDataEl.textContent);
          // Next.js の pageProps にある画像情報を探す
          const props = data?.props?.pageProps;
          if (props) {
            const jsonStr = JSON.stringify(props);
            // imagedelivery.net のURLを探す
            const cdnMatch = jsonStr.match(/https:\/\/imagedelivery\.net\/[^"\\]+/);
            if (cdnMatch) return cdnMatch[0];
            // その他の画像URLを探す
            const imgMatch = jsonStr.match(/https?:\/\/[^"\\]+\.(?:jpg|jpeg|png|webp|gif)/i);
            if (imgMatch) return imgMatch[0];
          }
        } catch (_e) {
          // JSON パースエラーは無視して次の方法へ
        }
      }

      // 方法2: DOM上の img タグから画像URLを取得
      // imagedelivery.net のCDN画像を優先
      const allImages = document.querySelectorAll('img');
      for (const img of allImages) {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src.includes('imagedelivery.net')) {
          return src;
        }
      }

      // 方法3: 大きいサイズの img タグを探す（ビューア画像は通常大きい）
      for (const img of allImages) {
        const src = img.src || img.getAttribute('data-src') || '';
        if (
          src &&
          !src.includes('data:') &&
          !src.includes('favicon') &&
          !src.includes('logo') &&
          !src.includes('icon') &&
          (img.naturalWidth > 200 || img.width > 200 || !img.complete)
        ) {
          return src;
        }
      }

      // 方法4: CSS背景画像を探す
      const bgElements = document.querySelectorAll('[style*="background"]');
      for (const el of bgElements) {
        const bgMatch = el.style.backgroundImage?.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/);
        if (bgMatch && bgMatch[1].includes('imagedelivery.net')) {
          return bgMatch[1];
        }
      }

      // 方法5: picture > source タグを探す
      const sources = document.querySelectorAll('picture source, picture img');
      for (const source of sources) {
        const srcset = source.srcset || source.src || '';
        if (srcset.includes('imagedelivery.net')) {
          // srcset から最初のURLを取得
          return srcset.split(/[\s,]+/)[0];
        }
      }

      return null;
    }
  });

  // executeScript の結果は配列で返る（各フレームごと）
  return results?.[0]?.result ?? null;
};

/**
 * URLから安全なファイル拡張子を取得する。
 * 判定できない場合は "jpg" を返す。
 */
const getExtension = (url) => {
  const match = url.match(/\.(\w{2,5})(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : 'jpg';
};

/**
 * バックグラウンドからポップアップへメッセージを送信する。
 * ポップアップが閉じている場合のエラーは無視する。
 */
const sendProgress = (type, data = {}) => {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => { });
};

/**
 * メインのダウンロード処理。
 * ページ1～maxPagesまで順に、タブを遷移させて画像を取得・保存する。
 */
const startProcess = async (tabId, articleId, maxPages) => {
  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i <= maxPages; i++) {
    const pageUrl = `${CONFIG.BASE_URL}${articleId}${CONFIG.PAGE_PARAM}${i}`;

    try {
      // タブを対象ページに遷移させる
      await chrome.tabs.update(tabId, { url: pageUrl });

      // ページ読み込み完了を待つ
      await waitForTabLoad(tabId);

      // DOMが完全にレンダリングされるまで少し待つ
      // （Next.js のハイドレーションに時間がかかる場合がある）
      await new Promise(resolve => setTimeout(resolve, 2000));

      // タブ内で画像URLを抽出する
      const imgUrl = await extractImageFromTab(tabId);

      if (imgUrl) {
        const ext = getExtension(imgUrl);
        const paddedPage = String(i).padStart(3, '0');
        await chrome.downloads.download({
          url: imgUrl,
          filename: `hentaipaw_${articleId}_${paddedPage}.${ext}`,
          conflictAction: 'overwrite'
        });
        successCount++;
      } else {
        console.warn(`[PictureDown] ページ ${i} で画像が見つかりません: ${pageUrl}`);
        failCount++;
      }

      // 進捗をポップアップに通知
      const percentage = Math.floor((i / maxPages) * 100);
      sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
        percentage,
        current: i,
        total: maxPages,
        successCount,
        failCount
      });

      // サーバー負荷軽減のためリクエスト間隔を空ける
      if (i < maxPages) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_DELAY));
      }

    } catch (e) {
      console.error(`[PictureDown] ページ ${i} でエラー:`, e);
      failCount++;

      // エラーが起きても進捗は通知する
      const percentage = Math.floor((i / maxPages) * 100);
      sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
        percentage,
        current: i,
        total: maxPages,
        successCount,
        failCount
      });
    }
  }

  // 完了通知
  if (successCount > 0) {
    sendProgress(CONFIG.REQUEST_TYPES.DONE, { successCount, failCount });
  } else {
    // 1枚もダウンロードできなかった場合はエラーとして通知
    sendProgress(CONFIG.REQUEST_TYPES.ERROR, {
      message: CONFIG.MESSAGES.ERROR_NO_IMAGE,
      successCount,
      failCount
    });
  }
};

// ポップアップからのメッセージを受信する
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === CONFIG.REQUEST_TYPES.START) {
    startProcess(request.tabId, request.articleId, request.maxPages);
  }
});
