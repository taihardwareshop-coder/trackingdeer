import os
import google.generativeai as genai

# 讀取剛剛設定的保險箱金鑰
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# 叫 Gemini 大模型幫忙寫文章
model = genai.GenerativeModel("gemini-2.5-flash")
prompt = "請寫一篇關於生活靈感的繁體中文短文，格式為 Markdown。"
response = model.generate_content(prompt)

# 建立一個叫 posts 的資料夾，並把文章存成 latest.md 檔案
file_path = "posts/latest.md"
os.makedirs(os.path.dirname(file_path), exist_ok=True)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(response.text)

print("文章生成完成！")