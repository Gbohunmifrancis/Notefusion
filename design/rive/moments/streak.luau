-- The streak, extended (Duolingo's streak moment): the grey flame catches, bursts and settles burning, embers rise,
-- and the day count rolls on to the new one.
--
-- Values: days (the streak now, 1 and up).

type Streak = { size: Vector, time: number, font: Font?, context: Context?, vm: ViewModel? }

local PERIOD = 3.6
local IGNITE = 0.8
local ROLL = 1.0

-- The 2D flame (flame-active.svg, 64x64), base at the origin; points above the waist sway with `wob`.
local function flamePath(cmds: { { number } }, wob: number, lean: number): Path
    local p = Path.new()
    local function v(x: number, y: number): Vector
        local up = math.max(0, 36 - y) / 32
        return Vector.xy(x - 32 + wob * up * 4 + lean * up * up * 6, y - 60)
    end
    for _, c in cmds do
        if c[1] == 0 then p:moveTo(v(c[2], c[3]))
        else p:cubicTo(v(c[2], c[3]), v(c[4], c[5]), v(c[6], c[7])) end
    end
    p:close()
    return p
end

local OUTER = {
    { 0, 32, 4 }, { 1, 37, 15, 50, 22, 50, 40 }, { 1, 50, 53, 42, 60, 32, 60 }, { 1, 22, 60, 14, 53, 14, 41 },
    { 1, 14, 32, 18, 27, 23, 22 }, { 1, 23, 29, 25, 32, 29, 33 }, { 1, 28, 22, 30, 12, 32, 4 },
}
local INNER = {
    { 0, 32, 30 }, { 1, 36, 37, 41, 40, 41, 47 }, { 1, 41, 54, 37, 58, 32, 58 }, { 1, 27, 58, 23, 54, 23, 47 },
    { 1, 23, 42, 26, 39, 29, 36 }, { 1, 30, 39, 31, 40, 32, 40 }, { 1, 31, 37, 31, 34, 32, 30 },
}

function draw(self: Streak, r: Renderer)
    if self.vm == nil and self.context ~= nil then self.vm = self.context:viewModel() end
    local t = played(self.time, PERIOD)
    local fade = fadeOut(t, PERIOD)
    local lit = easeOut((t - IGNITE) / 0.3)
    local cx, base = self.size.x / 2, 212
    local days = math.max(1, math.floor(num(self.vm, 'days', 7) + 0.5))
    r:save()
    r:modulateOpacity(fade)
    panel(r, self.size)

    -- The glow, a flash as it catches and a warm breath after.
    local flash = t > IGNITE and math.exp(-4 * (t - IGNITE)) or 0
    r:save(); r:transform(Mat2D.withTranslation(cx, base - 70))
    r:modulateOpacity(lit * (0.45 + 0.55 * flash + 0.06 * math.sin(t * 6)))
    r:drawPath(circle(150), glow(150, 251, 146, 60, 170)); r:restore()

    -- The ring thrown off as it catches.
    local since = t - IGNITE
    if since > 0 and since < 0.5 then
        local q = since / 0.5
        r:save(); r:transform(Mat2D.withTranslation(cx, base - 70)); r:modulateOpacity(1 - q)
        r:drawPath(circle(60 + 110 * easeOut(q)), Paint.with({ style = 'stroke', thickness = 6 * (1 - q) + 0.5, color = Color.rgb(255, 214, 160), blendMode = 'additive' }))
        r:restore()
    end

    -- The flame: grey while the day is unsung, alight once sung; a spring as it catches, a flicker while it burns.
    local wob = math.sin(t * 7.3) * 0.6 + math.sin(t * 11.1) * 0.4
    local lean = math.sin(t * 2.1) * 0.5
    local s = (0.82 + 0.18 * spring(since, 6, 13)) * 2.7 * (1 + 0.03 * math.sin(t * 9) * lit)
    if since <= 0 then s = 0.82 * 2.7 end
    r:save(); r:transform(Mat2D.withTranslation(cx, base) * Mat2D.withScale(s * (1 - 0.02 * math.sin(t * 9) * lit), s))
    local outer, inner = flamePath(OUTER, wob * lit, lean * lit), flamePath(INNER, wob * lit * 0.7, lean * lit)
    if lit < 1 then
        r:save(); r:modulateOpacity(1 - lit)
        r:drawPath(outer, vgrad(-56, 0, { { 0, 176, 184, 200 }, { 1, 120, 130, 150 } }))
        r:drawPath(inner, vgrad(-30, 0, { { 0, 214, 220, 230 }, { 1, 160, 168, 184 } }))
        r:restore()
    end
    if lit > 0 then
        r:save(); r:modulateOpacity(lit)
        r:drawPath(outer, vgrad(-56, 0, { { 0, 255, 200, 97 }, { 0.6, 251, 146, 60 }, { 1, 255, 77, 94 } }))
        r:drawPath(inner, vgrad(-30, 0, { { 0, 255, 244, 209 }, { 1, 253, 186, 116 } }))
        r:restore()
    end
    local shine = Path.new()
    shine:moveTo(Vector.xy(-10, -20)); shine:cubicTo(Vector.xy(-10, -25), Vector.xy(-8, -28), Vector.xy(-6, -30))
    r:drawPath(shine, stroke(255, 255, 255, 2.5, 140))
    r:restore()

    -- Embers, rising and swaying, while it burns.
    if since > 0 then
        for i = 1, 16 do
            local life = 1.3 + rand(i) * 0.8
            local age = since - rand(i * 7) * life
            if age > 0 then
                age = age % life
                local q = age / life
                local x = cx + (rand(i * 3) - 0.5) * 90 + math.sin(age * 4 + i) * 12
                local y = base - 30 - q * (150 + rand(i * 5) * 60)
                local sz = (1 - q) * (2.5 + rand(i * 11) * 3.5)
                r:save(); r:transform(Mat2D.withTranslation(x, y)); r:modulateOpacity((1 - q) * lit)
                r:drawPath(circle(sz), fill(255, 190 + math.floor(rand(i) * 50), 110)); r:restore()
            end
        end
    end

    -- The count: 6 rolls up and away, 7 springs up into its place.
    -- The count rolls inside its own window, like an odometer.
    local win = Path.new()
    win:moveTo(Vector.xy(0, 218)); win:lineTo(Vector.xy(self.size.x, 218)); win:lineTo(Vector.xy(self.size.x, 306)); win:lineTo(Vector.xy(0, 306)); win:close()
    r:save(); r:clipPath(win)
    local roll = clamp((t - ROLL) / 0.28, 0, 1)
    local ink = fill(255, 255, 255)
    local warm = fill(253, 186, 116)
    if roll < 1 and days > 1 then
        r:save(); r:modulateOpacity(1 - roll)
        say(r, self.font, tostring(days - 1), 92, ink, cx, 262 - 80 * easeOut(roll)); r:restore()
    end
    if t > ROLL then
        local up = spring(t - ROLL, 7, 14)
        r:save(); r:modulateOpacity(clamp((t - ROLL) / 0.12, 0, 1))
        say(r, self.font, tostring(days), 92, ink, cx, 262 + 80 * (1 - up), 1 + 0.12 * math.exp(-5 * (t - ROLL)))
        r:restore()
    end
    r:restore()
    say(r, self.font, days == 1 and "day streak begun" or "day streak", 26, warm, cx, 324)
    r:restore()
end

function advance(self: Streak, seconds: number): boolean self.time += seconds; return self.time < PERIOD + 0.2 end
function resize(self: Streak, size: Vector) self.size = size end
function init(self: Streak, context: Context): boolean
    self.font = context:font('Geist-ExtraBold'); self.context = context; self.vm = context:viewModel()
    return true
end

return function(context: Context): Layout<Streak>
    return { size = Vector.xy(360, 360), time = 0, font = nil, context = nil, vm = nil, init = init, advance = advance, resize = resize, draw = draw }
end
