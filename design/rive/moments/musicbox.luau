-- A reward, opened (Duolingo's chest, made a music box): it bobs, shakes three times, its lid flies open on a fan of
-- light, notes burst out in arcs, and what was finished pops up above it.
--
-- Values: label ("Unit done!", "Grade done!").

type Box = { size: Vector, time: number, font: Font?, context: Context?, vm: ViewModel? }

local PERIOD = 4.0
local SHAKES = { 0.45, 0.8, 1.15 }
local OPEN = 1.5
type Note = { x: number, y: number, c: { number }, k: number, delay: number }
-- Where each note lands (from the box's top), its colour, size and delay.
local NOTES: { Note } = {
    { x = -120, y = -150, c = { 125, 179, 255 }, k = 1.15, delay = 0.00 },
    { x = -55, y = -205, c = { 255, 227, 179 }, k = 1.3, delay = 0.05 },
    { x = 15, y = -232, c = { 61, 220, 151 }, k = 1.45, delay = 0.02 },
    { x = 85, y = -196, c = { 253, 186, 116 }, k = 1.25, delay = 0.08 },
    { x = 140, y = -140, c = { 255, 255, 255 }, k = 1.05, delay = 0.11 },
}

function draw(self: Box, r: Renderer)
    if self.vm == nil and self.context ~= nil then self.vm = self.context:viewModel() end
    local t = played(self.time, PERIOD)
    local fade = fadeOut(t, PERIOD)
    local cx, base = self.size.x / 2, 404
    local since = t - OPEN
    r:save(); r:modulateOpacity(fade)
    panel(r, self.size)

    -- The light fanning up from inside once it is open.
    if since > 0 then
        local o = easeOut(since / 0.4)
        r:save(); r:transform(Mat2D.withTranslation(cx, base - 118)); r:modulateOpacity(o)
        r:drawPath(circle(190), glow(190, 255, 236, 200, 110))
        for i = 0, 8 do
            local a = -math.pi / 2 + (i - 4) * 0.27 + math.sin(t * 0.8) * 0.05
            local ray = Path.new()
            ray:moveTo(Vector.xy(0, 0))
            ray:lineTo(Vector.xy(math.cos(a - 0.06) * 260 * o, math.sin(a - 0.06) * 260 * o))
            ray:lineTo(Vector.xy(math.cos(a + 0.06) * 260 * o, math.sin(a + 0.06) * 260 * o))
            ray:close()
            r:drawPath(ray, Paint.with({ style = 'fill', blendMode = 'screen',
                gradient = Gradient.radial(Vector.xy(0, 0), 260, {
                    { position = 0, color = Color.rgba(255, 240, 210, 120) },
                    { position = 1, color = Color.rgba(255, 240, 210, 0) },
                }) }))
        end
        r:restore()
    end

    -- The box: a bob at rest, three shakes that grow, a squash as it opens.
    local rot, sx, sy, lift = 0, 1, 1, math.sin(t * 3) * 3
    for k, at in SHAKES do
        local d = t - at
        if d > 0 and d < 0.3 then
            local env = math.sin(d / 0.3 * math.pi)
            rot += math.sin(d * 55) * 0.05 * env * (0.6 + 0.3 * k)
            lift -= 10 * env * (0.6 + 0.3 * k)
        end
    end
    if since > 0 then
        local sq = math.exp(-6 * since) * math.cos(14 * since)
        sx, sy = 1 + 0.12 * sq, 1 - 0.12 * sq
        lift = 0
    elseif t > OPEN - 0.15 then
        local a = (t - (OPEN - 0.15)) / 0.15
        sx, sy = 1 + 0.08 * a, 1 - 0.1 * a
    end
    -- The shadow.
    r:save(); r:transform(Mat2D.withTranslation(cx, base + 4) * Mat2D.withScale(1 + lift / 200, 1))
    r:drawPath(ellipse(118, 14), fill(0, 0, 0, 90)); r:restore()

    local open = since > 0 and spring(since, 5, 11) or 0
    r:save(); r:transform(Mat2D.withTranslation(cx, base + lift) * tfs(0, 0, sx, sy, rot) * Mat2D.withTranslation(0, -64))
    -- The body, its middle at the origin.
    r:drawPath(rrect(220, 128, 22), vgrad(-64, 64, { { 0, 79, 145, 255 }, { 1, 30, 79, 208 } }))
    r:drawPath(rrect(220, 128, 22), stroke(23, 54, 150, 6))
    -- Inside, seen once the lid is up: dark, lit from within.
    if open > 0 then
        r:save(); r:transform(Mat2D.withTranslation(0, -60)); r:modulateOpacity(clamp(open, 0, 1))
        r:drawPath(rrect(206, 26, 12), fill(12, 26, 70))
        r:drawPath(rrect(206, 26, 12), glow(110, 255, 236, 200, 150))
        r:restore()
    end
    -- The front plate, a quaver on it.
    r:drawPath(rrect(112, 68, 14), fill(227, 238, 255))
    r:save(); r:transform(Mat2D.withTranslation(-6, 14)); r:drawPath(quaver(1.05), fill(47, 123, 255)); r:restore()
    -- The band where the lid sits.
    r:drawPath(rrect(232, 16, 8), fill(23, 54, 150))
    -- The lid: closed it sits on the top; opening, it flips back on its hinge, so it rises and shows less of itself.
    r:save()
    r:transform(Mat2D.withTranslation(0, -92 - 46 * open) * Mat2D.withScale(1 - 0.06 * open, 1 - 0.62 * open) * Mat2D.withRotation(-0.06 * open))
    r:drawPath(rrect(236, 60, 22), vgrad(-30, 30, { { 0, 125, 179, 255 }, { 1, 47, 123, 255 } }))
    r:drawPath(rrect(236, 60, 22), stroke(23, 54, 150, 6))
    local hl = Path.new()
    hl:moveTo(Vector.xy(-92, -14)); hl:lineTo(Vector.xy(60, -14))
    r:drawPath(hl, stroke(255, 255, 255, 6, 110))
    r:restore()
    r:restore()

    -- The notes, out in arcs, turning as they fly.
    for i, n in NOTES do
        local d = since - n.delay
        if d > 0 then
            local q = easeOut(d / 0.65)
            local x = cx + n.x * q
            local y = base - 120 + n.y * 0.68 * q - 60 * math.sin(q * math.pi) * 0.3 + math.sin(t * 2 + i) * 4 * q
            local s = spring(d, 6, 12) * n.k
            r:save(); r:transform(tf(x, y, s, (1 - q) * (i % 2 == 0 and 1.6 or -1.6) + math.sin(t * 3 + i) * 0.08))
            local c = n.c
            r:drawPath(circle(40), glow(40, c[1], c[2], c[3], 140))
            r:drawPath(quaver(1.6), fill(c[1], c[2], c[3]))
            r:restore()
        end
    end

    -- The XP it held.
    if since > 0.35 then
        local s = spring(since - 0.35, 6, 13)
        r:save(); r:transform(Mat2D.withTranslation(cx, 50) * Mat2D.withScale(s, s))
        say(r, self.font, str(self.vm, 'label', "Unit done!"), 40, fill(255, 255, 255), 0, 0)
        r:restore()
    end
    r:restore()
end

function advance(self: Box, seconds: number): boolean self.time += seconds; return self.time < PERIOD + 0.2 end
function resize(self: Box, size: Vector) self.size = size end
function init(self: Box, context: Context): boolean
    self.font = context:font('Geist-ExtraBold'); self.context = context; self.vm = context:viewModel()
    return true
end

return function(context: Context): Layout<Box>
    return { size = Vector.xy(400, 440), time = 0, font = nil, context = nil, vm = nil, init = init, advance = advance, resize = resize, draw = draw }
end
