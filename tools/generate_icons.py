# Generate icons using a 16x16 base canvas (with the reading device occupying 16x14 centered vertically)
# Then scale from this base. Filenames: icon-[scale].png

from PIL import Image

base_w, base_h = 16, 16
img = Image.new("RGBA", (base_w, base_h), (0,0,0,0))
px = img.load()

outline = (40,40,40,255)
screen = (235,235,235,255)
accent = (90,180,255,255)
text = (160,160,160,255)

# Reader area 16x14 centered (1px top/bottom padding)
top = 1
bottom = 15
left = 0
right = 16

# Draw rounded frame
for y in range(top, bottom):
    for x in range(left, right):
        # skip extreme corners for rounding
        if (x,y) in [(0,top),(15,top),(0,bottom-1),(15,bottom-1)]:
            continue
        if x in (0,15) or y in (top,bottom-1):
            px[x,y] = outline
        else:
            px[x,y] = screen

# Column separators
for y in range(top+3, bottom-3):
    px[5,y] = accent
    px[10,y] = accent

# Simulated text rows
for y in range(top+3, bottom-3, 3):
    for x in range(2,4):
        px[x,y] = text
    for x in range(6,9):
        px[x,y] = text
    for x in range(11,14):
        px[x,y] = text

paths=[]

# Save base
base_path="/icon/icon-16.png"
img.save(base_path)
paths.append(base_path)

# Scales
scales=[32,48,64,96,128]
for s in scales:
    icon = img.resize((s,s), resample=Image.NEAREST)
    path=f"/icon/icon-{s}.png"
    icon.save(path)
    paths.append(path)