//包含了完整的状态机设计（空简历、抓取失败兜底、加载中、成功渲染、异常报错）。
document.addEventListener('DOMContentLoaded', async () => {
 const appContainer = document.getElementById('app');
 const API_URL = "http://127.0.0.1:8000/api/match"; // 你的本地 FastAPI 地址

 // 1. 防御：检查本地简历
 const storage = await chrome.storage.local.get(['resumeText']);
 if (!storage.resumeText) {
   renderEmptyResumeView(appContainer);
   return;
 }

 // 2. 加载状态
 renderLoadingView(appContainer);

 try {
   // 3. 向当前活动标签页发送消息，抓取 JD
   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
   if (!tab) throw new Error("无法获取当前页面标签");

   chrome.tabs.sendMessage(tab.id, { action: "get_jd" }, async (response) => {
     // 若 Content Script 未注入或抓取失败，进入手动兜底模式
     if (chrome.runtime.lastError || !response || !response.jdText) {
       renderManualInputView(appContainer, "未能自动捕获该岗位的职位描述，请手动粘贴：", storage.resumeText);
       return;
     }

     // 4. 调用后端进行匹配
     await performMatch(appContainer, storage.resumeText, response.jdText);
   });
 } catch (err) {
   renderErrorView(appContainer, err.message);
 }

 // 核心请求函数
 async function performMatch(container, resume, jd) {
   try {
     const res = await fetch(API_URL, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ resume_text: resume, jd_text: jd })
     });
     const data = await res.json();
     if (data.error) {
       renderErrorView(container, data.action_items[0]);
     } else {
       renderSuccessView(container, data);
     }
   } catch (err) {
     renderErrorView(container, "网络请求失败，请确认本地后端服务已启动。");
   }
 }
});

// ===== 视图渲染函数区 =====

function renderEmptyResumeView(container) {
 container.innerHTML = `
   <div class="card">
     <h3 style="margin-top:0;">📝 录入简历</h3>
     <p style="color: #666; font-size: 13px;">请先粘贴您的简历核心内容（经历、技能等），系统将自动保存在本地。</p>
     <textarea id="resumeInput" placeholder="在此粘贴简历..." style="height: 120px; margin-bottom: 10px;"></textarea>
     <button id="saveResumeBtn">保存简历并开启匹配</button>
   </div>
 `;
 document.getElementById('saveResumeBtn').addEventListener('click', async () => {
   const text = document.getElementById('resumeInput').value.trim();
   if (text.length < 20) return alert("为了准确率，简历内容请不要少于20字。");
   await chrome.storage.local.set({ resumeText: text });
   window.location.reload();
 });
}

function renderManualInputView(container, promptText, resumeText) {
 container.innerHTML = `
   <div class="card">
     <h4 style="margin: 0 0 10px 0;">💡 补充 JD 文本</h4>
     <p style="font-size: 12px; color: #666;">${promptText}</p>
     <textarea id="jdInput" placeholder="粘贴 JD 内容..." style="height: 100px; margin-bottom: 10px;"></textarea>
     <button id="calcBtn">手动计算匹配度</button>
   </div>
 `;
 document.getElementById('calcBtn').addEventListener('click', async () => {
   const jdText = document.getElementById('jdInput').value.trim();
   if (!jdText) return alert("JD 不能为空！");
   container.innerHTML = `<div class="card" style="text-align:center;">计算中...</div>`;
   // 这里需要重新调用外部的请求逻辑，简化处理：
   const res = await fetch('https://talent-radar-api.onrender.com/api/match', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ resume_text: resumeText, jd_text: jdText })
   }).catch(() => null);
   
   if (res && res.ok) {
     const data = await res.json();
     renderSuccessView(container, data);
   } else {
     renderErrorView(container, "请求失败");
   }
 });
}

function renderLoadingView(container) {
 container.innerHTML = `
   <div class="card" style="text-align: center; padding: 40px 10px;">
     <h4 style="color: #0066ff;">⚡ 正在计算多维契合度...</h4>
     <p style="font-size: 12px; color: #999;">深入解析简历与岗位要求</p>
   </div>
 `;
}

function renderErrorView(container, errorMsg) {
 container.innerHTML = `
   <div class="card" style="border-left: 4px solid #ff4d4f;">
     <h4 style="color: #cf1322; margin-top:0;">⚠️ 发生异常</h4>
     <p style="font-size: 13px;">${errorMsg}</p>
     <button onclick="window.location.reload()" style="background: #555;">重试</button>
   </div>
 `;
}

function renderSuccessView(container, data) {
 container.innerHTML = `
   <div class="card" style="display:flex; justify-content: space-between; align-items:center;">
     <span style="font-weight:bold; font-size:16px;">综合匹配度</span>
     <span style="font-size: 24px; font-weight: 900; color: #0066ff;">${data.match_score} 分</span>
   </div>
   <div class="card">
     <canvas id="radarChart"></canvas>
   </div>
   <div class="card">
     <h4 style="margin-top:0;">🎯 诊断建议</h4>
     <ul style="padding-left: 20px; font-size: 13px; color: #333; margin:0; line-height: 1.6;">
       ${data.action_items.map(item => `<li>${item}</li>`).join('')}
     </ul>
   </div>
 `;

 const ctx = document.getElementById('radarChart').getContext('2d');
 new Chart(ctx, {
   type: 'radar',
   data: {
     labels: data.radar_labels,
     datasets: [
       { label: '我的能力', data: data.radar_user_scores, backgroundColor: 'rgba(0,102,255,0.2)', borderColor: '#0066ff', pointBackgroundColor: '#0066ff' },
       { label: '岗位要求', data: data.radar_jd_scores, backgroundColor: 'rgba(255,99,132,0.1)', borderColor: '#ff6384', pointBackgroundColor: '#ff6384' }
     ]
   },
   options: { responsive: true, scales: { r: { suggestedMin: 0, suggestedMax: 100 } } }
 });
 chrome.storage.local.remove('resumeText');
}
