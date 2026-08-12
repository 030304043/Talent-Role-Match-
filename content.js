// 监听插件消息通信
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get_jd") {
    const jdText = extractJD();
    sendResponse({ jdText });
  }
  // 异步响应标识
  return true;
});

/**
 * 提取页面招聘JD文本
 * @returns {string|null} 岗位描述文本，无内容返回null
 */
function extractJD() {
  // 主流招聘平台JD专属选择器
  const selectors = [
    '.job-detail',          // Boss直聘
    '.job-sec-text',        // Boss直聘备用
    '.job-intro-content',   // 猎聘
    '.description__text',   // LinkedIn领英
    '.bmsg.job_msg.inbox'   // 前程无忧
  ];

  // 优先精准匹配平台专用容器
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    const text = el?.innerText.trim();
    if (text && text.length > 30) return text;
  }

  // 兜底：自动筛选页面最长有效文本块
  const blockList = Array.from(document.querySelectorAll('div, section, article'));
  let longestText = "";

  for (const block of blockList) {
    // 过滤层级过深、元素过多的大容器
    if (block.children.length < 10) {
      const text = block.innerText.trim();
      // 限制文本长度区间，排除过短/超长垃圾文本
      if (text.length > longestText.length && text.length < 5000) {
        longestText = text;
      }
    }
  }

  // 文本长度达标才返回
  return longestText.length > 50 ? longestText : null;
}