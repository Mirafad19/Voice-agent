
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
    let finalAudioLink = 'Not available.';
    const { fileUploadConfig } = profile;

    if (fileUploadConfig?.cloudinaryCloudName && fileUploadConfig.cloudinaryUploadPreset && recording.blob) {
      setIsUploading(true);
      try {
        finalAudioLink = await getCloudinaryShareableLink(fileUploadConfig.cloudinaryCloudName, fileUploadConfig.cloudinaryUploadPreset, recording);
      } catch (e) {
        console.error("Upload failed", e);
      } finally {
        setIsUploading(false);
      }
    }
    
    const subject = `Session Insight Report: ${recording.name}`;
    const body = `
SESSION INSIGHT REPORT
---
Recording Name: ${recording.name}
Sentiment: ${recording.sentiment || 'N/A'}
Summary: ${recording.summary || 'No summary available.'}
Action Items: ${(recording.actionItems?.length || 0) > 0 ? recording.actionItems!.join(', ') : 'None'}
Audio Link: ${finalAudioLink}
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
            Open email client with pre-formatted analysis.
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
                {isUploading ? <Spinner className="w-5 h-5"/> : 'Open Email'}
            </Button>
        </div>
      </div>
    </Modal>
  );
};
