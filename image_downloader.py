import asyncio
from playwright.async_api import async_playwright
import os
from urllib.parse import urljoin, urlparse
import aiohttp
import re
import ssl

class ImageDownloader:
    def __init__(self):
        # 更新默认请求头，完全匹配浏览器行为
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'zh-CN,zh-TW;q=0.9,zh;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Connection': 'keep-alive',
            'Cache-Control': 'max-age=0',
            'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Priority': 'u=0, i'
        }
        # 网站配置
        self.site_configs = {
            'www.imagefap.com': {
                'selectors': {
                    'image': '#slideshow > center > div.image-wrapper > span > img',
                    'next_button': '#controls > div > a.next'
                },
                'download_strategy': 'single_image_paging',
                'options': {
                    'wait_for_image_timeout': 15000,
                    'wait_for_page_change_timeout': 15000,
                    'delay_between_downloads': 200
                }
            },
            'xx.knit.bid': {
                'selectors': {
                    'image_container': '.article-content',
                    'images': '.article-content .item-image img',
                    'load_more_button': '.ias_trigger a',
                    'loading_indicator': '.pagination-loading',
                    'loading_image': 'img[src$="static/zde/timg.gif"]'
                },
                'download_strategy': 'multiple_images_scroll',
                'options': {
                    'scroll_step': 300,
                    'scroll_interval': 200,
                    'max_wait_time': 5000,
                    'load_more_wait_time': 10000
                }
            }
        }
        # 默认配置
        self.default_config = {
            'selectors': {
                'image': '#slideshow > center > div.image-wrapper > span > img',
                'next_button': '#controls > div > a.next'
            },
            'download_strategy': 'single_image_paging',
            'options': {
                'wait_for_image_timeout': 10000,
                'wait_for_page_change_timeout': 15000,
                'delay_between_downloads': 500
            }
        }

    async def download_image(self, url: str, folder: str, page):
        """使用 playwright 直接获取图片内容并保存"""
        try:
            os.makedirs(folder, exist_ok=True)
            
            filename = os.path.basename(urlparse(url).path).split('?')[0]
            if not filename:
                filename = f"image_{hash(url)}.jpg"
            
            filepath = os.path.join(folder, filename)
            
            if os.path.exists(filepath):
                print(f"文件已存在: {filename}")
                return
            
            try:
                print(f"正在下载: {filename}")
                # 使用 page.goto 获取响应
                response = await page.goto(url)
                if response:
                    # 获取图片内容
                    image_buffer = await response.body()
                    # 保存图片
                    with open(filepath, 'wb') as f:
                        f.write(image_buffer)
                    print(f"下载成功: {filename}")
                else:
                    print(f"下载失败: {url}, 无响应")
                    
            except Exception as e:
                print(f"下载失败: {url}, 错误: {str(e)}")
            
        except Exception as e:
            print(f"处理出错: {url}, 错误: {str(e)}")

    async def single_image_paging(self, page, config):
        """单图翻页模式下载策略"""
        selectors = config['selectors']
        options = config['options']
        processed_urls = set()
        
        # 创建新的页面用于下载
        download_page = await page.context.new_page()
        
        try:
            while True:
                try:
                    # 等待图片加载
                    img_element = await page.wait_for_selector(selectors['image'], 
                        timeout=options['wait_for_image_timeout'])
                    if not img_element:
                        print("图片加载超时")
                        break
                    
                    # 获取图片URL
                    img_url = await img_element.get_attribute('src')
                    if img_url in processed_urls:
                        print("检测到重复图片，下载完成")
                        break
                    
                    # 下载图片
                    folder_name = await page.title()
                    folder_name = re.sub(r'[\\/:*?"<>|]', '_', folder_name).strip()
                    await self.download_image(img_url, folder_name, download_page)
                    processed_urls.add(img_url)
                    
                    # 点击下一页
                    next_button = await page.query_selector(selectors['next_button'])
                    if not next_button:
                        break
                        
                    await next_button.click()
                    await page.wait_for_timeout(options['delay_between_downloads'])
                    
                except Exception as e:
                    print(f"处理出错: {str(e)}")
                    break
        finally:
            await download_page.close()

    async def multiple_images_scroll(self, page, config):
        """多图滚动加载模式下载策略"""
        selectors = config['selectors']
        options = config['options']
        processed_urls = set()
        loaded_images = 0
        
        # 滚动到顶部
        await page.evaluate('window.scrollTo(0, 0)')
        await page.wait_for_timeout(1000)
        print("开始加载图片...")
        
        while True:
            try:
                # 检查加载中的图片
                loading_images = await page.query_selector_all(selectors['loading_image'])
                if loading_images:
                    print("等待图片加载完成...")
                    await page.wait_for_timeout(options['max_wait_time'])
                
                # 获取当前可见的图片
                images = await page.query_selector_all(selectors['images'])
                for img in images:
                    img_url = await img.get_attribute('src') or await img.get_attribute('data-src')
                    if img_url and img_url not in processed_urls:
                        # 处理相对路径
                        if img_url.startswith('/'):
                            img_url = urljoin(await page.url, img_url)
                            
                        folder_name = await page.title()
                        folder_name = re.sub(r'[\\/:*?"<>|]', '_', folder_name).strip()
                        await self.download_image(img_url, folder_name, page)
                        processed_urls.add(img_url)
                        loaded_images += 1
                        print(f"已下载 {loaded_images} 张图片")
                
                # 检查加载更多按钮
                load_more = await page.query_selector(selectors['load_more_button'])
                if load_more:
                    await load_more.click()
                    print("点击加载更多...")
                    await page.wait_for_timeout(options['load_more_wait_time'])
                    continue
                
                # 滚动页面
                await page.evaluate(f'window.scrollBy(0, {options["scroll_step"]})')
                await page.wait_for_timeout(options['scroll_interval'])
                
                # 检查是否到达底部
                is_bottom = await page.evaluate('''
                    window.innerHeight + window.pageYOffset >= document.body.offsetHeight
                ''')
                if is_bottom:
                    await page.wait_for_timeout(2000)  # 等待可能的延迟加载
                    print(f"下载完成，共下载 {loaded_images} 张图片")
                    break
                    
            except Exception as e:
                print(f"处理出错: {str(e)}")
                break

    async def start(self, url: str):
        """开始下载流程"""
        async with async_playwright() as p:
            # 配置浏览器
            browser = await p.chromium.launch(headless=False)
            context = await browser.new_context(
                user_agent=self.headers['User-Agent'],
                # 添加更多请求头
                extra_http_headers={
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language': self.headers['Accept-Language'],
                    'Referer': 'https://www.imagefap.com/',
                    'Sec-Ch-Ua': self.headers['Sec-Ch-Ua'],
                    'Sec-Ch-Ua-Mobile': self.headers['Sec-Ch-Ua-Mobile'],
                    'Sec-Ch-Ua-Platform': self.headers['Sec-Ch-Ua-Platform'],
                    'Sec-Fetch-Dest': 'image',
                    'Sec-Fetch-Mode': 'no-cors',
                    'Sec-Fetch-Site': 'cross-site'
                }
            )
            
            # 设置Cookie
            await context.add_cookies([{
                'name': 'PHPSESSID',
                'value': 'aa6a9dd1b3c34d39aead70a1716f76a3',
                'domain': '.imagefap.com',
                'path': '/'
            }, {
                'name': 'show_only_once_per_day6',
                'value': '1',
                'domain': '.imagefap.com',
                'path': '/'
            }])
            
            # 创建两个页面：一个用于浏览，一个用于下载
            page = await context.new_page()
            download_page = await context.new_page()
            
            try:
                await page.goto(url)
                
                parsed_url = urlparse(url)
                hostname = parsed_url.hostname
                if not hostname:
                    raise ValueError("无效的URL，无法获取域名")
                
                config = self.site_configs.get(hostname, self.default_config)
                
                if config['download_strategy'] == 'single_image_paging':
                    await self.single_image_paging(page, config)
                else:
                    await self.multiple_images_scroll(page, config)
                    
            except Exception as e:
                print(f"发生错误: {str(e)}")
            finally:
                await browser.close()

# 使用示例
async def main():
    downloader = ImageDownloader()
    url = "https://www.imagefap.com/photo/1953248481/"  # 替换为实际的图片页面URL
    await downloader.start(url)

if __name__ == "__main__":
    asyncio.run(main()) 