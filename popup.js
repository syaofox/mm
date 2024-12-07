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
  
  // 根据域名配置不同网站的选择器和下载策略
  const siteConfigs = {
    'www.imagefap.com': {
      selectors: {
        image: '#slideshow > center > div.image-wrapper > span > img',
        nextButton: '#controls > div > a.next'
      },
      downloadStrategy: 'singleImagePaging',
      options: {
        waitForImageTimeout: 10000,
        waitForPageChangeTimeout: 15000,
        delayBetweenDownloads: 500
      }
    },
    'example2.com': {
      selectors: {
        imageContainer: '.gallery-container',
        images: '.gallery-container img',
        loadMoreButton: '.load-more'
      },
      downloadStrategy: 'multipleImagesScroll',
      options: {
        batchSize: 10,
        scrollDelay: 1000
      }
    },
    // 默认配置
    default: {
      selectors: {
        image: '#slideshow > center > div.image-wrapper > span > img',
        nextButton: '#controls > div > a.next'
      },
      downloadStrategy: 'singleImagePaging',
      options: {
        waitForImageTimeout: 10000,
        waitForPageChangeTimeout: 15000,
        delayBetweenDownloads: 500
      }
    }
  };

  // 下载策略实现
  const downloadStrategies = {
    // 单图翻页模式
    singleImagePaging: async (config) => {
      const { selectors, options } = config;
      let processedUrls = new Set();
      
      while (true) {
        const imgElement = await waitForImage(selectors.image, options.waitForImageTimeout);
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
        await downloadImage(imgUrl);
        
        const nextButton = document.querySelector(selectors.nextButton);
        if (!nextButton) break;
        
        nextButton.click();
        
        const pageChanged = await waitForPageChange(imgUrl, selectors.image, options.waitForPageChangeTimeout);
        if (!pageChanged) {
          console.log('页面切换超时');
          break;
        }
        
        await sleep(options.delayBetweenDownloads);
      }
    },

    // 多图滚动加载模式
    multipleImagesScroll: async (config) => {
      const { selectors, options } = config;
      let processedUrls = new Set();
      
      while (true) {
        const images = Array.from(document.querySelectorAll(selectors.images));
        let newImages = images.filter(img => !processedUrls.has(img.src));
        
        if (newImages.length === 0) {
          const loadMoreButton = document.querySelector(selectors.loadMoreButton);
          if (!loadMoreButton) break;
          
          loadMoreButton.click();
          await sleep(options.scrollDelay);
          continue;
        }
        
        for (const img of newImages) {
          processedUrls.add(img.src);
          await downloadImage(img.src);
        }
        
        // 自动滚动到底部
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(options.scrollDelay);
      }
    }
  };

  // 辅助函数
  const waitForImage = async (selector, timeout) => {
    let attempts = 0;
    const maxAttempts = timeout / 500;
    while (attempts < maxAttempts) {
      const imgElement = document.querySelector(selector);
      if (imgElement && imgElement.complete && imgElement.naturalHeight !== 0) {
        return imgElement;
      }
      await sleep(500);
      attempts++;
    }
    return null;
  };

  const waitForPageChange = async (currentUrl, imageSelector, timeout) => {
    return new Promise((resolve) => {
      let timeoutId;
      const observer = new MutationObserver(async (mutations) => {
        const imgElement = document.querySelector(imageSelector);
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
      }, timeout);
    });
  };

  const downloadImage = async (imgUrl) => {
    const folderName = document.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'downloaded_images';
    const originalFileName = imgUrl.split('/').pop().split('?')[0];
    
    chrome.runtime.sendMessage({
      type: 'downloadImage',
      url: imgUrl,
      filename: `${folderName}/${originalFileName}`
    });
  };

  // 获取当前网站的配置
  const currentConfig = siteConfigs[hostname] || siteConfigs.default;
  
  // 执行对应的下载策略
  await downloadStrategies[currentConfig.downloadStrategy](currentConfig);
} 