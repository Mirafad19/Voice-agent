
export const decodePcmChunk = (chunk: Uint8Array, context: AudioContext): AudioBuffer => {
    const dataInt16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
    const frameCount = dataInt16.length;
    
    const buffer = context.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {
        channelData[i] = dataInt16[i] / 32768.0;
    }
    
    return buffer;
};
