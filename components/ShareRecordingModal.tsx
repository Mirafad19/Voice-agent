import React, { useState } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Recording, AgentProfile } from '../types';
import { Spinner } from './ui/Spinner';

interface ShareRecordingModalProps {
  isOpen: boolean;
  onClose: () => void;
  recording: Recording | null;
  profile: AgentProfile | null;
  apiKey: string | null;
}

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


export const ShareRecordingModal: React.FC<ShareRecordingModalProps> = ({ isOpen, onClose, recording, profile }) => {
  const [recipientEmail, setRecipientEmail] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  if (!recording || !profile) return null;

  const handleSend = async () => {
    let finalAudioLink = 'Not available. Please access from the dashboard.';
    const { fileUploadConfig } = profile;

    if (fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset && recording.blob) {
      setIsUploading(true);
      try {
        finalAudioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
      } catch (e) {
        console.error("Upload failed", e);
        const message = e instanceof Error ? e.message : 'An unknown error occurred.';
        alert(`Could not upload audio file to generate a shareable link: ${message}. The email will be generated without it.`);
      } finally {
        setIsUploading(false);
      }
    } else {
        alert("Cloudinary is not configured. The email will be generated without a shareable audio link.");
    }
    
    const subject = `Session Insight Report: ${recording.name}`;
    const body = `
Hello,

Please find the analysis for the recent AI agent session below.

---
SESSION INSIGHT REPORT
---

Recording Name: ${recording.name}
Sentiment: ${recording.sentiment || 'N/A'}

Summary:
${recording.summary || 'No summary available.'}

Action Items:
${(recording.actionItems && recording.actionItems.length > 0) ? recording.actionItems.map(item => `- ${item}`).join('\n') : 'None'}

---

To listen to the full conversation, please use this link:
${finalAudioLink}

Best regards,
AI Voice Agent Dashboard
    `;

    const mailtoLink = `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    window.location.href = mailtoLink;
    onClose();
    setRecipientEmail('');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send Session Insight">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This will open your default email client with a pre-formatted message containing the session analysis. If cloud storage is configured, an audio link will be generated.
        </p>
        
        <Input
          label="Recipient Email"
          id="recipientEmail"
          type="email"
          placeholder="manager@example.com"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
        />

        <div className="flex justify-end space-x-3 pt-4">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSend} disabled={!recipientEmail || isUploading}>
                {isUploading ? <Spinner className="w-5 h-5"/> : 'Generate & Open Email'}
            </Button>
        </div>
      </div>
    </Modal>
  );
};
