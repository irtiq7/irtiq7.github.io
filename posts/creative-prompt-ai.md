![Creative Prompt AI logo](images/posts/creative-prompt-ai-logo.webp)

Creative Prompt AI is an open-source desktop application that puts a simple graphical interface on top of open-source text-to-image models from Hugging Face. Instead of writing a script for every experiment, you choose a model, type a prompt and get a batch of images in a viewer you can zoom into and save from.

Source code: [github.com/irtiq7/CreativePromptAI](https://github.com/irtiq7/CreativePromptAI)

## What it does

- **One-click setup.** An *Install Dependencies* button installs the Python packages the app needs, such as `diffusers`, `torch` and `Pillow`.
- **Any Hugging Face model.** Enter a model ID, for example `stabilityai/stable-diffusion-xl-base-1.0`, and a download path, and the app fetches and loads the model. Optional LoRA weights can be applied on top.
- **Batch generation.** Generate several images per prompt, with settings such as negative prompts and guidance scale for exploring variations and styles.
- **Built-in viewer.** Results open in a dedicated window with zoom, and any image can be saved directly from it.
- **Progress feedback.** A progress bar reports the status of model loading and image generation.

![Creative Prompt AI main window next to its image viewer showing a generated cyberpunk illustration](images/posts/creative-prompt-ai-main-window.webp)
*The main window (right) after generating an image from the prompt "cyberpunk art" with Stable Diffusion XL, and the image viewer (left).*

## How to use it

Creative Prompt AI requires an NVIDIA graphics card with CUDA.

1. Click **Install Dependencies** to set up the environment.
2. Copy a model ID from the model's page on Hugging Face.
3. Enter the model ID and a download path, then click **Load Model**. Load the model again whenever you change the model ID or the LoRA weights.
4. Enter a prompt and the number of images, then click **Generate Images**.
5. Inspect the results in the viewer, zoom in or out, and save the images you want to keep.

![Hugging Face model card for stabilityai/stable-diffusion-xl-base-1.0 with the model ID highlighted](images/posts/creative-prompt-ai-model-id.webp)
*Copying a model ID from its Hugging Face model card.*

## Who it is for

The interface is designed for artists, designers and anyone curious about AI image generation who would rather not write code. It also stays open to developers: because it is built on the Hugging Face libraries, any compatible model and LoRA can be plugged in, and the code can be extended to fit your own workflow.

## What's next

Ideas on the roadmap:

- image-to-image models
- language models for text generation
- multi-agent support

Contributions and feedback are welcome on [GitHub](https://github.com/irtiq7/CreativePromptAI).
