// This code runs inside your website when it's loaded in the iframe.

let scrollTimeout; // Used for throttling scroll events

/**
 * Sends the current state (URL and scroll position) to the parent extension.
 */
function sendStateToExtension() {
  parent.postMessage({
    type: 'IFRAME_STATE_UPDATE',
    url: window.location.href,
    scrollY: window.scrollY // Include the vertical scroll position
  }, '*');
}

// --- 1. LISTEN FOR MESSAGES FROM THE EXTENSION ---

window.addEventListener('message', (event) => {
  // We don't need to check the origin here, as we are not receiving sensitive data.
  // The action itself (scrolling) is harmless.
  if (event.data && event.data.type === 'RESTORE_STATE') {
    // The extension told us to scroll to a specific position.
    window.scrollTo(0, event.data.scrollY);
  }
});


// --- 2. SEND STATE UPDATES TO THE EXTENSION ---

// Listen for scroll events
window.addEventListener('scroll', () => {
  // Throttle the event to prevent spamming the extension with messages.
  // We only send an update every 250ms.
  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
  }
  scrollTimeout = setTimeout(sendStateToExtension, 250);
});

// The original URL change detection still works the same.
const originalPushState = history.pushState;
history.pushState = function(...args) {
  originalPushState.apply(this, args);
  sendStateToExtension();
};

window.addEventListener('popstate', sendStateToExtension);
window.addEventListener('load', sendStateToExtension);
