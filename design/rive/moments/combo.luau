-- In tune, again and again (Yousician's streak multiplier): the run's marks land mint one after another, each with a
-- pop and a ripple; the ×N badge bumps with every one and turns hot orange at ×5; a clean take ends on "Perfect run!".
--
-- Values: run (in-tune notes in a row, 1 and up), perfect (1 when the run is the whole take).

type Combo = { size: Vector, time: number, font: Font?, context: Context?, vm: ViewModel? }

local PERIOD = 3.8
local FIRST, SPAN = 0.3, 2.0 -- the marks land from FIRST, over at most SPAN seconds
local MAX_DOTS = 10

function draw(self: Combo, r: Renderer)
    if self.vm == nil and self.context ~= nil then self.vm = self.context:viewModel() end
    local t = played(self.time, PERIOD)
    local run = math.max(1, math.floor(num(self.vm, 'run', 8) + 0.5))
    local perfect = num(self.vm, 'perfect', 1) >= 0.5
    local dots = math.min(run, MAX_DOTS)
    local step = math.min(0.28, SPAN / dots)
    local gap = math.min(38, 290 / dots)
    local rad = math.min(13, gap * 0.36)
    local x0 = 30 + (290 - gap * (dots - 1)) / 2 - 10
    local y = 140
    r:save(); r:modulateOpacity(fadeOut(t, PERIOD))
    panel(r, self.size)
    local lit = 0
    for i = 1, dots do
        local x = x0 + (i - 1) * gap
        local d = t - (FIRST + (i - 1) * step)
        if d > 0 then lit = i end
        r:save(); r:transform(Mat2D.withTranslation(x, y))
        r:drawPath(circle(rad), stroke(255, 255, 255, 3, 50))
        if d > 0 then
            if d < 0.5 then
                local q = d / 0.5
                r:save(); r:modulateOpacity(1 - q)
                r:drawPath(circle(rad + 22 * easeOut(q)), Paint.with({ style = 'stroke', thickness = 4 * (1 - q) + 0.5, color = Color.rgb(140, 245, 200), blendMode = 'additive' }))
                r:restore()
            end
            local s = spring(d, 7, 16)
            r:save(); r:transform(Mat2D.withScale(s, s))
            r:drawPath(circle(rad * 1.6), glow(rad * 1.6, 61, 220, 151, 120))
            r:drawPath(circle(rad), vgrad(-rad, rad, { { 0, 130, 240, 190 }, { 1, 61, 220, 151 } }))
            local hi = Path.new(); hi:moveTo(Vector.xy(-rad * 0.46, -rad * 0.38)); hi:cubicTo(Vector.xy(-rad * 0.38, -rad * 0.6), Vector.xy(-rad * 0.15, -rad * 0.7), Vector.xy(rad * 0.08, -rad * 0.7))
            r:drawPath(hi, stroke(255, 255, 255, 2.5, 170))
            r:restore()
        end
        r:restore()
    end

    -- The badge: ×n, a bump on every mark, blue up to ×4 and hot orange from ×5, with a ring of heat as it turns.
    if lit > 0 then
        local n = if lit == dots then run else math.floor(run * lit / dots + 0.5)
        local d = t - (FIRST + (lit - 1) * step)
        local hot = n >= 5
        local s = spring(t - FIRST, 6, 14) * bump(d, 0.22)
        local bx, by = 384, y
        r:save(); r:transform(Mat2D.withTranslation(bx, by) * Mat2D.withScale(s, s))
        if hot then
            r:drawPath(circle(58), glow(58, 251, 146, 60, 150))
            r:drawPath(circle(38), vgrad(-38, 38, { { 0, 255, 200, 97 }, { 0.6, 251, 146, 60 }, { 1, 249, 115, 22 } }))
        else
            r:drawPath(circle(38), vgrad(-38, 38, { { 0, 125, 179, 255 }, { 1, 47, 123, 255 } }))
        end
        r:drawPath(circle(38), stroke(255, 255, 255, 3, 60))
        say(r, self.font, "×" .. n, n >= 10 and 25 or 30, fill(255, 255, 255), 0, -2)
        r:restore()
        say(r, self.font, "in tune", 15, fill(156, 194, 255), bx, by + 56)
    end

    -- The headline once every mark has landed: a clean take, or a good run in one.
    local landed = t - (FIRST + (dots - 1) * step) - 0.15
    if landed > 0 then
        local s = spring(landed, 6, 13)
        r:save(); r:transform(Mat2D.withTranslation(186, 62) * Mat2D.withScale(s, s) * Mat2D.withRotation(-0.04))
        say(r, self.font, perfect and "Perfect run!" or "On a roll!", 34, fill(140, 245, 200), 0, 0)
        r:restore()
        if landed < 0.9 then
            local q = landed / 0.9
            for i = 0, 9 do
                local a = i / 10 * TAU
                r:save(); r:transform(tf(186 + math.cos(a) * (110 + 50 * q), 62 + math.sin(a) * (26 + 22 * q), 1, q * 3)); r:modulateOpacity(1 - q)
                r:drawPath(sparkle(10 * (1 - q * q) + 2), fill(255, 255, 255)); r:restore()
            end
        end
    end
    r:restore()
end

function advance(self: Combo, seconds: number): boolean self.time += seconds; return self.time < PERIOD + 0.2 end
function resize(self: Combo, size: Vector) self.size = size end
function init(self: Combo, context: Context): boolean
    self.font = context:font('Geist-ExtraBold'); self.context = context; self.vm = context:viewModel()
    return true
end

return function(context: Context): Layout<Combo>
    return { size = Vector.xy(460, 230), time = 0, font = nil, context = nil, vm = nil, init = init, advance = advance, resize = resize, draw = draw }
end
