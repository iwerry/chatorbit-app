// Launchpad ideas, grouped like the ComfyUI template browser. Each one opens in the Canvas
// (image or video) or loads a Workflow template. Prompts are written in English because
// that is what most open image and video models understand best.

export type IdeaCat = 'popular' | 'product' | 'character' | 'brand' | 'tools' | 'video' | 'audio'
export type Idea = {
  id: string
  title: string
  cat: IdeaCat
  mode: 'image' | 'video' | 'workflow'
  tags: string[]
  prompt: string
  negative?: string
  aspect?: '1:1' | '4:3' | '3:4' | '16:9' | '9:16'
  template?: string
  hue: [number, number]
  /** Orbi Cloud model (OpenRouter id) this idea opens with, and the name shown on the card. */
  model?: string
  modelName?: string
}

/** Covers shipped with the app: src/assets/ideas/<idea id>.(webp|jpg|png|mp4|webm). */
const COVER_FILES = import.meta.glob('../assets/ideas/*.{webp,jpg,jpeg,png,mp4,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
export const IDEA_COVERS: Record<string, { url: string; kind: 'image' | 'video' }> = Object.fromEntries(
  Object.entries(COVER_FILES).map(([file, url]) => {
    const name = file.split('/').pop() || ''
    return [name.replace(/\.[^.]+$/, ''), { url, kind: /\.(mp4|webm)$/i.test(name) ? 'video' : 'image' }]
  }),
)

export const IDEA_CATS: { id: IdeaCat | 'all'; label: string }[] = [
  { id: 'all', label: 'All ideas' },
  { id: 'popular', label: 'Popular' },
  { id: 'product', label: 'Product & ads' },
  { id: 'character', label: 'Character & fashion' },
  { id: 'brand', label: 'Brand & design' },
  { id: 'tools', label: 'Image tools' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
]

export const IDEAS: Idea[] = [
  // Popular
  { id: 'harbor-portrait', model: 'google/gemini-3-pro-image', modelName: 'Nano Banana Pro', title: 'Natural-light portrait', cat: 'popular', mode: 'image', tags: ['Text to image', 'Photo'], aspect: '3:4', hue: [28, 200],
    prompt: 'Candid portrait of a young woman with long curly brown hair at a seaside harbor, soft overcast daylight, colorful wooden houses and sailboats blurred in the background, natural skin texture, 85mm lens, shallow depth of field, editorial photography' },
  { id: 'armored-dragon', model: 'black-forest-labs/flux.2-max', modelName: 'FLUX.2 Max', title: 'Pearl dragon knight', cat: 'popular', mode: 'image', tags: ['Text to image', 'Fantasy'], aspect: '3:4', hue: [210, 45],
    prompt: 'Close-up of a dragon-like knight in ornate white and gold scale armor, glowing amber eyes, misty cold background, intricate engraved details, cinematic rim light, ultra detailed fantasy concept art' },
  { id: 'paper-plane-city', model: 'google/veo-3.1', modelName: 'Veo 3.1', title: 'Paper plane over the city', cat: 'popular', mode: 'video', tags: ['Text to video'], aspect: '16:9', hue: [30, 190],
    prompt: 'A white paper plane glides between tall city buildings at golden hour, the camera follows it smoothly from behind, warm sunlight flares between the towers, gentle wind, cinematic tracking shot' },
  { id: 'neon-cyborg', model: 'bytedance-seed/seedream-5-0-pro', modelName: 'Seedream 5.0 Pro', title: 'Neon cyborg profile', cat: 'popular', mode: 'image', tags: ['Text to image', 'Sci-fi'], aspect: '3:4', hue: [300, 190],
    prompt: 'Side profile of a female cyborg with cracked porcelain skin panels, glowing cyan and magenta circuitry under the surface, dark studio background, neon light strips reflecting on her cheek, high-end sci-fi photography' },
  { id: 'yoga-cat', model: 'openai/gpt-image-2', modelName: 'GPT Image 2', title: 'Cat doing yoga', cat: 'popular', mode: 'image', tags: ['Text to image', 'Fun'], aspect: '4:3', hue: [350, 40],
    prompt: 'A ginger cat stretching in a perfect yoga pose on a mint green mat, sunny pastel pink room with arched windows, potted plants, soft morning light, playful whimsical interior photography' },
  { id: 'brutalist-moon', model: 'x-ai/grok-imagine-image-2.0', modelName: 'Grok Imagine 2.0', title: 'Brutalist moon pavilion', cat: 'popular', mode: 'image', tags: ['Text to image', 'Architecture'], aspect: '16:9', hue: [220, 260],
    prompt: 'Circular concrete pavilion with a round opening in the roof showing the full moon at night, a dancer standing on a low round platform in a beam of moonlight, minimalist brutalist architecture, long exposure, calm and surreal' },

  // Product & ads
  { id: 'perfume-still', model: 'google/gemini-nano-banana-2.1', modelName: 'Nano Banana 2.1', title: 'Perfume still life', cat: 'product', mode: 'image', tags: ['Product', 'Ads'], aspect: '3:4', hue: [30, 270],
    prompt: 'Amber glass perfume bottle on white sand with dried lavender, wood chips and small white flowers, soft window light from the left, warm neutral palette, luxury product photography, crisp label, shallow depth of field' },
  { id: 'sneaker-splash', model: 'black-forest-labs/flux-3-image', modelName: 'FLUX 3', title: 'Sneaker splash ad', cat: 'product', mode: 'image', tags: ['Product', 'Ads'], aspect: '1:1', hue: [190, 330],
    prompt: 'A white running sneaker frozen mid-air above a splash of bright blue paint, clean light grey studio background, high-speed photography, dramatic shadows, advertising campaign style' },
  { id: 'coffee-bag', model: 'openai/gpt-image-2.5-flare', modelName: 'GPT Image 2.5 Flare', title: 'Coffee packaging', cat: 'product', mode: 'image', tags: ['Product', 'Packaging'], aspect: '1:1', hue: [25, 45],
    prompt: 'Kraft paper coffee bag with a minimalist black label reading "ORBI ROAST", surrounded by roasted coffee beans and a ceramic cup on a dark walnut table, morning side light, commercial product photo' },
  { id: 'watch-launch', model: 'kwaivgi/kling-v3.0-pro', modelName: 'Kling 3.0 Pro', title: 'Smartwatch launch film', cat: 'product', mode: 'video', tags: ['Product', 'Text to video'], aspect: '16:9', hue: [210, 160],
    prompt: 'Slow orbit around a minimalist smartwatch standing on a stone plinth, soft fog drifts through the frame, light sweeps across the glass, premium calm mood, macro product commercial' },
  { id: 'car-interior', model: 'microsoft/mai-image-2.6', modelName: 'MAI-Image 2.6', title: 'Car interior detail', cat: 'product', mode: 'image', tags: ['Product', 'Automotive'], aspect: '16:9', hue: [220, 60],
    prompt: 'Futuristic white car interior with a blue leather steering wheel, a bold yellow logo on the center, sculpted dashboard, soft studio light, automotive design photography, clean and modern' },

  // Character & fashion
  { id: 'trench-london', model: 'krea/krea-2-large', modelName: 'Krea 2 Large', title: 'Trench coat street style', cat: 'character', mode: 'image', tags: ['Fashion', 'Photo'], aspect: '3:4', hue: [35, 0],
    prompt: 'Full-body street style photo of a woman in a beige double-breasted trench coat and turtleneck, standing beside a red telephone box on a rainy city street, wet pavement reflections, overcast light, fashion editorial' },
  { id: 'puffer-studio', model: 'bytedance-seed/seedream-5-0-pro', modelName: 'Seedream 5.0 Pro', title: 'Puffer jacket lookbook', cat: 'character', mode: 'image', tags: ['Fashion', 'Studio'], aspect: '3:4', hue: [0, 210],
    prompt: 'Model in an oversized black puffer jacket, cargo pants and a black balaclava, adjusting the cuff, plain off-white studio background, soft even lighting, streetwear lookbook photography' },
  { id: 'lily-portrait', model: 'google/gemini-3-pro-image', modelName: 'Nano Banana Pro', title: 'Portrait with lilies', cat: 'character', mode: 'image', tags: ['Portrait', 'Beauty'], aspect: '3:4', hue: [340, 210],
    prompt: 'Close beauty portrait of a young woman with dark wavy hair, pink lilies partly covering one side of her face, deep blue background, soft diffused light, glossy lips, fine skin texture, fashion magazine cover' },
  { id: 'rock-artist', model: 'qwen/qwen-image-3-pro', modelName: 'Qwen Image 3 Pro', title: 'Rock artist editorial', cat: 'character', mode: 'image', tags: ['Character', 'Consistent face'], aspect: '3:4', hue: [270, 20],
    prompt: 'Cinematic editorial photo of a confident rock artist with long lavender hair and a black leather jacket, standing on a European shopping street with snowy mountains behind, golden hour light, 50mm lens, sharp eyes, consistent facial features' },
  { id: 'multi-angle', model: 'google/gemini-nano-banana-2.1', modelName: 'Nano Banana 2.1', title: 'Same character, many angles', cat: 'character', mode: 'image', tags: ['Character sheet'], aspect: '16:9', hue: [190, 50],
    prompt: 'Character turnaround sheet of a young courier in a red bomber jacket and yellow sneakers: front view, three-quarter view, side view and back view, same face and outfit in every pose, plain light grey background, clean concept art' },

  // Brand & design
  { id: 'collage-poster', model: 'recraft/recraft-v4.1-pro', modelName: 'Recraft V4.1 Pro', title: 'Zebra collage poster', cat: 'brand', mode: 'image', tags: ['Design', 'Poster'], aspect: '3:4', hue: [80, 0],
    prompt: 'Bold graphic collage poster: a man in a camouflage jacket looking up, surrounded by black and white zebra stripes, organic doodles and halftone textures, acid lime green accents, contemporary street-art design' },
  { id: 'cocktail-cartoon', model: 'openai/gpt-image-2', modelName: 'GPT Image 2', title: 'Retro cartoon cocktail', cat: 'brand', mode: 'image', tags: ['Illustration'], aspect: '3:4', hue: [45, 0],
    prompt: 'A hand holding a martini glass with a lemon slice, tiny retro rubber-hose cartoon characters dancing inside and around the glass, black ink lines with orange and red accents, white background, playful 1930s animation style' },
  { id: 'type-poster', model: 'openai/gpt-image-2.5-sunburst', modelName: 'GPT Image 2.5 Sunburst', title: 'Bold typography poster', cat: 'brand', mode: 'image', tags: ['Typography', 'Poster'], aspect: '3:4', hue: [0, 55],
    prompt: 'Swiss-style typographic poster with the giant words "MAKE IT LOUD" in heavy condensed black letters, one orange square, red diagonal stripes, off-white paper texture, grid layout, modern graphic design' },
  { id: 'jazz-night', model: 'meta/muse-image', modelName: 'Meta Muse Image', title: 'Jazz night in São Paulo', cat: 'brand', mode: 'image', tags: ['Poster', 'Event'], aspect: '3:4', hue: [20, 280],
    prompt: 'Poster for a jazz night in São Paulo: a saxophonist playing under a neon sign at dusk, yellow taxis on a cobblestone street, warm glow from a bar window, elegant headline space at the top, vintage film grain' },
  { id: 'logo-mark', model: 'recraft/recraft-v4.1-pro-vector', modelName: 'Recraft V4.1 Vector', title: 'Minimal logo exploration', cat: 'brand', mode: 'image', tags: ['Logo', 'Branding'], aspect: '1:1', hue: [150, 220],
    prompt: 'Minimal geometric logo mark for a coffee brand: a coffee bean merged with an orbit ring, flat vector, single color dark green on cream background, centered, clean negative space, brand identity board' },
  { id: 'sticker', model: 'recraft/recraft-v4-styles', modelName: 'Recraft V4 Styles', title: 'Die-cut sticker', cat: 'brand', mode: 'image', tags: ['Sticker', 'Illustration'], aspect: '1:1', hue: [120, 300],
    prompt: 'A cute die-cut sticker of a smiling cactus wearing sunglasses, thick white border, bold flat colors, plain light grey background, vector illustration' },

  // Image tools (workflows)
  { id: 'tool-edit', model: 'google/gemini-3-pro-image', modelName: 'Nano Banana Pro', title: 'Change an image with words', cat: 'tools', mode: 'workflow', template: 'edit', tags: ['Image editing'], hue: [230, 30],
    prompt: 'Make it a snowy winter evening, keep the subject the same' },
  { id: 'tool-inpaint', model: 'google/gemini-3-pro-image', modelName: 'Nano Banana Pro', title: 'Repaint one area', cat: 'tools', mode: 'workflow', template: 'inpaint', tags: ['Inpainting'], hue: [330, 200],
    prompt: 'a vase of red flowers' },
  { id: 'tool-upscale', model: 'google/gemini-3-pro-image', modelName: 'Nano Banana Pro · 4K', title: 'Generate and upscale 4×', cat: 'tools', mode: 'workflow', template: 'upscale', tags: ['Upscaling'], hue: [190, 120],
    prompt: 'Detailed portrait of an astronaut, studio light' },
  { id: 'tool-idea', model: 'google/gemini-3-pro-image', modelName: 'Claude + Nano Banana Pro', title: 'Idea → AI prompt → image', cat: 'tools', mode: 'workflow', template: 'idea-image', tags: ['Prompt AI'], hue: [270, 150],
    prompt: 'Poster for a jazz night in São Paulo' },

  // Video
  { id: 'alpine-climber', model: 'bytedance/seedance-2.5', modelName: 'Seedance 2.5', title: 'Mountain climber', cat: 'video', mode: 'video', tags: ['Text to video'], aspect: '16:9', hue: [210, 30],
    prompt: 'A bearded climber in a snowy jacket pulls himself over an icy ridge, wind blowing snow across his face, the camera slowly pushes in, overcast cold light, intense cinematic mood' },
  { id: 'subway-guitar', model: 'google/veo-3.1-fast', modelName: 'Veo 3.1 Fast', title: 'Subway guitarist', cat: 'video', mode: 'video', tags: ['Text to video', 'Music'], aspect: '16:9', hue: [20, 200],
    prompt: 'A young musician plays an acoustic guitar on an empty subway platform at night, fluorescent lights flicker softly, a train passes behind him, handheld camera slowly circles around him' },
  { id: 'squirrel-gold', model: 'alibaba/wan-3.0-prime', modelName: 'Wan 3.0 Prime', title: 'Squirrel in the decorations', cat: 'video', mode: 'video', tags: ['Text to video', 'Nature'], aspect: '16:9', hue: [45, 120],
    prompt: 'A grey squirrel sniffs around a wooden table under a tree decorated with golden ornaments and white blossoms, shallow depth of field, gentle camera slide, warm afternoon light' },
  { id: 'image-to-motion', model: 'google/veo-3.1', modelName: 'Veo 3.1', title: 'Bring a photo to life', cat: 'video', mode: 'workflow', template: 'image-video', tags: ['Image to video'], hue: [160, 260],
    prompt: 'Slow camera push-in, gentle wind, cinematic motion' },
  { id: 'dancer-flowers', model: 'minimax/hailuo-3-max', modelName: 'Hailuo 3 Max', title: 'Dancer in white flowers', cat: 'video', mode: 'video', tags: ['Text to video'], aspect: '16:9', hue: [200, 340],
    prompt: 'A dancer in a flowing white dress moves slowly through a field of white flowers, petals drift in the air, soft backlight, dreamy slow motion, the camera floats beside her' },

  { id: 'neon-chase', model: 'x-ai/grok-imagine-video-1.5', modelName: 'Grok Imagine Video 1.5', title: 'Neon rain chase', cat: 'video', mode: 'video', tags: ['Text to video', 'Action'], aspect: '16:9', hue: [290, 200],
    prompt: 'A motorcyclist speeds through a narrow neon-lit alley in heavy rain at night, reflections on the wet asphalt, sparks of light, the camera tracks low beside the wheel, fast cinematic action' },
  { id: 'coast-drone', model: 'black-forest-labs/flux-3-video', modelName: 'FLUX 3 Video', title: 'Coastline drone flight', cat: 'video', mode: 'video', tags: ['Text to video', 'Landscape'], aspect: '16:9', hue: [190, 40],
    prompt: 'Smooth aerial drone flight along a rugged green coastline at sunrise, turquoise waves crashing on dark cliffs, a small white lighthouse, mist over the sea, ultra detailed 4K landscape film' },
  { id: 'clay-robot', model: 'runway/gen-4.5', modelName: 'Runway Gen-4.5', title: 'Clay robot waking up', cat: 'video', mode: 'video', tags: ['Text to video', 'Animation'], aspect: '16:9', hue: [30, 160],
    prompt: 'A small handmade clay robot wakes up on a cluttered workbench, stretches its arms and looks around curiously, stop-motion claymation style, warm desk lamp light, visible fingerprints in the clay' },

  // Audio
  { id: 'campaign', model: 'google/veo-3.1', modelName: 'Nano Banana Pro + Veo 3.1 + voz', title: 'Campaign: image, video and voiceover', cat: 'audio', mode: 'workflow', template: 'campaign', tags: ['Voiceover', 'Workflow'], hue: [100, 30],
    prompt: 'Launch of a minimalist smartwatch: calm, premium, soft light' },
]

export const DEFAULT_NEGATIVE = {
  image: 'blurry, low quality, lowres, jpeg artifacts, watermark, signature, deformed, bad anatomy, extra fingers, distorted face, oversaturated',
  video: 'blurry, low quality, flickering, jitter, distorted, warped faces, morphing, static frame, watermark, subtitles, worst quality',
}
