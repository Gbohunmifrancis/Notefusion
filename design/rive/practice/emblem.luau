-- The 3D level emblem: the level's emblem (design/practice-art, rasterised by design/rive/faces.mjs) on the face of a
-- bevelled hexagonal coin that sways at rest and spins when a level is reached.
--
-- Inputs: level (1..8) picks the face and the metal; levelUp (a trigger) spins the coin twice with a flash.
-- The 2D emblem's geometry, in its 140x140 viewBox: a pointy-top hexagon centred at (70, 72), radius 56 with
-- 14-unit rounded corners from level 4 (52 and 12 below it). The coin is that hexagon grown by RIM units.

type Emblem = {
    level: Input<number>,
    levelUp: Input<Trigger>,
    context: Context?,
    canvas: GPUCanvas?,
    msaa: GPUTexture?,
    depth: GPUTexture?,
    msaaView: GPUTextureView?,
    depthView: GPUTextureView?,
    coinPipe: GPUPipeline?,
    facePipe: GPUPipeline?,
    ubo: GPUBuffer?,
    uboData: buffer,
    coinGroup: GPUBindGroup?,
    faceGroup: GPUBindGroup?,
    faceTexGroup: GPUBindGroup?,
    sampler: GPUSampler?,
    coinVerts: GPUBuffer?,
    coinIndex: GPUBuffer?,
    coinCount: number,
    faceVerts: GPUBuffer?,
    faceIndex: GPUBuffer?,
    built: number,
    size: Vector,
    scale: number,
    time: number,
    spin: number,
}

local SAMPLES = 10 -- points per rounded corner
local RIM = 6 -- the coin's rim beyond the art's hexagon, in viewBox units
local BEVEL = 5
local HALF = 9 -- half the coin's thickness
local SPIN_SECONDS = 1.4

-- The metals, as the 2D art's frame gradient: silver-blue, and Choir-ready's violet. Linear 0..1.
local function metal(level: number): (vector, vector)
    if level >= 8 then
        return vector.create(0.62, 0.45, 1.0), vector.create(0.30, 0.15, 0.66)
    end
    return vector.create(0.66, 0.80, 1.0), vector.create(0.17, 0.39, 0.92)
end

-- The art's outline: a pointy-top hexagon with rounded corners, in model units (viewBox / 70, y up, centred).
local function outline(radius: number, corner: number): { vector }
    local pts = {}
    for k = 0, 5 do
        local a = math.rad(-90 + 60 * k)
        -- The corner's arc centre sits inside the vertex by corner / sin(60).
        local inset = corner / math.sin(math.rad(60))
        local cx = (radius - inset) * math.cos(a)
        local cy = (radius - inset) * math.sin(a)
        for s = 0, SAMPLES - 1 do
            local t = a - math.rad(30) + math.rad(60) * s / (SAMPLES - 1)
            local x = cx + corner * math.cos(t)
            local y = cy + corner * math.sin(t)
            table.insert(pts, vector.create(x / 70, -y / 70, 0))
        end
    end
    return pts
end

local STRIDE = 32 -- position xyz, normal xyz, uv

local function put(b: buffer, i: number, p: vector, n: vector, u: number, v: number)
    local o = i * STRIDE
    buffer.writef32(b, o, p.x); buffer.writef32(b, o + 4, p.y); buffer.writef32(b, o + 8, p.z)
    buffer.writef32(b, o + 12, n.x); buffer.writef32(b, o + 16, n.y); buffer.writef32(b, o + 20, n.z)
    buffer.writef32(b, o + 24, u); buffer.writef32(b, o + 28, v)
end

-- The coin: front cap, front bevel, side, back bevel, back cap. Each band has its own vertices so its edges stay crisp.
local function coin(level: number): (buffer, buffer, number)
    local big = level >= 4
    local radius = (big and 56 or 52) + RIM
    local corner = (big and 14 or 12) + RIM / 2
    local outer = outline(radius, corner)
    local inner = outline(radius - BEVEL, corner - BEVEL * 0.6)
    local n = #outer
    local h, b = HALF / 70, BEVEL / 70
    local verts = buffer.create((2 * (n + 1) + 6 * n) * STRIDE)
    local idx = {}
    local vi = 0
    local function cap(z: number, nz: number)
        local centre = vi
        put(verts, vi, vector.create(0, 0, z), vector.create(0, 0, nz), 0, 0); vi += 1
        for k = 1, n do put(verts, vi, inner[k] + vector.create(0, 0, z), vector.create(0, 0, nz), 0, 0); vi += 1 end
        for k = 0, n - 1 do
            local a, c = centre + 1 + k, centre + 1 + (k + 1) % n
            if nz > 0 then table.insert(idx, centre); table.insert(idx, a); table.insert(idx, c)
            else table.insert(idx, centre); table.insert(idx, c); table.insert(idx, a) end
        end
    end
    local function band(ra: { vector }, za: number, rb: { vector }, zb: number, nz: number)
        local start = vi
        for k = 1, n do
            -- The outward normal at this point of the outline: perpendicular to the neighbours' chord.
            local prev, nxt = outer[(k - 2) % n + 1], outer[k % n + 1]
            local d = nxt - prev
            local side = vector.normalize(vector.create(d.y, -d.x, 0))
            local nrm = vector.normalize(side + vector.create(0, 0, nz))
            put(verts, vi, ra[k] + vector.create(0, 0, za), nrm, 0, 0)
            put(verts, vi + 1, rb[k] + vector.create(0, 0, zb), nrm, 0, 0)
            vi += 2
        end
        for k = 0, n - 1 do
            local a0, b0 = start + 2 * k, start + 2 * k + 1
            local a1, b1 = start + 2 * ((k + 1) % n), start + 2 * ((k + 1) % n) + 1
            table.insert(idx, a0); table.insert(idx, b0); table.insert(idx, a1)
            table.insert(idx, a1); table.insert(idx, b0); table.insert(idx, b1)
        end
    end
    cap(h, 1)
    band(inner, h, outer, h - b, 0.9)
    band(outer, h - b, outer, -h + b, 0)
    band(outer, -h + b, inner, -h, -0.9)
    cap(-h, -1)
    local ib = buffer.create(#idx * 4)
    for i, v in idx do buffer.writeu32(ib, (i - 1) * 4, v) end
    return verts, ib, #idx
end

-- The face: the whole 140x140 art as one quad just in front of the coin's front cap.
local function face(): (buffer, buffer)
    local z = HALF / 70 + 0.004
    local top, bottom = 72 / 70, -68 / 70
    local verts = buffer.create(4 * STRIDE)
    local nrm = vector.create(0, 0, 1)
    put(verts, 0, vector.create(-1, top, z), nrm, 0, 0)
    put(verts, 1, vector.create(1, top, z), nrm, 1, 0)
    put(verts, 2, vector.create(1, bottom, z), nrm, 1, 1)
    put(verts, 3, vector.create(-1, bottom, z), nrm, 0, 1)
    local ib = buffer.create(6 * 4)
    for i, v in { 0, 1, 2, 0, 2, 3 } do buffer.writeu32(ib, (i - 1) * 4, v) end
    return verts, ib
end

local function levelOf(self: Emblem): number
    return math.clamp(math.floor(self.level or 1), 1, 8)
end

local LAYOUT: { VertexBufferLayout } = {
    {
        stride = STRIDE,
        attributes = {
            { format = 'float32x3', slot = 0, offset = 0 },
            { format = 'float32x3', slot = 1, offset = 12 },
            { format = 'float32x2', slot = 2, offset = 24 },
        },
    },
}

-- The level's geometry and face, rebuilt when the level input changes.
local function build(self: Emblem)
    local context = self.context
    if not context then return end
    local level = levelOf(self)
    local cv, ci, count = coin(level)
    self.coinVerts = GPUBuffer.new({ size = buffer.len(cv), usage = 'vertex', data = cv, immutable = true })
    self.coinIndex = GPUBuffer.new({ size = buffer.len(ci), usage = 'index', data = ci, immutable = true })
    self.coinCount = count
    local image = context:image('emblem-' .. level)
    local facePipe = self.facePipe
    if image and facePipe and self.sampler then
        self.faceTexGroup = GPUBindGroup.new({
            layout = facePipe:getBindGroupLayout(1),
            textures = { { slot = 0, view = image:view() } },
            samplers = { { slot = 1, sampler = self.sampler } },
        })
    end
    self.built = level
end

local function targets(self: Emblem)
    local context = self.context
    if not context then return end
    local w = math.max(1, math.floor(self.size.x * self.scale))
    local h = math.max(1, math.floor(self.size.y * self.scale))
    if self.canvas then self.canvas:resize(w, h) else self.canvas = context:gpuCanvas({ width = w, height = h }) end
    local msaa = GPUTexture.new({ width = w, height = h, format = 'rgba8unorm', renderTarget = true, sampleCount = 4 })
    local depth = GPUTexture.new({ width = w, height = h, format = 'depth32float', renderTarget = true, sampleCount = 4 })
    self.msaa, self.depth = msaa, depth
    self.msaaView = msaa:view()
    self.depthView = depth:view()
end

function init(self: Emblem, context: Context): boolean
    self.context = context
    local shader = context:shader('coin')
    if not shader then return false end
    local depthOn: DepthStencilState = { format = 'depth32float', compare = 'less-equal', write = true }
    local depthRead: DepthStencilState = { format = 'depth32float', compare = 'less-equal', write = false }
    local coinPipe = GPUPipeline.new({
        vertex = { module = shader, entryPoint = 'vs_coin' },
        fragment = { module = shader, entryPoint = 'fs_coin' },
        vertexLayout = LAYOUT,
        colorTargets = { { format = 'rgba8unorm' } },
        depthStencil = depthOn,
        sampleCount = 4,
    })
    local facePipe = GPUPipeline.new({
        vertex = { module = shader, entryPoint = 'vs_face' },
        fragment = { module = shader, entryPoint = 'fs_face' },
        vertexLayout = LAYOUT,
        colorTargets = { {
            format = 'rgba8unorm',
            blend = { srcColor = 'one', dstColor = 'one-minus-src-alpha', srcAlpha = 'one', dstAlpha = 'one-minus-src-alpha' },
        } },
        depthStencil = depthRead,
        sampleCount = 4,
    })
    local ubo = GPUBuffer.new({ size = 176, usage = 'uniform' })
    self.coinPipe, self.facePipe, self.ubo = coinPipe, facePipe, ubo
    self.coinGroup = GPUBindGroup.new({ layout = coinPipe:getBindGroupLayout(0), ubos = { { slot = 0, buffer = ubo } } })
    self.faceGroup = GPUBindGroup.new({ layout = facePipe:getBindGroupLayout(0), ubos = { { slot = 0, buffer = ubo } } })
    self.sampler = GPUSampler.new({ min = 'linear', mag = 'linear', mipmap = 'linear' })
    local fv, fi = face()
    self.faceVerts = GPUBuffer.new({ size = buffer.len(fv), usage = 'vertex', data = fv, immutable = true })
    self.faceIndex = GPUBuffer.new({ size = buffer.len(fi), usage = 'index', data = fi, immutable = true })
    build(self)
    return true
end

function update(self: Emblem)
    if levelOf(self) ~= self.built then build(self) end
end

function resize(self: Emblem, size: Vector, scale: number)
    self.size = size
    self.scale = scale
    targets(self)
end

function advance(self: Emblem, seconds: number): boolean
    self.time += seconds
    if self.spin > 0 then self.spin = math.max(0, self.spin - seconds) end
    return true
end

local function easeOut(t: number): number
    return 1 - (1 - t) ^ 3
end

function draw(self: Emblem, renderer: Renderer)
    local canvas, ubo = self.canvas, self.ubo
    if not canvas or not ubo or canvas.width == 0 or not self.msaaView or not self.depthView then return end
    if not self.faceTexGroup then build(self) end

    -- At rest it sways; a level-up spins it twice and flashes, settling back into the sway.
    local t = self.time
    local yaw = 0.42 * math.sin(t * 1.1)
    local pitch = -0.1 + 0.06 * math.sin(t * 0.7)
    local lift, glow = 0, 0
    if self.spin > 0 then
        local p = 1 - self.spin / SPIN_SECONDS
        yaw += (1 - easeOut(p)) * math.pi * 4
        lift = math.sin(p * math.pi) * 0.12
        glow = math.sin(p * math.pi)
    end
    local model = Mat4.fromTranslation(0, lift + 0.02 * math.sin(t * 1.6), 0) * Mat4.fromRotationX(pitch) * Mat4.fromRotationY(yaw)
    local aspect = canvas.width / canvas.height
    local fov = math.rad(28)
    local dist = 1.1 / math.tan(fov / 2) / math.min(1, aspect)
    local proj = Mat4.perspective(fov, aspect, 0.1, 20)
    local view = Mat4.fromTranslation(0, 0, -dist)
    local mvp = proj * view * model

    local level = levelOf(self)
    local rim, back = metal(level)
    local d = self.uboData
    mvp:writeToBuffer(d, 0)
    model:writeToBuffer(d, 64)
    buffer.writef32(d, 128, rim.x); buffer.writef32(d, 132, rim.y); buffer.writef32(d, 136, rim.z); buffer.writef32(d, 140, 1)
    buffer.writef32(d, 144, back.x); buffer.writef32(d, 148, back.y); buffer.writef32(d, 152, back.z); buffer.writef32(d, 156, 1)
    buffer.writef32(d, 160, glow); buffer.writef32(d, 164, t); buffer.writef32(d, 168, 0); buffer.writef32(d, 172, 0)
    ubo:write(d)

    local pass = canvas:beginRenderPass({
        color = { { view = self.msaaView, resolveTarget = canvas:colorView(), loadOp = 'clear', storeOp = 'discard', clearColor = { 0, 0, 0, 0 } } },
        depthStencil = { view = self.depthView, depthLoadOp = 'clear', depthStoreOp = 'discard', depthClearValue = 1 },
    })
    if self.coinPipe and self.coinGroup and self.coinVerts and self.coinIndex then
        pass:setPipeline(self.coinPipe)
        pass:setBindGroup(0, self.coinGroup)
        pass:setVertexBuffer(0, self.coinVerts)
        pass:setIndexBuffer(self.coinIndex, 'uint32')
        pass:drawIndexed(self.coinCount)
    end
    -- The face only when it looks toward the viewer: its back is the coin's back cap.
    if math.cos(yaw) > 0 and self.facePipe and self.faceGroup and self.faceTexGroup and self.faceVerts and self.faceIndex then
        pass:setPipeline(self.facePipe)
        pass:setBindGroup(0, self.faceGroup)
        pass:setBindGroup(1, self.faceTexGroup)
        pass:setVertexBuffer(0, self.faceVerts)
        pass:setIndexBuffer(self.faceIndex, 'uint32')
        pass:drawIndexed(6)
    end
    pass:finish()

    renderer:save()
    renderer:transform(Mat2D.withScale(1 / self.scale))
    renderer:drawImage(canvas.image, ImageSampler('clamp', 'clamp', 'bilinear'), 'srcOver', 1)
    renderer:restore()
end

return function(context: Context): Layout<Emblem>
    return {
        level = 1,
        levelUp = function(self: Emblem)
            self.spin = SPIN_SECONDS
        end,
        context = nil,
        canvas = nil,
        msaa = nil,
        depth = nil,
        msaaView = nil,
        depthView = nil,
        coinPipe = nil,
        facePipe = nil,
        ubo = nil,
        uboData = buffer.create(176),
        coinGroup = nil,
        faceGroup = nil,
        faceTexGroup = nil,
        sampler = nil,
        coinVerts = nil,
        coinIndex = nil,
        coinCount = 0,
        faceVerts = nil,
        faceIndex = nil,
        built = 0,
        size = Vector.xy(0, 0),
        scale = 1,
        time = 0,
        spin = 0,
        init = init,
        update = update,
        resize = resize,
        advance = advance,
        draw = draw,
    }
end
