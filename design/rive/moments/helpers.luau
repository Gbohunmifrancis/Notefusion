-- Shared by every reward moment (design/rive/moments.py prepends it to each piece): transforms, shapes, springs,
-- seeded randomness, the panel a moment is drawn on and the values the page hands it.
local TAU = math.pi * 2

local function tf(x: number, y: number, s: number, r: number): Mat2D
    local c, n = math.cos(r) * s, math.sin(r) * s
    return Mat2D.values(c, n, -n, c, x, y)
end

local function tfs(x: number, y: number, sx: number, sy: number, r: number): Mat2D
    local c, n = math.cos(r), math.sin(r)
    return Mat2D.values(c * sx, n * sx, -n * sy, c * sy, x, y)
end

local function ellipse(rx: number, ry: number): Path
    local p = Path.new()
    local kx, ky = 0.5523 * rx, 0.5523 * ry
    p:moveTo(Vector.xy(rx, 0))
    p:cubicTo(Vector.xy(rx, ky), Vector.xy(kx, ry), Vector.xy(0, ry))
    p:cubicTo(Vector.xy(-kx, ry), Vector.xy(-rx, ky), Vector.xy(-rx, 0))
    p:cubicTo(Vector.xy(-rx, -ky), Vector.xy(-kx, -ry), Vector.xy(0, -ry))
    p:cubicTo(Vector.xy(kx, -ry), Vector.xy(rx, -ky), Vector.xy(rx, 0))
    p:close()
    return p
end

local function circle(r: number): Path
    return ellipse(r, r)
end

-- A rounded rectangle centred on the origin.
local function rrect(w: number, h: number, rad: number): Path
    local p = Path.new()
    local x0, y0, x1, y1 = -w / 2, -h / 2, w / 2, h / 2
    local k = rad * 0.4477
    p:moveTo(Vector.xy(x0 + rad, y0))
    p:lineTo(Vector.xy(x1 - rad, y0))
    p:cubicTo(Vector.xy(x1 - k, y0), Vector.xy(x1, y0 + k), Vector.xy(x1, y0 + rad))
    p:lineTo(Vector.xy(x1, y1 - rad))
    p:cubicTo(Vector.xy(x1, y1 - k), Vector.xy(x1 - k, y1), Vector.xy(x1 - rad, y1))
    p:lineTo(Vector.xy(x0 + rad, y1))
    p:cubicTo(Vector.xy(x0 + k, y1), Vector.xy(x0, y1 - k), Vector.xy(x0, y1 - rad))
    p:lineTo(Vector.xy(x0, y0 + rad))
    p:cubicTo(Vector.xy(x0, y0 + k), Vector.xy(x0 + k, y0), Vector.xy(x0 + rad, y0))
    p:close()
    return p
end

-- A four-point twinkle.
local function sparkle(r: number): Path
    local p = Path.new()
    local k = 0.15
    p:moveTo(Vector.xy(0, -r))
    p:cubicTo(Vector.xy(0, -r * k), Vector.xy(r * k, 0), Vector.xy(r, 0))
    p:cubicTo(Vector.xy(r * k, 0), Vector.xy(0, r * k), Vector.xy(0, r))
    p:cubicTo(Vector.xy(0, r * k), Vector.xy(-r * k, 0), Vector.xy(-r, 0))
    p:cubicTo(Vector.xy(-r * k, 0), Vector.xy(0, -r * k), Vector.xy(0, -r))
    p:close()
    return p
end

-- An open arc of radius r from angle a0 to a1 (radians, clockwise from the right).
local function arc(r: number, a0: number, a1: number): Path
    local p = Path.new()
    local n = math.max(2, math.ceil(math.abs(a1 - a0) / TAU * 96))
    for i = 0, n do
        local a = a0 + (a1 - a0) * i / n
        local pt = Vector.xy(math.cos(a) * r, math.sin(a) * r)
        if i == 0 then p:moveTo(pt) else p:lineTo(pt) end
    end
    return p
end

-- A quaver: head, stem and flag, its head centred on the origin, k its scale.
local function quaver(k: number): Path
    local p = Path.new()
    local rx, ry = 9 * k, 6.5 * k
    -- The head, tilted.
    local c, s = math.cos(-0.35), math.sin(-0.35)
    local n = 20
    for i = 0, n do
        local a = i / n * TAU
        local x, y = math.cos(a) * rx, math.sin(a) * ry
        local pt = Vector.xy(x * c - y * s, x * s + y * c)
        if i == 0 then p:moveTo(pt) else p:lineTo(pt) end
    end
    p:close()
    -- The stem, rising from the head's right.
    local sx = 7.2 * k
    p:moveTo(Vector.xy(sx - 2.6 * k, -2 * k))
    p:lineTo(Vector.xy(sx - 2.6 * k, -34 * k))
    p:lineTo(Vector.xy(sx, -34 * k))
    p:lineTo(Vector.xy(sx, -2 * k))
    p:close()
    -- The flag.
    p:moveTo(Vector.xy(sx - 2.6 * k, -34 * k))
    p:cubicTo(Vector.xy(sx + 2 * k, -26 * k), Vector.xy(sx + 14 * k, -22 * k), Vector.xy(sx + 10 * k, -10 * k))
    p:cubicTo(Vector.xy(sx + 12 * k, -20 * k), Vector.xy(sx + 4 * k, -24 * k), Vector.xy(sx, -26 * k))
    p:close()
    return p
end

local function clamp(x: number, a: number, b: number): number
    return math.max(a, math.min(b, x))
end

local function easeOut(t: number): number
    local u = 1 - clamp(t, 0, 1)
    return 1 - u * u * u
end

local function easeInOut(t: number): number
    t = clamp(t, 0, 1)
    return t * t * (3 - 2 * t)
end

-- 0 before t = 0, then a spring up to 1 that overshoots and settles.
local function spring(t: number, damp: number?, freq: number?): number
    if t <= 0 then return 0 end
    return 1 - math.exp(-(damp or 7) * t) * math.cos((freq or 15) * t)
end

-- 1 at rest, a jolt that rings out from t = 0: for a bump on something already there.
local function bump(t: number, size: number): number
    if t <= 0 then return 1 end
    return 1 + size * math.exp(-8 * t) * math.cos(18 * t)
end

local function rand(seed: number): number
    local x = math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return x - math.floor(x)
end

-- A soft round glow of radius r: a radial gradient that fades to nothing at its edge.
local function glow(r: number, red: number, green: number, blue: number, alpha: number): Paint
    return Paint.with({
        style = 'fill',
        blendMode = 'screen',
        gradient = Gradient.radial(Vector.xy(0, 0), r, {
            { position = 0, color = Color.rgba(red, green, blue, alpha) },
            { position = 1, color = Color.rgba(red, green, blue, 0) },
        }),
    })
end

local function fill(red: number, green: number, blue: number, alpha: number?): Paint
    return Paint.with({ style = 'fill', color = Color.rgba(red, green, blue, alpha or 255) })
end

local function stroke(red: number, green: number, blue: number, thickness: number, alpha: number?): Paint
    return Paint.with({ style = 'stroke', color = Color.rgba(red, green, blue, alpha or 255), thickness = thickness, cap = 'round', join = 'round' })
end

local function vgrad(y0: number, y1: number, stops: { { number } }): Paint
    local list = {}
    for _, s in stops do
        table.insert(list, { position = s[1], color = Color.rgba(s[2], s[3], s[4], s[5] or 255) })
    end
    return Paint.with({ style = 'fill', gradient = Gradient.linear(Vector.xy(0, y0), Vector.xy(0, y1), list) })
end

-- Text centred on (x, y), drawn now.
local function say(r: Renderer, font: Font?, str: string, size: number, paint: Paint, x: number, y: number, scale: number?)
    if font == nil then return end
    local text = Text.new()
    text:append(str, { font = font, size = size, paint = paint })
    local lo, hi = text:bounds()
    r:save()
    r:transform(Mat2D.withTranslation(x, y) * Mat2D.withScale(scale or 1, scale or 1) * Mat2D.withTranslation(-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2))
    text:draw(r)
    r:restore()
end

-- The moment's own card: the app's Night surface with a hairline, so its white type reads on either theme.
local function panel(r: Renderer, size: Vector)
    local box = rrect(size.x - 2, size.y - 2, 28)
    r:save(); r:transform(Mat2D.withTranslation(size.x / 2, size.y / 2))
    r:drawPath(box, fill(14, 19, 32, 246))
    r:drawPath(box, stroke(232, 237, 247, 1.5, 22))
    r:restore()
end

-- A moment plays once: its clock stops at the end of its PERIOD, where it has faded out.
local function played(time: number, period: number): number
    return math.min(time, period)
end

-- The fade out over a moment's last 0.35 s.
local function fadeOut(t: number, period: number): number
    return t > period - 0.35 and math.max(0, (period - t) / 0.35) or 1
end

-- A number the page set on the moment's view model (design/rive/moments.py declares them), else the default.
local function num(vm: ViewModel?, name: string, default: number): number
    if vm == nil then return default end
    local p = vm:getNumber(name)
    if p == nil then return default end
    return p.value
end

local function str(vm: ViewModel?, name: string, default: string): string
    if vm == nil then return default end
    local p = vm:getString(name)
    if p == nil or p.value == "" then return default end
    return p.value
end
