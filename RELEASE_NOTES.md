## Orbi 0.1.27-7

**Creative**
- Canvas now has **Image** and **Video** modes. Each shows only the settings that make sense for it.
- **Quality presets** (Fast / Balanced / Best) use the recommended steps for each model, or choose Custom.
- Images: generate 1 to 8 at once. Video: choose **seconds and FPS** (8, 12, 16, 24, 30, 60). Orbi warns when a render is heavy for your PC, but never blocks it.
- **Live render status** on the canvas (step, time, stop) and a **Renders** queue. Strong PCs render two at once.
- Renders and workflows **keep running when you leave** Creative. The rail icon shows they are busy, and you get a "ready" notice with an Open button.
- Upscale any image 4× (Real-ESRGAN) from the gallery.

**Workflows**
- **Import ComfyUI workflows (.json)**: prompts, samplers, sizes, image-to-video, inpaint, edit, upscale, load and save are converted to Orbi nodes. Nodes Orbi can't run yet (e.g. FaceSwap) appear as labeled notes.
- Export and import Orbi workflows.
- New nodes: **Edit image with words** (FLUX.2 klein), **Inpaint** with a mask painter, and **Upscale 4×**. Video nodes now have FPS.
- New templates. Dropdowns now follow the dark theme.

**Other**
- About and installer now carry **Draft Creative Studio Ltda — Creative Design & Software Development**.
- Removed the InvokeAI references.

Developed by Daniel Rodrigues · Draft Creative Studio Ltda.
