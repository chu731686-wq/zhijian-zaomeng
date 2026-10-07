# 首页七张示例图 · 美术方向 v2

采用内置 imagegen，每张分别生成 A、B 两个独立候选；保留旧样图。以下正向提示词与对应候选构图说明一起投喂，避开项逐张附加。

统一正向基调：
Use case: stylized-concept。用途：首页电影叙事样图。独立单幅画面，电影剧照般安静、有故事感，高级手绘动画背景美术，场景与氛围优先。柔和方向光，平滑渐变，干净平滑的色块，克制的色彩，低饱和，每幅最多二至三个主色，仅一处小面积暖色点睛。大面积负空间，主体沿三分线布局，人物仅作为空间尺度和情绪线索。

## 1. home-hero.png · 16:9

**正向提示词：** 横向16:9，目标1792×1008。雨夜古城长街远景，青灰建筑沿石板路渐入薄雨与雾中，路面只有柔和低亮度反光。一个很小的撑油纸伞背影在右侧三分线附近走向画面深处，远处仅一盏暗琥珀暖灯笼。左侧45%完整留给平静的雨雾、暗墙与暗部，没有人物、灯笼、亮光、强线条或密集纹理。蓝灰与炭黑为主，暖琥珀为唯一点睛。

**A 构图：** 低机位长街透视，雨湿石板路在画面下方舒缓延伸，伞的背影位于右下三分线，远灯在右上纵深处。

**B 构图：** 略高平视的更疏朗街景，右边屋檐形成安静框景，背影离观众更远，灯笼藏在街道尽头的薄雾中。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `home-hero-a.png`、`home-hero-b.png`

## 2. template-mystery.png · 3:4

**正向提示词：** 纵向3:4，目标1152×1536。雾中古宅门廊，沉静的大门半开，门缝透出一线柔和烛光，台阶上一盏熄灭的灯笼，没有人物。门廊在右侧三分线，雾和空墙占大面积，建筑形体概括而朴素。雾灰、炭黑与极少暗琥珀，安静的古风悬疑。

**A 构图：** 正面略偏左的远观门廊，几级空台阶横向铺开，熄灭的灯笼在右下台阶，竖直门缝光很窄。

**B 构图：** 从院落一角斜望门廊，左前景一根暗柱形成柔和框景，雾绕过空台阶，熄灭的灯笼靠门侧，门缝光弱且细。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `template-mystery-a.png`、`template-mystery-b.png`

## 3. template-romance.png · 3:4

**正向提示词：** 纵向3:4，目标1152×1536。深夜无招牌无商品标签的朴素便利店窗内，一个普通成年人的远距离侧影坐在窗边，不展示清晰脸部五官。窗玻璃有稀疏雨滴，城市霓虹只有少量柔焦光斑，人物很小、在右侧三分线，雨夜玻璃与空座空间优先。烟蓝、炭灰，窗内仅一小处温暖米杏色光，孤独而温柔。

**A 构图：** 从街外平视大窗，人物侧影只占画面高度约五分之一，左边大片深蓝玻璃留白，暖光落在右边窗台。

**B 构图：** 从街外稍偏角度观察转角窗，人物坐在靠后位置，玻璃柔和映出雨夜街道，窗框和空座构成安静几何。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `template-romance-a.png`、`template-romance-b.png`

## 4. template-scifi.png · 3:4

**正向提示词：** 纵向3:4，目标1152×1536。冰原尽头悬着巨大的环形星港，星港只用沉静简洁的轮廓和稀疏几何结构描绘，大面积天空与冷雾。一名很小的成年探索者背影站在右下边缘仰望，只占画面高度约十分之一。冷灰蓝、炭灰，边缘只有一点暗琥珀指示灯，营造尺度感与安静的科幻冒险。

**A 构图：** 冰原远景，巨环位于上方右侧并在雾中逐渐消隐，人物站在右下冰缘，天空占画面一半以上。

**B 构图：** 从冰谷坡面远望侧倾的环形星港，巨环接近地平线，右下小人站在平缓脊线上，薄雾隔开前后空间。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `template-scifi-a.png`、`template-scifi-b.png`

## 5. project-mystery.png · 16:10

**正向提示词：** 横向16:10，目标1600×1000。古风书案静物特写，一封半封的素纸信、一个朴素封套、一支残烛，纸面和封套完全无字，窗外落雨。没有人物或手，书案、信和烛台布局简洁，主体位于右侧三分线，左侧45%是暗木桌面与柔和窗影留白。炭褐、雾灰与一处温暖烛焰，柔和光线，平滑明暗渐变。

**A 构图：** 桌面低斜角，信半插在素纸封套中，残烛立在右侧后方，窗外雨影安静地融入背景。

**B 构图：** 略俯视书案，未封完的纸信封套放在右下三分线，残烛在右上，左侧大片暗桌面承接一条柔和雨窗投影。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `project-mystery-a.png`、`project-mystery-b.png`

## 6. project-romance.png · 16:10

**正向提示词：** 横向16:10，目标1600×1000。城市天台黄昏，两名普通成年人隔着明显一段距离的背影，各自看向低处城市，人物很小，不牵手不拥抱，不展示面部。简洁护栏和疏朗的城市轮廓，天空占画面大半，两人分别置于中央偏右和右侧三分线。左侧45%是平静的天空与天台暗部留白。灰蓝、炭灰与地平线一抹低饱和暖杏色，克制而有未说出口的情绪。

**A 构图：** 平视的广阔远景，两人站在同一护栏前却相隔数米，一位偏中另一位在右侧，晚霞仅在远处形成很薄暖色带。

**B 构图：** 从天台后方略高机位远望，两人一个靠栏一个稍后退，两段背影之间留出空地，大片灰蓝天空与远处暖杏霞光。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `project-romance-a.png`、`project-romance-b.png`

## 7. project-scifi.png · 16:10

**正向提示词：** 横向16:10，目标1600×1000。简洁安静的飞船舱内，右侧的大舷窗外是一颗巨大的朦胧行星，舱内一名小小的成年人的背影剪影站在窗边，不展示五官。左侧45%是平滑暗部舱壁与空地，没有仪表文字、密集按钮或光点。蓝灰、炭黑为主，右边角落仅一个微弱暖色指示灯，柔和行星反射光与平滑渐变，孤独的科幻电影剧照。

**A 构图：** 宽幅平视舱内，椭圆舷窗在右侧，行星的弧线在窗外斜向展开，小剪影靠窗的右下方。

**B 构图：** 从舱室后侧斜望圆角长舷窗，行星的一部分悬在窗外冷雾中，小剪影位于右侧三分线，舱内地面接受柔和蓝灰漫射光。

**要避开的内容：** noise, grain, speckles, color blotches, color noise, over-sharpening, halo, oily skin, plastic skin, glossy highlights, overly detailed, beautiful anime girl face, close-up face, text, watermark, logo。去除噪点、去除色斑、严禁过度锐化、不要塑料感皮肤、不要精修美少女脸、不要文字水印。不要正脸特写、不要搔首弄姿、不要密集装饰、不要多色霓虹、不要拼贴或分格。

**输出文件：** `project-scifi-a.png`、`project-scifi-b.png`

