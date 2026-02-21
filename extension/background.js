import { CONFIG } from './config.js';

/**
 * サムネイルURLをフルサイズURLに変換する。
 * Cloudflare Image Delivery のvariant部分を "public" に変更する。
 */
const toFullsizeUrl = (thumbnailUrl) => {
  if (!thumbnailUrl.includes('imagedelivery.net')) return thumbnailUrl;
  // 形式: https://imagedelivery.net/ACCOUNT/IMAGE_ID/VARIANT
  const parts = thumbnailUrl.split('/');
  if (parts.length >= 2) {
    parts[parts.length - 1] = 'public';
    return parts.join('/');
  }
  return thumbnailUrl;
};

/**
 * URLから安全なファイル拡張子を取得する。
 */
const getExtension = (url) => {
  const match = url.match(/\.(\w{2,5})(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : 'jpg';
};

/**
 * フォルダ名をサニタイズする。
 */
const sanitizeFolderName = (name) => {
  return name
    .replace(/[<>:"|?*\\]/g, '_')
    .replace(/\.+$/g, '')
    .trim() || 'download';
};

/**
 * ポップアップへ進捗を送信する。
 */
const sendProgress = (type, data = {}) => {
  chrome.runtime.sendMessage({ type, ...data }).catch(() => { });
};

/**
 * ビューアページのHTMLからフルサイズの画像URLを抽出する。
 * __NEXT_DATA__ の JSON を優先的に解析する。
 */
const extractImageUrlFromHtml = (html) => {
  // __NEXT_DATA__ から画像URLを取得
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const jsonStr = JSON.stringify(data?.props?.pageProps);

      // imagedelivery.net のURLを探す
      const cdnMatch = jsonStr.match(/https:\/\/imagedelivery\.net\/[^"\\]+/);
      if (cdnMatch) return toFullsizeUrl(cdnMatch[0]);

      // その他の画像URLを探す
      const imgMatch = jsonStr.match(/https?:\/\/[^"\\]+\.(?:jpg|jpeg|png|webp|gif)/i);
      if (imgMatch) return imgMatch[0];
    } catch (_e) {
      // 無視
    }
  }

  // og:image メタタグから取得
  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (ogMatch) return ogMatch[1];

  // imgタグから imagedelivery.net のURLを取得
  const imgMatch = html.match(/src="(https:\/\/imagedelivery\.net\/[^"]+)"/);
  if (imgMatch) return toFullsizeUrl(imgMatch[1]);

  return null;
};

/**
 * 方式A: サムネイル画像URLから直接ダウンロード（最速・ページ遷移なし）
 */
const downloadFromImageUrls = async (imageUrls, folderName) => {
  let successCount = 0;
  let failCount = 0;
  const total = imageUrls.length;

  console.log(`[PictureDown] 方式A: ${total}枚の画像URLから直接ダウンロード`);

  for (let i = 0; i < total; i++) {
    const fullUrl = toFullsizeUrl(imageUrls[i]);
    const paddedPage = String(i + 1).padStart(3, '0');
    const ext = getExtension(fullUrl);

    try {
      await chrome.downloads.download({
        url: fullUrl,
        filename: `${folderName}/${paddedPage}.${ext}`,
        saveAs: false,
        conflictAction: 'overwrite'
      });
      successCount++;
    } catch (e) {
      console.error(`[PictureDown] ダウンロード失敗 (${i + 1}/${total}):`, e);
      failCount++;
    }

    sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
      percentage: Math.floor(((i + 1) / total) * 100),
      current: i + 1,
      total,
      successCount,
      failCount
    });

    if (i < total - 1) {
      await new Promise(r => setTimeout(r, CONFIG.DOWNLOAD_DELAY));
    }
  }

  return { successCount, failCount };
};

/**
 * 方式B: ビューアページのURLリストから fetch() で画像URLを取得してダウンロード
 * ページ遷移不要。バックグラウンドの fetch() でHTMLを取得し、画像URLを抽出する。
 */
const downloadFromViewerLinks = async (viewerLinks, folderName) => {
  let successCount = 0;
  let failCount = 0;
  const total = viewerLinks.length;

  console.log(`[PictureDown] 方式B: ${total}件のビューアリンクから fetch で画像取得`);

  for (let i = 0; i < total; i++) {
    try {
      const response = await fetch(viewerLinks[i], {
        credentials: 'include',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3'
        }
      });

      if (!response.ok) {
        console.warn(`[PictureDown] fetch失敗 (${i + 1}): HTTP ${response.status}`);
        failCount++;
        sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
          percentage: Math.floor(((i + 1) / total) * 100),
          current: i + 1,
          total,
          successCount,
          failCount
        });
        continue;
      }

      const html = await response.text();
      const imgUrl = extractImageUrlFromHtml(html);

      if (imgUrl) {
        const paddedPage = String(i + 1).padStart(3, '0');
        const ext = getExtension(imgUrl);
        await chrome.downloads.download({
          url: imgUrl,
          filename: `${folderName}/${paddedPage}.${ext}`,
          saveAs: false,
          conflictAction: 'overwrite'
        });
        successCount++;
      } else {
        console.warn(`[PictureDown] 画像URL抽出失敗 (${i + 1}): ${viewerLinks[i]}`);
        failCount++;
      }
    } catch (e) {
      console.error(`[PictureDown] 方式Bエラー (${i + 1}):`, e);
      failCount++;
    }

    sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
      percentage: Math.floor(((i + 1) / total) * 100),
      current: i + 1,
      total,
      successCount,
      failCount
    });

    if (i < total - 1) {
      await new Promise(r => setTimeout(r, CONFIG.DOWNLOAD_DELAY));
    }
  }

  return { successCount, failCount };
};

/**
 * 方式C: ページ遷移方式（最後の手段）
 * タブを順番に遷移させ、DOM から画像URLを取得する。
 */
const downloadByNavigation = async (tabId, articleId, folderName, maxPages) => {
  let successCount = 0;
  let failCount = 0;
  const total = maxPages > 0 ? maxPages : 43;

  console.log(`[PictureDown] 方式C: ページ遷移方式 (${total}ページ)`);

  for (let i = 1; i <= total; i++) {
    const pageUrl = `${CONFIG.BASE_URL}${articleId}${CONFIG.PAGE_PARAM}${i}`;

    try {
      await chrome.tabs.update(tabId, { url: pageUrl });

      // ページ読み込み完了を待つ
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('タイムアウト'));
        }, CONFIG.PAGE_LOAD_TIMEOUT);

        const listener = (id, info) => {
          if (id === tabId && info.status === 'complete') {
            clearTimeout(timeout);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });

      // レンダリング待ち
      await new Promise(r => setTimeout(r, 2000));

      // タブ内で画像URL取得
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const nd = document.querySelector('#__NEXT_DATA__');
          if (nd) {
            try {
              const d = JSON.parse(nd.textContent);
              const s = JSON.stringify(d?.props?.pageProps);
              const m = s.match(/https:\/\/imagedelivery\.net\/[^"\\]+/);
              if (m) return m[0];
            } catch (_) { }
          }
          const imgs = document.querySelectorAll('img');
          for (const img of imgs) {
            const src = img.src || '';
            if (src.includes('imagedelivery.net')) return src;
            if (src && !src.includes('data:') && !src.includes('icon')
              && (img.naturalWidth > 200 || img.width > 200)) return src;
          }
          return null;
        }
      });

      const imgUrl = results?.[0]?.result;
      if (imgUrl) {
        const fullUrl = toFullsizeUrl(imgUrl);
        const ext = getExtension(fullUrl);
        const paddedPage = String(i).padStart(3, '0');
        await chrome.downloads.download({
          url: fullUrl,
          filename: `${folderName}/${paddedPage}.${ext}`,
          saveAs: false,
          conflictAction: 'overwrite'
        });
        successCount++;
      } else {
        failCount++;
      }
    } catch (e) {
      console.error(`[PictureDown] 方式Cエラー (ページ${i}):`, e);
      failCount++;
    }

    sendProgress(CONFIG.REQUEST_TYPES.PROGRESS, {
      percentage: Math.floor((i / total) * 100),
      current: i,
      total,
      successCount,
      failCount
    });

    if (i < total) {
      await new Promise(r => setTimeout(r, CONFIG.REQUEST_DELAY));
    }
  }

  return { successCount, failCount };
};

/**
 * メインのダウンロード処理。
 * 3つの方式を優先順位で試す：
 *   A) サムネイル画像URLから直接ダウンロード（最速）
 *   B) ビューアリンクを fetch して画像URLを取得（ページ遷移なし）
 *   C) タブ遷移方式（最後の手段）
 */
const startProcess = async (tabId, articleId, folderName, viewerLinks, imageUrls) => {
  const safeFolderName = sanitizeFolderName(folderName);
  let result;

  if (imageUrls && imageUrls.length > 0) {
    // 方式A: サムネイルURLから直接ダウンロード
    result = await downloadFromImageUrls(imageUrls, safeFolderName);

    // 1枚もダウンロードできなかった場合は方式Bへ
    if (result.successCount === 0 && viewerLinks && viewerLinks.length > 0) {
      console.log('[PictureDown] 方式A失敗、方式Bへフォールバック');
      result = await downloadFromViewerLinks(viewerLinks, safeFolderName);
    }
  } else if (viewerLinks && viewerLinks.length > 0) {
    // 方式B: ビューアリンクから fetch で取得
    result = await downloadFromViewerLinks(viewerLinks, safeFolderName);
  } else {
    // 方式C: ページ遷移方式（最後の手段）
    result = await downloadByNavigation(tabId, articleId, safeFolderName, 0);
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

// ポップアップからのメッセージを受信
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === CONFIG.REQUEST_TYPES.START) {
    startProcess(
      request.tabId,
      request.articleId,
      request.folderName,
      request.viewerLinks,
      request.imageUrls
    );
  }
});
