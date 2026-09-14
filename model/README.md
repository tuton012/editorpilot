# Local model bundles

Place MLC WebGPU model bundles in this folder. The editor currently expects:

```text
model/
|-- Qwen2.5-1.5B-Instruct-q4f16_1-MLC/
|-- Qwen2.5-3B-Instruct-q4f16_1-MLC/
|-- Qwen2.5-7B-Instruct-q4f16_1-MLC/
`-- runtime/
    |-- Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm
    |-- Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm
    `-- Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm
```

The WebGPU runtime libraries must also be downloaded into `runtime/`. The model weights, tokenizer, and runtime then load from this folder only.

Basic Model uses Qwen 1.5B. Plus Model uses Qwen 3B and is the recommended grammar model. Power Model uses Qwen 7B and gives better quality but needs considerably more GPU memory.

Download the recommended bundle from the repository root with:

```powershell
hf download mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC --local-dir "model/Qwen2.5-1.5B-Instruct-q4f16_1-MLC"
```

Download the stronger grammar model instead:

```powershell
hf download mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC --local-dir "model/Qwen2.5-3B-Instruct-q4f16_1-MLC"
```

Download the Power Model weights similarly with `mlc-ai/Qwen2.5-7B-Instruct-q4f16_1-MLC` when you have enough GPU memory.

The three runtime libraries must be downloaded from the MLC binary library into `model/runtime/` using these filenames:

```text
Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm
Qwen2.5-3B-Instruct-q4f16_1_cs1k-webgpu.wasm
Qwen2-7B-Instruct-q4f16_1_cs1k-webgpu.wasm
```