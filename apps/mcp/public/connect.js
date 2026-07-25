const canonicalEndpoint = 'https://mcp.dailydraft.fun/mcp';
const endpoint = `${window.location.origin}/mcp`;

for (const element of document.querySelectorAll('[data-endpoint-text]')) {
  element.textContent = endpoint;
}

for (const element of document.querySelectorAll('[data-endpoint-code]')) {
  element.textContent = element.textContent.replaceAll(canonicalEndpoint, endpoint);
}

const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(selectedTab) {
  for (const tab of tabs) {
    const isSelected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;

    const panelId = tab.getAttribute('aria-controls');
    const panel = panelId ? document.getElementById(panelId) : null;
    if (panel) panel.hidden = !isSelected;
  }
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab);
    nextTab.focus();
  });
}

for (const button of document.querySelectorAll('[data-copy-target]')) {
  button.addEventListener('click', async () => {
    const targetId = button.getAttribute('data-copy-target');
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target?.textContent) return;

    try {
      await navigator.clipboard.writeText(target.textContent);
      button.dataset.copied = 'true';
      const originalLabel = button.getAttribute('aria-label');
      button.setAttribute('aria-label', 'Copied');
      window.setTimeout(() => {
        delete button.dataset.copied;
        if (originalLabel) button.setAttribute('aria-label', originalLabel);
      }, 1600);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  });
}

const status = document.querySelector('[data-service-status]');
const statusLabel = document.querySelector('[data-service-label]');

fetch('/health', { headers: { Accept: 'application/json' } })
  .then(async (response) => {
    const body = await response.json();
    if (!response.ok || body.status !== 'ready') throw new Error('Service is not ready');
    if (status) status.dataset.serviceStatus = 'ready';
    if (statusLabel) statusLabel.textContent = 'Hosted endpoint operational';
  })
  .catch(() => {
    if (status) status.dataset.serviceStatus = 'unavailable';
    if (statusLabel) statusLabel.textContent = 'Endpoint configuration pending';
  });
