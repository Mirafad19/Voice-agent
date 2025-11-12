/**
 * Decodes a Uint8Array of raw PCM audio data into a Web Audio API AudioBuffer.
 * This is necessary because the browser's native `decodeAudioData` does not
 * support raw PCM streams.
 * @param chunk The Uint8Array containing the 16-bit PCM data.
 * @param context The AudioContext to use for creating the AudioBuffer.
 * @returns An AudioBuffer containing the decoded audio.
 */
export const decodePcmChunk = (chunk: Uint8Array, context: AudioContext): AudioBuffer => {
    // The incoming data is 16-bit PCM, so we create an Int16Array view on the ArrayBuffer.
    // We specify the byteOffset and byteLength to handle cases where the Uint8Array is a subarray.
    const dataInt16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
    
    // The number of frames is the number of 16-bit samples.
    const frameCount = dataInt16.length;
    
    // Create a new AudioBuffer with one channel, the correct frame count, and a fixed sample rate.
    // The sample rate *must* be 24000 to match the audio from the Gemini API. Using context.sampleRate
    // can cause distortion if the browser's default rate is different (e.g., 44.1kHz or 48kHz).
    const buffer = context.createBuffer(1, frameCount, 24000);
    
    // Get the channel data to fill it.
    const channelData = buffer.getChannelData(0);

    // Loop through the 16-bit samples and convert them to 32-bit float samples (ranging from -1.0 to 1.0).
    for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
    }
    
    return buffer;
};
