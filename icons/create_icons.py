from PIL import Image, ImageDraw, ImageFont
import os

def create_gradient(size, color1, color2):
    """创建渐变背景"""
    image = Image.new('RGB', (size, size), color1)
    draw = ImageDraw.Draw(image)
    
    for y in range(size):
        for x in range(size):
            ratio = (x + y) / (2 * size)
            r = int(color1[0] * (1 - ratio) + color2[0] * ratio)
            g = int(color1[1] * (1 - ratio) + color2[1] * ratio)
            b = int(color1[2] * (1 - ratio) + color2[2] * ratio)
            draw.point((x, y), fill=(r, g, b))
    
    return image

def create_rounded_rect(draw, xy, radius, fill):
    """绘制圆角矩形"""
    x1, y1, x2, y2 = xy
    
    # 主体矩形
    draw.rectangle([x1 + radius, y1, x2 - radius, y2], fill=fill)
    draw.rectangle([x1, y1 + radius, x2, y2 - radius], fill=fill)
    
    # 四个角
    draw.ellipse([x1, y1, x1 + radius * 2, y1 + radius * 2], fill=fill)
    draw.ellipse([x2 - radius * 2, y1, x2, y1 + radius * 2], fill=fill)
    draw.ellipse([x1, y2 - radius * 2, x1 + radius * 2, y2], fill=fill)
    draw.ellipse([x2 - radius * 2, y2 - radius * 2, x2, y2], fill=fill)

def create_icon(size):
    """创建图标"""
    # 创建渐变背景
    img = create_gradient(size, (102, 126, 234), (118, 75, 162))
    draw = ImageDraw.Draw(img)
    
    # 添加圆角遮罩
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    radius = int(size * 0.15)
    create_rounded_rect(mask_draw, (0, 0, size, size), radius, 255)
    
    # 应用遮罩
    output = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    output.paste(img, (0, 0))
    output.putalpha(mask)
    
    # 绘制文字
    draw = ImageDraw.Draw(output)
    
    # 尝试使用不同字体
    font_size = int(size * 0.55)
    try:
        # Windows 系统字体
        font = ImageFont.truetype("segoeuiemoji.ttf", font_size)
    except:
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
    
    # 绘制符号
    symbol = "✨"
    bbox = draw.textbbox((0, 0), symbol, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = (size - text_width) // 2
    y = (size - text_height) // 2 - int(size * 0.05)
    
    draw.text((x, y), symbol, font=font, fill="white")
    
    return output

# 生成不同尺寸的图标
for size in [16, 48, 128]:
    icon = create_icon(size)
    icon.save(f"icon{size}.png", "PNG")
    print(f"Created icon{size}.png")

print("All icons created successfully!")
