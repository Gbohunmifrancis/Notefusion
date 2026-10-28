-- The take's stars land one after another, each with a spring, a ring and sparkles; the slots of the stars not earned
-- stay empty. Simply Piano's and Angry Birds' stars, in the 2D art's colours (stars-3.svg).
--
-- Values: stars (1-3).

type Stars = { size: Vector, time: number, context: Context?, vm: ViewModel? }

local PERIOD = 3.0
local LAND = { 0.3, 0.7, 1.1 } -- when each star lands
local POS = { { -128, 22, 0.78 }, { 0, -6, 1.0 }, { 128, 22, 0.78 } } -- x, y, scale

local STAR = {
    { 0.0, -24.0 }, { 6.5, -8.9 }, { 22.8, -7.4 }, { 10.5, 3.4 }, { 14.1, 19.4 },
    { 0.0, 11.0 }, { -14.1, 19.4 }, { -10.5, 3.4 }, { -22.8, -7.4 }, { -6.5, -8.9 },
}

local function star(k: number): Path
    local p = Path.new()
    for i, v in STAR do
        local pt = Vector.xy(v[1] * k, v[2] * k)
        if i == 1 then p:moveTo(pt) else p:lineTo(pt) end
    end
    p:close()
    return p
end

function draw(self: Stars, r: Renderer)
    if self.vm == nil and self.context ~= nil then self.vm = self.context:viewModel() end
    local t = played(self.time, PERIOD)
    local earned = clamp(math.floor(num(self.vm, 'stars', 3) + 0.5), 1, 3)
    r:save(); r:modulateOpacity(fadeOut(t, PERIOD))
    panel(r, self.size)
    r:save(); r:transform(Mat2D.withTranslation(self.size.x / 2, self.size.y / 2 + 6))
    for i = 1, 3 do
        local x, y, k = POS[i][1], POS[i][2], POS[i][3] * 2.3
        local slot = star(k)
        r:save(); r:transform(Mat2D.withTranslation(x, y))
        r:drawPath(slot, fill(255, 255, 255, 18)); r:drawPath(slot, stroke(255, 255, 255, 6, 40)); r:restore()
        local since = t - LAND[i]
        if i <= earned and since > 0 then
            -- A warm glow under the star, brightest as it lands.
            r:save(); r:transform(Mat2D.withTranslation(x, y) * Mat2D.withScale(POS[i][3], POS[i][3]))
            r:modulateOpacity(0.5 + 0.5 * math.exp(-3 * since)); r:drawPath(circle(70), glow(70, 251, 146, 60, 150)); r:restore()
            -- The ring and sparkles thrown off as it lands.
            if since < 0.6 then
                local q = since / 0.6
                r:save(); r:transform(Mat2D.withTranslation(x, y)); r:modulateOpacity(1 - q)
                r:drawPath(circle((30 + 70 * easeOut(q)) * POS[i][3]), Paint.with({ style = 'stroke', thickness = 7 * (1 - q) + 0.5, color = Color.rgb(255, 214, 170), blendMode = 'additive' }))
                r:restore()
                for sp = 0, 5 do
                    local th = sp / 6 * TAU + i
                    local d = (40 + 70 * q) * POS[i][3]
                    r:save(); r:transform(tf(x + math.cos(th) * d, y + math.sin(th) * d, 1, q * 2)); r:modulateOpacity(1 - q)
                    r:drawPath(sparkle(15 * (1 - q * q) * POS[i][3] + 1), fill(255, 241, 224)); r:restore()
                end
            end
            local body = star(k)
            r:save(); r:transform(tf(x, y, spring(since), -0.5 * math.exp(-6 * since) * math.cos(10 * since)))
            r:drawPath(body, Paint.with({ style = 'fill', gradient = Gradient.linear(Vector.xy(0, -60), Vector.xy(0, 50), {
                { position = 0, color = Color.rgb(255, 197, 138) }, { position = 1, color = Color.rgb(249, 115, 22) } }) }))
            r:drawPath(body, stroke(194, 65, 12, 8))
            -- The shine, as the 2D art draws it.
            local sh = Path.new()
            sh:moveTo(Vector.xy(-9 * k, -4 * k)); sh:lineTo(Vector.xy(-3 * k, -5 * k)); sh:lineTo(Vector.xy(0, -13 * k))
            r:drawPath(sh, stroke(255, 255, 255, 6, 180))
            r:restore()
        end
    end
    r:restore()
    r:restore()
end

function advance(self: Stars, seconds: number): boolean self.time += seconds; return self.time < PERIOD + 0.2 end
function resize(self: Stars, size: Vector) self.size = size end
function init(self: Stars, context: Context): boolean self.context = context; self.vm = context:viewModel(); return true end

return function(context: Context): Layout<Stars>
    return { size = Vector.xy(440, 240), time = 0, context = nil, vm = nil, init = init, advance = advance, resize = resize, draw = draw }
end
