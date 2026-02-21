import { CONFIG } from './config.js';

const DOM = {
  startBtn: document.querySelector(CONFIG.SELECTORS.START_BTN),
  statusText: document.querySelector(CONFIG.SELECTORS.STATUS_TEXT),
  progressBar: document.querySelector(CONFIG.SELECTORS.PROGRESS_BAR)
};

const updateStatus = (message, isError = false) => {
  DOM.statusText.textContent = message;
  DOM.statusText.classList.remove(CONFIG.CLASSES.HIDDEN);
  if (isError) {
    DOM.statusText.classList.add(CONFIG.CLASSES.ERROR);
  } else {
    DOM.statusText.classList.remove(CONFIG.CLASSES.ERROR);
  }
};

const updateProgress = (percentage) => {
  document.documentElement.style.setProperty(
    CONFIG.CSS_VARS.PROGRESS_WIDTH,
    `${percentage}%`
  );
};

const handleMessage = (request) => {
  if (request.type === CONFIG.REQUEST_TYPES.PROGRESS) {
    updateStatus(`${CONFIG.MESSAGES.START} (${request.current}${CONFIG.MESSAGES.COUNT_SUFFIX})`);
  }
  if (request.type === CONFIG.REQUEST_TYPES.DONE) {
    updateProgress(100);
    updateStatus(CONFIG.MESSAGES.DONE);
    DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
  }
};

const init = () => {
  chrome.runtime.onMessage.addListener(handleMessage);

  DOM.startBtn.addEventListener('click', async () => {
    DOM.startBtn.classList.add(CONFIG.CLASSES.HIDDEN);
    DOM.progressBar.classList.remove(CONFIG.CLASSES.HIDDEN);
    updateProgress(0);
    updateStatus(CONFIG.MESSAGES.START);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.includes(CONFIG.DOMAIN)) {
      const urlParams = new URLSearchParams(new URL(tab.url).search);
      const articleId = urlParams.get('articleId');
      chrome.runtime.sendMessage({
        type: CONFIG.REQUEST_TYPES.START,
        articleId: articleId
      });
    } else {
      updateStatus(CONFIG.MESSAGES.ERROR, true);
      DOM.startBtn.classList.remove(CONFIG.CLASSES.HIDDEN);
    }
  });
};

init();
