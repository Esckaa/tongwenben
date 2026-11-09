/* 点击工具栏图标，打开扩展内的 PDF 阅读器。 */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pdf-viewer.html') });
});
