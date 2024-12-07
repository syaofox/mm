document.getElementById('startDownload').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: startDownloading
  });
});

async function startDownloading() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  // 等待图片加载完成的函数
  const waitForImage = async () => {
    let attempts = 0;
    while (attempts < 20) {
      const imgElement = document.querySelector('#slideshow > center > div.image-wrapper > span > img');
      if (imgElement && imgElement.complete && imgElement.naturalHeight !== 0) {
        return imgElement;
      }
      await sleep(500);
      attempts++;
    }
    return null;
  };

  // 等待页面变化的函数
  const waitForPageChange = async (currentUrl) => {
    return new Promise((resolve) => {
      let timeoutId;
      const observer = new MutationObserver(async (mutations) => {
        const imgElement = document.querySelector('#slideshow > center > div.image-wrapper > span > img');
        if (imgElement && imgElement.src !== currentUrl) {
          observer.disconnect();
          clearTimeout(timeoutId);
          // 确保新图片已完全加载
          await sleep(500);
          resolve(true);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      // 设置超时保护，15秒后自动结束
      timeoutId = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, 15000);
    });
  };

  // 获取并清理文件夹名称
  let folderName = document.title.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!folderName) folderName = 'downloaded_images';
  
  let processedUrls = new Set();
  let index = 1;
  
  while (true) {
    // 等待图片完全加载
    const imgElement = await waitForImage();
    if (!imgElement) {
      console.log('图片加载超时');
      break;
    }
    
    const imgUrl = imgElement.src;
    if (processedUrls.has(imgUrl)) {
      console.log('检测到重复图片，下载完成');
      break;
    }
    
    processedUrls.add(imgUrl);
    
    // 从URL中提取文件名
    const originalFileName = imgUrl.split('/').pop().split('?')[0];
    
    // 发送下载请求到background script
    chrome.runtime.sendMessage({
      type: 'downloadImage',
      url: imgUrl,
      filename: `${folderName}/${originalFileName}`
    });
    
    // 点击下一页
    const nextButton = document.querySelector('#controls > div > a.next');
    if (!nextButton) break;
    
    nextButton.click();
    
    // 等待页面内容变化
    const pageChanged = await waitForPageChange(imgUrl);
    if (!pageChanged) {
      console.log('页面切换超时');
      break;
    }
    
    index++;
  }
} 