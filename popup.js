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
    'xx.knit.bid': {
      selectors: {
        imageContainer: '.article-content',
        images: '.article-content .item-image img',
        loadMoreButton: '.ias_trigger a',
        loadingIndicator: '.pagination-loading',
        loadingImage: 'img[src$="static/zde/timg.gif"]'
      },
      downloadStrategy: 'multipleImagesScroll',
      options: {
        scrollStep: window.innerHeight - 100,
        scrollInterval: 200,
        maxWaitTime: 5000,
        loadMoreWaitTime: 10000,
        processImageUrl: (img) => {
          let src = img.dataset.src || img.src;
          if (src.startsWith('/')) {
            return window.location.origin + src;
          } else if (!src.startsWith('http')) {
            return new URL(src, window.location.href).href;
          }
          return src;
        }
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
      let loadedImages = 0;
      
      const updateProgress = (message) => {
        console.log(message);
        chrome.runtime.sendMessage({
          type: 'updateProgress',
          message: message
        });
      };
      
      // 滚动到页面顶部
      window.scrollTo(0, 0);
      await sleep(1000);
      updateProgress('开始加载图片...');
      
      while (true) {
        // 检查当前可见区域内的加载中图片
        const loadingImages = Array.from(document.querySelectorAll(selectors.loadingImage))
          .filter(img => {
            const rect = img.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= window.innerHeight;
          });

        if (loadingImages.length > 0) {
          updateProgress('等待图片加载完成...');
          let waitTime = 0;
          while (document.querySelectorAll(selectors.loadingImage).length > 0 && 
                 waitTime < options.maxWaitTime) {
            await sleep(200);
            waitTime += 200;
          }
        }

        // 检查当前可见区域的图片
        const images = Array.from(document.querySelectorAll(selectors.images));
        const newImages = images.filter(img => !processedUrls.has(img.src));
        
        // 处理新发现的图片
        for (const img of newImages) {
          const imgUrl = options.processImageUrl(img);
          if (!processedUrls.has(imgUrl)) {
            processedUrls.add(imgUrl);
            await downloadImage(imgUrl);
            loadedImages++;
            updateProgress(`已下载 ${loadedImages} 张图片`);
          }
        }
        
        // 检查加载更多按钮
        let loadMoreButton = document.querySelector(selectors.loadMoreButton);
        if (loadMoreButton) {
          // 获取按钮的位置信息
          const buttonRect = loadMoreButton.getBoundingClientRect();
          
          // 如果按钮不在视图中或者只露出一部分，调整滚动位置
          if (buttonRect.bottom > window.innerHeight || buttonRect.top < 0) {
            // 滚动到按钮上方一点的位置，确保按钮完全可见
            const scrollToY = window.pageYOffset + buttonRect.top - 100;
            window.scrollTo(0, scrollToY);
            await sleep(500);
            
            // 重新获取按钮，因为滚动可能触发了页面更新
            loadMoreButton = document.querySelector(selectors.loadMoreButton);
          }
          
          if (loadMoreButton) {
            loadMoreButton.click();
            updateProgress('点击加载更多...');
            
            // 等待加载指示器消失
            let waitTime = 0;
            while (document.querySelector(selectors.loadingIndicator) && 
                   waitTime < options.loadMoreWaitTime) {
              await sleep(200);
              waitTime += 200;
            }
            
            if (waitTime >= options.loadMoreWaitTime) {
              updateProgress('加载更多内容超时');
              break;
            }
            
            // 等待新内容加载
            await sleep(1000);
            continue;
          }
        }
        
        // 如果没有找到加载更多按钮，使用较小的滚动步长
        const smallerScrollStep = Math.min(options.scrollStep, 300);
        window.scrollBy(0, smallerScrollStep);
        await sleep(options.scrollInterval);
        
        // 检查是否到达页面底部
        if (window.innerHeight + window.pageYOffset >= document.body.offsetHeight) {
          await sleep(2000); // 等待可能的延迟加载
          
          // 再次检查新图片
          const finalImages = Array.from(document.querySelectorAll(selectors.images));
          const remainingImages = finalImages.filter(img => !processedUrls.has(img.src));
          
          if (remainingImages.length === 0) {
            updateProgress(`下载完成，共下载 ${loadedImages} 张图片`);
            break;
          }
        }
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