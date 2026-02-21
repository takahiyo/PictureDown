import { CONFIG } from './config.js';

/**
 * サムネイルURLをフルサイズURLに変換する。
 * Cloudflare Image Delivery のvariant部分を変更する。
 *
 * 例: .../IMAGE_ID/thumbnail → .../IMAGE_ID/public
 */
const toFullsizeUrl = (thumbnailUrl) => {
  // imagedelivery.net のURL形式: https://imagedelivery.net/ACCOUNT/IMAGE_ID/VARIANT
  // 末尾のvariant部分を "public" に変換
  const parts = thumbnailUrl.split('/');
  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    // 既知のサムネイルvariantを検出してフルサイズに変換
    const isKnownVariant = CONFIG.THUMBNAIL_VARIANTS.some(v =>
      lastPart.toLowerCase().includes(v)
    );
    if (isKnownVariant || thumbnailUrl.includes('imagedelivery.net')) {
      parts[parts.length - 1] = CONFIG.FULLSIZE_VARIANTS[0]; // "public"
      return parts.join('/');
    }
  }
  return thumbnailUrl;
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
 * タブのページ読み込み完了を待つ（フォールバック用）。
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
 * タブ内でスクリプトを実行し、ビューアページから画像URLを取得する（フォールバック用）。
 */
const extractImageFromTab = async (tabId) => {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // __NEXT_DATA__ から画像URLを取得
      const nextDataEl = document.querySelector('#__NEXT_DATA__');
      if (nextDataEl) {
        try {
          const data = JSON.parse(nextDataEl.textContent);
          const props = data?.props?.pageProps;
          if (props) {
            const jsonStr = JSON.stringify(props);
            const cdnMatch = jsonStr.match(/https:\/\/imagedelivery\.net\/[^"\\]+/);
            if (cdnMatch) return cdnMatch[0];
            const imgMatch = jsonStr.match(/https?:\/\/[^"\\]+\.(?:jpg|jpeg|png|webp|gif)/i);
            if (imgMatch) return imgMatch[0];
          }
        } catch (_e) {
          // 無視
        }
      }

      // DOM上の img タグから取得
      const allImages = document.querySelectorAll('img');
      for (const img of allImages) {
        const src = img.src || img.getAttribute('data-src') || '';
        if (src.includes('imagedelivery.net')) {
          return src;
        }
      }

      // 大きい画像を探す
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

      return null;
    }
  });

  return results?.[0]?.result ?? null;
};

/**
 * 方式1: サムネイルURLリストから直接ダウンロードする（高速・ページ遷移なし）。
 */
const downloadFromThumbnails = async (imageUrls, articleId, folderName) => {
  let successCount = 0;
  let failCount = 0;
  const total = imageUrls.length;

  for (let i = 0; i < total; i++) {
    const fullUrl = toFullsizeUrl(imageUrls[i]);
    const paddedPage = String(i + 1).padStart(3, '0');
    const ext = getExtension(fullUrl);

    try {
      await chrome.downloads.download({
        url: fullUrl,
        filename: `${folderName}/${paddedPage}.${ext}`,
        conflictAction: 'overwrite'
      });
      successCount++;
    } catch (e) {
      console.error(`[PictureDown] ダウンロード失敗 (${i + 1}/${total}):`, e);
      failCount++;
    }

    // 進捗を通知
    const percentage = Math.floor(((i + 1) / total) * 100);
    sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
      percentage,
      current: i + 1,
      total,
      successCount,
      failCount
    });

    // 連続リクエストの負荷軽減
    if (i < total - 1) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.DOWNLOAD_DELAY));
    }
  }

  return { successCount, failCount };
};

/**
 * 方式2: ページ遷移方式でダウンロードする（フォールバック）。
 */
const downloadByNavigation = async (tabId, articleId, folderName, totalPages) => {
  let successCount = 0;
  let failCount = 0;
  // ページ数が不明な場合は43をデフォルトに
  const maxPages = totalPages > 0 ? totalPages : 43;

  for (let i = 1; i <= maxPages; i++) {
    const pageUrl = `${CONFIG.BASE_URL}${articleId}${CONFIG.PAGE_PARAM}${i}`;

    try {
      // タブを対象ページに遷移させる
      await chrome.tabs.update(tabId, { url: pageUrl });
      await waitForTabLoad(tabId);

      // DOM レンダリング待ち
      await new Promise(resolve => setTimeout(resolve, 2000));

      const imgUrl = await extractImageFromTab(tabId);

      if (imgUrl) {
        const ext = getExtension(imgUrl);
        const paddedPage = String(i).padStart(3, '0');
        await chrome.downloads.download({
          url: imgUrl,
          filename: `${folderName}/${paddedPage}.${ext}`,
          conflictAction: 'overwrite'
        });
        successCount++;
      } else {
        console.warn(`[PictureDown] ページ ${i} で画像が見つかりません: ${pageUrl}`);
        failCount++;
      }

      // 進捗を通知
      const percentage = Math.floor((i / maxPages) * 100);
      sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
        percentage,
        current: i,
        total: maxPages,
        successCount,
        failCount
      });

      if (i < maxPages) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.REQUEST_DELAY));
      }

    } catch (e) {
      console.error(`[PictureDown] ページ ${i} でエラー:`, e);
      failCount++;

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

  return { successCount, failCount };
};

/**
 * メインのダウンロード処理。
 * サムネイルURLが取得できていれば直接ダウンロード、
 * 取得できていなければページ遷移方式で実行する。
 */
const startProcess = async (tabId, articleId, folderName, imageUrls, totalPages) => {
  let result;

  if (imageUrls && imageUrls.length > 0) {
    // 方式1: サムネイルURLリストから直接ダウンロード（高速）
    console.log(`[PictureDown] サムネイル方式: ${imageUrls.length}枚の画像を検出`);
    result = await downloadFromThumbnails(imageUrls, articleId, folderName);
  } else {
    // 方式2: ページ遷移方式（フォールバック）
    console.log(`[PictureDown] ページ遷移方式にフォールバック`);
    result = await downloadByNavigation(tabId, articleId, folderName, totalPages);
  }

  // 完了通知
  if (result.successCount > 0) {
    sendProgress(CONFIG.REQUEST_TYPES.DONE, result);
  } else {
    sendProgress(CONFIG.REQUEST_TYPES.ERROR, {
      message: CONFIG.MESSAGES.ERROR_NO_IMAGE,
      ...result
    });
  }
};

// ポップアップからのメッセージを受信する
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === CONFIG.REQUEST_TYPES.START) {
    startProcess(
      request.tabId,
      request.articleId,
      request.folderName,
      request.imageUrls,
      request.totalPages
    );
  }
});
