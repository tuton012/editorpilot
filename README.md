# EditorPilot

EditorPilot is a private AI writing assistant that runs in your browser. It helps with grammar, rewrites, tone changes, and focused editing while keeping your writing on your device.

## Live Demo

Try EditorPilot here:

```text
https://editorpilot.com/editor/
```

Landing page:

```text
https://editorpilot.com/
```

## Features

- Grammar, punctuation, and clarity suggestions
- 10+ writing modes including Professional, Simple, Shorter, Friendlier, Email, Academic, Creative, Formal, and Casual
- Multilingual writing support
- Local-first privacy with no accounts, tracking, or server-side draft storage
- Offline-friendly workflow after the model is downloaded and cached
- Clean editor interface with settings, review tools, and export options

## Privacy

EditorPilot is designed so your writing stays with you. Core editing happens locally in the browser using on-device AI models. Drafts and preferences are stored on your device, and your text is not sent to an EditorPilot backend for editing.

## Requirements

- A modern browser with WebGPU support
- HTTPS or localhost when running locally
- Local model files in `model/`, plus WebGPU support in the browser
- Enough device storage and memory for local model files

## Support The Project

EditorPilot is free to use. Donations are never required, but every contribution helps improve the project.

- Stripe: https://donate.stripe.com/5kAaIF8nD5xS8ve000
- PayPal: https://www.paypal.com/ncp/payment/CZJHNVHKCFYDA
- Buy Me a Coffee: https://buymeacoffee.com/carlos.i

## Credits

EditorPilot was created by Carlos I.

Thank you to the people and teams behind the open web technologies that make this project possible:

- WebLLM / MLC for local in-browser language models
- SQLite WASM + OPFS for on-device persistence
- WebGPU for fast local inference
- Qwen models converted to MLC format for local browser inference
- Everyone building privacy-respecting tools for the web

## Run Locally

Clone the repository, then serve the folder with any local static server.

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

The editor is available at:

```text
http://localhost:8000/editor/
```

## Local Models

EditorPilot uses model records defined in `editor/ai.js`. On localhost, it loads model weights and runtime libraries from the repository's `model/` folder. On the hosted domain, Cloudflare Pages excludes the large local files and WebLLM downloads the selected model into the browser cache on first use.

The model choices are:

- **Basic Model** — Qwen2.5 1.5B; lowest memory use
- **Plus Model** — Qwen2.5 3B; recommended for grammar correction
- **Power Model** — Qwen2.5 7B; highest local grammar and rewriting quality, requiring about 6 GB of available GPU memory

Install the Hugging Face CLI, then download the MLC WebGPU bundle into the exact folder below:

```powershell
hf download mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC --local-dir "model/Qwen2.5-3B-Instruct-q4f16_1-MLC"
```

Choose `Plus Model` in the editor. On localhost, bundle files are stored under `resolve/main/` because WebLLM uses Hugging Face's repository layout, and the WebGPU runtime library is served from `model/runtime/`. On the hosted domain, the equivalent model and runtime are downloaded and cached by the browser.

Download the Plus Model runtime library:

```powershell
New-Item -ItemType Directory -Force .\model\runtime
Invoke-WebRequest -UseBasicParsing `
	-Uri "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm" `
	-OutFile ".\model\runtime\Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm"
```

For the Power Model, download Qwen2.5 7B Instruct q4f16:

```powershell
hf download mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC --local-dir "model/Qwen2.5-7B-Instruct-q4f16_1-MLC"
```

When using the setup wizard, **Review each word** is selected by default. This enables accepting or rejecting individual grammar and punctuation changes instead of replacing the entire draft at once. Existing saved preferences are preserved.

Cloudflare Pages uses `.cfignore` to exclude the local `model/` directory because Pages limits individual files to 25 MiB. This does not affect localhost, where the local bundles remain available.

## Project Structure

```text
.
|-- index.html          # Landing page
|-- logo.png            # App logo
|-- model/              # Local model weights and runtime libraries
|-- _headers            # Hosting/security headers
`-- editor/             # Main EditorPilot app
```
