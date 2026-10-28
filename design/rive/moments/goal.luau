-- The week's goal, a day nearer (Duolingo's daily goal, Apple's rings): today's day pours into the ring as a chip
-- drops in, the count steps on, and when it closes the ring flashes and a mint tick draws itself in the middle.
--
-- Values: done (days practised this week, today included), target (the week's goal).

type Goal = { size: Vector, time: number, font: Font?, context: Context?, vm: ViewModel? }

local PERIOD = 3.6
local FILL0, FILL1 = 0.5, 1.4
local DONE = 1.45

function draw(self: Goal, r: Renderer)
    if self.vm == nil and self.context ~= nil then self.vm = self.context:viewModel() end
    local t = played(self.time, PERIOD)
    local target = math.max(1, math.floor(num(self.vm, 'target', 5) + 0.5))
    local done = clamp(math.floor(num(self.vm, 'done', target) + 0.5), 1, target)
    local met = done >= target
    local cx, cy, R = self.size.x / 2, self.size.y / 2 - 6, 104
    local q = easeInOut((t - FILL0) / (FILL1 - FILL0))
    local p = ((done - 1) + q) / target
    local since = met and t - DONE or -1
    r:save(); r:modulateOpacity(fadeOut(t, PERIOD))
    panel(r, self.size)
    r:save(); r:transform(Mat2D.withTranslation(cx, cy) * Mat2D.withScale(bump(since, 0.07), bump(since, 0.07)))

    -- The ring: a quiet track, the week's days in blue, a flash as it closes.
    if since > 0 then
        r:save(); r:modulateOpacity(0.6 * math.exp(-2.5 * since) + 0.25)
        r:drawPath(circle(R + 40), glow(R + 40, 47, 123, 255, 120)); r:restore()
    end
    r:drawPath(circle(R), stroke(255, 255, 255, 24, 22))
    -- The day ticks round the track, one a day.
    for d = 1, target - 1 do
        local a = -math.pi / 2 + TAU * d / target
        r:save(); r:transform(Mat2D.withTranslation(math.cos(a) * R, math.sin(a) * R))
        r:drawPath(circle(2.5), fill(255, 255, 255, 60)); r:restore()
    end
    local band = Paint.with({ style = 'stroke', thickness = 24, cap = 'round',
        gradient = Gradient.linear(Vector.xy(-R, -R), Vector.xy(R, R), {
            { position = 0, color = Color.rgb(125, 179, 255) },
            { position = 1, color = Color.rgb(47, 123, 255) },
        }) })
    if p > 0.001 then r:drawPath(arc(R, -math.pi / 2, -math.pi / 2 + TAU * p), band) end
    -- The tip catches the light while it moves.
    if t > FILL0 and t < FILL1 + 0.1 then
        local a = -math.pi / 2 + TAU * p
        r:save(); r:transform(Mat2D.withTranslation(math.cos(a) * R, math.sin(a) * R))
        r:drawPath(circle(30), glow(30, 200, 225, 255, 200)); r:restore()
    end
    if since > 0 and since < 0.3 then
        r:save(); r:modulateOpacity(0.55 * (1 - since / 0.3))
        r:drawPath(circle(R), Paint.with({ style = 'stroke', thickness = 24, color = Color.rgb(255, 255, 255), blendMode = 'additive' }))
        r:restore()
    end

    -- The middle: the days so far, stepping on as the ring fills; the mint tick once it closes.
    local shown = if t >= (FILL0 + FILL1) / 2 then done else done - 1
    local out = met and clamp(since / 0.15, 0, 1) or 0
    if out < 1 then
        r:save(); r:modulateOpacity(1 - out)
        local pop = bump(t - (FILL0 + FILL1) / 2, 0.18)
        say(r, self.font, tostring(shown), 64, fill(255, 255, 255), 0, -10, (1 - 0.4 * out) * pop)
        say(r, self.font, "of " .. target .. (target == 1 and " day" or " days"), 20, fill(156, 194, 255), 0, 36, 1 - 0.4 * out)
        r:restore()
    end
    if met and since > 0.05 then
        local s = spring(since - 0.05, 6, 14)
        r:save(); r:transform(Mat2D.withScale(s, s))
        r:drawPath(circle(56), vgrad(-56, 56, { { 0, 110, 236, 180 }, { 1, 61, 220, 151 } }))
        local tick = Path.new()
        local drawn = clamp((since - 0.08) / 0.22, 0, 1)
        local pts = { Vector.xy(-24, 2), Vector.xy(-7, 19), Vector.xy(26, -16) }
        tick:moveTo(pts[1])
        if drawn <= 0.4 then
            tick:lineTo(pts[1] + (pts[2] - pts[1]) * (drawn / 0.4))
        else
            tick:lineTo(pts[2]); tick:lineTo(pts[2] + (pts[3] - pts[2]) * ((drawn - 0.4) / 0.6))
        end
        if drawn > 0 then r:drawPath(tick, stroke(255, 255, 255, 11)) end
        r:restore()
    end

    -- Sparkles thrown out round the ring as it closes.
    if since > 0 and since < 0.9 then
        local k = since / 0.9
        for i = 0, 11 do
            local a = i / 12 * TAU + 0.2
            local d = R + 18 + 50 * easeOut(k)
            r:save(); r:transform(tf(math.cos(a) * d, math.sin(a) * d, 1, k * 3)); r:modulateOpacity(1 - k)
            r:drawPath(sparkle(12 * (1 - k * k) + 2), fill(255, 255, 255)); r:restore()
        end
    end
    r:restore()

    -- Today's day as it arrives: a chip that pops in over the ring and is drawn down into it as it fills.
    if t > 0.15 and t < FILL1 then
        local s = spring(t - 0.15) * (1 - easeInOut((q - 0.55) / 0.45))
        r:save(); r:transform(Mat2D.withTranslation(cx, cy - R - 4 + 40 * q) * Mat2D.withScale(s, s))
        r:drawPath(rrect(100, 40, 20), fill(47, 123, 255))
        r:drawPath(rrect(100, 40, 20), stroke(14, 19, 32, 4))
        say(r, self.font, "+1 day", 20, fill(255, 255, 255), 0, 0)
        r:restore()
    end
    -- What it means, under the ring.
    if met then
        r:save(); r:modulateOpacity(clamp((since - 0.2) / 0.3, 0, 1))
        say(r, self.font, "Week goal met!", 24, fill(140, 245, 200), cx, self.size.y - 34)
        r:restore()
    else
        say(r, self.font, "This week", 20, fill(156, 194, 255), cx, self.size.y - 34)
    end
    r:restore()
end

function advance(self: Goal, seconds: number): boolean self.time += seconds; return self.time < PERIOD + 0.2 end
function resize(self: Goal, size: Vector) self.size = size end
function init(self: Goal, context: Context): boolean
    self.font = context:font('Geist-ExtraBold'); self.context = context; self.vm = context:viewModel()
    return true
end

return function(context: Context): Layout<Goal>
    return { size = Vector.xy(360, 380), time = 0, font = nil, context = nil, vm = nil, init = init, advance = advance, resize = resize, draw = draw }
end
