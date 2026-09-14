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
- Internet access on first use so the AI model can download and cache, unless you install a local model bundle
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
- Qwen, Gemma, and other open model communities distributed through MLC
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

The editor supports model bundles stored in the repository's root `model/` folder. Qwen2.5 3B Instruct q4f16 is the recommended local bundle for grammar correction. Qwen2.5 7B Instruct q4f16 is the Power Model for the best local quality.

Install the Hugging Face CLI, then download the MLC WebGPU bundle into the exact folder below:

```powershell
hf download mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC --local-dir "model/Qwen2.5-3B-Instruct-q4f16_1-MLC"
```

Choose `Plus Model` in the editor. The bundle files are stored under `resolve/main/` because WebLLM uses Hugging Face's repository layout. The WebGPU runtime library is also expected locally in `model/runtime/`; the model weights and runtime are never loaded from an online model catalog.

For the Power Model, download Qwen2.5 7B Instruct q4f16:

```powershell
hf download mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC --local-dir "model/Qwen2.5-7B-Instruct-q4f16_1-MLC"
```

## Project Structure

```text
.
|-- index.html          # Landing page
|-- logo.png            # App logo
|-- _headers            # Hosting/security headers
`-- editor/             # Main EditorPilot app
```
