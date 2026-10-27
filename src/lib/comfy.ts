// Imports ComfyUI workflow files (both the UI "workflow.json" and the API "prompt" format) into Orbi nodes.
// ComfyUI graphs contain many plumbing nodes (loaders, VAE decode, latents...). Orbi keeps the creative
// steps — prompts, generation, video, edit, inpaint, upscale, load and save — and reconnects them by
// walking through the plumbing. Nodes Orbi cannot run yet become notes, so nothing is silently lost.

export type CKind = 'prompt' | 'image' | 'video' | 'load' | 'output' | 'note' | 'edit' | 'inpaint' | 'upscale'
export type CNode = { id: string; kind: CKind; x: number; y: number; data: Record<string, string | number | undefined> }
export type CEdge = { id: string; from: string; fromPort: string; to: string; toPort: string }
export type ComfyImport = { nodes: CNode[]; edges: CEdge[]; unsupported: string[]; models: string[] }

type N = { id: string; type: string; x: number; y: number; widgets: unknown[]; named: Record<string, unknown>; inputs: Record<string, string | null> }

const PROMPT = /^(CLIPTextEncode|CLIPTextEncodeSDXL|CLIPTextEncodeFlux|CLIPTextEncodeSD3|CLIPTextEncodeHunyuanDiT|PrimitiveStringMultiline|PrimitiveString|String Literal|Text Multiline)$/i
const SAMPLER = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced|KSampler \(Efficient\))$/i
const VIDEO = /(WanImageToVideo|WanFirstLastFrameToVideo|Wan22ImageToVideoLatent|EmptyHunyuanLatentVideo|EmptyMochiLatentVideo|EmptyLTXVLatentVideo|LTXVImgToVideo|WanVideoSampler|HunyuanVideo|CosmosImageToVideo)/i
const LOAD = /^(LoadImage|LoadImageMask|Load Image|ETN_LoadImageBase64)$/i
const SAVE = /^(SaveImage|PreviewImage|SaveAnimatedWEBP|SaveAnimatedPNG|SaveVideo|VHS_VideoCombine|SaveWEBM|CreateVideo|Image Save)$/i
const UPSCALE = /^(ImageUpscaleWithModel|UltimateSDUpscale)$/i
const INPAINT = /^(VAEEncodeForInpaint|InpaintModelConditioning|SetLatentNoiseMask)$/i
const EDIT = /^(ReferenceLatent|FluxKontextImageScale|TextEncodeQwenImageEdit|TextEncodeQwenImageEditPlus|FluxKontextMultiReferenceLatentMethod)$/i
const LATENT_SIZE = /^(EmptyLatentImage|EmptySD3LatentImage|EmptyFlux2LatentImage|EmptyChromaRadianceLatentImage)$/i
const MODEL_LOADER = /^(CheckpointLoaderSimple|UNETLoader|UnetLoaderGGUF|CheckpointLoader|DiffusersLoader|UpscaleModelLoader)$/i
// Plumbing Orbi handles by itself (no node needed, no warning).
const PLUMBING =
  /^(VAEDecode|VAEEncode|VAELoader|CLIPLoader|DualCLIPLoader|TripleCLIPLoader|CLIPLoaderGGUF|DualCLIPLoaderGGUF|CLIPVisionLoader|CLIPVisionEncode|CLIPSetLastLayer|ModelSamplingSD3|ModelSamplingFlux|ModelSamplingAuraFlow|FluxGuidance|ConditioningZeroOut|ConditioningCombine|ConditioningSetTimestepRange|LoraLoader|LoraLoaderModelOnly|Reroute|Note|MarkdownNote|PrimitiveNode|RandomNoise|KSamplerSelect|BasicScheduler|BasicGuider|CFGGuider|EmptyLatentImage|EmptySD3LatentImage|EmptyFlux2LatentImage|ImageScale|ImageScaleBy|ImageScaleToTotalPixels|LatentUpscale|LatentUpscaleBy|SetLatentNoiseMask|UpscaleModelLoader|CheckpointLoaderSimple|UNETLoader|UnetLoaderGGUF|VHS_LoadVideo|GetImageSize|ImageBatch|RepeatLatentBatch|TrimVideoLatent|ModelSamplingDiscrete|SkipLayerGuidanceDiT|TorchCompileModel|PathchSageAttentionKJ|CLIPTextEncodeSDXLRefiner|SDTurboScheduler|EmptyChromaRadianceLatentImage)$/i

const uid = () => Math.random().toString(36).slice(2, 9)

function normalize(json: unknown): N[] {
  const out: N[] = []
  const j = json as Record<string, unknown>
  if (Array.isArray(j?.nodes)) {
    // UI format
    const links = new Map<number, number>()
    for (const l of (j.links as unknown[]) || []) {
      if (Array.isArray(l)) links.set(l[0] as number, l[1] as number)
      else if (l && typeof l === 'object') links.set((l as { id: number }).id, (l as { origin_id: number }).origin_id)
    }
    for (const n of j.nodes as Record<string, unknown>[]) {
      const inputs: Record<string, string | null> = {}
      for (const i of (n.inputs as { name: string; link: number | null }[]) || []) inputs[i.name] = i.link != null && links.has(i.link) ? String(links.get(i.link)) : null
      const pos = (Array.isArray(n.pos) ? n.pos : [((n.pos as { 0: number }) || { 0: 0 })[0], 0]) as number[]
      out.push({ id: String(n.id), type: String(n.type || ''), x: Number(pos[0]) || 0, y: Number(pos[1]) || 0, widgets: (n.widgets_values as unknown[]) || [], named: {}, inputs })
    }
    return out
  }
  // API format: { "3": { class_type, inputs: { name: value | [id, slot] } } }
  let i = 0
  for (const [id, n] of Object.entries(j || {})) {
    const node = n as { class_type?: string; inputs?: Record<string, unknown> }
    if (!node?.class_type) continue
    const inputs: Record<string, string | null> = {}
    const named: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node.inputs || {})) {
      if (Array.isArray(v) && v.length === 2 && (typeof v[0] === 'string' || typeof v[0] === 'number')) inputs[k] = String(v[0])
      else named[k] = v
    }
    out.push({ id, type: node.class_type, x: (i % 5) * 340, y: Math.floor(i / 5) * 300, widgets: [], named, inputs })
    i++
  }
  return out
}

const num = (n: N, name: string, idx: number) => {
  const v = n.named[name] ?? n.widgets[idx]
  return typeof v === 'number' ? v : Number(v) || undefined
}
const text = (n: N) => String(n.named.text ?? n.named.value ?? n.named.string ?? n.named.text_g ?? (typeof n.widgets[0] === 'string' ? n.widgets[0] : '') ?? '')

function kindOf(n: N): CKind | 'plumbing' | 'unsupported' {
  if (PROMPT.test(n.type)) return 'prompt'
  if (VIDEO.test(n.type)) return 'video'
  if (SAMPLER.test(n.type)) return 'image'
  if (LOAD.test(n.type)) return 'load'
  if (SAVE.test(n.type)) return 'output'
  if (UPSCALE.test(n.type)) return 'upscale'
  if (INPAINT.test(n.type) && n.type !== 'SetLatentNoiseMask') return 'inpaint'
  if (EDIT.test(n.type)) return 'edit'
  if (/^(Note|MarkdownNote)$/i.test(n.type)) return 'note'
  if (PLUMBING.test(n.type) || LATENT_SIZE.test(n.type) || MODEL_LOADER.test(n.type)) return 'plumbing'
  return 'unsupported'
}

const OUT_TYPE: Record<string, 'text' | 'image' | 'video' | 'media'> = { prompt: 'text', image: 'image', load: 'image', edit: 'image', inpaint: 'image', upscale: 'image', video: 'video' }
const OUT_PORT: Record<string, string> = { prompt: 'text', image: 'image', load: 'image', edit: 'image', inpaint: 'image', upscale: 'image', video: 'video' }

export function importComfy(json: unknown): ComfyImport {
  const all = normalize(json)
  if (!all.length) throw new Error('This file is not a ComfyUI workflow.')
  const byId = new Map(all.map((n) => [n.id, n]))
  const kinds = new Map(all.map((n) => [n.id, kindOf(n)]))
  const models = all.filter((n) => MODEL_LOADER.test(n.type)).map((n) => String(n.named.ckpt_name ?? n.named.unet_name ?? n.named.model_name ?? n.widgets[0] ?? '')).filter(Boolean)
  const unsupported = [...new Set(all.filter((n) => kinds.get(n.id) === 'unsupported').map((n) => n.type))]

  // Prompts that only feed "negative" inputs become the sampler's negative text instead of nodes.
  const negativeOnly = new Set<string>()
  const positiveUse = new Set<string>()
  for (const n of all) for (const [name, src] of Object.entries(n.inputs)) if (src && kinds.get(src) === 'prompt') (/negative/i.test(name) ? negativeOnly : positiveUse).add(src)
  for (const id of positiveUse) negativeOnly.delete(id)

  // Semantic (visible) nodes
  const nodes: CNode[] = []
  const map = new Map<string, CNode>()
  const minX = Math.min(...all.map((n) => n.x))
  const minY = Math.min(...all.map((n) => n.y))
  for (const n of all) {
    const k = kinds.get(n.id)!
    if (k === 'plumbing' || negativeOnly.has(n.id)) continue
    const base = { id: uid(), x: Math.round((n.x - minX) * 0.9) + 40, y: Math.round((n.y - minY) * 0.9) + 40 }
    let node: CNode
    if (k === 'unsupported') node = { ...base, kind: 'note', data: { text: `ComfyUI node not available in Orbi yet: ${n.type}` } }
    else if (k === 'prompt') node = { ...base, kind: 'prompt', data: { text: text(n) } }
    else if (k === 'note') node = { ...base, kind: 'note', data: { text: String(n.widgets[0] ?? n.named.text ?? '') } }
    else if (k === 'image') node = { ...base, kind: 'image', data: { aspect: '1:1', steps: num(n, 'steps', 2) ?? 0, seed: num(n, 'seed', 0) ?? '', strength: num(n, 'denoise', 6) ?? 0.65 } }
    else if (k === 'video') node = { ...base, kind: 'video', data: { frames: num(n, 'length', 2) ?? num(n, 'num_frames', 2) ?? 33 } }
    else node = { ...base, kind: k as CKind, data: k === 'output' ? { board: '' } : {} }
    nodes.push(node)
    map.set(n.id, node)
  }

  // Walk upstream through plumbing to the nearest semantic nodes.
  const upstream = (id: string, seen = new Set<string>()): string[] => {
    if (seen.has(id)) return []
    seen.add(id)
    if (map.has(id) || negativeOnly.has(id)) return [id]
    const n = byId.get(id)
    if (!n) return []
    return Object.values(n.inputs).flatMap((src) => (src ? upstream(src, seen) : []))
  }

  const edges: CEdge[] = []
  const add = (from: CNode, fromPort: string, to: CNode, toPort: string) => {
    if (!edges.some((e) => e.from === from.id && e.to === to.id && e.toPort === toPort)) edges.push({ id: uid(), from: from.id, fromPort, to: to.id, toPort })
  }
  for (const [cid, target] of map) {
    const n = byId.get(cid)!
    for (const [name, src] of Object.entries(n.inputs)) {
      if (!src) continue
      for (const sid of upstream(src)) {
        if (negativeOnly.has(sid)) {
          if (target.kind === 'image' || target.kind === 'video') target.data.negative = text(byId.get(sid)!)
          continue
        }
        const source = map.get(sid)
        if (!source || source === target) continue
        const t = OUT_TYPE[source.kind]
        if (!t) continue
        if (target.kind === 'output') add(source, OUT_PORT[source.kind], target, 'media')
        else if (t === 'text' && ['image', 'video', 'edit', 'inpaint'].includes(target.kind)) add(source, 'text', target, 'prompt')
        else if (t === 'image' && ['image', 'video', 'edit', 'inpaint', 'upscale'].includes(target.kind) && !/negative|positive/i.test(name)) add(source, 'image', target, 'image')
      }
    }
  }
  // Read width/height from latent nodes feeding a sampler and turn them into an aspect ratio.
  for (const [cid, target] of map) {
    if (target.kind !== 'image') continue
    const seen = new Set<string>()
    const walk = (id: string): N | null => {
      if (seen.has(id)) return null
      seen.add(id)
      const n = byId.get(id)
      if (!n) return null
      if (LATENT_SIZE.test(n.type)) return n
      for (const src of Object.values(n.inputs)) if (src && !map.has(src)) {
        const r = walk(src)
        if (r) return r
      }
      return null
    }
    const lat = Object.values(byId.get(cid)!.inputs).map((s) => (s ? walk(s) : null)).find(Boolean)
    if (lat) {
      const w = num(lat, 'width', 0) || 1024
      const h = num(lat, 'height', 1) || 1024
      const r = w / h
      target.data.aspect = r > 1.5 ? '16:9' : r > 1.15 ? '4:3' : r < 0.62 ? '9:16' : r < 0.87 ? '3:4' : '1:1'
    }
  }
  return { nodes, edges, unsupported, models }
}
