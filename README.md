# 🧠 Idea Collision

一个基于多智能体的创意碰撞系统，通过不同思维角度的智能体进行多轮辩论和碰撞，产出高质量的创意方案。

## ✨ 特性

- **7个专业智能体**：挑衅者、研究者、批评家、连接者、实验者、融合者、务实者
- **多轮碰撞**：智能体之间进行4-6轮深入辩论
- **知识库集成**：ChromaDB向量数据库存储历史碰撞成果
- **素材库系统**：支持PDF文件上传和知识提取
- **Web UI**：React + FastAPI的现代化界面
- **导出功能**：支持Markdown和HTML格式导出

## 🚀 快速开始

### 安装依赖

```bash
pip install -r requirements.txt
```

### 配置

1. 复制配置文件：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，填入你的API密钥：
```
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

### 运行

#### CLI模式
```bash
python main.py "你的主题"
```

#### Web UI模式
```bash
python server.py
```

访问 http://localhost:8080

## 📁 项目结构

```
idea-collision/
├── agents/              # 智能体代码
│   ├── base.py         # 基础智能体类
│   ├── provocateur.py  # 挑衅者
│   ├── researcher.py   # 研究者
│   ├── critic.py       # 批评家
│   ├── connector.py    # 连接者
│   ├── experimenter.py # 实验者
│   ├── synthesizer.py  # 融合者
│   └── pragmatist.py   # 务实者
├── knowledge/           # 知识库代码
├── web/                 # 前端代码
├── server.py           # Web服务器
├── arena.py            # 碰撞调度器
├── config.py           # 配置管理
├── main.py             # CLI入口
└── report.py           # 报告生成
```

## 🎯 使用场景

- 学术研究创意生成
- 产品设计头脑风暴
- 技术方案评审
- 创意写作辅助
- 任何需要多角度思考的场景

## 📝 许可证

MIT License
