// This code runs inside your website when it's loaded in the iframe.

/**
 * Sends the current URL of the page to the parent window (the extension).
 * This allows the extension to know which page the user is on.
 */
function sendUrlToExtension() {
  // 'parent' refers to the window that contains the iframe.
  // We post a message with a specific type and the current URL.
  // The '*' targetOrigin is acceptable here because we are not sending sensitive data,
  // and the receiving extension will validate the origin of the message anyway.
  parent.postMessage({
    type: 'URL_CHANGE',
    url: window.location.href
  }, '*');
}

// --- URL Change Detection ---

// Modern websites (Single-Page Applications) often change the URL without a full
// page reload. We need to detect these changes. Overriding history.pushState
// is a reliable way to do this.

// Keep a reference to the original pushState function.
const originalPushState = history.pushState;

// Override the function.
history.pushState = function(...args) {
  // Call the original function to perform the navigation.
  originalPushState.apply(this, args);
  // After the URL has been changed, notify the extension.
  sendUrlToExtension();
};

// We also need to listen for when the user clicks the browser's back/forward buttons.
window.addEventListener('popstate', sendUrlToExtension);

// Finally, we need to send the initial URL when the page first loads inside the iframe.
// The 'load' event is a good time to do this.
window.addEventListener('load', sendUrlToExtension);
