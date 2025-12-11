
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
        // Reset input value so the same file can be selected again if needed
        e.target.value = '';
    }
  };

  const triggerImport = () => {
      fileInputRef.current?.click();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings & Data">
      <div className="space-y-8">
        
        {/* Data Management Section */}
        <section className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Data Backup & Restore
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400">
                Your agent configurations are stored in your browser. To prevent data loss (e.g., clearing history), 
                download a backup file regularly.
            </p>
            <div className="flex gap-4">
                <Button onClick={onExportProfiles} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                    <span className="flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                        Download Backup
                    </span>
                </Button>
                <Button onClick={triggerImport} variant="secondary" className="flex-1">
                     <span className="flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1xsM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                        Restore Backup
                     </span>
                </Button>
                <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    accept=".json" 
                    className="hidden" 
                />
            </div>
        </section>

        {/* API Key Section */}
        <section className="space-y-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Gemini API Key
            </h4>
            <div className="flex gap-2 items-end">
                <div className="flex-grow">
                    <Input 
                        label="API Key" 
                        id="apiKeySettings" 
                        type="password" 
                        value={tempKey} 
                        onChange={(e) => setTempKey(e.target.value)} 
                    />
                </div>
                <Button onClick={handleSaveKey}>Update</Button>
            </div>
        </section>

      </div>
    </Modal>
  );
};
