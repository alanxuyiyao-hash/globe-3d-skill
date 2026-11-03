#!/usr/bin/env python3
"""Copy the clean, self-contained globe template into a new project folder."""
import argparse
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1] / 'assets' / 'template'
    destination = args.destination.expanduser().resolve()
    if destination.exists():
        parser.error(f'目标已存在，拒绝覆盖：{destination}')
    if source == destination or source in destination.parents:
        parser.error('输出目录不能放在 Skill 的模板内')
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns(
        'node_modules', 'dist', '.git', '.env*', '*.local', '*.tsbuildinfo', '__pycache__', '.DS_Store'))
    print(f'已创建：{destination}\n运行：cd "{destination}" && npm ci && npm run dev')


if __name__ == '__main__':
    main()
