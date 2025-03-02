// Store active timers
let activeTimers = {};

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setTimer') {
    setTabTimer(message.tabId, message.minutes, message.endTime);
    sendResponse({ success: true });
  } else if (message.action === 'cancelTimer') {
    cancelTabTimer(message.tabId || sender.tab?.id);
    sendResponse({ success: true });
  } else if (message.action === 'getTimerStatus') {
    const tabId = message.tabId || sender.tab?.id;
    if (tabId && activeTimers[tabId]) {
      sendResponse({
        active: true,
        endTime: activeTimers[tabId].endTime,
        timeRemaining: Math.max(0, Math.floor((activeTimers[tabId].endTime - Date.now()) / 1000))
      });
    } else {
      sendResponse({ active: false });
    }
  } else if (message.action === 'extendTimer') {
    const tabId = message.tabId || sender.tab?.id;
    const additionalMinutes = message.minutes;

    if (tabId && activeTimers[tabId]) {
      // Calculate new end time
      const newEndTime = activeTimers[tabId].endTime + (additionalMinutes * 60 * 1000);

      // Update the timer
      clearTimeout(activeTimers[tabId].timerId);
      const newRemainingMinutes = Math.ceil((newEndTime - Date.now()) / (60 * 1000));

      setTabTimer(tabId, newRemainingMinutes, newEndTime);
      sendResponse({
        success: true,
        endTime: newEndTime,
        timeRemaining: Math.max(0, Math.floor((newEndTime - Date.now()) / 1000))
      });
    } else {
      sendResponse({ success: false });
    }
  }
  return true; // Keep the message channel open for async responses
});

// Set a timer for a specific tab
function setTabTimer(tabId, minutes, endTime) {
  // Cancel any existing timer for this tab
  cancelTabTimer(tabId);

  // Store timer information
  activeTimers[tabId] = {
    endTime: endTime,
    timerId: setTimeout(() => closeTab(tabId), minutes * 60 * 1000),
    countdownTimerId: null,
    countdownInterval: null,
    countdownShown: false
  };

  // Save to storage for persistence
  chrome.storage.local.get(['sleepTimers'], (result) => {
    const timers = result.sleepTimers || {};
    timers[tabId] = { endTime: endTime };
    chrome.storage.local.set({ sleepTimers: timers });
  });

  // Calculate when to show the countdown (1 minute before closing)
  const countdownTime = (minutes * 60 - 60) * 1000; // 1 minute before closing

  if (countdownTime > 0) {
    activeTimers[tabId].countdownTimerId = setTimeout(() => {
      showCountdown(tabId);
    }, countdownTime);
  } else {
    // If less than 1 minute, show countdown immediately
    showCountdown(tabId);
  }

  // Set up a check every 5 seconds to ensure countdown is showing when it should be
  activeTimers[tabId].countdownCheckInterval = setInterval(() => {
    if (!activeTimers[tabId]) {
      clearInterval(activeTimers[tabId]?.countdownCheckInterval);
      return;
    }

    // Check if tab still exists
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        // Tab doesn't exist anymore, clean up the timer
        console.log("Tab no longer exists, cleaning up timer:", tabId);
        cancelTabTimer(tabId);
        return;
      }

      const timeRemaining = Math.max(0, Math.floor((activeTimers[tabId].endTime - Date.now()) / 1000));

      // If less than 60 seconds remain and countdown isn't shown, show it
      if (timeRemaining <= 60 && !activeTimers[tabId].countdownShown) {
        showCountdown(tabId);
      }
    });
  }, 5000);
}

// Cancel a timer for a specific tab
function cancelTabTimer(tabId) {
  if (activeTimers[tabId]) {
    clearTimeout(activeTimers[tabId].timerId);
    if (activeTimers[tabId].countdownTimerId) {
      clearTimeout(activeTimers[tabId].countdownTimerId);
    }
    if (activeTimers[tabId].countdownInterval) {
      clearInterval(activeTimers[tabId].countdownInterval);
    }
    if (activeTimers[tabId].countdownCheckInterval) {
      clearInterval(activeTimers[tabId].countdownCheckInterval);
    }
    delete activeTimers[tabId];

    // Clear from storage
    chrome.storage.local.get(['sleepTimers'], (result) => {
      const timers = result.sleepTimers || {};
      delete timers[tabId];
      chrome.storage.local.set({ sleepTimers: timers });
    });

    // Try to remove countdown if it's showing
    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: removeCountdownFromPage
      }).catch(err => {
        // Ignore errors when tab doesn't exist or isn't accessible
        console.log("Could not remove countdown, tab may be closed:", tabId);
      });
    } catch (err) {
      // Ignore errors when tab doesn't exist
      console.log("Error removing countdown, tab may be closed:", tabId);
    }
  }
}

// Close the tab when timer expires
function closeTab(tabId) {
  // Check if tab exists before trying to close it
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.log("Tab doesn't exist, can't close:", tabId);
      // Clean up the timer anyway
      delete activeTimers[tabId];

      // Remove from storage
      chrome.storage.local.get(['sleepTimers'], (result) => {
        const timers = result.sleepTimers || {};
        delete timers[tabId];
        chrome.storage.local.set({ sleepTimers: timers });
      });
      return;
    }

    // Tab exists, try to close it
    chrome.tabs.remove(tabId).then(() => {
      console.log("Tab closed successfully:", tabId);
    }).catch(err => {
      console.log("Failed to close tab, but continuing cleanup:", err);
    }).finally(() => {
      // Clean up regardless of whether the tab was closed
      delete activeTimers[tabId];

      // Remove from storage
      chrome.storage.local.get(['sleepTimers'], (result) => {
        const timers = result.sleepTimers || {};
        delete timers[tabId];
        chrome.storage.local.set({ sleepTimers: timers });
      });
    });
  });
}

// Show countdown in the tab
function showCountdown(tabId) {
  // Check if tab exists before trying to inject script
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.log("Tab doesn't exist, can't show countdown:", tabId);
      return;
    }

    if (!activeTimers[tabId]) return;

    // Mark countdown as shown
    activeTimers[tabId].countdownShown = true;

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: injectCountdown
    }).catch(err => {
      console.log("Failed to inject countdown, tab may be inaccessible:", err);
    });

    // Start sending countdown updates to the content script
    if (activeTimers[tabId] && activeTimers[tabId].countdownInterval) {
      clearInterval(activeTimers[tabId].countdownInterval);
    }

    activeTimers[tabId].countdownInterval = setInterval(() => {
      if (!activeTimers[tabId]) {
        clearInterval(activeTimers[tabId]?.countdownInterval);
        return;
      }

      // Check if tab still exists
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          // Tab doesn't exist anymore, clean up the timer
          console.log("Tab no longer exists during countdown, cleaning up:", tabId);
          if (activeTimers[tabId]) {
            clearInterval(activeTimers[tabId].countdownInterval);
            cancelTabTimer(tabId);
          }
          return;
        }

        const timeRemaining = Math.max(0, Math.floor((activeTimers[tabId].endTime - Date.now()) / 1000));

        // Send the update directly to the page using executeScript
        try {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: updateCountdownInPage,
            args: [timeRemaining]
          }).catch(err => {
            console.log("Could not update countdown:", err);
          });
        } catch (err) {
          console.log("Error updating countdown:", err);
        }

        if (timeRemaining <= 0) {
          if (activeTimers[tabId]) {
            clearInterval(activeTimers[tabId].countdownInterval);
            closeTab(tabId);
          }
        }
      });
    }, 1000);
  });
}

// Function to update the countdown in the page
function updateCountdownInPage(timeRemaining) {
  const countdownElement = document.getElementById('tab-sleep-timer-countdown-time');
  if (countdownElement) {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    countdownElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

// Function to be injected into the page to create countdown UI
function injectCountdown() {
  if (document.getElementById('tab-sleep-timer-countdown')) {
    return;
  }

  const countdownContainer = document.createElement('div');
  countdownContainer.id = 'tab-sleep-timer-countdown';
  countdownContainer.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transition: opacity 0.3s ease;
  `;

  const message = document.createElement('div');
  message.textContent = 'Tab will close in:';
  message.style.marginBottom = '8px';

  const timer = document.createElement('div');
  timer.id = 'tab-sleep-timer-countdown-time';
  timer.textContent = '0:00'; // Initialize with a value
  timer.style.cssText = `
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 12px;
  `;

  // Add extension buttons
  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = `
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    width: 100%;
  `;

  // Create extension buttons
  const createExtendButton = (minutes, label) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = `
      background-color: #4285f4;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 8px;
      cursor: pointer;
      font-size: 12px;
      flex: 1;
      height: 36px;
    `;

    button.addEventListener('click', () => {
      // Use a custom event to handle extension
      const event = new CustomEvent('tabSleepTimerExtend', {
        detail: { minutes: minutes }
      });
      document.dispatchEvent(event);
    });

    return button;
  };

  // Add the extension buttons
  const fiveMinButton = createExtendButton(5, '+5m');
  const thirtyMinButton = createExtendButton(30, '+30m');
  const oneHourButton = createExtendButton(60, '+1h');

  buttonContainer.appendChild(fiveMinButton);
  buttonContainer.appendChild(thirtyMinButton);
  buttonContainer.appendChild(oneHourButton);

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel Timer';
  cancelButton.style.cssText = `
    background-color: #ea4335;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 12px;
    width: 100%;
    height: 36px;
  `;

  cancelButton.addEventListener('click', () => {
    // Use a custom event to handle cancellation
    document.dispatchEvent(new CustomEvent('tabSleepTimerCancel'));
  });

  countdownContainer.appendChild(message);
  countdownContainer.appendChild(timer);
  countdownContainer.appendChild(buttonContainer);
  countdownContainer.appendChild(cancelButton);
  document.body.appendChild(countdownContainer);

  // Set up event listeners for the custom events
  document.addEventListener('tabSleepTimerExtend', (e) => {
    chrome.runtime.sendMessage({
      action: 'extendTimer',
      minutes: e.detail.minutes
    });
  });

  document.addEventListener('tabSleepTimerCancel', () => {
    chrome.runtime.sendMessage({ action: 'cancelTimer' });
    countdownContainer.remove();
  });
}

// Function to be injected to remove countdown UI
function removeCountdownFromPage() {
  const countdownElement = document.getElementById('tab-sleep-timer-countdown');
  if (countdownElement) {
    countdownElement.remove();
  }
}

// Restore timers when extension is loaded
chrome.storage.local.get(['sleepTimers'], (result) => {
  const timers = result.sleepTimers || {};
  const now = Date.now();

  Object.keys(timers).forEach(tabId => {
    const endTime = timers[tabId].endTime;

    if (endTime > now) {
      const remainingMinutes = Math.ceil((endTime - now) / (60 * 1000));
      const remainingSeconds = Math.floor((endTime - now) / 1000);

      // Check if tab still exists
      chrome.tabs.get(parseInt(tabId), (tab) => {
        if (chrome.runtime.lastError) {
          // Tab doesn't exist anymore, remove the timer
          delete timers[tabId];
          chrome.storage.local.set({ sleepTimers: timers });
        } else {
          // Tab exists, restore the timer
          setTabTimer(parseInt(tabId), remainingMinutes, endTime);

          // If less than 60 seconds remain, show countdown immediately
          if (remainingSeconds <= 60) {
            showCountdown(parseInt(tabId));
          }
        }
      });
    } else {
      // Timer has expired, remove it
      delete timers[tabId];
      chrome.storage.local.set({ sleepTimers: timers });
    }
  });
});
