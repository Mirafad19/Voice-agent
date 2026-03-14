
async function decodePcmData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const PREFERRED_MIME_TYPES = [
  'audio/wav',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
];

export class RecordingService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private mixerNode: MediaStreamAudioDestinationNode | null = null;
  private recordedChunks: Blob[] = [];
  private onRecordingStop: (blob: Blob, mimeType: string) => void;
  private isRecording = false;

  private userSource: MediaStreamAudioSourceNode | null = null;
  private agentGainNode: GainNode | null = null;
  private mimeType: string;
  private agentAudioNextStartTime = 0;


  constructor(onRecordingStop: (blob: Blob, mimeType: string) => void) {
    this.onRecordingStop = onRecordingStop;
    this.mimeType = PREFERRED_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || PREFERRED_MIME_TYPES[1];
  }

  public async start(userStream: MediaStream): Promise<void> {
    if (this.isRecording) return;
    
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
      this.agentAudioNextStartTime = this.audioContext.currentTime;

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      this.mixerNode = this.audioContext.createMediaStreamDestination();

      this.userSource = this.audioContext.createMediaStreamSource(userStream);
      this.userSource.connect(this.mixerNode);

      this.agentGainNode = this.audioContext.createGain();
      this.agentGainNode.connect(this.mixerNode);

      const recorderOptions: MediaRecorderOptions = { mimeType: this.mimeType };
      if (this.mimeType.includes('webm') || this.mimeType.includes('ogg')) {
        recorderOptions.audioBitsPerSecond = 128000;
      }
      this.mediaRecorder = new MediaRecorder(this.mixerNode.stream, recorderOptions);


      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.recordedChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: this.mimeType });
        this.onRecordingStop(blob, this.mimeType);
        this.cleanup();
      };
      
      this.recordedChunks = [];
      this.mediaRecorder.start();
      this.isRecording = true;

    } catch (error) {
      console.error("Failed to start recording:", error);
      this.cleanup();
      throw error;
    }
  }

  public addAgentAudioChunk(pcmData: Uint8Array): void {
    if (!this.audioContext || !this.agentGainNode || !this.isRecording) return;
    
    const capturedContext = this.audioContext;
    decodePcmData(pcmData, capturedContext, 24000, 1).then(audioBuffer => {
      if (this.isRecording && this.agentGainNode) {
        const source = capturedContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.agentGainNode);
        
        const currentTime = capturedContext.currentTime;
        const startTime = Math.max(currentTime, this.agentAudioNextStartTime);
        source.start(startTime);
        this.agentAudioNextStartTime = startTime + audioBuffer.duration;
      }
    }).catch(err => console.error("Error processing agent audio chunk:", err));
  }

  public stop(): void {
    if (!this.isRecording || !this.mediaRecorder) return;
    
    if (this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
    }
    this.isRecording = false;
  }

  private cleanup(): void {
    this.userSource?.disconnect();
    this.agentGainNode?.disconnect();

    this.audioContext?.close().catch(console.error);
    
    this.isRecording = false;
    this.agentAudioNextStartTime = 0;
    this.audioContext = null;
    this.mixerNode = null;
    this.mediaRecorder = null;
    this.userSource = null;
    this.agentGainNode = null;
  }
}
