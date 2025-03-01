// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateCountdown') {
    updateCountdown(message.timeRemaining);
    sendResponse({ success: true });
  }
  return true;
});

// Update the countdown timer display
function updateCountdown(timeRemaining) {
  const countdownElement = document.getElementById('tab-sleep-timer-countdown-time');
  if (countdownElement) {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    countdownElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

// Check if there's an active timer for this tab when the page loads
chrome.runtime.sendMessage({ action: 'getTimerStatus' }, (response) => {
  if (response && response.active) {
    // The background script will handle showing the countdown if needed
    // No need to do anything here as the background script will inject the countdown
    // when appropriate
  }
});