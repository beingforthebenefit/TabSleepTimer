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
      if (response && response.active) {
        if (response.timeRemaining > 0) {
          displayActiveTimer(response.timeRemaining);
          startTimerUpdates(response.endTime);
          disableTimerControls();
        } else {
          enableTimerControls();
        }
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

  // Cancel timer event
  cancelTimerBtn.addEventListener('click', () => {
    if (currentTabId) {
      chrome.runtime.sendMessage({ action: 'cancelTimer', tabId: currentTabId });
      stopTimerUpdates();
      activeTimerDiv.classList.add('hidden');
      enableTimerControls();
    }
  });

  /**
   * Sets the timer based on custom input.
   */
  function setTimerFromCustomInput() {
    const minutes = parseInt(customMinutesInput.value);
    if (minutes && minutes > 0 && minutes <= 1440) {
      setTimer(minutes);
    } else {
      alert('Please enter a valid number of minutes (1-1440).');
    }
  }

  /**
   * Sends a message to set a timer and updates the UI.
   * @param {number} minutes
   */
  function setTimer(minutes) {
    if (currentTabId) {
      const endTime = Date.now() + minutes * 60 * 1000;
      chrome.runtime.sendMessage({ action: 'setTimer', tabId: currentTabId, minutes, endTime });
      displayActiveTimer(minutes * 60);
      startTimerUpdates(endTime);
      disableTimerControls();
    }
  }

  /**
   * Displays the active timer UI.
   * @param {number} seconds
   */
  function displayActiveTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secondsPart = seconds % 60;
    timeRemainingSpan.textContent = `${minutes}:${secondsPart.toString().padStart(2, '0')}`;
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
    timerButtons.forEach(button => {
      button.disabled = true;
      button.classList.add('disabled');
    });
    customMinutesInput.disabled = true;
    customTimerBtn.disabled = true;
    customTimerBtn.classList.add('disabled');
  }

  /**
   * Enables timer control buttons.
   */
  function enableTimerControls() {
    timerButtons.forEach(button => {
      button.disabled = false;
      button.classList.remove('disabled');
    });
    customMinutesInput.disabled = false;
    customTimerBtn.disabled = false;
    customTimerBtn.classList.remove('disabled');
  }
});
