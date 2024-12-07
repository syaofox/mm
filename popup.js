document.getElementById('startDownload').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: startDownloading
  });
});

async function startDownloading() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  // 获取并清理文件夹名称
  let folderName = document.title.replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!folderName) folderName = 'downloaded_images';
  
  let processedUrls = new Set();
  let index = 1;
  
  while (true) {
    // 获取当前图片
    const imgElement = document.querySelector('#slideshow > center > div.image-wrapper > span > img');
    if (!imgElement) break;
    
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
    index++;
    
    // 等待页面加载
    await sleep(1000);
  }
} 