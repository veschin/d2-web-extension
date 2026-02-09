/** Inject edit pencil buttons near each detected D2 macro */

function injectButtons() {
  const ext = (window as any).__d2ext;
  if (!ext?.elements?.length) return;

  // Remove any existing buttons
  document.querySelectorAll('.d2ext-edit-btn').forEach((b) => b.remove());

  ext.elements.forEach((el: Element, index: number) => {
    const btn = document.createElement('button');
    btn.className = 'd2ext-edit-btn';
    btn.title = `Edit D2 macro #${index + 1}`;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>`;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Send message to open editor for this macro
      chrome.runtime?.sendMessage?.({ type: 'open-editor', macroIndex: index });
      // Also dispatch custom event for same-page listener
      window.dispatchEvent(
        new CustomEvent('d2ext-open-editor', { detail: { macroIndex: index } })
      );
    });

    // Position the button relative to the macro element
    const wrapper = el.closest('.d2-macro') || el;
    if (wrapper instanceof HTMLElement) {
      wrapper.style.position = 'relative';
      btn.style.position = 'absolute';
      btn.style.top = '4px';
      btn.style.right = '4px';
      btn.style.zIndex = '1000';
      wrapper.appendChild(btn);
    }
  });
}

// Wait for detector to finish, then inject
function waitAndInject() {
  if ((window as any).__d2ext?.elements?.length) {
    injectButtons();
  } else {
    setTimeout(waitAndInject, 500);
  }
}

// Start after a short delay to let detector run first
setTimeout(waitAndInject, 1000);

// Re-inject when macros are re-detected
window.addEventListener('d2ext-macros-updated', () => injectButtons());
