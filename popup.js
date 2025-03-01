document.addEventListener('DOMContentLoaded', () => {
  const timerButtons = document.querySelectorAll('.timer-btn');
  const customTimerBtn = document.getElementById('custom-timer-btn');
  const customMinutesInput = document.getElementById('custom-minutes');
  const cancelTimerBtn = document.getElementById('cancel-timer');
  const activeTimerDiv = document.getElementById('active-timer');
  const timeRemainingSpan = document.getElementById('time-remaining');

  let updateInterval = null;
  let currentTabId = null;

  // Get the current tab ID
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      currentTabId = tabs[0].id;
      // Check if there's an active timer for this tab
      checkActiveTimer(currentTabId);
    }
  });

  function checkActiveTimer(tabId) {
    chrome.runtime.sendMessage({
      action: 'getTimerStatus',
      tabId: tabId
    }, (response) => {
      if (response && response.active) {
        const timeRemaining = response.timeRemaining;
        if (timeRemaining > 0) {
          displayActiveTimer(timeRemaining);
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

  // Set timer from preset buttons
  timerButtons.forEach(button => {
    button.addEventListener('click', () => {
      const minutes = parseInt(button.dataset.minutes);
      setTimer(minutes);
    });
  });

  // Set timer from custom input
  customTimerBtn.addEventListener('click', () => {
    const minutes = parseInt(customMinutesInput.value);
    if (minutes && minutes > 0 && minutes <= 1440) { // Max 24 hours
      setTimer(minutes);
    } else {
      alert('Please enter a valid number of minutes (1-1440)');
    }
  });

  // Cancel active timer
  cancelTimerBtn.addEventListener('click', () => {
    if (currentTabId) {
      chrome.runtime.sendMessage({
        action: 'cancelTimer',
        tabId: currentTabId
      });
      stopTimerUpdates();
      activeTimerDiv.classList.add('hidden');
      enableTimerControls();
    }
  });

  function setTimer(minutes) {
    if (currentTabId) {
      const endTime = Date.now() + minutes * 60 * 1000;

      chrome.runtime.sendMessage({
        action: 'setTimer',
        tabId: currentTabId,
        minutes: minutes,
        endTime: endTime
      });

      displayActiveTimer(minutes * 60);
      startTimerUpdates(endTime);
      disableTimerControls();
    }
  }

  function displayActiveTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    timeRemainingSpan.textContent = `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    activeTimerDiv.classList.remove('hidden');
  }

  function startTimerUpdates(endTime) {
    stopTimerUpdates();

    updateInterval = setInterval(() => {
      const timeRemaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));

      if (timeRemaining <= 0) {
        stopTimerUpdates();
        activeTimerDiv.classList.add('hidden');
        enableTimerControls();
        return;
      }

      displayActiveTimer(timeRemaining);
    }, 1000);
  }

  function stopTimerUpdates() {
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  function disableTimerControls() {
    timerButtons.forEach(button => {
      button.disabled = true;
      button.classList.add('disabled');
    });

    customMinutesInput.disabled = true;
    customTimerBtn.disabled = true;
    customTimerBtn.classList.add('disabled');
  }

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
