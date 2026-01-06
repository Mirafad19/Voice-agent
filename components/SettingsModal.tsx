
import React, { useState, useRef } from 'react';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string | null;
  onUpdateApiKey: (key: string) => void;
  onExportProfiles: () => void;
  onImportProfiles: (file: File) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, 
  onClose, 
  apiKey, 
  onUpdateApiKey,
  onExportProfiles,
  onImportProfiles
}) => {
  const [tempKey, setTempKey] = useState(apiKey || '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveKey = () => {
    if (tempKey.trim()) {
      onUpdateApiKey(tempKey.trim());
      alert("API Key updated successfully.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        onImportProfiles(file);
        e.target.value = '';
    }
  };

  const triggerImport = () => fileInputRef.current?.click();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings & Data">
      <div className="space-y-8">
        <section className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Data Backup & Restore
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
                Configurations are stored in-browser. Backup regularly.
            </p>
            <div className="flex gap-4">
                <Button onClick={onExportProfiles} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                    Download Backup
                </Button>
                <Button onClick={triggerImport} variant="secondary" className="flex-1">
                    Restore Backup
                </Button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".json" className="hidden" />
            </div>
        </section>

        <section className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Gemini API Key
            </h4>
            <div className="flex gap-2 items-end">
                <div className="flex-grow">
                    <Input label="API Key" id="apiKeySettings" type="password" value={tempKey} onChange={(e) => setTempKey(e.target.value)} />
                </div>
                <Button onClick={handleSaveKey}>Update</Button>
            </div>
        </section>
      </div>
    </Modal>
  );
};
