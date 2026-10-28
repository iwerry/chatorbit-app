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
}

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
  { id: 'harbor-portrait', title: 'Natural-light portrait', cat: 'popular', mode: 'image', tags: ['Text to image', 'Photo'], aspect: '3:4', hue: [28, 200],
    prompt: 'Candid portrait of a young woman with long curly brown hair at a seaside harbor, soft overcast daylight, colorful wooden houses and sailboats blurred in the background, natural skin texture, 85mm lens, shallow depth of field, editorial photography' },
  { id: 'armored-dragon', title: 'Pearl dragon knight', cat: 'popular', mode: 'image', tags: ['Text to image', 'Fantasy'], aspect: '3:4', hue: [210, 45],
    prompt: 'Close-up of a dragon-like knight in ornate white and gold scale armor, glowing amber eyes, misty cold background, intricate engraved details, cinematic rim light, ultra detailed fantasy concept art' },
  { id: 'paper-plane-city', title: 'Paper plane over the city', cat: 'popular', mode: 'video', tags: ['Text to video'], aspect: '16:9', hue: [30, 190],
    prompt: 'A white paper plane glides between tall city buildings at golden hour, the camera follows it smoothly from behind, warm sunlight flares between the towers, gentle wind, cinematic tracking shot' },
  { id: 'neon-cyborg', title: 'Neon cyborg profile', cat: 'popular', mode: 'image', tags: ['Text to image', 'Sci-fi'], aspect: '3:4', hue: [300, 190],
    prompt: 'Side profile of a female cyborg with cracked porcelain skin panels, glowing cyan and magenta circuitry under the surface, dark studio background, neon light strips reflecting on her cheek, high-end sci-fi photography' },
  { id: 'yoga-cat', title: 'Cat doing yoga', cat: 'popular', mode: 'image', tags: ['Text to image', 'Fun'], aspect: '4:3', hue: [350, 40],
    prompt: 'A ginger cat stretching in a perfect yoga pose on a mint green mat, sunny pastel pink room with arched windows, potted plants, soft morning light, playful whimsical interior photography' },
  { id: 'brutalist-moon', title: 'Brutalist moon pavilion', cat: 'popular', mode: 'image', tags: ['Text to image', 'Architecture'], aspect: '16:9', hue: [220, 260],
    prompt: 'Circular concrete pavilion with a round opening in the roof showing the full moon at night, a dancer standing on a low round platform in a beam of moonlight, minimalist brutalist architecture, long exposure, calm and surreal' },

  // Product & ads
  { id: 'perfume-still', title: 'Perfume still life', cat: 'product', mode: 'image', tags: ['Product', 'Ads'], aspect: '3:4', hue: [30, 270],
    prompt: 'Amber glass perfume bottle on white sand with dried lavender, wood chips and small white flowers, soft window light from the left, warm neutral palette, luxury product photography, crisp label, shallow depth of field' },
  { id: 'sneaker-splash', title: 'Sneaker splash ad', cat: 'product', mode: 'image', tags: ['Product', 'Ads'], aspect: '1:1', hue: [190, 330],
    prompt: 'A white running sneaker frozen mid-air above a splash of bright blue paint, clean light grey studio background, high-speed photography, dramatic shadows, advertising campaign style' },
  { id: 'coffee-bag', title: 'Coffee packaging', cat: 'product', mode: 'image', tags: ['Product', 'Packaging'], aspect: '1:1', hue: [25, 45],
    prompt: 'Kraft paper coffee bag with a minimalist black label reading "ORBI ROAST", surrounded by roasted coffee beans and a ceramic cup on a dark walnut table, morning side light, commercial product photo' },
  { id: 'watch-launch', title: 'Smartwatch launch film', cat: 'product', mode: 'video', tags: ['Product', 'Text to video'], aspect: '16:9', hue: [210, 160],
    prompt: 'Slow orbit around a minimalist smartwatch standing on a stone plinth, soft fog drifts through the frame, light sweeps across the glass, premium calm mood, macro product commercial' },
  { id: 'car-interior', title: 'Car interior detail', cat: 'product', mode: 'image', tags: ['Product', 'Automotive'], aspect: '16:9', hue: [220, 60],
    prompt: 'Futuristic white car interior with a blue leather steering wheel, a bold yellow logo on the center, sculpted dashboard, soft studio light, automotive design photography, clean and modern' },

  // Character & fashion
  { id: 'trench-london', title: 'Trench coat street style', cat: 'character', mode: 'image', tags: ['Fashion', 'Photo'], aspect: '3:4', hue: [35, 0],
    prompt: 'Full-body street style photo of a woman in a beige double-breasted trench coat and turtleneck, standing beside a red telephone box on a rainy city street, wet pavement reflections, overcast light, fashion editorial' },
  { id: 'puffer-studio', title: 'Puffer jacket lookbook', cat: 'character', mode: 'image', tags: ['Fashion', 'Studio'], aspect: '3:4', hue: [0, 210],
    prompt: 'Model in an oversized black puffer jacket, cargo pants and a black balaclava, adjusting the cuff, plain off-white studio background, soft even lighting, streetwear lookbook photography' },
  { id: 'lily-portrait', title: 'Portrait with lilies', cat: 'character', mode: 'image', tags: ['Portrait', 'Beauty'], aspect: '3:4', hue: [340, 210],
    prompt: 'Close beauty portrait of a young woman with dark wavy hair, pink lilies partly covering one side of her face, deep blue background, soft diffused light, glossy lips, fine skin texture, fashion magazine cover' },
  { id: 'rock-artist', title: 'Rock artist editorial', cat: 'character', mode: 'image', tags: ['Character', 'Consistent face'], aspect: '3:4', hue: [270, 20],
    prompt: 'Cinematic editorial photo of a confident rock artist with long lavender hair and a black leather jacket, standing on a European shopping street with snowy mountains behind, golden hour light, 50mm lens, sharp eyes, consistent facial features' },
  { id: 'multi-angle', title: 'Same character, many angles', cat: 'character', mode: 'image', tags: ['Character sheet'], aspect: '16:9', hue: [190, 50],
    prompt: 'Character turnaround sheet of a young courier in a red bomber jacket and yellow sneakers: front view, three-quarter view, side view and back view, same face and outfit in every pose, plain light grey background, clean concept art' },

  // Brand & design
  { id: 'collage-poster', title: 'Zebra collage poster', cat: 'brand', mode: 'image', tags: ['Design', 'Poster'], aspect: '3:4', hue: [80, 0],
    prompt: 'Bold graphic collage poster: a man in a camouflage jacket looking up, surrounded by black and white zebra stripes, organic doodles and halftone textures, acid lime green accents, contemporary street-art design' },
  { id: 'cocktail-cartoon', title: 'Retro cartoon cocktail', cat: 'brand', mode: 'image', tags: ['Illustration'], aspect: '3:4', hue: [45, 0],
    prompt: 'A hand holding a martini glass with a lemon slice, tiny retro rubber-hose cartoon characters dancing inside and around the glass, black ink lines with orange and red accents, white background, playful 1930s animation style' },
  { id: 'type-poster', title: 'Bold typography poster', cat: 'brand', mode: 'image', tags: ['Typography', 'Poster'], aspect: '3:4', hue: [0, 55],
    prompt: 'Swiss-style typographic poster with the giant words "MAKE IT LOUD" in heavy condensed black letters, one orange square, red diagonal stripes, off-white paper texture, grid layout, modern graphic design' },
  { id: 'jazz-night', title: 'Jazz night in São Paulo', cat: 'brand', mode: 'image', tags: ['Poster', 'Event'], aspect: '3:4', hue: [20, 280],
    prompt: 'Poster for a jazz night in São Paulo: a saxophonist playing under a neon sign at dusk, yellow taxis on a cobblestone street, warm glow from a bar window, elegant headline space at the top, vintage film grain' },
  { id: 'logo-mark', title: 'Minimal logo exploration', cat: 'brand', mode: 'image', tags: ['Logo', 'Branding'], aspect: '1:1', hue: [150, 220],
    prompt: 'Minimal geometric logo mark for a coffee brand: a coffee bean merged with an orbit ring, flat vector, single color dark green on cream background, centered, clean negative space, brand identity board' },
  { id: 'sticker', title: 'Die-cut sticker', cat: 'brand', mode: 'image', tags: ['Sticker', 'Illustration'], aspect: '1:1', hue: [120, 300],
    prompt: 'A cute die-cut sticker of a smiling cactus wearing sunglasses, thick white border, bold flat colors, plain light grey background, vector illustration' },

  // Image tools (workflows)
  { id: 'tool-edit', title: 'Change an image with words', cat: 'tools', mode: 'workflow', template: 'edit', tags: ['Image editing'], hue: [230, 30],
    prompt: 'Make it a snowy winter evening, keep the subject the same' },
  { id: 'tool-inpaint', title: 'Repaint one area', cat: 'tools', mode: 'workflow', template: 'inpaint', tags: ['Inpainting'], hue: [330, 200],
    prompt: 'a vase of red flowers' },
  { id: 'tool-upscale', title: 'Generate and upscale 4×', cat: 'tools', mode: 'workflow', template: 'upscale', tags: ['Upscaling'], hue: [190, 120],
    prompt: 'Detailed portrait of an astronaut, studio light' },
  { id: 'tool-idea', title: 'Idea → AI prompt → image', cat: 'tools', mode: 'workflow', template: 'idea-image', tags: ['Prompt AI'], hue: [270, 150],
    prompt: 'Poster for a jazz night in São Paulo' },

  // Video
  { id: 'alpine-climber', title: 'Mountain climber', cat: 'video', mode: 'video', tags: ['Text to video'], aspect: '16:9', hue: [210, 30],
    prompt: 'A bearded climber in a snowy jacket pulls himself over an icy ridge, wind blowing snow across his face, the camera slowly pushes in, overcast cold light, intense cinematic mood' },
  { id: 'subway-guitar', title: 'Subway guitarist', cat: 'video', mode: 'video', tags: ['Text to video', 'Music'], aspect: '16:9', hue: [20, 200],
    prompt: 'A young musician plays an acoustic guitar on an empty subway platform at night, fluorescent lights flicker softly, a train passes behind him, handheld camera slowly circles around him' },
  { id: 'squirrel-gold', title: 'Squirrel in the decorations', cat: 'video', mode: 'video', tags: ['Text to video', 'Nature'], aspect: '16:9', hue: [45, 120],
    prompt: 'A grey squirrel sniffs around a wooden table under a tree decorated with golden ornaments and white blossoms, shallow depth of field, gentle camera slide, warm afternoon light' },
  { id: 'image-to-motion', title: 'Bring a photo to life', cat: 'video', mode: 'workflow', template: 'image-video', tags: ['Image to video'], hue: [160, 260],
    prompt: 'Slow camera push-in, gentle wind, cinematic motion' },
  { id: 'dancer-flowers', title: 'Dancer in white flowers', cat: 'video', mode: 'video', tags: ['Text to video'], aspect: '16:9', hue: [200, 340],
    prompt: 'A dancer in a flowing white dress moves slowly through a field of white flowers, petals drift in the air, soft backlight, dreamy slow motion, the camera floats beside her' },

  // Audio
  { id: 'campaign', title: 'Campaign: image, video and voiceover', cat: 'audio', mode: 'workflow', template: 'campaign', tags: ['Voiceover', 'Workflow'], hue: [100, 30],
    prompt: 'Launch of a minimalist smartwatch: calm, premium, soft light' },
]

export const DEFAULT_NEGATIVE = {
  image: 'blurry, low quality, lowres, jpeg artifacts, watermark, signature, deformed, bad anatomy, extra fingers, distorted face, oversaturated',
  video: 'blurry, low quality, flickering, jitter, distorted, warped faces, morphing, static frame, watermark, subtitles, worst quality',
}
