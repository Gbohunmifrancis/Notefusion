-- A Practice sticker in 3D: the flame, the freeze, the stars or a badge (design/practice-art), lit as if inflated
-- from its outline (design/rive/faces.mjs writes its colours and its normal map) on a card that floats and tilts, with
-- a little thickness at its edge.
--
-- Inputs: art names the sticker (an image here, with its "-normal" twin); pop (a trigger) springs it forward with a
-- flash, as a badge is earned or the streak grows.

type Sticker = {
    art: Input<string>,
    pop: Input<Trigger>,
    context: Context?,
    canvas: GPUCanvas?,
    pipe: GPUPipeline?,
    ubo: GPUBuffer?,
    uboData: buffer,
    uboGroup: GPUBindGroup?,
    texGroup: GPUBindGroup?,
    sampler: GPUSampler?,
    verts: GPUBuffer?,
    index: GPUBuffer?,
    loaded: string,
    size: Vector,
    scale: number,
    time: number,
    popLeft: number,
}

local LAYERS = 7 -- copies behind the face that make its edge
local DEPTH = 0.012 -- between copies, in card units (the card spans -1..1)
local POP_SECONDS = 0.9

local STRIDE = 20 -- position xyz, uv

local LAYOUT: { VertexBufferLayout } = {
    {
        stride = STRIDE,
        attributes = {
            { format = 'float32x3', slot = 0, offset = 0 },
            { format = 'float32x2', slot = 1, offset = 12 },
        },
    },
}

local function card(): (buffer, buffer)
    local verts = buffer.create(4 * STRIDE)
    local corners = { { -1, 1, 0, 0 }, { 1, 1, 1, 0 }, { 1, -1, 1, 1 }, { -1, -1, 0, 1 } }
    for i, c in corners do
        local o = (i - 1) * STRIDE
        buffer.writef32(verts, o, c[1]); buffer.writef32(verts, o + 4, c[2]); buffer.writef32(verts, o + 8, 0)
        buffer.writef32(verts, o + 12, c[3]); buffer.writef32(verts, o + 16, c[4])
    end
    local ib = buffer.create(6 * 4)
    for i, v in { 0, 1, 2, 0, 2, 3 } do buffer.writeu32(ib, (i - 1) * 4, v) end
    return verts, ib
end

local function load(self: Sticker)
    local context, pipe, sampler = self.context, self.pipe, self.sampler
    if not context or not pipe or not sampler then return end
    local name = self.art or 'flame-active'
    local color, normal = context:image(name), context:image(name .. '-normal')
    if not color or not normal then return end
    self.texGroup = GPUBindGroup.new({
        layout = pipe:getBindGroupLayout(1),
        textures = { { slot = 0, view = color:view() }, { slot = 1, view = normal:view() } },
        samplers = { { slot = 2, sampler = sampler } },
    })
    self.loaded = name
end

function init(self: Sticker, context: Context): boolean
    self.context = context
    local shader = context:shader('puff')
    if not shader then return false end
    local pipe = GPUPipeline.new({
        vertex = shader,
        fragment = shader,
        vertexLayout = LAYOUT,
        colorTargets = { {
            format = 'rgba8unorm',
            blend = { srcColor = 'one', dstColor = 'one-minus-src-alpha', srcAlpha = 'one', dstAlpha = 'one-minus-src-alpha' },
        } },
        sampleCount = 1,
    })
    local ubo = GPUBuffer.new({ size = 144, usage = 'uniform' })
    self.pipe, self.ubo = pipe, ubo
    self.uboGroup = GPUBindGroup.new({ layout = pipe:getBindGroupLayout(0), ubos = { { slot = 0, buffer = ubo } } })
    self.sampler = GPUSampler.new({ min = 'linear', mag = 'linear', mipmap = 'linear' })
    local v, i = card()
    self.verts = GPUBuffer.new({ size = buffer.len(v), usage = 'vertex', data = v, immutable = true })
    self.index = GPUBuffer.new({ size = buffer.len(i), usage = 'index', data = i, immutable = true })
    load(self)
    return true
end

function update(self: Sticker)
    if (self.art or '') ~= self.loaded then load(self) end
end

function resize(self: Sticker, size: Vector, scale: number)
    self.size, self.scale = size, scale
    local context = self.context
    if not context then return end
    local w = math.max(1, math.floor(size.x * scale))
    local h = math.max(1, math.floor(size.y * scale))
    if self.canvas then self.canvas:resize(w, h) else self.canvas = context:gpuCanvas({ width = w, height = h }) end
end

function advance(self: Sticker, seconds: number): boolean
    self.time += seconds
    if self.popLeft > 0 then self.popLeft = math.max(0, self.popLeft - seconds) end
    return true
end

function draw(self: Sticker, renderer: Renderer)
    local canvas, ubo, pipe = self.canvas, self.ubo, self.pipe
    if not canvas or not ubo or not pipe or canvas.width == 0 then return end
    if not self.texGroup then load(self) end
    local t = self.time
    -- At rest it floats and turns a little; a pop springs it toward the viewer and flashes.
    local yaw = 0.38 * math.sin(t * 0.9)
    local pitch = 0.16 + 0.07 * math.sin(t * 0.75)
    local push, glow = 0, 0
    if self.popLeft > 0 then
        local p = 1 - self.popLeft / POP_SECONDS
        push = math.sin(p * math.pi) * 0.35 * (1 - p * 0.5)
        glow = math.sin(p * math.pi)
        yaw += math.sin(p * math.pi * 2) * 0.5
    end
    local model = Mat4.fromTranslation(0, 0.03 * math.sin(t * 1.4), push) * Mat4.fromRotationX(pitch) * Mat4.fromRotationY(yaw)
    local aspect = canvas.width / canvas.height
    local fov = math.rad(28)
    local dist = 1.08 / math.tan(fov / 2) / math.min(1, aspect)
    local mvp = Mat4.perspective(fov, aspect, 0.1, 20) * Mat4.fromTranslation(0, 0, -dist) * model
    local d = self.uboData
    mvp:writeToBuffer(d, 0)
    model:writeToBuffer(d, 64)
    buffer.writef32(d, 128, LAYERS); buffer.writef32(d, 132, DEPTH); buffer.writef32(d, 136, glow); buffer.writef32(d, 140, 0)
    ubo:write(d)

    local pass = canvas:beginRenderPass({ color = { { loadOp = 'clear', storeOp = 'store', clearColor = { 0, 0, 0, 0 } } } })
    if self.uboGroup and self.texGroup and self.verts and self.index then
        pass:setPipeline(pipe)
        pass:setBindGroup(0, self.uboGroup)
        pass:setBindGroup(1, self.texGroup)
        pass:setVertexBuffer(0, self.verts)
        pass:setIndexBuffer(self.index, 'uint32')
        pass:drawIndexed(6, LAYERS + 1)
    end
    pass:finish()

    renderer:save()
    renderer:transform(Mat2D.withScale(1 / self.scale))
    renderer:drawImage(canvas.image, ImageSampler('clamp', 'clamp', 'bilinear'), 'srcOver', 1)
    renderer:restore()
end

return function(context: Context): Layout<Sticker>
    return {
        art = 'flame-active',
        pop = function(self: Sticker)
            self.popLeft = POP_SECONDS
        end,
        context = nil,
        canvas = nil,
        pipe = nil,
        ubo = nil,
        uboData = buffer.create(144),
        uboGroup = nil,
        texGroup = nil,
        sampler = nil,
        verts = nil,
        index = nil,
        loaded = '',
        size = Vector.xy(0, 0),
        scale = 1,
        time = 0,
        popLeft = 0,
        init = init,
        update = update,
        resize = resize,
        advance = advance,
        draw = draw,
    }
end
