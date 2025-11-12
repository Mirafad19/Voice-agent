import React, { useState } from 'react';
import { AgentProfile, Recording } from '../types';
import { GoogleGenAI, Type } from '@google/genai';
import { blobToBase64 } from '../utils';
import { Spinner } from './ui/Spinner';
import { ShareRecordingModal } from './ShareRecordingModal';

interface RecordingsPanelProps {
  recordings: Recording[];
  onDelete: (id: string) => void;
  onUpdate: (recording: Recording) => void;
  apiKey: string;
  profile: AgentProfile;
}

const AudioPlayerIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.858 8.464a5 5 0 000 7.072m2.828 9.9a9 9 0 000-12.728M12 15a3 3 0 100-6 3 3 0 000 6z" />
  </svg>
);

const AnalyzeIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
);

const EmailIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
);

const SentimentBadge: React.FC<{ sentiment: string }> = ({ sentiment }) => {
    const sentimentColors = {
        'Positive': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        'Neutral': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        'Negative': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    const colorClass = sentimentColors[sentiment as keyof typeof sentimentColors] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    return (
        <span className={`px-2 py-1 text-xs font-medium rounded-full ${colorClass}`}>{sentiment}</span>
    );
};

// Helper function to upload and get a shareable link from Cloudinary
async function getCloudinaryShareableLink(cloudName: string, uploadPreset: string, recording: Recording): Promise<string> {
    const formData = new FormData();
    formData.append('file', recording.blob);
    formData.append('upload_preset', uploadPreset);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Cloudinary upload failed: ${errorData.error.message}`);
    }

    const result = await response.json();
    return result.secure_url;
}


export const RecordingsPanel: React.FC<RecordingsPanelProps> = ({ recordings, onDelete, onUpdate, apiKey, profile }) => {
  const [recordingToShare, setRecordingToShare] = useState<Recording | null>(null);
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  
  const handleAnalyze = async (recording: Recording) => {
    onUpdate({ ...recording, isAnalyzing: true });

    try {
        const ai = new GoogleGenAI({ apiKey });
        const audioBase64 = await blobToBase64(recording.blob);

        const textPart = {
            text: `You are a highly skilled call center analyst. Your task is to analyze the following customer service call recording.
            Please provide a concise summary of the conversation, assess the customer's sentiment, and list any explicit action items for the support agent.
            Return the analysis in a JSON object.`,
        };

        const audioPart = {
            inlineData: {
                mimeType: recording.mimeType,
                data: audioBase64,
            },
        };

        const responseSchema = {
            type: Type.OBJECT,
            properties: {
                summary: {
                    type: Type.STRING,
                    description: "A brief paragraph summarizing the call."
                },
                sentiment: {
                    type: Type.STRING,
                    description: "One of the following: 'Positive', 'Neutral', 'Negative'."
                },
                actionItems: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "A list of clear action items. Return an empty array if there are none."
                }
            },
            required: ["summary", "sentiment", "actionItems"]
        };
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: { parts: [textPart, audioPart] },
            config: {
                responseMimeType: "application/json",
                responseSchema
            },
        });
        
        const result = JSON.parse(response.text);
        
        onUpdate({
            ...recording,
            isAnalyzing: false,
            summary: result.summary,
            sentiment: result.sentiment,
            actionItems: result.actionItems,
        });

    } catch (error) {
        console.error("Failed to analyze recording:", error);
        alert("An error occurred while analyzing the recording. Please check the console for details.");
        onUpdate({ ...recording, isAnalyzing: false });
    }
  };

  const handleSendEmail = async (recording: Recording) => {
    const { emailConfig, fileUploadConfig } = profile;
    if (!emailConfig?.formspreeEndpoint) {
        alert("Formspree endpoint is not configured. Please set it in the Agent Configuration section.");
        return;
    }
    
    setSendingEmailId(recording.id);

    try {
        let downloadUrl = "Not available: Cloudinary not configured.";
        if (fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset) {
            try {
                downloadUrl = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
            } catch (error) {
                const errorText = error instanceof Error ? error.message : JSON.stringify(error);
                console.error("Failed to get Cloudinary link:", errorText);
                alert(`Failed to get audio link from Cloudinary: ${errorText}. The report will be generated without it.`);
                downloadUrl = `Failed to generate link: ${errorText}`;
            }
        }

        const reportData = {
            _subject: `Session Insight Report: ${recording.name}`,
            agent: profile.name,
            sentiment: recording.sentiment || 'N/A',
            summary: recording.summary || 'No summary available.',
            actionItems: (recording.actionItems && recording.actionItems.length > 0) ? recording.actionItems.map(item => `- ${item}`).join('\n') : 'None',
            audioLink: downloadUrl,
        };

        const response = await fetch(emailConfig.formspreeEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(reportData)
        });

        if (!response.ok) {
            throw new Error('Failed to send report via Formspree. Check endpoint URL.');
        }
        
        alert("Report sent successfully!");

    } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred.";
        console.error("Failed to send report:", error);
        alert(`Failed to send report: ${message}`);
    } finally {
        setSendingEmailId(null);
    }
  };

  if (recordings.length === 0) {
    return (
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Session Recordings</h3>
            <p className="text-gray-500 dark:text-gray-400">No recordings yet. Your conversations with the agent will appear here.</p>
        </div>
    );
  }

  return (
    <>
    <div className="mt-8 bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Session Recordings</h3>
      <ul className="space-y-4">
        {recordings.map((rec) => {
          const fileExtension = rec.mimeType?.split('/')[1]?.split(';')[0] || 'wav';
          const downloadName = `${rec.name}.${fileExtension}`;

          return (
            <li key={rec.id} className="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg shadow-sm transition-all">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4 min-w-0">
                        <AudioPlayerIcon />
                        <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{rec.name}</span>
                    </div>
                    <div className="flex items-center space-x-2 flex-shrink-0">
                        <audio controls src={rec.url} className="h-10"></audio>
                        {!rec.summary && (
                             <button
                                onClick={() => handleAnalyze(rec)}
                                disabled={rec.isAnalyzing}
                                className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Analyze Session"
                            >
                                {rec.isAnalyzing ? <Spinner className="w-5 h-5 text-indigo-500" /> : <AnalyzeIcon />}
                            </button>
                        )}
                         {rec.summary && (
                            <>
                            <button
                                onClick={() => handleSendEmail(rec)}
                                disabled={sendingEmailId === rec.id}
                                className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                                title="Send Report via Email"
                            >
                                {sendingEmailId === rec.id ? <Spinner className="w-5 h-5 text-indigo-500"/> : <EmailIcon />}
                            </button>
                            <button
                                onClick={() => setRecordingToShare(rec)}
                                className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                                title="Share Insights"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                                </svg>
                            </button>
                            </>
                        )}
                        <a
                        href={rec.url}
                        download={downloadName}
                        className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                        title="Download"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        </a>
                        <button
                        onClick={() => onDelete(rec.id)}
                        className="p-2 rounded-md hover:bg-red-100 dark:hover:bg-red-900/50"
                        title="Delete"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                </div>

                {rec.summary && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                       <div className="flex justify-between items-start">
                         <h4 className="text-base font-semibold text-gray-900 dark:text-white">Session Insights</h4>
                         {rec.sentiment && <SentimentBadge sentiment={rec.sentiment} />}
                       </div>
                       
                       <div>
                            <h5 className="font-semibold mb-1">Summary</h5>
                            <p className="text-gray-600 dark:text-gray-400">{rec.summary}</p>
                       </div>
                       
                       {rec.actionItems && rec.actionItems.length > 0 && (
                         <div>
                            <h5 className="font-semibold mb-1">Action Items</h5>
                            <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400">
                                {rec.actionItems.map((item, index) => <li key={index}>{item}</li>)}
                            </ul>
                         </div>
                       )}
                    </div>
                )}
            </li>
          );
        })}
      </ul>
    </div>
    <ShareRecordingModal
        isOpen={!!recordingToShare}
        onClose={() => setRecordingToShare(null)}
        recording={recordingToShare}
        profile={profile}
        apiKey={apiKey}
    />
    </>
  );
};