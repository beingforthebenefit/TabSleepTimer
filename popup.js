/**
 * Popup script for Tab Sleep Timer.
 * Handles UI interactions, timer setting, and countdown updates.
 */

document.addEventListener('DOMContentLoaded', () => {
  const timerButtons = document.querySelectorAll('.timer-btn');
  const customTimerBtn = document.getElementById('custom-timer-btn');
  const customMinutesInput = document.getElementById('custom-minutes');
  const cancelTimerBtn = document.getElementById('cancel-timer');
  const activeTimerDiv = document.getElementById('active-timer');
  const timeRemainingSpan = document.getElementById('time-remaining');
  let updateInterval = null;
  let currentTabId = null;

  /**
   * Retrieves the current active tab and initializes timer status.
   */
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      currentTabId = tabs[0].id;
      checkActiveTimer(currentTabId);
    }
  });

  /**
   * Checks if there's an active timer for the specified tab.
   * @param {number} tabId
   */
  function checkActiveTimer(tabId) {
    chrome.runtime.sendMessage({ action: 'getTimerStatus', tabId }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('Could not check timer status:', chrome.runtime.lastError.message);
        enableTimerControls();
        return;
      }
      if (response && response.active && response.timeRemaining > 0) {
        displayActiveTimer(response.timeRemaining);
        startTimerUpdates(response.endTime);
        disableTimerControls();
      } else {
        enableTimerControls();
      }
    });
  }

  // Event listeners for preset timer buttons
  timerButtons.forEach(button => {
    button.addEventListener('click', () => {
      const minutes = parseInt(button.dataset.minutes);
      setTimer(minutes);
    });
  });

  // Set timer using custom input
  customTimerBtn.addEventListener('click', setTimerFromCustomInput);
  customMinutesInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      setTimerFromCustomInput();
    }
  });

  // Clear validation error on input
  customMinutesInput.addEventListener('input', clearValidationError);

  // Cancel timer event
  cancelTimerBtn.addEventListener('click', () => {
    if (currentTabId == null) return;
    chrome.runtime.sendMessage({ action: 'cancelTimer', tabId: currentTabId }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Cancel failed:', chrome.runtime.lastError.message);
      }
    });
    stopTimerUpdates();
    activeTimerDiv.classList.add('hidden');
    enableTimerControls();
  });

  /**
   * Sets the timer based on custom input.
   */
  function setTimerFromCustomInput() {
    const raw = customMinutesInput.value.trim();
    const minutes = parseInt(raw);
    if (!raw || isNaN(minutes) || minutes < 1 || minutes > 1440) {
      showValidationError('Enter a number between 1 and 1440.');
      customMinutesInput.focus();
      return;
    }
    setTimer(minutes);
  }

  /**
   * Shows an inline validation error below the custom input.
   * @param {string} message
   */
  function showValidationError(message) {
    clearValidationError();
    const error = document.createElement('div');
    error.className = 'validation-error';
    error.textContent = message;
    error.setAttribute('role', 'alert');
    const customTimerDiv = customMinutesInput.parentElement;
    customTimerDiv.insertAdjacentElement('afterend', error);
  }

  /**
   * Clears the inline validation error.
   */
  function clearValidationError() {
    const existing = document.querySelector('.validation-error');
    if (existing) existing.remove();
  }

  /**
   * Sends a message to set a timer and updates the UI.
   * @param {number} minutes
   */
  function setTimer(minutes) {
    if (currentTabId == null) return;
    const endTime = Date.now() + minutes * 60 * 1000;
    chrome.runtime.sendMessage(
      { action: 'setTimer', tabId: currentTabId, minutes, endTime },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to set timer:', chrome.runtime.lastError.message);
        }
      }
    );
    clearValidationError();
    displayActiveTimer(minutes * 60);
    startTimerUpdates(endTime);
    disableTimerControls();
  }

  /**
   * Displays the active timer UI.
   * @param {number} seconds
   */
  function displayActiveTimer(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      timeRemainingSpan.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      timeRemainingSpan.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    activeTimerDiv.classList.remove('hidden');
  }

  /**
   * Starts an interval to update the timer countdown.
   * @param {number} endTime
   */
  function startTimerUpdates(endTime) {
    stopTimerUpdates();
    updateInterval = setInterval(() => {
      const timeRemaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      if (timeRemaining <= 0) {
        stopTimerUpdates();
        activeTimerDiv.classList.add('hidden');
        enableTimerControls();
      } else {
        displayActiveTimer(timeRemaining);
      }
    }, 1000);
  }

  /**
   * Stops the timer update interval.
   */
  function stopTimerUpdates() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  /**
   * Disables timer control buttons.
   */
  function disableTimerControls() {
    timerButtons.forEach(button => { button.disabled = true; });
    customMinutesInput.disabled = true;
    customTimerBtn.disabled = true;
  }

  /**
   * Enables timer control buttons.
   */
  function enableTimerControls() {
    timerButtons.forEach(button => { button.disabled = false; });
    customMinutesInput.disabled = false;
    customTimerBtn.disabled = false;
  }

  /**
   * Checks if the review prompt should be shown.
   */
  const reviewPrompt = document.getElementById('review-prompt');
  const dismissButton = document.getElementById('dismiss-review');

  chrome.storage.local.get(['usageCount', 'reviewDismissed'], (result) => {
    let count = result.usageCount || 0;
    const dismissed = result.reviewDismissed || false;

    if (!dismissed) {
      count++;
      chrome.storage.local.set({ usageCount: count });

      if (count >= 5) {
        reviewPrompt.classList.remove('hidden');
      }
    }
  });

  dismissButton.addEventListener('click', () => {
    reviewPrompt.classList.add('hidden');
    chrome.storage.local.set({ reviewDismissed: true });
  });
});
