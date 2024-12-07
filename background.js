chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'downloadImage') {
    chrome.downloads.download({
      url: message.url,
      filename: message.filename,
      saveAs: false
    });
  }
}); 