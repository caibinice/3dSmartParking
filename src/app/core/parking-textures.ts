import { KhronosTextureContainer2 } from '@babylonjs/core/Misc/khronosTextureContainer2';

export function configureLocalKtxDecoder(mobile: boolean) {
  const file = (name: string) => new URL(`vendor/ktx2/9.29.0/${name}`, document.baseURI).href;
  KhronosTextureContainer2.URLConfig = {
    jsDecoderModule: file('decoder.js'), wasmUASTCToASTC: file('uastc_astc.wasm'), wasmUASTCToBC7: file('uastc_bc7.wasm'),
    wasmUASTCToRGBA_UNORM: file('uastc_rgba8_unorm_v2.wasm'), wasmUASTCToRGBA_SRGB: file('uastc_rgba8_srgb_v2.wasm'),
    wasmUASTCToR8_UNORM: file('uastc_r8_unorm.wasm'), wasmUASTCToRG8_UNORM: file('uastc_rg8_unorm.wasm'),
    jsMSCTranscoder: file('msc_basis_transcoder.js'), wasmMSCTranscoder: file('msc_basis_transcoder.wasm'), wasmZSTDDecoder: file('zstddec.wasm'),
  };
  KhronosTextureContainer2.DefaultNumWorkers = mobile ? 2 : 4;
  // Prefer the high-fidelity RGBA fallback on devices without ASTC/BC7. Do not
  // trade the existing appearance for lower-quality BC1/BC3 recompression.
  KhronosTextureContainer2.DefaultDecoderOptions.useRGBAIfASTCBC7NotAvailableWhenUASTC = true;
}
