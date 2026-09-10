# 赛尔传说 · 星辰冒险 (Seer Legends HTML5) + Mesh Animation Extractor

类宝可梦 HTML5 游戏：三宠开局 → 6 张星球地图草丛探险 → 捕捉/进化/配招 → 挑战 6 大 SPT Boss → 裂隙隐藏 Boss。
数值与技能数据源自 [Seer-golang-](https://github.com/gt88domain/Seer-golang-)（`spt.xml` / `skills.xml`，含伤害公式/克制表/经验曲线），
立绘与属性图标来自 [seer-unity-assets-](https://github.com/gt88domain/seer-unity-assets-)，4 只隐藏 Boss 使用本仓库的 Unity Mesh 网格动画实时渲染（雷伊 / 神秘精灵 / 鲁尔蒂尼 / 朵拉格）。
另有自制「宫崎骏 Q 版」皮肤可一键切换（首批三主宠，标题屏/ HUD 🎨 按钮）。

## HTML5 游戏试玩

```bash
# 仓库根目录启动静态服务，然后打开：
# http://127.0.0.1:8080/game/
npx http-server .        # 或 python3 -m http.server 8080
```

玩法：WASD/方向键移动，E/空格互动；草丛遇怪 → 削弱 → 胶囊捕捉；治疗仪免费回复；
商店补给；精灵升级学招、到等级自动进化；击败 Boss 解锁下一张地图。

| 内容 | 规模 |
| ---- | ---- |
| 精灵 | 73 只（含完整进化链）+ 隐藏 Boss |
| 技能 | 319 个（物攻/特攻/变化，全部附加效果可用） |
| 地图 | 6 张（草原/浅滩/火山/遗迹/长空/雷神殿） |
| Boss | 6 SPT + 5 连战裂隙（SPT 通缉令，4 只 Mesh 动画） |
| 道具 | 4 种胶囊 + 6 种药品 |
| 皮肤 | 宫崎骏 Q 版（首批三主宠一整线，逐步追加） |

## 数据管线

```bash
# 从 Seer-golang- 数据裁剪游戏 JSON（已内置开箱即用的 game/data/*.json）
python tools/build_data.py --spt /path/to/Seer-golang-/data/spt.xml \
                           --skills /path/to/Seer-golang-/data/skills.xml

# 无头冒烟测试（Node stub DOM，跑完选宠/走路/野战/捕捉/Boss/商店/存档全流程）
node tools/smoke.mjs

# 数据 + 新 SideEffect 引擎校验
node tools/validate_data.mjs

# ppets_* AssetBundle -> 游戏 Mesh 数据（需自备 Bundle，见 tools/mesh/）
python tools/mesh/export_mesh.py ppets_431 out/ [--atlas-size 2048]

# 宫崎骏皮肤批处理（品红底 AI 图 -> 透明立绘 + manifest）
python tools/skins/chromakey.py raw/ [--ids 1,2,3]
```

> 版权声明：精灵立绘/数值等游戏素材版权归上海淘米网络科技有限公司所有，仅供学习交流。

---

# Seer Unity Mesh Animation Extractor

> [!WARNING]
> 说明：就是一个快速验证个人想法是否可行的小工具，swf精灵共享材质没有处理，导出速度缓慢，学习一下原理即可，不要当作生产工具使用。可以前往朋友[坚果](https://github.com/Nattsu39)的 [seer-pet-viewer](https://github.com/Nattsu39/seer-pet-viewer)或者我的[网页](https://seerinfo.yuyuqaq.cn/tool/petanim)查看动画~

提取 Unity 2D Mesh 动画序列，支持导出为 GIF / WebP / 逐帧 PNG，并提供 WebGL 浏览器预览。

![示例动画](img/standby.webp)

## WebGL 浏览器预览

根目录下启动一个http服务(`npx http-server .`)打开 `http://127.0.0.1:8080`，默认加载 `4913.pet.json` 和 `4913._Atlas_.png`。

支持功能：切换动画序列、调节播放速度、缩放、暂停/播放。

![WebGL 预览](img/web.png)

## 环境要求

- Python 3.8+
- Pillow

```bash
pip install Pillow
```

## 命令行用法

### 基础用法（导出 GIF）

```bash
python index.py 4913.pet.json 4913._Atlas_.png
```

### 导出逐帧 PNG

```bash
python index.py 4913.pet.json 4913._Atlas_.png --png
```

### 导出 WebP 动态图

```bash
python index.py 4913.pet.json 4913._Atlas_.png --webp
```

### 透明背景

```bash
python index.py 4913.pet.json 4913._Atlas_.png --transparent --webp
```

### 提取其他动画序列

```bash
python index.py 4913.pet.json 4913._Atlas_.png -s attack --webp --transparent
```

### 固定画布尺寸

```bash
python index.py 4913.pet.json 4913._Atlas_.png --width 800 --height 800
```

### 调整缩放与留白

```bash
# 增大 scale 让精灵在画布中更大
python index.py 4913.pet.json 4913._Atlas_.png --scale 200

# 自适应画布留白
python index.py 4913.pet.json 4913._Atlas_.png --padding 40
```

### 指定输出目录

```bash
python index.py 4913.pet.json 4913._Atlas_.png -o my_output
```

## 参数说明

| 参数               | 默认值    | 说明                    |
| ------------------ | --------- | ----------------------- |
| `asset`            | (必填)    | Unity 资产 JSON 文件    |
| `atlas`            | (必填)    | 图集纹理 PNG 文件       |
| `-o`, `--output`   | `output`  | 输出目录                |
| `-s`, `--sequence` | `standby` | 动画序列名称            |
| `--fps`            | `24`      | 帧率                    |
| `--scale`          | `120`     | 顶点缩放倍率            |
| `--width`          | 自适应    | 画布宽度                |
| `--height`         | 自适应    | 画布高度                |
| `--padding`        | `16`      | 自适应画布留白（像素）  |
| `--png`            | -         | 导出逐帧 PNG            |
| `--webp`           | -         | 导出 WebP 动态图        |
| `--webp-quality`   | `100`     | WebP 质量（100 = 无损） |
| `--transparent`    | -         | 使用透明背景            |
