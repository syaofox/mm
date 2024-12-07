document.getElementById('startDownload').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: startDownloading
  });
});

async function startDownloading() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  // 获取当前域名
  const hostname = window.location.hostname;
  
  // 根据域名配置不同网站的选择器
  const selectors = {
    'www.imagefap.com': {
      image: '#slideshow > center > div.image-wrapper > span > img',
      nextButton: '#controls > div > a.next'
    },
    'example2.com': {
      image: '.main-image img',
      nextButton: '.next-button'
    },
    // 默认选择器
    default: {
      image: '#slideshow > center > div.image-wrapper > span > img',
      nextButton: '#controls > div > a.next'
    }
  };

  // 获取当前网站的选择器配置
  const currentSelectors = selectors[hostname] || selectors.default;

  // 修改 waitForImage 函数使用动态选择器
  const waitForImage = async () => {
    let attempts = 0;
    while (attempts < 20) {
      const imgElement = document.querySelector(currentSelectors.image);
      if (imgElement && imgElement.complete && imgElement.naturalHeight !== 0) {
        return imgElement;
      }
      await sleep(500);
      attempts++;
    }
    return null;
  };

  // 修改 waitForPageChange 函数使用动态选择器
  const waitForPageChange = async (currentUrl) => {
    return new Promise((resolve) => {
      let timeoutId;
      const observer = new MutationObserver(async (mutations) => {
        const imgElement = document.querySelector(currentSelectors.image);
        if (imgElement && imgElement.src !== currentUrl) {
          observer.disconnect();
          clearTimeout(timeoutId);
          await sleep(500);
          resolve(true);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

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
    
    // 修改下一页按钮选择器
    const nextButton = document.querySelector(currentSelectors.nextButton);
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