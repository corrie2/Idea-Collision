"""CLI entry point for Idea Collision system."""

import argparse
import os
import sys

from config import Config
from arena import Arena
from report import generate_report


def main():
    parser = argparse.ArgumentParser(
        description="🧠 Idea Collision — 多智能体创意碰撞系统",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python3 main.py "过滤型近似近邻搜索里有没有强的非图算法"
  python3 main.py "如何设计一个自愈系统" --rounds 6
  python3 main.py "AI Agent 的未来" --no-knowledge
  python3 main.py --stats
  python3 main.py --search "HNSW"
        """
    )

    parser.add_argument("topic", nargs="?", help="碰撞主题")
    parser.add_argument("--rounds", type=int, default=None, help="碰撞轮次 (默认: 4)")
    parser.add_argument("--no-knowledge", action="store_true", help="跳过知识库")
    parser.add_argument("--agents", type=str, default=None,
                        help="指定智能体 (逗号分隔，如: provocateur,critic,researcher)")
    parser.add_argument("--disable", type=str, default=None,
                        help="禁用指定智能体 (逗号分隔)")
    parser.add_argument("--stats", action="store_true", help="查看知识库统计")
    parser.add_argument("--search", type=str, default=None, help="搜索知识库")

    args = parser.parse_args()

    config = Config()

    # Handle --stats
    if args.stats:
        config.no_knowledge = False
        arena = Arena(config)
        stats = arena.get_knowledge_stats()
        if stats:
            print(f"\n📊 知识库统计:")
            print(f"  创意 (ideas):      {stats['ideas']}")
            print(f"  洞见 (insights):   {stats['insights']}")
            print(f"  质疑 (critiques):  {stats['critiques']}")
            print(f"  概念 (concepts):   {stats['concepts']}")
            print(f"  关系 (relations):  {stats['relations']}")
            total = sum(stats.values())
            print(f"  ─────────────────")
            print(f"  总计:              {total}")
        else:
            print("知识库未启用或为空。")
        arena.close()
        return

    # Handle --search
    if args.search:
        config.no_knowledge = False
        arena = Arena(config)
        results = arena.search_knowledge(args.search)
        if results:
            print(f"\n🔍 搜索: \"{args.search}\"\n")
            for category, items in results.items():
                if items:
                    print(f"  [{category}]")
                    for i, item in enumerate(items, 1):
                        doc = item["document"][:100]
                        print(f"    {i}. {doc}")
                    print()
        else:
            print("知识库未启用或无结果。")
        arena.close()
        return

    # Normal collision
    if not args.topic:
        parser.print_help()
        sys.exit(1)

    # Apply CLI overrides
    if args.rounds:
        config.num_rounds = args.rounds
    if args.no_knowledge:
        config.no_knowledge = True
    if args.agents:
        config.agents_order = [a.strip() for a in args.agents.split(",")]
    if args.disable:
        config.agents_disabled = [a.strip() for a in args.disable.split(",")]

    config.validate()

    arena = Arena(config)
    try:
        result = arena.run(args.topic)
        report_path = generate_report(result, config.output_dir)
        print(f"📄 Report saved to: {report_path}")
    finally:
        arena.close()


if __name__ == "__main__":
    main()
