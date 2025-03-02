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
 * Restores timers from storage and sets them in activeTimers.
 */
async function restoreTimers() {
  try {
    const result = await getStorage('sleepTimers');
    const timers = result.sleepTimers || {};
    const now = Date.now();
    for (const tabId in timers) {
      const endTime = timers[tabId].endTime;
      if (endTime > now) {
        activeTimers[parseInt(tabId)] = { endTime, countdownShown: false };
      }
    }
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
    // Remove countdown UI if injected
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

    if (timeRemaining <= 60) {
      if (!timerData.countdownShown) {
        await injectCountdown(tabId);
        timerData.countdownShown = true;
      }
      await updateCountdown(tabId, timeRemaining);
    } else if (timeRemaining > 60 && timerData.countdownShown) {
      // If extended beyond 1 minute, remove any warning UI.
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
      const tabId = message.tabId || sender.tab?.id;
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
 * Injected into the page to create the countdown UI.
 * Runs in the context of the webpage.
 */
function injectCountdownUI() {
  if (document.getElementById('tab-sleep-timer-countdown')) {
    return;
  }

  const countdownContainer = document.createElement('div');
  countdownContainer.id = 'tab-sleep-timer-countdown';
  countdownContainer.setAttribute('role', 'alert');
  countdownContainer.setAttribute('aria-live', 'assertive');
  countdownContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    padding: 16px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 16px;
    z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
    text-align: center;
  `;

  const message = document.createElement('div');
  message.textContent = 'Tab will close in:';
  message.style.marginBottom = '8px';

  const timer = document.createElement('div');
  timer.id = 'tab-sleep-timer-countdown-time';
  timer.textContent = '0:00';
  timer.style.cssText = `
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 12px;
  `;

  // Button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';
  buttonContainer.style.marginBottom = '12px';

  const createExtendButton = (minutes, label) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      flex: 1;
      padding: 8px;
      font-size: 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: #4285f4;
      color: white;
    `;
    btn.addEventListener('click', () => {
      // Send extend message and immediately dismiss the warning window.
      chrome.runtime.sendMessage({ action: 'extendTimer', minutes });
      document.getElementById('tab-sleep-timer-countdown')?.remove();
    });
    return btn;
  };

  const btn5 = createExtendButton(5, '+5m');
  const btn30 = createExtendButton(30, '+30m');
  const btn60 = createExtendButton(60, '+1h');

  buttonContainer.appendChild(btn5);
  buttonContainer.appendChild(btn30);
  buttonContainer.appendChild(btn60);

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel Timer';
  cancelButton.style.cssText = `
    width: 100%;
    padding: 8px;
    font-size: 14px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    background: #ea4335;
    color: white;
  `;
  cancelButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'cancelTimer' });
    countdownContainer.remove();
  });

  countdownContainer.appendChild(message);
  countdownContainer.appendChild(timer);
  countdownContainer.appendChild(buttonContainer);
  countdownContainer.appendChild(cancelButton);

  document.body.appendChild(countdownContainer);
  // Trigger fade-in transition
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
  const countdownElement = document.getElementById('tab-sleep-timer-countdown');
  if (countdownElement) {
    countdownElement.remove();
  }
}

// Start the global update loop when the background script initializes.
(async function init() {
  await restoreTimers();
  globalUpdateIntervalId = setInterval(updateTimers, 1000);
})();
