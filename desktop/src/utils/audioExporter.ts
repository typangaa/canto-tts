// src/utils/audioExporter.ts — Client-side Web Audio API Exporter

/**
 * Encodes a Web Audio AudioBuffer into a 16-bit PCM WAV Blob.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = buffer.length;
  const dataByteLength = length * blockAlign;
  const headerByteLength = 44;
  const wavBuffer = new ArrayBuffer(headerByteLength + dataByteLength);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, "WAVE");

  // fmt sub-chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(36, "data");
  view.setUint32(40, dataByteLength, true);

  // Interleave channels & write 16-bit PCM samples
  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

/**
 * Resamples an audio Blob to a specified playback rate using OfflineAudioContext.
 */
export async function renderAudioWithSpeed(
  audioBlob: Blob,
  playbackRate: number
): Promise<AudioBuffer> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const tempCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  if (playbackRate === 1.0) {
    return decodedBuffer;
  }

  // Calculate new target length based on speed multiplier
  const newLength = Math.ceil(decodedBuffer.length / playbackRate);
  const targetSampleRate = decodedBuffer.sampleRate;

  const offlineCtx = new OfflineAudioContext(
    decodedBuffer.numberOfChannels,
    newLength,
    targetSampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = decodedBuffer;
  source.playbackRate.value = playbackRate;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}

/**
 * Exports an audio Blob at a specific playback rate.
 *
 * WAV only. There is deliberately no MP3 path: an earlier version handed back
 * the WAV bytes under an `audio/mp3` MIME type and a `.mp3` filename, which is
 * not MP3 at all — identical in size to the WAV, and rejected by strict
 * decoders. Shipping a real encoder (lamejs) is not worth the dependency for a
 * few seconds of speech.
 *
 * Note `renderAudioWithSpeed` resamples, so a non-1.0 rate shifts pitch as well
 * as duration; StudioTab sets `preservesPitch = false` on the preview element
 * so what the user hears is what they download.
 */
export async function exportAudio(
  rawBlob: Blob,
  playbackRate: number,
  format: "wav" = "wav"
): Promise<{ blob: Blob; ext: string }> {
  void format;
  // Unchanged speed — hand back the server's WAV untouched, no decode/re-encode.
  if (playbackRate === 1.0) {
    return { blob: rawBlob, ext: "wav" };
  }

  const renderedBuffer = await renderAudioWithSpeed(rawBlob, playbackRate);
  return { blob: audioBufferToWav(renderedBuffer), ext: "wav" };
}

/**
 * Helper to trigger browser download of a Blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Converts a recorded audio Blob (e.g. WebM/Opus from MediaRecorder)
 * to a 16-bit PCM WAV File suitable for the voice cloning API.
 */
export async function recordingBlobToWavFile(
  recordedBlob: Blob,
  fileName = "recording.wav"
): Promise<File> {
  const arrayBuffer = await recordedBlob.arrayBuffer();
  const tempCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  await tempCtx.close();

  const wavBlob = audioBufferToWav(decodedBuffer);
  return new File([wavBlob], fileName, { type: "audio/wav" });
}
