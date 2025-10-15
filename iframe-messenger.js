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
```

### Step 2: Update Your Extension's Script (`popup.js`)

This new version will:
*   Save the entire state object (URL and scrollY).
*   Listen for the iframe's `load` event, and then send the `RESTORE_STATE` message back to it.

**Replace the entire content of your `popup.js` file with this:**

```javascript
const HOME_URL = "https://shkspr.vercel.app/";
const websiteFrame = document.getElementById('website-frame');

// 1. Listen for state updates from the iframe
window.addEventListener('message', (event) => {
  // Security: Only accept messages from our website
  if (event.origin !== "https://shkspr.vercel.app") {
    return;
  }

  if (event.data && event.data.type === 'IFRAME_STATE_UPDATE') {
    // Save the entire state object (URL and scroll position)
    const newState = {
      url: event.data.url,
      scrollY: event.data.scrollY
    };
    chrome.storage.local.set({ 'lastState': newState });
    // Optional: log for debugging
    // console.log("State received! Saved:", newState);
  }
});

// 2. Load the last state when the popup opens
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['lastState'], function(result) {
    const lastState = result.lastState || { url: HOME_URL, scrollY: 0 };
    console.log("Popup is loading state:", lastState);
    websiteFrame.src = lastState.url;
  });
});

// 3. After the iframe loads, tell it where to scroll
websiteFrame.addEventListener('load', () => {
  chrome.storage.local.get(['lastState'], function(result) {
    if (result.lastState && result.lastState.scrollY) {
      // Send the message back to the iframe's window
      websiteFrame.contentWindow.postMessage({
        type: 'RESTORE_STATE',
        scrollY: result.lastState.scrollY
      }, 'https://shkspr.vercel.app'); // Target the specific origin for security
    }
  });
});
