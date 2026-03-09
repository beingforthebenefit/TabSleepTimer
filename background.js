/**
 * @typedef {Object} TimerData
 * @property {number} endTime - The timestamp when the tab should be closed.
 * @property {boolean} countdownShown - Whether the countdown UI is injected.
 */

/** @type {Object<number, TimerData>} */
let activeTimers = {};

/** Global update interval ID */
let globalUpdateIntervalId = null;

/**
 * Promisified wrapper for chrome.storage.local.get.
 * @param {string|string[]} keys
 * @returns {Promise<any>}
 */
function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Promisified wrapper for chrome.storage.local.set.
 * @param {Object} items
 * @returns {Promise<void>}
 */
function setStorage(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Restores timers from storage, validating that tabs still exist.
 */
async function restoreTimers() {
  try {
    const result = await getStorage('sleepTimers');
    const timers = result.sleepTimers || {};
    const now = Date.now();
    for (const tabId in timers) {
      const endTime = timers[tabId].endTime;
      if (endTime > now) {
        const id = parseInt(tabId);
        // Verify the tab still exists before restoring its timer
        try {
          await chrome.tabs.get(id);
          activeTimers[id] = { endTime, countdownShown: false };
        } catch {
          // Tab no longer exists — skip it
        }
      }
    }
    await persistTimers();
  } catch (error) {
    console.error('Error restoring timers:', error);
  }
}

/**
 * Persists activeTimers to storage.
 */
async function persistTimers() {
  try {
    const timersToStore = {};
    for (const tabId in activeTimers) {
      timersToStore[tabId] = { endTime: activeTimers[tabId].endTime };
    }
    await setStorage({ sleepTimers: timersToStore });
  } catch (error) {
    console.error('Error persisting timers:', error);
  }
}

/**
 * Updates the badge text for a tab to show remaining time.
 * @param {number} tabId
 * @param {number} timeRemaining - Time remaining in seconds.
 */
function updateBadge(tabId, timeRemaining) {
  let text = '';
  if (timeRemaining > 0) {
    if (timeRemaining >= 3600) {
      text = `${Math.floor(timeRemaining / 3600)}h`;
    } else if (timeRemaining >= 60) {
      text = `${Math.ceil(timeRemaining / 60)}m`;
    } else {
      text = `${timeRemaining}s`;
    }
  }
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({
    color: timeRemaining <= 60 ? '#ea4335' : '#4285f4',
    tabId,
  });
}

/**
 * Clears the badge for a tab.
 * @param {number} tabId
 */
function clearBadge(tabId) {
  chrome.action.setBadgeText({ text: '', tabId });
}

/**
 * Sets a timer for a specific tab.
 * @param {number} tabId
 * @param {number} minutes
 * @param {number} endTime
 */
async function setTabTimer(tabId, minutes, endTime) {
  await cancelTabTimer(tabId);
  activeTimers[tabId] = { endTime, countdownShown: false };
  await persistTimers();
}

/**
 * Cancels the timer for a specific tab.
 * @param {number} tabId
 */
async function cancelTabTimer(tabId) {
  if (activeTimers[tabId]) {
    delete activeTimers[tabId];
    await persistTimers();
    clearBadge(tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: removeCountdownFromPage,
      });
    } catch (error) {
      console.warn("Could not remove countdown from tab", tabId, error);
    }
  }
}

/**
 * Closes the specified tab.
 * @param {number} tabId
 */
async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    console.warn("Failed to close tab", tabId, error);
  } finally {
    delete activeTimers[tabId];
    clearBadge(tabId);
    await persistTimers();
  }
}

/**
 * Injects the countdown UI into the specified tab if not already injected.
 * @param {number} tabId
 */
async function injectCountdown(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: injectCountdownUI,
    });
  } catch (error) {
    console.error("Failed to inject countdown UI in tab", tabId, error);
  }
}

/**
 * Updates the countdown UI in the specified tab.
 * @param {number} tabId
 * @param {number} timeRemaining - Time remaining in seconds.
 */
async function updateCountdown(tabId, timeRemaining) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: updateCountdownUI,
      args: [timeRemaining],
    });
  } catch (error) {
    console.error("Failed to update countdown UI in tab", tabId, error);
  }
}

/**
 * The central update loop that checks timers, injects countdown UI,
 * updates countdowns, and closes tabs.
 */
async function updateTimers() {
  const now = Date.now();
  for (const tabIdStr in activeTimers) {
    const tabId = parseInt(tabIdStr);
    const timerData = activeTimers[tabId];
    const timeRemaining = Math.max(0, Math.floor((timerData.endTime - now) / 1000));

    updateBadge(tabId, timeRemaining);

    if (timeRemaining <= 60) {
      if (!timerData.countdownShown) {
        await injectCountdown(tabId);
        timerData.countdownShown = true;
      }
      await updateCountdown(tabId, timeRemaining);
    } else if (timerData.countdownShown) {
      // Timer was extended beyond 1 minute — remove warning UI.
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: removeCountdownFromPage,
        });
      } catch (error) {
        console.error("Error removing countdown UI:", error);
      }
      timerData.countdownShown = false;
    }

    if (timeRemaining <= 0) {
      await closeTab(tabId);
    }
  }
}

/**
 * Handles incoming messages from the popup or injected scripts.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const tabId = message.tabId != null ? message.tabId : sender.tab?.id;
      switch (message.action) {
        case 'setTimer': {
          await setTabTimer(message.tabId, message.minutes, message.endTime);
          sendResponse({ success: true });
          break;
        }
        case 'cancelTimer': {
          await cancelTabTimer(tabId);
          sendResponse({ success: true });
          break;
        }
        case 'getTimerStatus': {
          if (activeTimers[tabId]) {
            const timeRemaining = Math.max(0, Math.floor((activeTimers[tabId].endTime - Date.now()) / 1000));
            sendResponse({
              active: true,
              endTime: activeTimers[tabId].endTime,
              timeRemaining,
            });
          } else {
            sendResponse({ active: false });
          }
          break;
        }
        case 'extendTimer': {
          if (activeTimers[tabId]) {
            activeTimers[tabId].endTime += message.minutes * 60 * 1000;
            const timeRemaining = Math.max(0, Math.floor((activeTimers[tabId].endTime - Date.now()) / 1000));
            await persistTimers();
            sendResponse({
              success: true,
              endTime: activeTimers[tabId].endTime,
              timeRemaining,
            });
          } else {
            sendResponse({ success: false });
          }
          break;
        }
        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  return true; // keep the messaging channel open for async responses
});

/**
 * Clean up timer when a tab is manually closed by the user.
 * Prevents memory leaks from orphaned timer entries.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTimers[tabId]) {
    delete activeTimers[tabId];
    persistTimers();
  }
});

/**
 * Handle tab replacement (e.g. prerender navigation).
 * Transfers the timer from the old tab to the new one.
 */
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (activeTimers[removedTabId]) {
    activeTimers[addedTabId] = activeTimers[removedTabId];
    delete activeTimers[removedTabId];
    persistTimers();
  }
});

/**
 * Injected into the page to create the countdown UI.
 * Runs in the context of the webpage.
 */
function injectCountdownUI() {
  if (!document.body) return;
  if (document.getElementById('tab-sleep-timer-countdown')) return;

  const countdownContainer = document.createElement('div');
  countdownContainer.id = 'tab-sleep-timer-countdown';
  countdownContainer.setAttribute('role', 'alert');
  countdownContainer.setAttribute('aria-live', 'assertive');
  countdownContainer.setAttribute('aria-label', 'Tab sleep timer countdown');

  // Detect dark vs light page background for adaptive styling
  const isDarkPage = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const bg = isDarkPage ? 'rgba(30, 30, 30, 0.95)' : 'rgba(0, 0, 0, 0.88)';

  countdownContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bg};
    color: #fff;
    padding: 16px;
    border-radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    z-index: 2147483647;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    text-align: center;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  `;

  const message = document.createElement('div');
  message.textContent = 'Tab will close in:';
  message.style.cssText = 'margin-bottom: 6px; font-size: 13px; opacity: 0.85;';

  const timer = document.createElement('div');
  timer.id = 'tab-sleep-timer-countdown-time';
  timer.textContent = '0:00';
  timer.style.cssText = `
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 12px;
    font-variant-numeric: tabular-nums;
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';

  const btnStyle = `
    flex: 1;
    padding: 7px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: white;
    transition: opacity 0.15s;
  `;

  const createExtendButton = (minutes, label) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = btnStyle + 'background: #4285f4;';
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'extendTimer', minutes });
      document.getElementById('tab-sleep-timer-countdown')?.remove();
    });
    return btn;
  };

  buttonContainer.appendChild(createExtendButton(5, '+5m'));
  buttonContainer.appendChild(createExtendButton(30, '+30m'));
  buttonContainer.appendChild(createExtendButton(60, '+1h'));

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel Timer';
  cancelButton.style.cssText = `
    width: 100%;
    padding: 7px;
    font-size: 13px;
    font-weight: 500;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    background: #ea4335;
    color: white;
    transition: opacity 0.15s;
  `;
  cancelButton.addEventListener('mouseenter', () => { cancelButton.style.opacity = '0.85'; });
  cancelButton.addEventListener('mouseleave', () => { cancelButton.style.opacity = '1'; });
  cancelButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'cancelTimer' });
    countdownContainer.remove();
  });

  countdownContainer.appendChild(message);
  countdownContainer.appendChild(timer);
  countdownContainer.appendChild(buttonContainer);
  countdownContainer.appendChild(cancelButton);

  document.body.appendChild(countdownContainer);
  requestAnimationFrame(() => {
    countdownContainer.style.opacity = '1';
  });
}

/**
 * Injected into the page to update the countdown UI.
 * @param {number} timeRemaining - Time remaining in seconds.
 */
function updateCountdownUI(timeRemaining) {
  const countdownElement = document.getElementById('tab-sleep-timer-countdown-time');
  if (countdownElement) {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    countdownElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

/**
 * Injected into the page to remove the countdown UI.
 */
function removeCountdownFromPage() {
  document.getElementById('tab-sleep-timer-countdown')?.remove();
}

// Start the global update loop when the background script initializes.
(async function init() {
  await restoreTimers();
  globalUpdateIntervalId = setInterval(updateTimers, 1000);
})();
