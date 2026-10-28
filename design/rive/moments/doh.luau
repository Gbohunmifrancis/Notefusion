-- Doh, delighted (Duo after a lesson): a wave at rest, a crouch, a leap with stretch, a squash on landing and a little
-- second hop, notes and confetti thrown up at the top of the leap.

type Doh = { size: Vector, time: number, wave: Image?, cheer: Image?, sampler: ImageSampler }

local PERIOD = 3.6
local CROUCH, JUMP, LAND = 0.55, 0.78, 1.28
local HOP0, HOP1 = 1.85, 2.2
local NOTE_COLOURS = { { 156, 194, 255 }, { 255, 227, 179 }, { 61, 220, 151 }, { 253, 186, 116 } }
local CONFETTI = { { 125, 179, 255 }, { 255, 227, 179 }, { 61, 220, 151 }, { 253, 186, 116 }, { 255, 255, 255 } }

function draw(self: Doh, r: Renderer)
    local t = played(self.time, PERIOD)
    local fade = fadeOut(t, PERIOD)
    local cx, base = self.size.x / 2, 392
    local lift, sx, sy = 0, 1, 1
    if t < CROUCH then
        sy = 1 + 0.015 * math.sin(t * 6); sx = 2 - sy
    elseif t < JUMP then
        local q = easeInOut((t - CROUCH) / (JUMP - CROUCH))
        sx, sy = 1 + 0.1 * q, 1 - 0.14 * q
    elseif t < LAND then
        local q = (t - JUMP) / (LAND - JUMP)
        lift = 96 * math.sin(q * math.pi)
        local st = 0.12 * math.cos(q * math.pi)
        sx, sy = 1 - st * 0.6, 1 + st
    else
        local d = t - LAND
        local sq = 0.14 * math.exp(-7 * d) * math.cos(16 * d)
        sx, sy = 1 + sq, 1 - sq
        if t > HOP0 and t < HOP1 then lift = 34 * math.sin((t - HOP0) / (HOP1 - HOP0) * math.pi) end
    end
    r:save(); r:modulateOpacity(fade)
    panel(r, self.size)

    -- The shadow shrinks and fades as Doh rises.
    r:save(); r:transform(Mat2D.withTranslation(cx, base - 4) * Mat2D.withScale(1 - lift / 260, 1))
    r:modulateOpacity(1 - lift / 200)
    r:drawPath(ellipse(76, 12), fill(0, 0, 0, 110)); r:restore()

    -- Doh: waving at rest, cheering from the leap on; scaled about the feet.
    local img = if t < JUMP then self.wave else self.cheer
    if img ~= nil and img.width > 0 then
        local k = 250 / img.width
        r:save()
        r:transform(Mat2D.withTranslation(cx, base - lift) * Mat2D.withScale(sx * k, sy * k) * Mat2D.withTranslation(-img.width / 2, -img.height * 0.94))
        r:drawImage(img, self.sampler, 'srcOver', 1)
        r:restore()
    end

    -- Notes up from the top of the leap, swaying as they rise.
    for i = 1, 4 do
        local d = t - (JUMP + 0.2 + i * 0.07)
        if d > 0 and d < 1.6 then
            local q = d / 1.6
            local side = (i % 2 == 0) and 1 or -1
            local x = cx + side * (70 + 30 * i * 0.5) * easeOut(q * 1.5) + math.sin(d * 5 + i) * 8
            local y = base - 250 - 90 * q
            local c = NOTE_COLOURS[i]
            r:save(); r:transform(tf(x, y, spring(d, 6, 12) * 0.95, side * 0.2 + math.sin(d * 4 + i) * 0.15))
            r:modulateOpacity(1 - clamp((q - 0.6) / 0.4, 0, 1))
            r:drawPath(quaver(1), fill(c[1], c[2], c[3]))
            r:restore()
        end
    end

    -- Confetti thrown up and falling.
    local d = t - (JUMP + 0.22)
    if d > 0 and d < 1.8 then
        for i = 1, 22 do
            local a = -math.pi / 2 + (rand(i) - 0.5) * 2.8
            local v = 200 + rand(i * 3) * 140
            local x = cx + math.cos(a) * v * d
            local y = base - 230 + math.sin(a) * v * d + 0.5 * 600 * d * d
            local c = CONFETTI[(i % #CONFETTI) + 1]
            r:save(); r:transform(tfs(x, y, 1, math.abs(math.cos(d * 9 + i)) + 0.15, d * (4 + rand(i * 5) * 6)))
            r:modulateOpacity(1 - clamp((d - 1.2) / 0.6, 0, 1))
            if i % 3 == 0 then r:drawPath(sparkle(7), fill(c[1], c[2], c[3]))
            else r:drawPath(rrect(12, 7, 2), fill(c[1], c[2], c[3])) end
            r:restore()
        end
    end
    r:restore()
end

function advance(self: Doh, seconds: number): boolean self.time += seconds; return self.time < PERIOD + 0.2 end
function resize(self: Doh, size: Vector) self.size = size end
function init(self: Doh, context: Context): boolean
    self.wave = context:image('doh-wave')
    self.cheer = context:image('doh-cheer')
    return true
end

return function(context: Context): Layout<Doh>
    return { size = Vector.xy(380, 420), time = 0, wave = nil, cheer = nil, sampler = ImageSampler('clamp', 'clamp', 'bilinear'),
        init = init, advance = advance, resize = resize, draw = draw }
end
