import { CONFIG } from './config.js';

/**
 * Fetch the HTML content of a viewer page.
 * The extension's host_permissions for hentaipaw.com allow this cross-origin fetch.
 */
const fetchPageHtml = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.text();
};

/**
 * Extract the primary viewer image URL from the page HTML.
 *
 * NOTE: The exact HTML structure of the viewer is unknown at implementation time.
 * The patterns below cover common CDN and og:image conventions.
 * If downloads fail, inspect the viewer page source and update the regex patterns
 * to match the actual <img> tag class/ID used for the main reading image.
 *
 * Priority order:
 *   1. CDN image delivery URL in an <img src="..."> tag
 *   2. og:image meta tag (often contains the page image)
 *   3. Any large image URL found in the HTML (last resort)
 */
const extractImageUrl = (html) => {
  // Pattern 1: Cloudflare Image Delivery CDN (<img src="https://imagedelivery.net/...">)
  const cdnPattern = /src="(https:\/\/imagedelivery\.net\/[^"]+)"/;
  const cdnMatch = html.match(cdnPattern);
  if (cdnMatch) return cdnMatch[1];

  // Pattern 2: Generic CDN subdomain pattern (e.g. cdn.hentaipaw.com/...)
  const cdnSubdomainPattern = /src="(https?:\/\/cdn\.[^"]+\.(?:jpg|jpeg|png|webp|gif)[^"]*)"/i;
  const cdnSubdomainMatch = html.match(cdnSubdomainPattern);
  if (cdnSubdomainMatch) return cdnSubdomainMatch[1];

  // Pattern 3: og:image meta tag
  const ogPattern = /property="og:image"\s+content="([^"]+)"/;
  const ogMatch = html.match(ogPattern);
  if (ogMatch) return ogMatch[1];

  // Pattern 4: Any <img> with a CDN-like path containing the word "image" or a page number
  const genericImgPattern = /src="(https?:\/\/[^"]+\/(?:image|img|page|p)\d*[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/i;
  const genericMatch = html.match(genericImgPattern);
  if (genericMatch) return genericMatch[1];

  return null;
};

/**
 * Derive a safe filename extension from a URL.
 * Falls back to "jpg" when the extension cannot be determined.
 */
const getExtension = (url) => {
  const match = url.match(/\.(\w{2,5})(?:[?#]|$)/);
  return match ? match[1].toLowerCase() : 'jpg';
};

/**
 * Main download loop. Iterates pages 1..maxPages, fetches each viewer page,
 * extracts the image URL, and triggers a chrome.downloads.download() call.
 */
const startProcess = async (articleId, maxPages) => {
  for (let i = 1; i <= maxPages; i++) {
    const pageUrl = `${CONFIG.BASE_URL}${articleId}${CONFIG.PAGE_PARAM}${i}`;

    try {
      const html = await fetchPageHtml(pageUrl);
      const imgUrl = extractImageUrl(html);

      if (imgUrl) {
        const ext = getExtension(imgUrl);
        const paddedPage = String(i).padStart(3, '0');
        await chrome.downloads.download({
          url: imgUrl,
          filename: `hentaipaw_${articleId}_${paddedPage}.${ext}`,
          conflictAction: 'overwrite'
        });
      } else {
        console.warn(`[PictureDown] No image found on page ${i}: ${pageUrl}`);
      }

      const percentage = Math.floor((i / maxPages) * 100);
      chrome.runtime.sendMessage({
        type: CONFIG.REQUEST_TYPES.PROGRESS,
        percentage,
        current: i,
        total: maxPages
      }).catch(() => {
        // Popup may have been closed; ignore messaging errors
      });

      // 1-second delay between requests to reduce server load
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (e) {
      console.error(`[PictureDown] Error on page ${i}:`, e);
    }
  }

  chrome.runtime.sendMessage({ type: CONFIG.REQUEST_TYPES.DONE }).catch(() => {});
};

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === CONFIG.REQUEST_TYPES.START) {
    startProcess(request.articleId, request.maxPages);
  }
});
