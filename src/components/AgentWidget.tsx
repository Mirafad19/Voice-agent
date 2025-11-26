
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AgentProfile, AgentConfig, WidgetState, Recording, ReportingStatus } from '../types';
import { GeminiLiveService } from '../services/geminiLiveService';
import { RecordingService } from '../services/recordingService';
import { Spinner } from './ui/Spinner';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { blobToBase64 } from '../utils';
import { decodePcmChunk } from '../utils/audio';

interface AgentWidgetProps {
  agentProfile: AgentProfile | AgentConfig;
  apiKey: string;
  isWidgetMode: boolean;
  onSessionEnd?: (recording: Recording) => void;
}

// Helper function to upload and get a shareable link from Cloudinary
async function getCloudinaryShareableLink(cloudName: string, uploadPreset: string, recording: Omit<Recording, 'id' | 'url'>): Promise<string> {
    const formData = new FormData();
    formData.append('file', recording.blob);
    // IMPORTANT: We trim the preset to avoid spaces which cause "Unknown API key" error
    formData.append('upload_preset', uploadPreset.trim());

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName.trim()}/video/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.error.message;
        if (errorMsg === "Unknown API key") {
            throw new Error(`Cloudinary Error: "Unknown API key". This means the Upload Preset Name (${uploadPreset}) does not exist in your Cloudinary Dashboard. Please check the spelling exactly.`);
        }
        throw new Error(`Cloudinary upload failed: ${errorMsg}`);
    }

    const result = await response.json();
    return result.secure_url;
}


const FabIcon = ({className = "h-9 w-9 text-white"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* Headphone band and earpieces */}
        <path d="M4 13.5V12a8 8 0 1116 0v1.5" />
        <path d="M4 12a2 2 0 00-2 2v3a2 2 0 002 2h1" />
        <path d="M20 12a2 2 0 012 2v3a2 2 0 01-2 2h-1" />
        
        {/* Eyes */}
        <path d="M9 12h.01" />
        <path d="M15 12h.01" />
        
        {/* Smile */}
        <path d="M9.5 16a3.5 3.5 0 005 0" />
        
        {/* Microphone */}
        <path d="M5 14v1a2 2 0 002 2h2" />
    </svg>
);

const MicrophoneIcon = ({state}: {state: WidgetState}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-12 w-12 transition-colors duration-300 ${state === WidgetState.Idle ? 'text-gray-800 dark:text-white' : 'text-white'}`} viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
        <path d="M9 2m0 3a3 3 0 0 1 3 -3h0a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3z" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <path d="M8 21l8 0" />
        <path d="M12 17l0 4" />
    </svg>
);

const NetworkIcon = ({ isOnline }: { isOnline: boolean }) => (
    <div className={`flex items-center gap-1.5 rounded-full px-2 py-1 border transition-colors ${isOnline ? 'bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-600' : 'bg-red-100 border-red-200 dark:bg-red-900/30 dark:border-red-800'}`} title={isOnline ? "Network Stable" : "Network Unstable"}>
        <div className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
        <span className={`text-[10px] font-medium uppercase tracking-wider ${isOnline ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
            {isOnline ? 'LIVE' : 'OFFLINE'}
        </span>
    </div>
);

export const AgentWidget: React.FC<AgentWidgetProps> = ({ agentProfile, apiKey, isWidgetMode, onSessionEnd }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showCallout, setShowCallout] = useState(false);
  
  const [widgetState, _setWidgetState] = useState<WidgetState>(WidgetState.Idle);
  const widgetStateRef = useRef(widgetState);
  const setWidgetState = (state: WidgetState) => {
    widgetStateRef.current = state;
    _setWidgetState(state);
  };

  const [reportingStatus, setReportingStatus] = useState<ReportingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  
  // Network Monitoring State
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const geminiServiceRef = useRef<GeminiLiveService | null>(null);
  const recordingServiceRef = useRef<RecordingService | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const activeAudioSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartTimeRef = useRef(0);
  const shouldEndAfterSpeakingRef = useRef(false);
  
  const accentColorClass = agentProfile.accentColor;

  // Network Monitoring Effect
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const analyzeAndSendReport = useCallback(async (recording: Omit<Recording, 'id' | 'url'>) => {
    const { emailConfig, fileUploadConfig } = agentProfile as AgentConfig;
    if (!emailConfig?.formspreeEndpoint) {
        let detailedError = "Formspree endpoint not configured.";
        if (isWidgetMode) {
          detailedError = "Email report failed: Formspree URL is missing. Please update your agent profile in the dashboard and generate a new embed code.";
        } else {
          detailedError = "Formspree endpoint not configured. Please add it in the Agent Configuration panel.";
        }
        setErrorMessage(detailedError);
        setReportingStatus('failed');
        return;
    }

    setReportingStatus('analyzing');

    try {
        let audioLink = 'Audio link not available: Cloudinary is not configured.';
        // --- Cloudinary Upload Step ---
        if (fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset) {
            try {
                audioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
            } catch (uploadError) {
                console.error("Audio upload to Cloudinary failed:", uploadError);
                // Handle user-facing error for Cloudinary specifically
                const errorMsg = uploadError instanceof Error ? uploadError.message : 'Upload failed';
                // If it's our custom "Signed" error, we want to show that clearly
                if (errorMsg.includes("Signed") || errorMsg.includes("Upload Preset Name")) {
                     setErrorMessage(errorMsg);
                     throw new Error(errorMsg);
                }
                
                if (uploadError instanceof TypeError || (uploadError instanceof Error && uploadError.message.includes('Failed to fetch'))) {
                     throw new Error('Upload error. Check network, ad-blockers, or website Content Security Policy (CSP).');
                }
                throw new Error(uploadError instanceof Error ? `Cloudinary error: ${uploadError.message}` : 'Cloudinary upload failed.');
            }
        }

        const ai = new GoogleGenAI({ apiKey });
        const audioBase64 = await blobToBase64(recording.blob);
        
        let analysis;
        // --- Gemini Analysis Step ---
        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: { parts: [
                    { text: `Analyze this call recording. Provide a concise summary, the customer's sentiment ('Positive', 'Neutral', or 'Negative'), and a list of action items. Return a JSON object.` },
                    { inlineData: { mimeType: recording.mimeType, data: audioBase64 } },
                ] },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT, properties: {
                            summary: { type: Type.STRING },
                            sentiment: { type: Type.STRING },
                            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }, required: ["summary", "sentiment", "actionItems"]
                    }
                },
            });
            if (!response.text) {
              throw new Error("Gemini analysis returned an empty response.");
            }
            analysis = JSON.parse(response.text);
        } catch (geminiError) {
             console.error("Failed to analyze with Gemini:", geminiError);
             throw new Error("Failed to get analysis from AI. Check API key and billing.");
        }

        const reportData = {
          _subject: `Session Insight Report: ${recording.name}`,
          agent: agentProfile.name,
          sentiment: analysis.sentiment || 'N/A',
          summary: analysis.summary || 'No summary available.',
          actionItems: (analysis.actionItems && analysis.actionItems.length > 0) ? analysis.actionItems.map((item:string) => `- ${item}`).join('\n') : 'None',
          audioLink: audioLink,
        };

        setReportingStatus('sending');

        // --- Formspree Sending Step ---
        const formspreeResponse = await fetch(emailConfig.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(reportData)
        });

        if (!formspreeResponse.ok) {
            throw new Error('Failed to send report via Formspree. Check endpoint URL.');
        }

        setReportingStatus('sent');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred. Check the console.';
        console.error("Failed to process and send report:", error);
        setErrorMessage(message);
        setReportingStatus('failed');
    }
  }, [agentProfile, apiKey, isWidgetMode]);

  const endSession = useCallback(() => {
    cleanupServices();
    setWidgetState(WidgetState.Ended);
  }, []);

  const handleSessionEnd = useCallback((blob: Blob, mimeType: string) => {
    if (blob.size === 0) return;
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newRecording: Omit<Recording, 'id' | 'url'> = {
        name: `Recording - ${dateString}, ${timeString}`,
        blob,
        mimeType,
    };
    
    if (isWidgetMode) {
      analyzeAndSendReport(newRecording);
    } else if(onSessionEnd) {
        onSessionEnd({
            ...newRecording,
            id: `rec-${now.getTime()}`,
            url: URL.createObjectURL(blob),
        });
    }
  }, [onSessionEnd, isWidgetMode, analyzeAndSendReport]);

  const cleanupServices = useCallback(() => {
    geminiServiceRef.current?.disconnect();
    geminiServiceRef.current = null;
    
    recordingServiceRef.current?.stop();
    recordingServiceRef.current = null;
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    activeAudioSourcesRef.current.forEach(source => source.stop());
    activeAudioSourcesRef.current.clear();
    
    outputAudioContextRef.current?.close().catch(console.error);
    outputAudioContextRef.current = null;
    
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
  }, []);

  useEffect(() => {
    if (!isWidgetMode) return;
    if (isOpen) {
      window.parent.postMessage({ type: 'agent-widget-resize', width: 400, height: 600 }, '*');
    } else {
      window.parent.postMessage({ type: 'agent-widget-resize', width: 300, height: 140 }, '*');
    }
  }, [isOpen, isWidgetMode]);
  
  useEffect(() => {
    const calloutShown = sessionStorage.getItem('ai-agent-callout-shown');
    let showTimer: number;
    let hideTimer: number;

    if (!isOpen && !calloutShown && agentProfile.calloutMessage) {
      showTimer = window.setTimeout(() => {
        setShowCallout(true);
        sessionStorage.setItem('ai-agent-callout-shown', 'true');
        
        hideTimer = window.setTimeout(() => {
          setShowCallout(false);
        }, 5000); // Display for 5 seconds
      }, 1500); // Initial delay
    }

    if (isOpen) {
        setShowCallout(false);
    }

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isOpen, agentProfile.calloutMessage]);

  const playAudioQueue = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    
    isPlayingRef.current = true;
    if (widgetStateRef.current !== WidgetState.Speaking && widgetStateRef.current !== WidgetState.Error) {
        setWidgetState(WidgetState.Speaking);
    }
    
    const audioContext = outputAudioContextRef.current;
    if (!audioContext) {
      isPlayingRef.current = false;
      return;
    }

    const processNextChunk = () => {
        if(audioQueueRef.current.length === 0) {
            isPlayingRef.current = false;
            if (shouldEndAfterSpeakingRef.current) {
                endSession();
                return;
            }
            if(widgetStateRef.current === WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
            }
            return;
        }

        const chunk = audioQueueRef.current.shift()!;
        const audioBuffer = decodePcmChunk(chunk, audioContext);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        activeAudioSourcesRef.current.add(source);
        source.addEventListener('ended', () => {
            activeAudioSourcesRef.current.delete(source);
        });

        const startTime = Math.max(nextStartTimeRef.current, audioContext.currentTime);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;
        source.onended = processNextChunk;
    }

    processNextChunk();
  }, [endSession]);

  const handleInterruption = useCallback(() => {
    activeAudioSourcesRef.current.forEach(source => {
      source.stop();
    });
    activeAudioSourcesRef.current.clear();
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextStartTimeRef.current = 0;
    if (widgetStateRef.current === WidgetState.Speaking) {
        setWidgetState(WidgetState.Listening);
    }
  }, []);

  const startSession = useCallback(async () => {
    // Check network before starting
    if (!navigator.onLine) {
        setWidgetState(WidgetState.Error);
        setErrorMessage("No internet connection.");
        return;
    }

    shouldEndAfterSpeakingRef.current = false;
    setWidgetState(WidgetState.Connecting);
    setReportingStatus('idle');
    setErrorMessage('');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
    } catch (e) {
      setWidgetState(WidgetState.Error);
      setErrorMessage("Failed to get microphone access.");
      cleanupServices();
      return;
    }
    
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    recordingServiceRef.current = new RecordingService(handleSessionEnd);
    await recordingServiceRef.current.start(stream);

    const greeting = (agentProfile as AgentConfig).initialGreeting;
    if (greeting) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: greeting }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: (agentProfile as AgentConfig).voice },
                        },
                    },
                },
            });
            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const binaryString = atob(base64Audio);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                audioQueueRef.current.push(bytes);
                recordingServiceRef.current?.addAgentAudioChunk(bytes);
                playAudioQueue();
            }
        } catch (error) {
            console.error("Failed to generate greeting audio:", error);
        }
    }

    geminiServiceRef.current = new GeminiLiveService(apiKey, agentProfile as AgentConfig, {
      onStateChange: (state) => {
        if (state === 'connected') {
            if (widgetStateRef.current !== WidgetState.Speaking) {
                setWidgetState(WidgetState.Listening);
            }
        }
        if (state === 'ended') {
            setWidgetState(WidgetState.Ended);
            cleanupServices();
        }
      },
      onTranscriptUpdate: (isFinal, text, type) => {
        if (isFinal && type === 'output') {
          const lowerCaseText = text.toLowerCase();
          const endKeywords = ['goodbye', 'farewell', 'take care', 'talk to you later', 'bye bye', 'bye'];
          if (endKeywords.some(keyword => lowerCaseText.includes(keyword))) {
            shouldEndAfterSpeakingRef.current = true;
          }
        }
      },
      onAudioChunk: (chunk) => {
        audioQueueRef.current.push(chunk);
        recordingServiceRef.current?.addAgentAudioChunk(chunk);
        playAudioQueue();
      },
      onInterruption: handleInterruption,
      onError: (error) => {
        setWidgetState(WidgetState.Error);
        setErrorMessage(error);
        cleanupServices();
      },
    });
    geminiServiceRef.current.connect(stream);
  }, [apiKey, agentProfile, cleanupServices, handleSessionEnd, playAudioQueue, handleInterruption]);
  
  const toggleWidget = () => {
    if (isOpen) {
      endSession();
    }
    setIsOpen(!isOpen);
  };
  
  const getStatusText = () => {
    if (!isOnline) return "Network Connection Lost";
    
    if (widgetState === WidgetState.Ended) {
        switch(reportingStatus) {
            case 'analyzing': return 'Analyzing & uploading...';
            case 'sending': return 'Sending report...';
            case 'sent': return 'Report sent successfully!';
            case 'failed': return errorMessage || 'Failed to generate report.';
            default: return 'Session Ended';
        }
    }
    switch(widgetState){
        case WidgetState.Connecting: return "Connecting...";
        case WidgetState.Listening: return "Listening...";
        case WidgetState.Speaking: return "Speaking...";
        case WidgetState.Error: return errorMessage || "An error occurred";
        default: return "Ready to talk";
    }
  }
  
  const themeClass = agentProfile.theme === 'dark' ? 'dark' : '';

  if (!isOpen) {
    const fabContent = (
      <div className={`${themeClass} relative`}>
        {showCallout && agentProfile.calloutMessage && (
          <div className="absolute top-1/2 right-full mr-4 w-max max-w-[200px] transform -translate-y-1/2 px-4 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg shadow-lg text-left text-sm animate-fade-in-up">
            <p>{agentProfile.calloutMessage}</p>
            <div className="absolute top-1/2 -right-2 w-0 h-0 transform -translate-y-1/2 border-y-8 border-y-transparent border-l-8 border-l-white dark:border-l-gray-800"></div>
          </div>
        )}
        <button onClick={toggleWidget} className={`w-16 h-16 rounded-full bg-accent-${accentColorClass} shadow-lg flex items-center justify-center text-white transform hover:scale-110 transition-transform animate-pulse`}>
          <FabIcon />
        </button>
      </div>
    );
    return isWidgetMode ? <div className="w-full h-full p-2 flex items-end justify-end bg-transparent">{fabContent}</div> : <div className="fixed bottom-5 right-5 z-50">{fabContent}</div>;
  }

  return (
    <div className={`${themeClass} ${isWidgetMode ? 'w-full h-full' : 'fixed bottom-24 right-5 w-96 h-[600px] rounded-2xl shadow-2xl z-40'}`}>
        <div className={`flex flex-col w-full h-full bg-white dark:bg-gray-900 text-black dark:text-white rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700`}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <h3 className="font-bold text-lg">{agentProfile.name}</h3>
                    <NetworkIcon isOnline={isOnline} />
                </div>
                <button onClick={toggleWidget} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div className="flex-grow flex flex-col items-center justify-center p-6 text-center relative">
                {/* Network Instability Overlay */}
                {!isOnline && (
                    <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 z-10 flex flex-col items-center justify-center backdrop-blur-sm">
                        <div className="bg-red-100 dark:bg-red-900/50 p-4 rounded-xl border border-red-200 dark:border-red-700 max-w-[80%]">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600 dark:text-red-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
                            </svg>
                            <h4 className="font-bold text-red-800 dark:text-red-200">Network Unstable</h4>
                            <p className="text-xs text-red-700 dark:text-red-300 mt-1">Check your internet connection. The call may glitch or disconnect.</p>
                        </div>
                    </div>
                )}

                <div className="relative w-48 h-48 flex items-center justify-center mb-4">
                    {widgetState === WidgetState.Connecting && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                    
                    {widgetState === WidgetState.Idle && (
                        <FabIcon className={`h-24 w-24 text-gray-400 dark:text-gray-500`} />
                    )}

                    {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                        <div className="relative w-36 h-36 flex items-center justify-center">
                            {(widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) && (
                                <>
                                    <div className={`absolute w-full h-full rounded-full bg-accent-${accentColorClass} animate-sonar-ping`}></div>
                                    <div className={`absolute w-full h-full rounded-full bg-accent-${accentColorClass} animate-sonar-ping [animation-delay:0.5s]`}></div>
                                </>
                            )}
                            <div className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-colors duration-300 shadow-lg bg-accent-${accentColorClass}`}>
                                {widgetState === WidgetState.Speaking && <div className="absolute inset-0 rounded-full bg-white opacity-20 animate-ping"></div>}
                                <MicrophoneIcon state={widgetState} />
                            </div>
                        </div>
                    )}

                    {widgetState === WidgetState.Error && <div className="text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && (reportingStatus === 'analyzing' || reportingStatus === 'sending') && <Spinner className={`w-24 h-24 text-accent-${accentColorClass}`} />}
                    {widgetState === WidgetState.Ended && reportingStatus === 'sent' && <div className="text-green-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    {widgetState === WidgetState.Ended && reportingStatus === 'failed' && <div className="text-red-500"><svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>}
                    
                </div>
                <p className="text-lg text-gray-600 dark:text-gray-400 h-8 mb-2 break-words max-w-full px-2">{getStatusText()}</p>
                
                <div className="h-10 mb-4 flex items-center justify-center">
                    {(widgetState === WidgetState.Idle || (widgetState === WidgetState.Ended && reportingStatus === 'idle')) && (
                         <p className="text-md text-gray-500 dark:text-gray-300 transition-opacity duration-500">
                           Click the call button to start a conversation.
                        </p>
                    )}
                     {(widgetState === WidgetState.Ended && (reportingStatus === 'sent' || reportingStatus === 'failed')) && (
                         <p className="text-md text-gray-500 dark:text-gray-300 transition-opacity duration-500">
                           You may now close the widget.
                        </p>
                    )}
                </div>

                <div className="h-20">
                    {(widgetState === WidgetState.Connecting || widgetState === WidgetState.Listening || widgetState === WidgetState.Speaking) ? (
                        <button onClick={endSession} className="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg transition-transform transform hover:scale-105" aria-label="End Call">
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 rotate-135" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                        </button>
                    ) : (
                        !(widgetState === WidgetState.Ended && (reportingStatus === 'analyzing' || reportingStatus === 'sending' || reportingStatus === 'sent')) && (
                            <button onClick={startSession} className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center shadow-lg transition-transform transform hover:scale-105" aria-label={widgetState === WidgetState.Error || (widgetState === WidgetState.Ended && reportingStatus === 'failed') ? "Retry" : "Start Call"}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
                            </button>
                        )
                    )}
                </div>
            </div>
        </div>
    </div>
  );
};
