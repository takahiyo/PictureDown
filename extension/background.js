import { CONFIG } from './config.js';

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
 * 1枚の画像をダウンロードする。
 * フォルダ付きファイル名で失敗した場合は、フォルダなしでも試す。
 */
const downloadOneImage = async (imgUrl, folderName, pageNum) => {
  const paddedPage = String(pageNum).padStart(3, '0');
  const ext = getExtension(imgUrl);

  // まずフォルダ付きで試す
  try {
    const downloadId = await chrome.downloads.download({
      url: imgUrl,
      filename: `${folderName}/${paddedPage}.${ext}`,
      saveAs: false,
      conflictAction: 'overwrite'
    });
    console.log(`[PictureDown] DL成功 (ID:${downloadId}): ${folderName}/${paddedPage}.${ext}`);
    return true;
  } catch (e) {
    console.warn(`[PictureDown] フォルダ付きDL失敗、フォルダなしで再試行:`, e.message);
  }

  // フォルダなしで再試行
  try {
    const downloadId = await chrome.downloads.download({
      url: imgUrl,
      filename: `${folderName}_${paddedPage}.${ext}`,
      saveAs: false,
      conflictAction: 'overwrite'
    });
    console.log(`[PictureDown] DL成功 (ID:${downloadId}): ${folderName}_${paddedPage}.${ext}`);
    return true;
  } catch (e2) {
    console.error(`[PictureDown] DL完全失敗:`, e2.message);
    return false;
  }
};

/**
 * ビューアページのHTMLから画像URLを抽出する。
 */
const extractImageUrlFromHtml = (html) => {
  // __NEXT_DATA__ から画像URLを取得
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const jsonStr = JSON.stringify(data?.props?.pageProps);
      const cdnMatch = jsonStr.match(/https:\/\/imagedelivery\.net\/[^"\\]+/);
      if (cdnMatch) return cdnMatch[0];
      const imgMatch = jsonStr.match(/https?:\/\/[^"\\]+\.(?:jpg|jpeg|png|webp|gif)/i);
      if (imgMatch) return imgMatch[0];
    } catch (_e) {
      // 無視
    }
  }

  // og:image から取得
  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (ogMatch) return ogMatch[1];

  // imgタグから imagedelivery.net のURLを取得
  const imgMatch = html.match(/src="(https:\/\/imagedelivery\.net\/[^"]+)"/);
  if (imgMatch) return imgMatch[1];

  return null;
};

/**
 * 方式A: 画像URLリストから直接ダウンロード（最速・ページ遷移なし）
 * URLはそのまま使う（変換しない）。
 */
const downloadFromImageUrls = async (imageUrls, folderName) => {
  let successCount = 0;
  let failCount = 0;
  const total = imageUrls.length;

  console.log(`[PictureDown] 方式A開始: ${total}枚の画像URLから直接ダウンロード`);

  for (let i = 0; i < total; i++) {
    const ok = await downloadOneImage(imageUrls[i], folderName, i + 1);
    if (ok) {
      successCount++;
    } else {
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

  console.log(`[PictureDown] 方式A結果: 成功=${successCount}, 失敗=${failCount}`);
  return { successCount, failCount };
};

/**
 * 方式B: ビューアリンクを fetch() で取得し、HTMLから画像URLを抽出してダウンロード
 * ページ遷移なし。
 */
const downloadFromViewerLinks = async (viewerLinks, folderName) => {
  let successCount = 0;
  let failCount = 0;
  const total = viewerLinks.length;

  console.log(`[PictureDown] 方式B開始: ${total}件のビューアリンクを fetch`);

  for (let i = 0; i < total; i++) {
    try {
      const response = await fetch(viewerLinks[i], {
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en;q=0.5'
        }
      });

      if (!response.ok) {
        console.warn(`[PictureDown] 方式B: fetch HTTP ${response.status} (${i + 1}/${total})`);
        failCount++;
      } else {
        const html = await response.text();
        const imgUrl = extractImageUrlFromHtml(html);

        if (imgUrl) {
          const ok = await downloadOneImage(imgUrl, folderName, i + 1);
          if (ok) {
            successCount++;
          } else {
            failCount++;
          }
        } else {
          console.warn(`[PictureDown] 方式B: 画像URL抽出失敗 (${i + 1}/${total})`);
          failCount++;
        }
      }
    } catch (e) {
      console.error(`[PictureDown] 方式Bエラー (${i + 1}):`, e.message);
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

  console.log(`[PictureDown] 方式B結果: 成功=${successCount}, 失敗=${failCount}`);
  return { successCount, failCount };
};

/**
 * 方式C: ページ遷移方式（最後の手段）
 */
const downloadByNavigation = async (tabId, articleId, folderName, maxPages) => {
  let successCount = 0;
  let failCount = 0;
  const total = maxPages > 0 ? maxPages : 43;

  console.log(`[PictureDown] 方式C開始: ページ遷移方式 (${total}ページ)`);

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
        const ok = await downloadOneImage(imgUrl, folderName, i);
        if (ok) {
          successCount++;
        } else {
          failCount++;
        }
      } else {
        console.warn(`[PictureDown] 方式C: 画像未検出 (ページ${i})`);
        failCount++;
      }
    } catch (e) {
      console.error(`[PictureDown] 方式Cエラー (ページ${i}):`, e.message);
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

  console.log(`[PictureDown] 方式C結果: 成功=${successCount}, 失敗=${failCount}`);
  return { successCount, failCount };
};

/**
 * メインのダウンロード処理。
 * 3つの方式を優先順位で自動選択する。
 * どの方式も完全に失敗した場合は次の方式にフォールバックする。
 */
const startProcess = async (tabId, articleId, folderName, viewerLinks, imageUrls) => {
  const safeFolderName = sanitizeFolderName(folderName);
  let result = { successCount: 0, failCount: 0 };

  // 方式A: 画像URLリストから直接ダウンロード
  if (imageUrls && imageUrls.length > 0) {
    result = await downloadFromImageUrls(imageUrls, safeFolderName);
  }

  // 方式Aが完全失敗 → 方式B: ビューアリンクから fetch
  if (result.successCount === 0 && viewerLinks && viewerLinks.length > 0) {
    console.log('[PictureDown] 方式Bにフォールバック');
    result = await downloadFromViewerLinks(viewerLinks, safeFolderName);
  }

  // 方式A・B両方とも完全失敗 → 方式C: ページ遷移
  if (result.successCount === 0) {
    console.log('[PictureDown] 方式Cにフォールバック');
    const totalPages = (viewerLinks?.length) || (imageUrls?.length) || 0;
    result = await downloadByNavigation(tabId, articleId, safeFolderName, totalPages);
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
