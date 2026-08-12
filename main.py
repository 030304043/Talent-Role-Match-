from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from zhipuai import ZhipuAI
import json
import re
import hashlib
import uvicorn
from typing import List, Dict, Any



app = FastAPI(title="Talent‑Role Match Engine")

# CORS修复：allow_credentials=True不能搭配*
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "chrome-extension://*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 内存缓存：存dict而不是Pydantic对象
cache_db: Dict[str, Any] = {}

# 填入你申请到的智谱 API Key
API_KEY = "d17539fbb492453d89ffeb370442a484.cfuA5VE83bgzxbVe" 
client = ZhipuAI(api_key=API_KEY)

class MatchRequest(BaseModel):
    resume_text: str
    jd_text: str


class MatchResponse(BaseModel):
    match_score: int
    radar_labels: List[str]
    radar_user_scores: List[int]
    radar_jd_scores: List[int]
    action_items: List[str]
    error: bool = False


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'[^\w\s\u4e00-\u9fa5,，.。（）()+/]', '', text)
    return text.strip()




def get_fallback_response(msg: str) -> MatchResponse:
    return MatchResponse(
        match_score=60,
        radar_labels=["硬核技术", "项目经验", "学历背景", "软技能", "综合素养"],
        radar_user_scores=[60, 60, 60, 60, 60],
        radar_jd_scores=[80, 80, 80, 80, 80],
        action_items=[msg],
        error=True
    )

def call_llm_for_match(resume: str, jd: str):
    system_prompt = """
    你是一位资深的互联网技术HR专家和职业规划师。
    请阅读用户提供的【岗位JD】和【求职者简历】，进行深度的多维度评估。
    
    你必须严格输出一个 JSON 对象，不要输出任何解释文字和 Markdown 符号。
    要求：所有的分数必须是你根据简历和JD的实际情况，经过真实计算后得出的 0-100 的整数，绝对不能偷懒照抄！
    
    JSON 格式如下：
    {
      "match_score": 0, // 请将0替换为你真实评估的综合得分 (0-100)
      "radar_labels": ["硬核技术", "项目经验", "学历背景", "软技能", "业务认知"],
      "radar_user_scores": [0, 0, 0, 0, 0], // 请将0替换为求职者的真实得分数组
      "radar_jd_scores": [0, 0, 0, 0, 0], // 请将0替换为岗位要求的真实基准得分数组
      "action_items": [
        "🟢 优势：(基于简历内容，具体指出求职者最符合该岗位的长处)",
        "🔴 劣势：(基于JD要求，具体指出求职者欠缺的经验或技能)",
        "🟡 建议：(给出具有实操性的面试准备或短期提升建议)"
      ]
    }
    再次警告：输出的 JSON 中不能包含任何值为 0 的假数据，必须输出真实计算结果！
    """
    user_prompt = f"【岗位JD】\n{jd}\n\n【求职者简历】\n{resume}"

    try:
        response = client.chat.completions.create(
            model="glm-4-flash", # 如果你申请的是GLM-5.2，可在此处更改模型名称
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3, 
        )
        
        result_text = response.choices[0].message.content.strip()
        result_text = re.sub(r"^```json\s*", "", result_text)
        result_text = re.sub(r"\s*```$", "", result_text)
        
        return json.loads(result_text)
    except Exception as e:
        print(f"LLM API Error: {e}")
        return None


@app.post("/api/match", response_model=MatchResponse)
async def match_talent_and_role(req: MatchRequest):
    try:
        resume = clean_text(req.resume_text)
        jd = clean_text(req.jd_text)

        if len(resume) < 20 or len(jd) < 20:
            return get_fallback_response("输入文本过短，请提供完整的简历和JD内容。")

        cache_key = hashlib.md5(f"{resume[:100]}_{jd[:100]}".encode()).hexdigest()
        if cache_key in cache_db:
            return MatchResponse(**cache_db[cache_key])

        llm_result = call_llm_for_match(resume, jd)
        if llm_result is None:
            return get_fallback_response("AI 分析时出现波动，请稍后重试。")
            
        match_response = MatchResponse(**llm_result)
        cache_db[cache_key] = match_response.model_dump()
        return match_response

    except Exception as e:
        print(f"Error during matching: {e}")
        return get_fallback_response("匹配服务处理异常，已开启保护模式，请稍后重试。")


import os
if __name__ == "__main__":
    # 云平台会自动注入 PORT 环境变量，如果没有就默认用 8000
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)